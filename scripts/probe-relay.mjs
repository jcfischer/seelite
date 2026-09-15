/**
 * Node #43's browser tier: the pirate relay's discover → intervene → persist →
 * revisit loop in the running game.
 *
 * The headless rows own the arithmetic — `tests/pirate-relay.test.ts` (the
 * plan, the signal, the lifecycle), `tests/raider-slots.test.ts` and
 * `tests/encounter.test.ts` (the detection dial on the leg law). What only the
 * page can answer is the wiring, in the loop's own order:
 *
 * - beyond the signal's range there is nothing: no cue, no contact, no target;
 * - **before**: a leg to the watched station meets a raider, a leg to the
 *   other station meets one at the law;
 * - inside the signal's range the cue reads, and the relay is still not a
 *   target — identification is a knowledge write inside its own range, and
 *   only then is the relay a contact, a target and a marker;
 * - the pulse laser, fired along the sightline, spends the relay's hull and
 *   the kill lands in world state with the player's provenance;
 * - **after**: a leg to the watched station meets nothing, the other route
 *   is untouched, and a raider already on the player is not made to vanish;
 * - the save round-trips the kill; a jump out and back finds it destroyed;
 * - the wreck is drawn, and the Communications log names the kill, the
 *   repair and the replacement on the clock.
 *
 * The before and after arms fly real legs: `forceRaider` is for reach checks
 * and never for the measurement.
 *
 * `HEADED=1` also writes 1440x900 captures of the cue, the relay and the
 * wreck under `RELAY_EVIDENCE` (default `/tmp/seelite-43-evidence`) for the
 * principal's look. On SwiftShader they are the wiring's picture, not the
 * player's.
 */
import { mkdirSync } from "node:fs";
import { PNG } from "pngjs";
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const headed = process.env.HEADED === "1";
const out = process.env.RELAY_EVIDENCE ?? "/tmp/seelite-43-evidence";
if (headed) mkdirSync(out, { recursive: true });
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: !headed });
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
watch(page);
await page.goto(gameUrl(origin, { seed: 42, "relay-prototype": true }));
await bootedGame(page);
const capture = async (name) => {
	if (headed) await page.screenshot({ path: `${out}/${name}.png` });
};
/** A few animation frames, so the cockpit's DOM catches up with a render. */
const settle = () =>
	page.evaluate(
		() =>
			new Promise((done) => {
				let n = 3;
				const tick = () => (n-- ? requestAnimationFrame(tick) : done());
				requestAnimationFrame(tick);
			}),
	);

// The page-side helpers, installed once. Every one of them drives the shipped
// game through its public handle.
await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const frame = () => {
		g.step(dt);
		g.render(dt);
	};
	window.__relayProbe = {
		/** Spool into cruise toward `targetId` `count` times, reading whether
		 *  the leg drew a raider and what the relay's dial said. Each leg is
		 *  ended before the raider appears; the next spool draws on a new
		 *  second. */
		flyLegs(targetId, count) {
			const met = [];
			const detections = new Set();
			for (let i = 0; i < count; i++) {
				g.targetId = targetId;
				g.engageCruise();
				for (let s = 0; s < 200 && g.regime !== "cruise"; s++) g.step(dt);
				if (g.regime !== "cruise")
					throw new Error(`leg ${i}: never reached cruise (${g.lastExit})`);
				detections.add(g.relayReadout().detection);
				met.push(g.encounter !== null);
				g.dropOut("probe");
				g.encounter = null;
				g.world.gameTime += 1.5;
				g.step(dt);
			}
			return { met, detections: [...detections] };
		},
		/** Put the ship `km` from the relay, at rest beside it, nose on it. */
		placeNear(km) {
			g.dropOut("probe");
			g.encounter = null;
			const r = g.relayReadout();
			g.world.ship.pos = {
				x: r.view.pos.x + km,
				y: r.view.pos.y,
				z: r.view.pos.z,
			};
			g.world.ship.vel = { ...r.view.vel };
			g.throttle = 0;
			g.setAttitude({ x: -1, y: 0, z: 0 }, g.shipUp());
			g.setHeadLook("forward");
			frame();
		},
		/** Put the ship well clear of the watched station's planet, so a leg
		 *  can be spooled from here: the relay itself stands inside the guard
		 *  shell a cruise leg is dropped by. */
		placeFar() {
			g.dropOut("probe");
			g.encounter = null;
			const r = g.relayReadout();
			g.world.ship.pos = {
				x: r.view.pos.x + 60_000,
				y: r.view.pos.y + 20_000,
				z: r.view.pos.z,
			};
			g.world.ship.vel = { ...r.view.vel };
			g.throttle = 0;
			frame();
		},
		/** What the probe reads of the relay and the glass. */
		readout() {
			const r = g.relayReadout();
			const cue = document.querySelector("[data-live-relay-cue]");
			return {
				km: r.view?.signal?.km ?? null,
				strength: r.view?.signal?.strength ?? null,
				identified: r.view?.identified ?? null,
				condition: r.view?.condition ?? null,
				listed: r.listed,
				hull: r.hull,
				detection: r.detection,
				targetable: r.view ? g.selectableIds().includes(r.view.key) : false,
				cueHidden: cue?.hidden ?? null,
				// The attribute alone is not the state: an id rule with `display`
				// beats `[hidden]`, and a badge once showed on every page while a
				// probe reading `el.hidden` passed.
				cueVisible: cue ? cue.checkVisibility() : null,
				cueText: cue?.textContent ?? "",
				targetText:
					document.querySelector("[data-live-director] > strong")
						?.textContent ?? "",
				meshCondition: g.relayMesh.root.userData.condition,
				meshDrawn: g.relayMesh.root.parent !== null,
				lastExit: g.lastExit,
				key: r.view?.key ?? null,
			};
		},
		/** Hold the trigger on the relay until it is destroyed or `maxSteps`
		 *  pass, aiming each frame before the step. */
		shoot(maxSteps) {
			const r0 = g.relayReadout();
			g.targetId = r0.view.key;
			const hullBefore = r0.hull;
			g.keys.add(" ");
			let steps = 0;
			for (; steps < maxSteps; steps++) {
				const r = g.relayReadout();
				if (r.view.condition !== "operational") break;
				const p = g.world.ship.pos;
				const t = r.view.pos;
				g.setAttitude({ x: t.x - p.x, y: t.y - p.y, z: t.z - p.z }, g.shipUp());
				frame();
			}
			g.keys.delete(" ");
			return { hullBefore, steps, killedAt: g.world.gameTime };
		},
		/** A jump to the nearest other system and back, through the shipped
		 *  course and charge; the tank is topped up for the return, because
		 *  fuel is not what this row is about. */
		jumpOutAndBack() {
			const here = g.world.system.record;
			const d = (a, b) =>
				Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
			const near = g.world.galaxy.systems
				.filter((s) => s.index !== here.index)
				.sort((a, b) => d(a, here) - d(b, here))[0];
			g.dropOut("probe");
			g.encounter = null;
			const leg = (toIndex) => {
				const committed = g.commitCourseTo(toIndex);
				const charged = g.chargeJump();
				for (let i = 0; i < 80 && g.world.system.record.index !== toIndex; i++)
					frame();
				// One more: the jump is taken at the end of the frame that armed
				// it, and that frame read the relay of the system being left.
				frame();
				return {
					committed,
					charged,
					notice: g.jumpNotice,
					arrived: g.world.system.record.index === toIndex,
				};
			};
			const outward = leg(near.index);
			const awayReadout = window.__relayProbe.readout();
			g.commander = { ...g.commander, fuelLy: 7 };
			const back = leg(here.index);
			frame();
			return {
				near: near.index,
				distanceLy: d(near, here),
				outward,
				awayReadout,
				back,
			};
		},
		/** The Communications log at `t`, with the relay's condition then. */
		logAt(t, key) {
			g.encounter = null;
			g.world.gameTime = t;
			g.leftTab = "Communications";
			g.setHeadLook("left");
			frame();
			return {
				condition: g.carrierCondition(key).condition,
				instance: g.carrierCondition(key).instanceOrdinal,
				lines: [...document.querySelectorAll("[data-live-raider-log] li")].map(
					(li) => li.textContent,
				),
			};
		},
		frame,
	};
});

// ---------------------------------------------------------------------------
// Far away: nothing to read, nothing to target.
// ---------------------------------------------------------------------------
const far = await page.evaluate(() => {
	const g = window.__seelite;
	g.resetFlightToStart();
	window.__relayProbe.frame();
	const r = g.relayReadout();
	const km = Math.hypot(
		r.view.pos.x - g.world.ship.pos.x,
		r.view.pos.y - g.world.ship.pos.y,
		r.view.pos.z - g.world.ship.pos.z,
	);
	return {
		enabled: r.enabled,
		watched: r.plan?.watchedStationId,
		distanceKm: km,
		...window.__relayProbe.readout(),
	};
});
check(
	"the prototype is on and the relay watches the trade station",
	far.enabled && far.watched === "station-trade",
	JSON.stringify(far),
);
check(
	"at the arrival point there is no signal, no contact, no target and no cue",
	far.distanceKm > 10_000 &&
		far.strength === null &&
		!far.identified &&
		!far.listed &&
		!far.targetable &&
		far.cueHidden === true &&
		far.cueVisible === false &&
		far.condition === "operational",
	JSON.stringify(far),
);

// ---------------------------------------------------------------------------
// Before: legs flown to each station with the relay up.
// ---------------------------------------------------------------------------
const before = await page.evaluate(() =>
	window.__relayProbe.flyLegs("station-trade", 6),
);
check(
	"before: every leg to the watched station meets a raider, detection certain",
	before.met.every(Boolean) && before.detections.join() === "certain",
	JSON.stringify(before),
);
const controlBefore = await page.evaluate(() =>
	window.__relayProbe.flyLegs("station-shipyard", 24),
);
check(
	"before: legs to the other station meet raiders at the law — some, not all",
	controlBefore.detections.join() === "law" &&
		controlBefore.met.some(Boolean) &&
		!controlBefore.met.every(Boolean),
	JSON.stringify(controlBefore),
);

// ---------------------------------------------------------------------------
// Inside the signal's range: the cue reads and the relay is still hidden.
// ---------------------------------------------------------------------------
await page.evaluate(() => window.__relayProbe.placeNear(1200));
await settle();
const signalled = await page.evaluate(() => window.__relayProbe.readout());
check(
	"inside the signal's range the cue reads strength and bearing, and the relay is not yet a contact or a target",
	signalled.km !== null &&
		signalled.km > 1000 &&
		signalled.strength > 0 &&
		signalled.strength < 1 &&
		!signalled.identified &&
		!signalled.listed &&
		!signalled.targetable &&
		signalled.cueHidden === false &&
		signalled.cueVisible === true &&
		/SIGNAL/.test(signalled.cueText) &&
		/off nose/.test(signalled.cueText) &&
		!/km/.test(signalled.cueText),
	JSON.stringify(signalled),
);
await capture("01-signal-cue");

// ---------------------------------------------------------------------------
// Inside identification range: a knowledge row, a contact, a target.
// ---------------------------------------------------------------------------
await page.evaluate(() => window.__relayProbe.placeNear(100));
await settle();
const identified = await page.evaluate(async () => {
	const g = window.__seelite;
	const ws = await import("/src/world-state.ts");
	const key = g.relayReadout().view.key;
	const row = ws.readKnowledge(
		g.saveEnvelope().world.galaxies[g.world.system.record.galaxy],
		key,
	);
	return { ...window.__relayProbe.readout(), row };
});
check(
	"inside identification range the relay is identified: a knowledge row with its source, a contact, a target, and the cue says so",
	identified.identified &&
		identified.listed &&
		identified.targetable &&
		identified.row?.source === "identification" &&
		identified.row?.observedCondition === "operational" &&
		/IDENTIFIED/.test(identified.cueText) &&
		/km/.test(identified.cueText) &&
		identified.lastExit === "pirate relay identified",
	JSON.stringify(identified),
);
await capture("02-identified");

// ---------------------------------------------------------------------------
// The shot: ten seconds of pulse fire along the sightline, then the kill.
// ---------------------------------------------------------------------------
await page.evaluate(() => window.__relayProbe.placeNear(1.5));
const kill = await page.evaluate(() => {
	const done = window.__relayProbe.shoot(400);
	return { ...done, ...window.__relayProbe.readout() };
});
check(
	"the pulse laser spends the relay's hull and the kill writes the slot's destruction with the player's provenance",
	kill.hullBefore > 0 &&
		kill.hull === 0 &&
		kill.condition === "destroyed" &&
		kill.lastExit === "pirate relay destroyed" &&
		kill.steps >= 90 &&
		kill.steps <= 130,
	JSON.stringify(kill),
);
const provenance = await page.evaluate(async () => {
	const g = window.__seelite;
	const key = g.relayReadout().view.key;
	const env = g.saveEnvelope().world.galaxies[g.world.system.record.galaxy];
	const episode = env.episodes[key];
	return {
		kind: episode?.initiating.kind,
		role: episode?.initiating.cause.playerRole,
		area: env.objective[key]?.scheduled?.consequenceArea,
	};
});
check(
	"the episode records a destroy by the player, and its consequence area is the route",
	provenance.kind === "destroy" &&
		provenance.role === "direct" &&
		provenance.area === "route:58:station-trade",
	JSON.stringify(provenance),
);
await settle();
// The cue and the marker read one relay: both are evaluated at the clock as
// it stands, so their ranges agree to within one step of relative motion. The
// first capture had them 0.9 km apart at 4.9 km.
const ranges = await page.evaluate(() => {
	const g = window.__seelite;
	window.__relayProbe.placeNear(4.9);
	g.targetId = g.relayReadout().view.key;
	window.__relayProbe.frame();
	const cue =
		document.querySelector("[data-live-relay-cue]")?.textContent ?? "";
	const cueKm = Number(/(\d[\d,]*) km/.exec(cue)?.[1]?.replace(",", ""));
	const targetKm = g.targetRange();
	return { cueKm, targetKm, cue };
});
check(
	"the cue and the target panel read the relay at the same clock: their ranges agree",
	Number.isFinite(ranges.cueKm) &&
		Math.abs(ranges.cueKm - ranges.targetKm) < 0.6,
	JSON.stringify(ranges),
);
await page.evaluate(() => window.__relayProbe.placeNear(4.9));
await settle();
await capture("03-wreck-close");

// ---------------------------------------------------------------------------
// After: the watched route meets nothing, the other route is untouched, and
// a raider already on the player stays.
// ---------------------------------------------------------------------------
await page.evaluate(() => window.__relayProbe.placeFar());
const after = await page.evaluate(() =>
	window.__relayProbe.flyLegs("station-trade", 6),
);
check(
	"after: no leg to the watched station meets a raider, detection none",
	after.met.every((m) => !m) && after.detections.join() === "none",
	JSON.stringify(after),
);
await page.evaluate(() => window.__relayProbe.placeFar());
const controlAfter = await page.evaluate(() =>
	window.__relayProbe.flyLegs("station-shipyard", 24),
);
check(
	"after: legs to the other station still meet raiders at the law",
	controlAfter.detections.join() === "law" &&
		controlAfter.met.some(Boolean) &&
		!controlAfter.met.every(Boolean),
	JSON.stringify(controlAfter),
);
const duel = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	window.__relayProbe.placeFar();
	g.targetId = "station-trade";
	g.engageCruise();
	for (let s = 0; s < 200 && g.regime !== "cruise"; s++) g.step(dt);
	// A raider on demand: the reach check, not the measurement.
	g.forceRaider("ahead", 0.5, 12);
	for (let i = 0; i < 900 && g.encounter?.phase !== "duel"; i++)
		window.__relayProbe.frame();
	const phase = g.encounter?.phase ?? null;
	for (let i = 0; i < 30; i++) window.__relayProbe.frame();
	return {
		phase,
		still: g.encounter?.phase ?? null,
		detection: g.relayReadout().detection,
	};
});
check(
	"a raider already on the player is not made to vanish by the relay's loss",
	duel.phase === "duel" && duel.still === "duel" && duel.detection === "none",
	JSON.stringify(duel),
);

// ---------------------------------------------------------------------------
// Persistence: the save round-trips the kill, and a jump out and back finds
// the relay destroyed, identified and drawn as a wreck.
// ---------------------------------------------------------------------------
const roundTrip = await page.evaluate(async () => {
	const g = window.__seelite;
	g.encounter = null;
	g.dropOut("probe");
	const ws = await import("/src/world-state.ts");
	const key = g.relayReadout().view.key;
	const env = g.saveEnvelope();
	const parsed = ws.parseWorld(
		JSON.parse(JSON.stringify(ws.serializeWorld(env.world))),
	);
	const galaxy = g.world.system.record.galaxy;
	return {
		condition: ws.effectiveCarrier(
			parsed.galaxies[galaxy],
			key,
			g.world.gameTime,
		).condition,
		role: parsed.galaxies[galaxy].episodes[key]?.initiating.cause.playerRole,
		known: ws.readKnowledge(parsed.galaxies[galaxy], key)?.source,
	};
});
check(
	"the serialized world parses back with the relay destroyed, the kill attributed and the knowledge row updated by the kill",
	// §3.1: a player-caused transition updates knowledge at once, so the row
	// identification wrote now reads the kill as its source.
	roundTrip.condition === "destroyed" &&
		roundTrip.role === "direct" &&
		roundTrip.known === "intervention",
	JSON.stringify(roundTrip),
);
const trip = await page.evaluate(() => window.__relayProbe.jumpOutAndBack());
check(
	"a jump out reaches another system, where the relay read is that system's own",
	trip.outward.arrived &&
		trip.awayReadout.condition === "operational" &&
		!trip.awayReadout.identified,
	JSON.stringify(trip),
);
const returned = await page.evaluate(() => {
	window.__relayProbe.placeNear(0.4);
	return window.__relayProbe.readout();
});
check(
	"a jump back finds the relay destroyed, still identified, drawn as a wreck",
	trip.back.arrived &&
		returned.condition === "destroyed" &&
		returned.identified &&
		returned.meshDrawn &&
		returned.meshCondition === "destroyed",
	JSON.stringify({ back: trip.back, returned }),
);

// The wreck is on the screen: pixels move when its mesh is hidden.
const wreckPixels = async () => {
	await page.evaluate(() => window.__relayProbe.frame());
	const shown = PNG.sync.read(await page.screenshot());
	await page.evaluate(() => {
		window.__seelite.relayMesh.root.visible = false;
		window.__relayProbe.frame();
	});
	const hidden = PNG.sync.read(await page.screenshot());
	await page.evaluate(() => {
		window.__seelite.relayMesh.root.visible = true;
		window.__relayProbe.frame();
	});
	let moved = 0;
	for (let i = 0; i < shown.data.length; i += 4)
		if (
			Math.abs(shown.data[i] - hidden.data[i]) > 24 ||
			Math.abs(shown.data[i + 1] - hidden.data[i + 1]) > 24 ||
			Math.abs(shown.data[i + 2] - hidden.data[i + 2]) > 24
		)
			moved++;
	return moved;
};
const wreckMoved = await wreckPixels();
check(
	"the wreck is drawn: hiding its mesh moves pixels on the glass",
	wreckMoved > 200,
	`${wreckMoved} px moved past 24/255`,
);
await capture("04-wreck-after-return");

// ---------------------------------------------------------------------------
// The lifecycle on the clock, in the Communications log.
// ---------------------------------------------------------------------------
const key = kill.key;
const t0 = await page.evaluate(() => window.__seelite.world.gameTime);
const atKill = await page.evaluate(
	([t, k]) => window.__relayProbe.logAt(t, k),
	[t0 + 1, key],
);
const repairing = await page.evaluate(
	([t, k]) => window.__relayProbe.logAt(t, k),
	[kill.killedAt + 1201, key],
);
const replaced = await page.evaluate(
	([t, k]) => window.__relayProbe.logAt(t, k),
	[kill.killedAt + 3601, key],
);
check(
	"the Communications log names the relay's destruction",
	atKill.condition === "destroyed" &&
		atKill.lines.some((l) => l.endsWith("Pirate relay destroyed")),
	JSON.stringify(atKill),
);
check(
	"twenty minutes on, the relay is repairing and the log says so",
	repairing.condition === "repairing" &&
		repairing.lines.some((l) => l.endsWith("Pirate relay under repair")),
	JSON.stringify(repairing),
);
check(
	"an hour on, the relay is replaced, back in service, and drawn lit again",
	replaced.condition === "operational" &&
		replaced.instance === 1 &&
		replaced.lines.some((l) => l.endsWith("Pirate relay back in service")),
	JSON.stringify(replaced),
);
const relit = await page.evaluate(() => {
	const g = window.__seelite;
	// A look left and back rebuilds the cockpit; the cue must come back with
	// it (sage #350: it stayed empty until its key moved).
	g.setHeadLook("left");
	window.__relayProbe.frame();
	g.setHeadLook("forward");
	window.__relayProbe.placeNear(0.4);
	g.targetId = "station-trade";
	return window.__relayProbe.readout();
});
await settle();
const relitCue = await page.evaluate(() => window.__relayProbe.readout());
check(
	"the replacement is drawn operational, watches the route again, and the cue is back after a cockpit rebuild",
	relit.condition === "operational" &&
		relit.meshCondition === "operational" &&
		relit.detection === "certain" &&
		relit.hull === 60 &&
		relitCue.cueVisible === true &&
		/IDENTIFIED/.test(relitCue.cueText),
	JSON.stringify({ relit, relitCue }),
);
// The replacement starts whole: one pulse wears it, it does not die (sage
// #350 — it inherited the wreck's zero hull and fell to the first shot).
const pulse = await page.evaluate(() => {
	const g = window.__seelite;
	window.__relayProbe.placeNear(1.5);
	g.targetId = g.relayReadout().view.key;
	const r = g.relayReadout();
	const p = g.world.ship.pos;
	const t = r.view.pos;
	g.setAttitude({ x: t.x - p.x, y: t.y - p.y, z: t.z - p.z }, g.shipUp());
	g.keys.add(" ");
	window.__relayProbe.frame();
	g.keys.delete(" ");
	return window.__relayProbe.readout();
});
check(
	"one pulse at the replacement wears its hull and leaves it operational",
	pulse.hull < 60 && pulse.hull > 50 && pulse.condition === "operational",
	JSON.stringify(pulse),
);
await capture("05-replaced");

await browser.close();
exit();
