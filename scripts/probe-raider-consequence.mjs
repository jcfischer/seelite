/**
 * Node #324 part (d)'s browser tier: what a kill leaves in the running game.
 *
 * The headless rows own the arithmetic — `tests/world-state.test.ts` (the lazy
 * scheduled start), `tests/raider-wreck.test.ts` (the lifecycle event, the
 * drop and the scoop), `tests/raider-log.test.ts` and `tests/encounter.test.ts`
 * (a slot that is not operational fields no raider). What only the page can
 * answer is the wiring:
 *
 * - a kill writes the slot's destruction into the live world state;
 * - a forced raider never takes the destroyed slot (wiring only);
 * - the wreck drops canisters, which show on the glass;
 * - a close, slow pass scoops one into the hold;
 * - the lifecycle runs on the game clock;
 * - the Communications console shows it.
 *
 * The kill is taken on a raider brought to its last point of hull. How a duel
 * wears a raider down is `probe-interdiction.mjs`'s question, and flying one
 * down here would make this probe a minute long for nothing it checks.
 */
import { writeFileSync } from "node:fs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await page.goto(gameUrl(origin, { seed: 42 }));
await bootedGame(page);

const kill = await page.evaluate(async () => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const frame = (each) => {
		g.step(dt);
		each?.();
		g.render(dt);
	};
	g.resetFlightToStart();
	// #870: the real kill must price an upgraded fit, not a stock-hull guess.
	const { makeModule } = await import("/src/loadout.ts");
	g.commander = {
		...g.commander,
		loadout: {
			...g.commander.loadout,
			h1: makeModule("military-laser", 1, "A"),
		},
	};
	g.armedFireGroup.reset();
	let far = null;
	let farKm = 0;
	for (const b of g.world.system.bodies) {
		const d = Math.hypot(
			b.pos.x - g.world.ship.pos.x,
			b.pos.y - g.world.ship.pos.y,
			b.pos.z - g.world.ship.pos.z,
		);
		if (b.kind !== "star" && d > farKm) {
			far = b;
			farKm = d;
		}
	}
	g.targetId = far.id;
	g.faceTarget?.();
	g.engageCruise();
	for (let i = 0; i < 100 && g.regime !== "cruise"; i++) g.step(dt);
	g.forceRaider("ahead", 0.5, 12);
	for (let i = 0; i < 900 && g.encounter?.phase !== "duel"; i++) frame();
	for (let i = 0; i < 30 && !g.encounter?.raider; i++) frame();
	const encounter = g.encounter;
	if (!encounter?.raider) return { error: "no duel", phase: encounter?.phase };
	const key = encounter.slot.key;
	const name = encounter.name;
	const targetLoadout = structuredClone(encounter.loadout);
	// The raider's last point of hull, and every shield spent, two kilometres
	// ahead at the ship's velocity: at that hull it flees at once, and from
	// further out it leaves the laser's reach before a shot lands.
	const ahead = g.nose();
	const shipPos = g.world.ship.pos;
	g.encounter = {
		...encounter,
		raider: {
			...encounter.raider,
			flight: {
				...encounter.raider.flight,
				ship: {
					...encounter.raider.flight.ship,
					pos: {
						x: shipPos.x + ahead.x * 2,
						y: shipPos.y + ahead.y * 2,
						z: shipPos.z + ahead.z * 2,
					},
					// Fleeing at the assist cap, as a raider at its last point of
					// hull does: the case that left the playtest's canisters out
					// of reach.
					vel: {
						x: g.world.ship.vel.x + ahead.x * g.assistCapKms,
						y: g.world.ship.vel.y + ahead.y * g.assistCapKms,
						z: g.world.ship.vel.z + ahead.z * g.assistCapKms,
					},
				},
			},
			condition: {
				...encounter.raider.condition,
				fore: 0,
				aft: 0,
				hull: 0.01,
			},
		},
	};
	const cargoBefore = { ...g.commander.cargo };
	// #564: the kill's combat credit, read across the kill the game flew.
	const pendingBefore = g.ladderPending.combat;
	g.keys.add(" ");
	// Aim, then step: the step fires along the aim it starts with. Aiming after
	// the step shoots where a fleeing raider was, and the capture lost one so.
	for (let i = 0; i < 600 && g.encounter; i++) {
		const r = g.encounter?.raider;
		if (r) {
			const p = g.world.ship.pos;
			const t = r.flight.ship.pos;
			g.setAttitude({ x: t.x - p.x, y: t.y - p.y, z: t.z - p.z }, g.shipUp());
		}
		frame();
	}
	g.keys.delete(" ");
	return {
		key,
		name,
		killedAt: g.world.gameTime,
		lastExit: g.lastExit,
		encounter: g.encounter,
		condition: g.carrierCondition(key).condition,
		canisters: g.canisters.map((c) => ({
			commodity: c.commodity,
			tonnes: c.tonnes,
			km: Math.hypot(
				c.pos.x - g.world.ship.pos.x,
				c.pos.y - g.world.ship.pos.y,
				c.pos.z - g.world.ship.pos.z,
			),
			expiresAt: c.expiresAt,
		})),
		cargoBefore,
		pendingDelta: g.ladderPending.combat - pendingBefore,
		ownHull: g.commander.hull,
		ownLoadout: g.commander.loadout,
		targetLoadout,
	};
});
check(
	"a kill ends the encounter as destroyed",
	!kill.error && kill.encounter === null && kill.lastExit.endsWith("destroyed"),
	JSON.stringify(kill),
);
// #564: the kill path the game flew prices the raider on the combat ladder,
// pending until a dock. Read off the page's own formula, never restated.
const expectedCredit = await page.evaluate(
	async ({ own, targetLoadout }) => {
		const { killCredit } = await import("/src/kill-credit.ts");
		const { RAIDER_HULL_ID } = await import("/src/raider-slots.ts");
		return {
			fitted: killCredit(own, { hull: RAIDER_HULL_ID, loadout: targetLoadout }),
			stock: killCredit(own, RAIDER_HULL_ID),
		};
	},
	{
		own: { hull: kill.ownHull, loadout: kill.ownLoadout },
		targetLoadout: kill.targetLoadout,
	},
);
check(
	"the kill is pending combat credit at the game's price for a raider (#564)",
	expectedCredit.fitted > 0 &&
		Math.abs(expectedCredit.fitted - expectedCredit.stock) > 1e-9 &&
		Math.abs(kill.pendingDelta - expectedCredit.fitted) < 1e-9,
	`${kill.pendingDelta} against fitted ${expectedCredit.fitted}, stock ${expectedCredit.stock}`,
);
check(
	"the kill writes the slot's destruction into world state",
	kill.condition === "destroyed",
	`${kill.key} is ${kill.condition}`,
);
check(
	"the wreck drops one to three one-tonne canisters within 20 km of the player, expiring in five minutes",
	kill.canisters.length >= 1 &&
		kill.canisters.length <= 3 &&
		kill.canisters.every(
			(c) =>
				c.tonnes === 1 &&
				c.km < 20 &&
				// The kill is stamped at the start of the step it happened in,
				// and `killedAt` is read after that step, so a step apart.
				Math.abs(c.expiresAt - kill.killedAt - 300) <= 0.2,
		),
	JSON.stringify(kill.canisters),
);

// ---------------------------------------------------------------------------
// The glass shows them, and a close, slow pass scoops one.
// ---------------------------------------------------------------------------
const glass = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const c = g.canisters[0];
	// Face the canister so its marker is on the glass.
	const p = g.world.ship.pos;
	g.setAttitude(
		{ x: c.pos.x - p.x, y: c.pos.y - p.y, z: c.pos.z - p.z },
		g.shipUp(),
	);
	const countGreen = () => {
		const overlay = document.getElementById("overlay");
		const ctx = overlay.getContext("2d", { willReadFrequently: true });
		const data = ctx.getImageData(
			overlay.width / 2 - 40,
			overlay.height / 2 - 40,
			80,
			80,
		).data;
		let green = 0;
		for (let i = 0; i < data.length; i += 4)
			if (
				data[i + 3] > 40 &&
				data[i + 1] > 200 &&
				data[i] < 190 &&
				data[i + 2] < 200
			)
				green++;
		return green;
	};
	g.step(dt);
	g.render(dt);
	const green = countGreen();
	// **The control.** The prograde marker is green too and can sit in the same
	// box, so the same frame is drawn again with the canisters taken away, and
	// the marker must add green of its own (sage #330).
	const kept = g.canisters;
	g.canisters = [];
	g.render(dt);
	const control = countGreen();
	g.canisters = kept;
	g.render(dt);
	return { green, control, count: g.canisters.length };
});
check(
	"a canister ahead is marked on the glass",
	glass.count > 0 && glass.green > glass.control,
	JSON.stringify(glass),
);

// ---------------------------------------------------------------------------
// A canister is a contact, not only a diamond (#324, the principal's ruling
// after the fifth playtest): selectable, on the scanner, and carrying range and
// the scoop gate's own speed **on the instrument in front of the pilot**.
//
// The first version of this read `[data-live-left-copy]`, the left console's
// copy — which lives in an `.lc-panel`, `display: none` unless the pilot turns
// their head, and which this very block had just turned away from with
// `setHeadLook("forward")`. So it hid its own subject and then read its text,
// and passed while the cockpit showed the pilot nothing (sage #353, a blocker).
//
// What it reads now is `cockpit.instrumentKey`, which `updateInstruments`
// writes **only when it repaints** — a record of what was painted rather than a
// string that was built. The console is still checked, in the state that shows
// it.
// ---------------------------------------------------------------------------
const lock = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
	const len = (a) => Math.hypot(a.x, a.y, a.z);
	const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
	const cross = (a, b) => ({
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x,
	});
	const unit = (a) => {
		const n = len(a);
		return { x: a.x / n, y: a.y / n, z: a.z / n };
	};
	const c = g.canisters[0];
	const listed = g.selectableIds().includes(c.id);
	g.targetId = c.id;
	g.setHeadLook("forward");
	g.step(dt);
	g.render(dt);
	// The canister object is replaced every step (`driftCanister` returns a new
	// one), so a captured copy goes stale — read it back by id each time.
	const live = () => g.canisters.find((x) => x.id === c.id) ?? c;
	// `updateCockpit` and not `render`: the instrument is repainted on the step
	// path, so a render alone leaves the previous frame's figure on the canvas.
	const paintedOf = () => {
		g.updateCockpit();
		return g.cockpit.instrumentKey ?? "";
	};
	const relOf = () => len(sub(g.world.ship.vel, live().vel));
	const target = g.targetBody();
	const held = {
		painted: paintedOf(),
		rel: relOf(),
		reads: g.targetRelativeKms(),
	};

	// **The arm that separates the gate's speed from the rate along the line**
	// (sage #353): fly at 1 km/s straight across the line to the canister. The
	// rate along the line is zero there, so the rejected readout showed `0.00`
	// while the gate was refusing at 0.25. Never stepped: the assist would
	// rewrite the velocity this arm injects.
	const u = unit(sub(live().pos, g.world.ship.pos));
	const axis =
		Math.abs(u.x) < 0.5 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
	const across = unit(cross(u, axis));
	const keep = { ...g.world.ship.vel };
	const at = live().vel;
	g.world.ship.vel = {
		x: at.x + across.x,
		y: at.y + across.y,
		z: at.z + across.z,
	};
	const crossing = {
		painted: paintedOf(),
		reads: g.targetRelativeKms(),
		alongLine: dot(sub(g.world.ship.vel, at), u),
	};
	// The instrument as pixels. **A painted figure can still be unreadable** —
	// the primary row shrinks to fit and this one does not — and no check here
	// can see that, so the frame goes to a person.
	const shot = g.cockpit.targetInstrument.ctx.canvas.toDataURL("image/png");
	g.world.ship.vel = keep;
	g.render(dt);

	// The console's copy is a real second surface, checked in the state that
	// shows it rather than the state that hides it.
	g.setHeadLook("left");
	g.updateCockpit();
	g.render(dt);
	const el = document.querySelector("[data-live-left-copy]");
	const consolePanel = {
		text: el?.textContent ?? "",
		shown: el?.checkVisibility() ?? false,
	};
	g.setHeadLook("forward");
	g.updateCockpit();
	return {
		id: c.id,
		listed,
		kind: target?.kind ?? null,
		rangeKm: g.targetRange(),
		onScanner: g.scannerContacts.some((s) => s.id === c.id),
		held,
		crossing,
		consolePanel,
		shot,
	};
});
const { shot, ...locked } = lock;
const relPainted = (key) =>
	Number(String(key).match(/REL ([\d.]+) km\/s/)?.[1]);
check(
	"a canister is selectable, on the scanner, and its relative speed is painted on the cockpit Target instrument",
	lock.listed &&
		lock.kind === "cargo" &&
		lock.onScanner &&
		lock.rangeKm > 0 &&
		Math.abs(relPainted(lock.held.painted) - lock.held.rel) <= 0.01,
	JSON.stringify(locked),
);
check(
	"crossing the line to a canister paints the crossing speed, not the zero along it",
	Math.abs(lock.crossing.alongLine) <= 1e-6 &&
		Math.abs(lock.crossing.reads - 1) <= 1e-6 &&
		Math.abs(relPainted(lock.crossing.painted) - 1) <= 0.01,
	JSON.stringify(lock.crossing),
);
check(
	"the left console carries the same figure, and is visible with the console open",
	lock.consolePanel.shown && /REL [\d.]+ km\/s/.test(lock.consolePanel.text),
	JSON.stringify(lock.consolePanel),
);
// `SHOT_DIR=<path>` writes the instrument frame for a person to read. Off by
// default: a probe that drops a file on every run is noise.
if (process.env.SHOT_DIR) {
	const to = `${process.env.SHOT_DIR}/target-instrument.png`;
	writeFileSync(to, Buffer.from(shot.split(",")[1], "base64"));
	console.log(`  shot  ${to}`);
}

// **The scoop is flown, not placed.** This row set the ship onto the canister
// with the canister's own velocity, which proves the scoop predicate and not
// that a pilot can reach one. The third playtest could not: a fleeing raider
// dies at the assist cap, and a canister that kept that velocity held its
// range for good. The ship flies at the canister through the assist, from a
// raider that died at the cap. **It shows reachability, not a pilot's time.**
// The nose is set each frame rather than turned at the hull's rate, and it
// steers on the canister's exact velocity, which no readout gives a pilot.
const scoop = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const cap = g.assistCapKms;
	const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
	const len = (a) => Math.hypot(a.x, a.y, a.z);
	const before = g.canisters.length;
	const c0 = g.canisters[0];
	const held = g.commander.cargo[c0.commodity] ?? 0;
	const frameVel = g.localFrame();
	const startKm = len(sub(c0.pos, g.world.ship.pos));
	const canisterKms = len(sub(c0.vel, frameVel));
	let flownS = null;
	const limit = Math.round(120 / dt);
	for (let i = 0; i < limit; i++) {
		const c = g.canisters.find((x) => x.id === c0.id);
		if (!c) {
			flownS = i * dt;
			break;
		}
		// Match the canister's drift and close along the line to it, slowing to
		// scoop speed as the range falls: the velocity a pilot would ask for.
		const to = sub(c.pos, g.world.ship.pos);
		const km = len(to);
		const closing = Math.min(cap, km);
		const want = {
			x: c.vel.x - frameVel.x + (to.x / km) * closing,
			y: c.vel.y - frameVel.y + (to.y / km) * closing,
			z: c.vel.z - frameVel.z + (to.z / km) * closing,
		};
		g.setAttitude(want, g.shipUp());
		g.throttle = Math.min(1, len(want) / cap);
		g.step(dt);
		g.render(dt);
	}
	g.throttle = 0;
	g.render(dt);
	// **The scoop says so on the glass** (#324, the sixth playtest: it "just
	// disappears"). `scoopRender` is written inside the draw itself, so it is a
	// record of painting — and the pixels are counted beside it against a
	// control frame with the notice suppressed, because a record alone cannot
	// show the text was lit.
	// Any lit text, not only green: the refusal is drawn in §4's red, and a
	// filter tuned to the cargo green would call that "nothing drawn".
	const band = (fraction) => {
		const overlay = document.getElementById("overlay");
		const c2d = overlay.getContext("2d", { willReadFrequently: true });
		const y = Math.max(
			0,
			Math.min(overlay.height - 90, Math.round(overlay.height * fraction) - 60),
		);
		const data = c2d.getImageData(0, y, overlay.width, 90).data;
		let lit = 0;
		for (let i = 0; i < data.length; i += 4)
			if (data[i + 3] > 40 && (data[i] > 150 || data[i + 1] > 150)) lit++;
		return lit;
	};
	/** A reading, and the same reading with the notice suppressed. Both view
	 *  arms below need the pair, and writing the save/restore out twice is how
	 *  one of them ends up subtly different (sage #355). */
	const againstControl = (measure) => {
		const shown = measure();
		const kept = g.scoop.left;
		g.scoop.left = 0;
		g.render(dt);
		const control = measure();
		g.scoop.left = kept;
		g.render(dt);
		return { shown, control };
	};
	const noticeAt = g.scoopRender ? { ...g.scoopRender } : null;
	const cockpit = againstControl(() => band(0.62));
	const lit = cockpit.shown;
	const control = cockpit.control;

	// **Every view, not only the one this probe sits in** (sage #355). The
	// cockpit band cannot see the chase draw, which sits further down the glass,
	// so the claim needed its own arm.
	const wasView = g.view;
	g.view = "chase";
	g.render(dt);
	const chaseCounts = againstControl(() => band(1));
	const chase = {
		render: g.scoopRender ? { ...g.scoopRender } : null,
		lit: chaseCounts.shown,
		control: chaseCounts.control,
	};
	g.view = wasView;
	g.render(dt);
	// And it clears: a notice that never goes away is not an event.
	for (let t = 0; t < 4; t += dt) {
		g.step(dt);
		g.render(dt);
	}
	const noticeAfter = g.scoopRender ? { ...g.scoopRender } : null;
	return {
		noticeAt,
		lit,
		control,
		chase,
		noticeAfter,
		before,
		after: g.canisters.length,
		commodity: c0.commodity,
		held,
		now: g.commander.cargo[c0.commodity] ?? 0,
		lastExit: g.lastExit,
		startKm,
		canisterKms,
		flownS,
	};
});
check(
	"a canister from a raider killed at the cap is flown to and scooped into the hold",
	scoop.flownS !== null &&
		scoop.after === scoop.before - 1 &&
		scoop.now === scoop.held + 1 &&
		scoop.lastExit.startsWith("scooped"),
	JSON.stringify(scoop),
);
check(
	"the scoop says so on the glass, and the notice clears",
	scoop.noticeAt !== null &&
		/^SCOOPED {2}1 t /.test(scoop.noticeAt.text) &&
		scoop.noticeAt.alpha > 0 &&
		// Lit against the same frame with the notice suppressed, because the
		// record alone cannot show the text reached the canvas.
		scoop.lit > scoop.control &&
		scoop.noticeAfter === null,
	JSON.stringify({
		at: scoop.noticeAt,
		lit: scoop.lit,
		control: scoop.control,
		after: scoop.noticeAfter,
	}),
);
check(
	"the notice is on the glass in chase as well as the cockpit",
	scoop.chase.render !== null && scoop.chase.lit > scoop.chase.control,
	JSON.stringify(scoop.chase),
);

// ---------------------------------------------------------------------------
// A full hold refuses, and says so in the refusal's own colour.
// ---------------------------------------------------------------------------
const refusal = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	// Fill the hold, then put a canister on the ship at matching velocity so the
	// scoop gate opens and `scoopCargo` refuses. **Driven, not flown**: what is
	// under test is the refusal's notice, not the approach, which the row above
	// already flies.
	g.commander = { ...g.commander, cargo: { Food: 10000 } };
	const now = g.world.gameTime;
	g.canisters = [
		{
			id: "refusal#0",
			commodity: "Food",
			tonnes: 1,
			pos: { ...g.world.ship.pos },
			vel: { ...g.world.ship.vel },
			frameBodyId: null,
			restsAt: now,
			expiresAt: now + 300,
		},
	];
	g.step(dt);
	g.render(dt);
	// **§4 owns red for refusal, so count the colour** rather than infer it.
	// `accepted === false` only proves the state the draw branches on; against a
	// control frame with the notice suppressed, this shows what reached the
	// canvas and which hue it added.
	const tone = () => {
		const overlay = document.getElementById("overlay");
		const c2d = overlay.getContext("2d", { willReadFrequently: true });
		// The same clamp the other readback has: this copy had lost it, which is
		// the drift sage's dedupe finding was pointing at.
		const y = Math.max(
			0,
			Math.min(overlay.height - 90, Math.round(overlay.height * 0.62) - 60),
		);
		const data = c2d.getImageData(0, y, overlay.width, 90).data;
		let red = 0;
		let green = 0;
		for (let i = 0; i < data.length; i += 4) {
			if (data[i + 3] < 40) continue;
			if (data[i] > 150 && data[i + 1] < 140) red++;
			else if (data[i + 1] > 150 && data[i] < 200) green++;
		}
		return { red, green };
	};
	const shown = tone();
	const kept = g.scoop.left;
	g.scoop.left = 0;
	g.render(dt);
	const control = tone();
	g.scoop.left = kept;
	g.render(dt);
	return {
		render: g.scoopRender ? { ...g.scoopRender } : null,
		lastExit: g.lastExit,
		left: g.canisters.length,
		addedRed: shown.red - control.red,
		addedGreen: shown.green - control.green,
	};
});
check(
	"a full hold says so, in the refusal's colour, and leaves the canister in space",
	refusal.render !== null &&
		refusal.render.accepted === false &&
		/^HOLD FULL/.test(refusal.render.text) &&
		refusal.left === 1 &&
		refusal.lastExit.startsWith("hold full") &&
		// What it added to the frame is red, not the cargo green a confirmed
		// scoop draws.
		refusal.addedRed > 0 &&
		refusal.addedRed > refusal.addedGreen,
	JSON.stringify(refusal),
);

const afterScoop = await page.evaluate((id) => {
	const g = window.__seelite;
	return { listed: g.selectableIds().includes(id), targetId: g.targetId };
}, lock.id);
check(
	"the scooped canister leaves the selection list and takes the lock with it",
	!afterScoop.listed && afterScoop.targetId === null,
	JSON.stringify(afterScoop),
);

// ---------------------------------------------------------------------------
// A canister keeps its own body's frame after the pilot leaves it.
//
// **The case every other check agrees on** (sage #355). The headless row hands
// the stepper its own frame table, and the near-body measurement parks the ship
// beside the station — where `localFrame()` *equals* the station's frame, so a
// build that resolved the observer's frame for every canister passes both. The
// two answers only separate once the ship is past `NEAR_FAR_KM`, where the
// observer's frame becomes the star's and a borrowed frame would drop the
// canister to rest in star coordinates.
// ---------------------------------------------------------------------------
const leaves = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
	const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
	const len = (a) => Math.hypot(a.x, a.y, a.z);
	g.resetFlightToStart();
	for (let i = 0; i < 20; i++) g.step(dt);
	const station =
		g.world.system.bodies.find((b) => b.kind === "station") ??
		g.world.system.bodies.find((b) => b.kind === "planet");
	// The body's velocity from two steps, as the sim itself has it.
	const was = { ...station.pos };
	const t0 = g.world.gameTime;
	g.step(dt);
	const moved = g.world.system.byId.get(station.id) ?? station;
	const stationVel = scale(sub(moved.pos, was), 1 / (g.world.gameTime - t0));

	// Park beside it and leave a canister already at rest in its frame.
	g.world.ship.pos = { x: moved.pos.x + 200, y: moved.pos.y, z: moved.pos.z };
	g.world.ship.vel = { ...stationVel };
	g.throttle = 0;
	for (let i = 0; i < 10; i++) g.step(dt);
	const now = g.world.gameTime;
	g.canisters = [
		{
			id: "leaves#0",
			commodity: "Food",
			tonnes: 1,
			pos: {
				x: g.world.ship.pos.x + 1,
				y: g.world.ship.pos.y,
				z: g.world.ship.pos.z,
			},
			vel: { ...g.localFrame() },
			frameBodyId: station.id,
			restsAt: now - 1,
			expiresAt: now + 300,
		},
	];
	// The game's own analytic frame for that body, which is what the canister is
	// brought to rest in. `stationVel` above is a finite difference over one
	// step and is only good to a few m/s, so it sizes the arm rather than
	// bounding it.
	const frameBeside = { ...g.localFrame() };
	for (let i = 0; i < 10; i++) g.step(dt);
	const beside = len(sub(g.canisters[0].vel, frameBeside));

	// **Now leave.** Far enough that the observer's frame is the star's.
	g.world.ship.pos = {
		x: moved.pos.x + 5e5,
		y: moved.pos.y,
		z: moved.pos.z,
	};
	g.world.ship.vel = { x: 0, y: 0, z: 0 };
	for (let i = 0; i < 10; i++) g.step(dt);
	return {
		stationKms: len(stationVel),
		observerFrameKms: len(g.localFrame()),
		beside,
		away: len(sub(g.canisters[0].vel, frameBeside)),
		// The figure that separates the two answers: still carried by the
		// station, or dropped to rest in star coordinates.
		speedKms: len(g.canisters[0].vel),
		left: g.canisters.length,
	};
});
check(
	"a canister keeps its own body's frame after the pilot leaves it",
	// The arm is only meaningful if the two frames really did separate: a moving
	// station, and an observer whose frame is now the star's.
	leaves.stationKms > 20 &&
		leaves.observerFrameKms < 1e-9 &&
		leaves.left === 1 &&
		// Still in the station's frame to within a tenth of a km/s, and still
		// carried at its speed. A borrowed observer frame would read `away` at
		// the full 29 km/s and `speedKms` at nothing: the two answers are three
		// hundred times apart, so the bound does not need to be tight.
		leaves.beside < 0.1 &&
		leaves.away < 0.1 &&
		leaves.speedKms > 20,
	JSON.stringify(leaves),
);

// ---------------------------------------------------------------------------
// The destroyed slot fields no raider; the lifecycle runs on the clock; the
// Communications console shows it.
// ---------------------------------------------------------------------------
const next = await page.evaluate((killedKey) => {
	const g = window.__seelite;
	g.forceRaider("ahead", 5, 12);
	return {
		slot: g.encounter?.slot.key ?? null,
		name: g.encounter?.name ?? null,
		killedKey,
	};
}, kill.key);
check(
	"a forced raider after the kill never takes the destroyed slot (wiring only)",
	// **Weak here, and said so** (sage #330). In a one-slot system no raider is
	// fielded, and this passes without testing a choice. The choice itself is
	// `tests/encounter.test.ts`'s ("a forced raider takes the first operational
	// slot, or none"); this row holds only that `Game` passes world state in.
	next.slot !== next.killedKey,
	JSON.stringify(next),
);

const logAt = async (t) => {
	await page.evaluate((time) => {
		const g = window.__seelite;
		g.encounter = null;
		g.world.gameTime = time;
		g.leftTab = "Communications";
		g.setHeadLook("left");
		g.render(g.units.MAX_DT);
	}, t);
	await page.evaluate(
		() =>
			new Promise((done) => {
				let n = 3;
				const tick = () => (n-- ? requestAnimationFrame(tick) : done());
				requestAnimationFrame(tick);
			}),
	);
	return page.evaluate((key) => {
		const g = window.__seelite;
		return {
			condition: g.carrierCondition(key).condition,
			instance: g.carrierCondition(key).instanceOrdinal,
			lines: [...document.querySelectorAll("[data-live-raider-log] li")].map(
				(li) => li.textContent,
			),
		};
	}, kill.key);
};
const atKill = await logAt(kill.killedAt + 1);
const repairing = await logAt(kill.killedAt + 601);
const replaced = await logAt(kill.killedAt + 1801);
check(
	"the Communications log names the kill",
	atKill.condition === "destroyed" &&
		atKill.lines.some((l) => l.endsWith(`${kill.name} destroyed`)),
	JSON.stringify(atKill),
);
check(
	"ten minutes on, the slot is repairing and the log says so",
	repairing.condition === "repairing" &&
		repairing.lines.some((l) => l.endsWith(`${kill.name} under repair`)),
	JSON.stringify(repairing),
);
check(
	"thirty minutes on, the raider is replaced and back in service",
	replaced.condition === "operational" &&
		replaced.instance === 1 &&
		replaced.lines.some((l) => l.endsWith(`${kill.name} back in service`)),
	JSON.stringify(replaced),
);

await browser.close();
exit();
