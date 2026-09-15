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

const kill = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const frame = (each) => {
		g.step(dt);
		each?.();
		g.render(dt);
	};
	g.resetFlightToStart();
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
	};
});
check(
	"a kill ends the encounter as destroyed",
	!kill.error && kill.encounter === null && kill.lastExit.endsWith("destroyed"),
	JSON.stringify(kill),
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
	return {
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
