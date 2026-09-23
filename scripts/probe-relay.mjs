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
// **A normal boot, no flag (#351).** The relay is production content, active by
// a seeded roll per system that falls with government, so the probe needs a
// start system whose roll came up: seed 56 starts in ESLAIN (government 6, a
// trade station and a shipyard — RAAQU's layout). Seed 42's RAAQU rolled
// inactive, and the last block below boots it to check the relay is absent.
// Both are asserted rather than assumed, so a re-tuned chance that flips
// either one fails here by name.
const RELAY_SEED = 56;
const NO_RELAY_SEED = 42;
await page.goto(gameUrl(origin, { seed: RELAY_SEED }));
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
		/** #481: fit or strip the long-range scanner, the module the whole
		 *  reading channel is gated on. The name comes from `market.ts` rather
		 *  than from a literal here, because a probe with its own copy of a
		 *  constant goes falsely red the day the module is renamed. */
		async fitScanner(own) {
			const market = await import("/src/market.ts");
			g.commander.ownedEquipment = own ? [market.LONG_RANGE_SCANNER] : [];
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
				active: r.active,
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
		active: r.active,
		watched: r.plan?.watchedStationId,
		distanceKm: km,
		...window.__relayProbe.readout(),
	};
});
check(
	"a normal boot: the start system's relay is active and watches the trade station",
	far.active && far.watched === "station-trade",
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
	window.__relayProbe.flyLegs("station-trade", 24),
);
const controlBefore = await page.evaluate(() =>
	window.__relayProbe.flyLegs("station-shipyard", 24),
);
const metCount = (arm) => arm.met.filter(Boolean).length;
check(
	// #351's rate is 90%: over 24 legs the mean is 21.6 and the sd 1.5, so 16
	// is almost four below it. The law here is about a quarter, so the
	// watched route must also out-meet the control flown beside it.
	"before: most legs to the watched station meet a raider, detection watched, well above the control",
	before.detections.join() === "watched" &&
		metCount(before) >= 16 &&
		metCount(before) > metCount(controlBefore),
	JSON.stringify({ before, control: metCount(controlBefore) }),
);
check(
	"before: legs to the other station meet raiders at the law — some, not all",
	controlBefore.detections.join() === "law" &&
		controlBefore.met.some(Boolean) &&
		!controlBefore.met.every(Boolean),
	JSON.stringify(controlBefore),
);

// ---------------------------------------------------------------------------
// #481: the reading is a bought module's, and the route effect is not.
//
// Every check above this line was flown with an empty equipment list, and the
// two leg rows are already half of #479's ruling: the watched route's dial
// bites for a pilot who owns nothing. This arm is the other half — standing
// where the fitted pilot reads strength, and again where the fitted pilot
// identifies, an unfitted one reads nothing at all.
//
// **Both ranges, not one.** The identification write is what lists the contact
// and hands over a target, so a gate on the cue alone would leave an unfitted
// pilot a relay in the Navigation list they cannot see in the glass. A single
// check at 1,200 km would pass on that build.
// ---------------------------------------------------------------------------
// **One definition of dark, read by both unfitted arms.** Two copies of it
// drift apart the day a field joins `readout()`.
const readsNothing = (r) =>
	r.km === null &&
	r.strength === null &&
	!r.identified &&
	!r.listed &&
	!r.targetable &&
	r.cueVisible === false;

await page.evaluate(() => window.__relayProbe.fitScanner(false));
const unfittedSignal = await page.evaluate(() => {
	window.__relayProbe.placeNear(1200);
	return window.__relayProbe.readout();
});
await settle();
const unfittedNear = await page.evaluate(() => {
	window.__relayProbe.placeNear(60);
	window.__relayProbe.frame();
	return window.__relayProbe.readout();
});
await settle();
const unfittedCue = await page.evaluate(
	() => window.__relayProbe.readout().cueVisible,
);
// **The dial is a property of the selected target, not of where the ship is
// standing.** `relayDetection` reads `targetId`, so a readout taken with the
// other station selected says `law` whatever the relay is doing — the first
// version of this check read exactly that and called it a regression. Select
// the watched station, which is what a pilot flying that route has done.
const unfittedDial = await page.evaluate(() => {
	const g = window.__seelite;
	// **Restored afterwards.** The checks below this arm were written against
	// whatever the boot selected, and `relayDetection` reads `targetId` — a
	// selection left behind here would make a later `detection` row pass or
	// fail for the selection rather than for the code.
	const was = g.targetId;
	g.targetId = "station-trade";
	window.__relayProbe.frame();
	const readout = window.__relayProbe.readout();
	g.targetId = was;
	window.__relayProbe.frame();
	return readout;
});
check(
	"#481: without the module there is no signal at 1,200 km and no identification at 60 km — no cue, no knowledge, no contact, no target",
	readsNothing(unfittedSignal) && readsNothing(unfittedNear) && !unfittedCue,
	JSON.stringify({ unfittedSignal, unfittedNear, unfittedCue }),
);
check(
	"#481: the watched route's dial bites all the same — the effect is felt by a pilot who cannot find its cause",
	unfittedDial.detection === "watched" &&
		unfittedDial.condition === "operational" &&
		// Still nothing to see, at the moment the dial is watched.
		unfittedDial.km === null &&
		!unfittedDial.identified &&
		unfittedDial.cueVisible === false,
	JSON.stringify(unfittedDial),
);
await capture("00-unfitted");

// ---------------------------------------------------------------------------
// Inside the signal's range: the cue reads and the relay is still hidden.
//
// Fitted from here on. The checks below are unchanged and were green before
// the module existed, so the fitted arm is the old behaviour restored rather
// than a new one described (#481).
// ---------------------------------------------------------------------------
// **Place first, then fit.** `fitScanner` steps a frame, and a frame stepped
// while the ship still stands at the arm above's 60 km identifies the relay
// the instant the module is fitted — which is correct behaviour and wrong
// evidence: the check below would then read `IDENTIFIED` at 1,200 km and go
// red for the ordering rather than for the code.
await page.evaluate(() => window.__relayProbe.placeNear(1200));
await page.evaluate(() => window.__relayProbe.fitScanner(true));
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
		// Read off the page rather than restated: the system is the seed's.
		expectedArea: `route:${g.world.system.record.index}:${g.relayReadout().plan.watchedStationId}`,
	};
});
check(
	"the episode records a destroy by the player, and its consequence area is the route",
	provenance.kind === "destroy" &&
		provenance.role === "direct" &&
		provenance.area === provenance.expectedArea &&
		// And pinned, so a mis-derived index cannot agree with itself: ESLAIN is
		// system 244 at seed 56 (`measure-relay-route.ts` prints it).
		provenance.area === "route:244:station-trade",
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
		// #351: the neighbour's relay is its own roll — absent, or present
		// and un-identified. Either way not this system's wreck.
		(trip.awayReadout.active
			? trip.awayReadout.condition === "operational"
			: trip.awayReadout.condition === null && !trip.awayReadout.meshDrawn) &&
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

// The gimbal pulls the beam toward a selected relay as it does toward a
// raider (the principal flew the first build with the beam on the boresight
// and could not hit it). Three degrees off the nose, the beam sits on it.
const gimbal = await page.evaluate(() => {
	const g = window.__seelite;
	window.__relayProbe.placeNear(2);
	g.targetId = g.relayReadout().view.key;
	const r = g.relayReadout();
	const p = g.world.ship.pos;
	const t = r.view.pos;
	const to = { x: t.x - p.x, y: t.y - p.y, z: t.z - p.z };
	const len = Math.hypot(to.x, to.y, to.z);
	// Turn 3° off the relay about the vertical.
	const a = (3 * Math.PI) / 180;
	const off = {
		x: to.x * Math.cos(a) + to.z * Math.sin(a),
		y: to.y,
		z: -to.x * Math.sin(a) + to.z * Math.cos(a),
	};
	// Rotation has momentum (`stepAngular`); an earlier segment's rates would
	// carry the nose off the bearing set here.
	g.rates = { pitch: 0, yaw: 0, roll: 0 };
	g.setAttitude(off, g.shipUp());
	for (let i = 0; i < 3; i++) window.__relayProbe.frame();
	const deg = (u, v) =>
		(Math.acos(
			(u.x * v.x + u.y * v.y + u.z * v.z) /
				(Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z)),
		) *
			180) /
		Math.PI;
	const rr = g.relayReadout().view.pos;
	const q = g.world.ship.pos;
	const dir = { x: rr.x - q.x, y: rr.y - q.y, z: rr.z - q.z };
	return {
		noseOffDeg: deg(g.nose(), dir),
		beamOffDeg: deg(g.beamAim(), dir),
		km: len,
	};
});
check(
	"a selected relay pulls the gimbal: three degrees off the nose, the beam is on it",
	// The beam aims from the camera, 8 m off the ship's position the row measures
	// from: a quarter of a degree at 2 km, against a hit sphere 2.4° wide there.
	gimbal.noseOffDeg > 2.5 && gimbal.noseOffDeg < 3.5 && gimbal.beamOffDeg < 1,
	JSON.stringify(gimbal),
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
		relit.detection === "watched" &&
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

// ---------------------------------------------------------------------------
// #481: an already-identified relay, and the module gone.
//
// **What this exercises, said exactly.** The relay above was identified by
// flying to it, not by loading a save — so this is the gated *read* of a row
// that exists, which is the same envelope read a loaded save would make, and
// not a load. The commander the gate is justified by (one who identified a
// relay under the free regime this node ends) arrives at this same state by a
// route this arm does not fly; the serialization row above is what carries the
// envelope across a load.
//
// **It runs last on purpose.** Taken earlier it wrote that knowledge row
// before the checks that require a relay nobody has found yet, and turned two
// of them red for the ordering rather than for the code.
//
// Nothing unwrites knowledge. Strip the module and the relay goes dark; fit it
// again, standing still at the same range, and what was found is found again.
// ---------------------------------------------------------------------------
// The baseline is read **here**, not carried down from the destroy arm: a
// stale snapshot would let `stripped` go dark for something that happened in
// between and read as the gate working.
const beforeStrip = await page.evaluate(() => window.__relayProbe.readout());
await page.evaluate(() => window.__relayProbe.fitScanner(false));
await settle();
const stripped = await page.evaluate(() => window.__relayProbe.readout());
await page.evaluate(() => window.__relayProbe.fitScanner(true));
await settle();
const refitted = await page.evaluate(() => window.__relayProbe.readout());
check(
	"#481: an already-identified relay goes dark when the module is gone, and is found again when it is back — the row is never unwritten",
	beforeStrip.identified &&
		beforeStrip.listed &&
		readsNothing(stripped) &&
		refitted.identified &&
		refitted.listed &&
		refitted.targetable &&
		// Refitted where it stands, without flying back through identification
		// range: the row is still in the envelope.
		refitted.km !== null &&
		refitted.cueVisible === true,
	JSON.stringify({ beforeStrip, stripped, refitted }),
);

// ---------------------------------------------------------------------------
// #351: the recovery you can meet. Kill the replacement, move the clock into
// its repair, and the tender flies in, parks at the wreck and can be shot —
// which sets the repair back and brings the next tender a wreck later.
// ---------------------------------------------------------------------------
await page.evaluate(() => {
	window.__relayProbe.placeNear(1.5);
});
const secondKill = await page.evaluate(() => window.__relayProbe.shoot(400));
const tenderAt = await page.evaluate(async (killedAt) => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const relay = await import("/src/pirate-relay.ts");
	const tender = await import("/src/relay-tender.ts");
	const frame = () => {
		g.step(dt);
		g.render(dt);
	};
	const read = () => {
		const r = g.relayReadout();
		const t = r.tender;
		const rel = r.view?.pos;
		return {
			condition: r.view?.condition ?? null,
			present: t !== null,
			kmFromRelay:
				t && rel
					? Math.hypot(t.pos.x - rel.x, t.pos.y - rel.y, t.pos.z - rel.z)
					: null,
			listed: t?.listed ?? false,
			drawn: t?.drawn ?? false,
			targetable: t ? g.selectableIds().includes(t.key) : false,
			key: t?.key ?? null,
		};
	};
	const repairFrom = killedAt + relay.RELAY_WRECK_S;
	g.world.gameTime = repairFrom - 5;
	frame();
	const beforeWindow = read();
	g.world.gameTime = repairFrom + 1;
	frame();
	const arriving = read();
	g.world.gameTime = repairFrom + tender.RELAY_TENDER_INBOUND_S / 2;
	frame();
	const halfway = read();
	g.world.gameTime = repairFrom + tender.RELAY_TENDER_INBOUND_S + 30;
	frame();
	const parked = read();
	return {
		beforeWindow,
		arriving,
		halfway,
		parked,
		entryKm: tender.RELAY_TENDER_ENTRY_KM,
		parkKm: tender.RELAY_TENDER_PARK_KM,
	};
}, secondKill.killedAt);
check(
	"#351: no tender while the relay is a fresh wreck; in the repair window it flies in from far out and parks at the wreck",
	secondKill.hullBefore > 0 &&
		tenderAt.beforeWindow.condition === "destroyed" &&
		!tenderAt.beforeWindow.present &&
		tenderAt.arriving.condition === "repairing" &&
		tenderAt.arriving.present &&
		tenderAt.arriving.kmFromRelay > tenderAt.entryKm * 0.9 &&
		tenderAt.halfway.kmFromRelay < tenderAt.arriving.kmFromRelay &&
		tenderAt.halfway.kmFromRelay > tenderAt.parkKm &&
		Math.abs(tenderAt.parked.kmFromRelay - tenderAt.parkKm) < 1e-3,
	JSON.stringify({ secondKill, tenderAt }),
);
check(
	"#351: the tender is a listed, targetable, drawn contact",
	tenderAt.parked.listed && tenderAt.parked.targetable && tenderAt.parked.drawn,
	JSON.stringify(tenderAt.parked),
);
// The fourth combat target pulls the gimbal by name (map constraint from #43).
// Three degrees off the nose with the tender selected the beam is on it; the
// same pose with nothing selected is the control, and leaves the beam on the
// boresight — so the pull is `tenderSelected`'s and not the pose's.
const tenderGimbal = await page.evaluate(() => {
	const g = window.__seelite;
	const deg = (u, v) =>
		(Math.acos(
			(u.x * v.x + u.y * v.y + u.z * v.z) /
				(Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z)),
		) *
			180) /
		Math.PI;
	const arm = (select) => {
		const t0 = g.relayReadout().tender;
		g.dropOut("probe");
		g.encounter = null;
		g.world.ship.pos = { x: t0.pos.x + 2, y: t0.pos.y, z: t0.pos.z };
		g.world.ship.vel = { ...t0.vel };
		g.throttle = 0;
		g.targetId = select ? t0.key : null;
		const a = (3 * Math.PI) / 180;
		const to = { x: -2, y: 0, z: 0 };
		g.rates = { pitch: 0, yaw: 0, roll: 0 };
		g.setAttitude(
			{
				x: to.x * Math.cos(a) + to.z * Math.sin(a),
				y: to.y,
				z: -to.x * Math.sin(a) + to.z * Math.cos(a),
			},
			g.shipUp(),
		);
		for (let i = 0; i < 3; i++) window.__relayProbe.frame();
		const t = g.relayReadout().tender.pos;
		const q = g.world.ship.pos;
		const dir = { x: t.x - q.x, y: t.y - q.y, z: t.z - q.z };
		return {
			noseOffDeg: deg(g.nose(), dir),
			beamOffDeg: deg(g.beamAim(), dir),
		};
	};
	const selected = arm(true);
	const control = arm(false);
	g.targetId = null;
	return { selected, control };
});
check(
	"#351: a selected tender pulls the gimbal onto it; unselected, the beam stays on the boresight",
	tenderGimbal.selected.noseOffDeg > 2 &&
		tenderGimbal.selected.beamOffDeg < 1 &&
		tenderGimbal.control.noseOffDeg > 2 &&
		tenderGimbal.control.beamOffDeg > 2,
	JSON.stringify(tenderGimbal),
);
// Drawn, as pixels: nose on the parked tug at 1.5 km, hiding its mesh moves
// the frame, and two shown frames of the same build move it by far less.
await page.evaluate(() => {
	const g = window.__seelite;
	const t0 = g.relayReadout().tender;
	g.dropOut("probe");
	g.encounter = null;
	g.world.ship.pos = { x: t0.pos.x + 1.5, y: t0.pos.y, z: t0.pos.z };
	g.world.ship.vel = { ...t0.vel };
	g.throttle = 0;
	g.rates = { pitch: 0, yaw: 0, roll: 0 };
	g.setAttitude({ x: -1, y: 0, z: 0 }, g.shipUp());
	g.setHeadLook("forward");
	for (let i = 0; i < 4; i++) window.__relayProbe.frame();
});
const framePng = async () => {
	// Render without stepping: a step moves the ship and the tug between the
	// two shots, and the control then reads the motion as a difference.
	await page.evaluate(() => window.__seelite.render(0));
	return PNG.sync.read(await page.screenshot());
};
const movedBetween = (a, b) => {
	let moved = 0;
	for (let i = 0; i < a.data.length; i += 4)
		if (
			Math.abs(a.data[i] - b.data[i]) > 24 ||
			Math.abs(a.data[i + 1] - b.data[i + 1]) > 24 ||
			Math.abs(a.data[i + 2] - b.data[i + 2]) > 24
		)
			moved++;
	return moved;
};
// And hold the page's own loop, as the combat rig does: it steps the world
// between two screenshots otherwise.
await page.evaluate(() => {
	const g = window.__seelite;
	if (g.animationFrame) cancelAnimationFrame(g.animationFrame);
	g.animationFrame = 0;
});
const tenderShown = await framePng();
const tenderShownAgain = await framePng();
await page.evaluate(() => {
	window.__seelite.tenderMesh.visible = false;
});
const tenderHidden = await framePng();
await page.evaluate(() => {
	window.__seelite.tenderMesh.visible = true;
	window.__seelite.render(0);
	if (!window.__seelite.animationFrame) window.__seelite.animate();
});
const tenderPx = {
	moved: movedBetween(tenderShown, tenderHidden),
	control: movedBetween(tenderShown, tenderShownAgain),
};
check(
	"#351: the parked tender is drawn: hiding its mesh moves pixels, and a same-build control moves far fewer",
	tenderPx.moved > 200 && tenderPx.moved > 5 * tenderPx.control,
	JSON.stringify(tenderPx),
);
await capture("05-tender-parked");
const tenderKill = await page.evaluate(async () => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const relay = await import("/src/pirate-relay.ts");
	const frame = () => {
		g.step(dt);
		g.render(dt);
	};
	const r0 = g.relayReadout();
	const t0 = r0.tender;
	// Beside it, at rest in the relay's frame, nose on it. The assist pulls the
	// ship toward another frame at about 0.6 km/s, which carries it out of beam
	// range inside the 25 s a tug takes to kill — so the ship is put back beside
	// it every fifty steps, as a pilot holds range.
	const besideIt = (t) => {
		g.dropOut("probe");
		g.encounter = null;
		g.world.ship.pos = { x: t.pos.x + 1.2, y: t.pos.y, z: t.pos.z };
		g.world.ship.vel = { ...t.vel };
		g.throttle = 0;
	};
	besideIt(t0);
	g.setHeadLook("forward");
	frame();
	g.targetId = t0.key;
	const hullBefore = g.relayReadout().tender.hull;
	g.keys.add(" ");
	const samples = [];
	let steps = 0;
	for (; steps < 2000; steps++) {
		const t = g.relayReadout().tender;
		if (!t) break;
		if (steps > 0 && steps % 50 === 0) besideIt(t);
		const p = g.world.ship.pos;
		if (steps % 100 === 0)
			samples.push([
				steps,
				Math.round(
					Math.hypot(t.pos.x - p.x, t.pos.y - p.y, t.pos.z - p.z) * 1000,
				) / 1000,
				Math.round(t.hull * 10) / 10,
			]);
		g.setAttitude(
			{ x: t.pos.x - p.x, y: t.pos.y - p.y, z: t.pos.z - p.z },
			g.shipUp(),
		);
		frame();
	}
	g.keys.delete(" ");
	const env = g.saveEnvelope().world.galaxies[g.world.system.record.galaxy];
	// The kill's own time, off the saved episode: the loop has stepped once
	// more by the time it notices the tender is gone.
	const killedAt = env.episodes[t0.key]?.initiating.occurredAt ?? Number.NaN;
	const relayKey = r0.view.key;
	const after = g.relayReadout();
	g.leftTab = "Communications";
	g.setHeadLook("left");
	frame();
	const lines = [...document.querySelectorAll("[data-live-raider-log] li")].map(
		(li) => li.textContent,
	);
	g.setHeadLook("forward");
	frame();
	return {
		hullBefore,
		steps,
		samples,
		killedAt,
		lastExit: g.lastExit,
		tenderGone: after.tender === null,
		tenderCondition: env.objective[t0.key]?.condition ?? null,
		relayCondition: g.carrierCondition(relayKey).condition,
		relayCompletesAt: g.carrierCondition(relayKey).recovery?.completesAt,
		expectedCompletesAt: killedAt + relay.RELAY_WRECK_S + relay.RELAY_REPAIR_S,
		lines,
	};
});
check(
	"#351: shooting the tender destroys it, saves the kill, and sets the relay's repair back by a wreck and a repair",
	tenderKill.hullBefore > 0 &&
		tenderKill.tenderGone &&
		tenderKill.lastExit === "relay tender destroyed" &&
		tenderKill.tenderCondition === "destroyed" &&
		tenderKill.relayCondition === "repairing" &&
		Math.abs(tenderKill.relayCompletesAt - tenderKill.expectedCompletesAt) <
			1e-6 &&
		tenderKill.lines.some((l) =>
			l.endsWith("Relay tender destroyed · relay repair set back"),
		),
	JSON.stringify(tenderKill),
);
// The kill is the world's: a jump out and back finds the tender destroyed and
// the relay's set-back where it was.
const tenderTrip = await page.evaluate(
	async ({ tenderKey, relayKey }) => {
		const g = window.__seelite;
		const trip = await window.__relayProbe.jumpOutAndBack();
		return {
			arrived: trip.outward.arrived && trip.back.arrived,
			gameTime: g.world.gameTime,
			tender: g.carrierCondition(tenderKey).condition,
			relayCompletesAt: g.carrierCondition(relayKey).recovery?.completesAt,
		};
	},
	{ tenderKey: tenderAt.parked.key, relayKey: kill.key },
);
check(
	"#351: a jump out and back finds the tender destroyed and the set-back kept",
	tenderTrip.arrived &&
		tenderTrip.gameTime < tenderKill.killedAt + 1200 &&
		tenderTrip.tender !== "operational" &&
		tenderTrip.relayCompletesAt === tenderKill.relayCompletesAt,
	JSON.stringify({ tenderTrip, killedAt: tenderKill.killedAt }),
);
const nextTender = await page.evaluate(async (killedAt) => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const relay = await import("/src/pirate-relay.ts");
	g.world.gameTime = killedAt + relay.RELAY_WRECK_S - 5;
	g.step(dt);
	g.render(dt);
	const gap = g.relayReadout().tender;
	g.world.gameTime = killedAt + relay.RELAY_WRECK_S + 1;
	g.step(dt);
	g.render(dt);
	const next = g.relayReadout().tender;
	return { gap, next: next && { listed: next.listed, drawn: next.drawn } };
}, tenderKill.killedAt);
check(
	"#351: no tender for a wreck period, then the next one flies in",
	nextTender.gap === null && nextTender.next?.listed === true,
	JSON.stringify(nextTender),
);
await capture("06-tender-next");

// ---------------------------------------------------------------------------
// #351: a system whose relay did not roll active has none — not drawn, no
// signal even with the module fitted, and the law on every route. Its own
// page, because a page under measurement is never navigated (#121).
// ---------------------------------------------------------------------------
await page.close();
const quiet = await browser.newPage({ viewport: { width: 1440, height: 900 } });
watch(quiet);
await quiet.goto(gameUrl(origin, { seed: NO_RELAY_SEED }));
await bootedGame(quiet);
const absent = await quiet.evaluate(async () => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const market = await import("/src/market.ts");
	g.commander.ownedEquipment = [market.LONG_RANGE_SCANNER];
	g.targetId = "station-trade";
	g.step(dt);
	g.render(dt);
	const r = g.relayReadout();
	const detections = new Set();
	let met = 0;
	for (let i = 0; i < 24; i++) {
		g.targetId = "station-trade";
		g.engageCruise();
		for (let s = 0; s < 200 && g.regime !== "cruise"; s++) g.step(dt);
		if (g.regime !== "cruise")
			throw new Error(`leg ${i}: never reached cruise (${g.lastExit})`);
		detections.add(g.relayReadout().detection);
		if (g.encounter !== null) met++;
		g.dropOut("probe");
		g.encounter = null;
		g.world.gameTime += 1.5;
		g.step(dt);
	}
	const cue = document.querySelector("[data-live-relay-cue]");
	return {
		system: g.world.system.record.name,
		cueFound: cue !== null,
		meshDrawn: g.relayMesh.root.parent !== null,
		active: r.active,
		plan: r.plan,
		view: r.view,
		detections: [...detections],
		met,
		cueVisible: cue ? cue.checkVisibility() : false,
	};
});
check(
	"#351: where the relay did not roll active there is none — no plan, nothing drawn, no cue with the module fitted, and the law on the trade route",
	absent.active === false &&
		absent.plan === null &&
		absent.view === null &&
		absent.detections.join() === "law" &&
		// The law here is about a quarter and the watched rate 90%: 12 of 24
		// separates them by more than four sd either way.
		absent.met <= 12 &&
		absent.cueFound &&
		absent.cueVisible === false &&
		absent.meshDrawn === false,
	JSON.stringify(absent),
);
await quiet.close();

await browser.close();
exit();
