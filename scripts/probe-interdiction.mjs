/**
 * Node #324 part (b)'s browser tier: a raider interdicts the player in cruise
 * in the running game, both drop to normal flight, and they duel.
 *
 * The headless rows own the arithmetic — `tests/interdiction.test.ts`,
 * `tests/encounter.test.ts`, `tests/duel.test.ts`. What only the running game
 * can answer is the wiring: that `Game` steps the encounter in its own frame
 * order, drops the player's regime, lands the raider's fire through
 * `takeDamage`, puts a hostile contact on the scanner and the raider hull in
 * the near scene, reads the pilot's trigger, and schedules a raider on a leg.
 *
 * The break arm turns the ship with `setAttitude` at the courier's cruise turn
 * rate rather than through held keys: the keys' path to a turn rate is the
 * flight model's, and its own probes hold it. This one asks whether a turn at
 * that rate breaks a lock in the running game.
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

/** Helpers installed on every page: fly cruise, read the raider. */
const installHelpers = () => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	window.__int = {
		dt,
		/** Target the farthest body and fly until cruise is engaged. */
		cruise() {
			g.resetFlightToStart();
			let far = null;
			let farKm = 0;
			for (const body of g.world.system.bodies) {
				const d = Math.hypot(
					body.pos.x - g.world.ship.pos.x,
					body.pos.y - g.world.ship.pos.y,
					body.pos.z - g.world.ship.pos.z,
				);
				if (body.kind !== "star" && d > farKm) {
					far = body;
					farKm = d;
				}
			}
			g.targetId = far.id;
			g.faceTarget?.();
			g.engageCruise();
			for (let i = 0; i < 100 && g.regime !== "cruise"; i++) g.step(dt);
			return g.regime;
		},
		steps(seconds, each) {
			for (let i = 0; i < Math.round(seconds / dt); i++) {
				each?.();
				g.step(dt);
				g.render(dt);
			}
		},
		raider() {
			const contact = g.selectable().find((b) => b.scannerClass === "hostile");
			return {
				encounter: g.encounter
					? { phase: g.encounter.phase, name: g.encounter.name }
					: null,
				contact: contact
					? {
							id: contact.id,
							shipType: contact.shipType,
							scannerClass: contact.scannerClass,
						}
					: null,
				meshInScene: g.raiderMesh.parent !== null,
			};
		},
		pool: (c) => c.fore + c.aft + c.hull,
	};
};

// ---------------------------------------------------------------------------
// Hold course: interdicted, dropped, dueled, fired on, and able to fire back.
// ---------------------------------------------------------------------------

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await page.goto(gameUrl(origin, { seed: 42 }));
await bootedGame(page);
await page.evaluate(installHelpers);

const held = await page.evaluate(() => {
	const g = window.__seelite;
	const I = window.__int;
	const regimeAtStart = I.cruise();
	const scheduledByLaw = g.encounter;
	g.forceRaider("behind", 1, 30);
	const before = I.raider();
	I.steps(1.2);
	const appeared = I.raider();
	const regimeWhileContested = g.regime;
	I.steps(2.8);
	const afterCharge = {
		regime: g.regime,
		lastExit: g.lastExit,
		...I.raider(),
	};
	// The duel, flown hands-off for a minute: the raider closes and shoots.
	const poolBefore = I.pool(g.condition);
	let struck = false;
	I.steps(60, () => {
		if (I.pool(g.condition) < poolBefore - 1e-9) struck = true;
	});
	const afterDuel = {
		pool: I.pool(g.condition),
		struck,
		...I.raider(),
		lastExit: g.lastExit,
	};
	return {
		regimeAtStart,
		scheduledByLaw: scheduledByLaw !== null,
		before,
		appeared,
		regimeWhileContested,
		afterCharge,
		poolBefore,
		afterDuel,
	};
});

check(
	"the player is in cruise before the raider comes",
	held.regimeAtStart === "cruise",
);
check(
	"no raider is on the scanner before it appears",
	held.before.contact === null && !held.before.meshInScene,
	JSON.stringify(held.before),
);
check(
	"it appears as a hostile raider contact with its hull in the near scene",
	held.appeared.contact?.scannerClass === "hostile" &&
		held.appeared.contact?.shipType === "raider" &&
		held.appeared.meshInScene &&
		held.appeared.encounter?.phase === "contest",
	JSON.stringify(held.appeared),
);
check(
	"the player stays in cruise while the lock charges",
	held.regimeWhileContested === "cruise",
);
check(
	"a held course is interdicted: the player drops to normal flight and the duel starts",
	held.afterCharge.regime === "normal" &&
		held.afterCharge.lastExit.startsWith("interdicted by") &&
		held.afterCharge.encounter?.phase === "duel",
	JSON.stringify(held.afterCharge),
);
check(
	"the raider's fire lands on the player's condition",
	held.afterDuel.struck,
	`pool ${held.poolBefore.toFixed(1)} → ${held.afterDuel.pool.toFixed(1)}; ${JSON.stringify(held.afterDuel)}`,
);

// Fire back: aim at the raider every frame and hold Space.
const fired = await page.evaluate(() => {
	const g = window.__seelite;
	const I = window.__int;
	if (!g.encounter || g.encounter.phase !== "duel") {
		g.forceRaider("ahead", 0.5, 20);
		I.cruise();
		g.forceRaider("ahead", 0.5, 20);
		I.steps(4);
	}
	if (!g.encounter?.raider) I.steps(0.2);
	const start = g.encounter?.raider
		? I.pool(g.encounter.raider.condition)
		: null;
	const energyStart = g.condition.energy;
	let fired = false;
	g.keys.add(" ");
	I.steps(20, () => {
		const r = g.encounter?.raider;
		if (!r) return;
		const to = {
			x: r.flight.ship.pos.x - g.world.ship.pos.x,
			y: r.flight.ship.pos.y - g.world.ship.pos.y,
			z: r.flight.ship.pos.z - g.world.ship.pos.z,
		};
		g.setAttitude(to, g.shipUp());
		if (g.condition.energy < energyStart) fired = true;
	});
	g.keys.delete(" ");
	return {
		start,
		end: g.encounter?.raider ? I.pool(g.encounter.raider.condition) : null,
		phase: g.encounter?.phase ?? null,
		lastExit: g.lastExit,
		fired,
	};
});

check(
	"Space fires the player's pulse laser in flight",
	fired.fired,
	JSON.stringify(fired),
);
check(
	"aimed fire damages the raider through its condition, or destroys it",
	fired.start !== null &&
		(fired.end === null
			? fired.lastExit.endsWith("destroyed") || fired.lastExit.endsWith("fled")
			: fired.end < fired.start),
	JSON.stringify(fired),
);

// ---------------------------------------------------------------------------
// Turn hard: the lock breaks and the player keeps cruising.
// ---------------------------------------------------------------------------

const broke = await page.evaluate(() => {
	const g = window.__seelite;
	const I = window.__int;
	I.cruise();
	g.forceRaider("alongside", 0.5, 30);
	I.steps(0.6);
	const appeared = I.raider();
	// The courier's cruise turn rate, which `scripts/measure-interdiction-contest.ts`
	// prints: 0.90 rad/s.
	const rate = 0.9;
	I.steps(4, () => {
		// A yaw about the ship's own up axis. Rotating about the world's y axis
		// instead turns an inclined nose by only `rate × √(1 − n.y²)` — which is
		// what the first version of this arm did, at a nose 41° below the horizon,
		// and the raider held its lock through a turn too slow to break it.
		const n = g.nose();
		const u = g.shipUp();
		const a = rate * I.dt;
		const across = {
			x: u.y * n.z - u.z * n.y,
			y: u.z * n.x - u.x * n.z,
			z: u.x * n.y - u.y * n.x,
		};
		const turned = {
			x: n.x * Math.cos(a) + across.x * Math.sin(a),
			y: n.y * Math.cos(a) + across.y * Math.sin(a),
			z: n.z * Math.cos(a) + across.z * Math.sin(a),
		};
		g.setAttitude(turned, u);
	});
	return {
		appeared,
		regime: g.regime,
		encounter: g.encounter,
		lastExit: g.lastExit,
		after: I.raider(),
	};
});

check(
	"a hard turn breaks the lock: the raider is gone and the player still cruises",
	broke.appeared.encounter?.phase === "contest" &&
		broke.regime === "cruise" &&
		broke.encounter === null &&
		broke.lastExit.startsWith("broke") &&
		broke.after.contact === null &&
		!broke.after.meshInScene,
	JSON.stringify(broke),
);
await page.close();

// ---------------------------------------------------------------------------
// ?raider: a leg draws its raider when the spool completes.
// ---------------------------------------------------------------------------

const playtest = await browser.newPage({
	viewport: { width: 900, height: 620 },
});
watch(playtest);
await playtest.goto(gameUrl(origin, { seed: 42, raider: true }));
await bootedGame(playtest);
await playtest.evaluate(installHelpers);
const leg = await playtest.evaluate(() => {
	const g = window.__seelite;
	const I = window.__int;
	I.cruise();
	return {
		regime: g.regime,
		legStartedAtS: g.legStartedAtS,
		encounter: g.encounter
			? { phase: g.encounter.phase, appearsAtS: g.encounter.appearsAtS }
			: null,
	};
});
check(
	"under ?raider a cruise leg schedules a raider when the spool completes",
	leg.regime === "cruise" &&
		leg.encounter?.phase === "inbound" &&
		leg.encounter.appearsAtS > leg.legStartedAtS,
	JSON.stringify(leg),
);
await playtest.close();

await browser.close();
exit();
