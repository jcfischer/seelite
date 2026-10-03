/**
 * A ship stops at a body's surface in normal flight, and the cockpit camera is
 * still outside the surface on the frame of impact (`collision.md` §9.2.3,
 * node #661).
 *
 * **At a moon, and that is #514's doing rather than a choice of subject.**
 * Normal flight stops at a planet's 1.2-radius boundary, so no flown approach
 * reaches a planet's collision sphere: §2.1's planet sphere is defence in depth
 * under that boundary, and `tests/sim.test.ts` holds the boundary. A moon has
 * no such boundary, so a moon is where a pilot meets §2.1's sphere. Seed 47,
 * system 0, `planet-0-moon-0`: 1,813 km, carried at about 32 km/s.
 *
 * `tests/collision.test.ts` owns the law and the resolver. What only the page
 * can answer is the wiring — that `Game` hands the flown hull's box to
 * `stepWorld` while flying, lands the impact through its one damage path, and
 * that the camera the player looks through is not inside the moon on the frame
 * the ship meets it. Three rows: assist off at the docking gate, assist on
 * under a small throttle, and a fast hit that kills.
 *
 * Every row prints what it read, so the same probe at two refs is the
 * before/after.
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
const SEED = 47;
const SYSTEM = 0;
const MOON = "planet-0-moon-0";
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/**
 * Fly at the moon nose first from `startKm` above it, at `gates` times V_GATE,
 * and step until the ship has met it and `afterS` more seconds have passed.
 */
const approach = async ({ assist, throttle, gates, startKm, afterS }) => {
	const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
	watch(page);
	await page.goto(gameUrl(origin, { seed: SEED, system: SYSTEM }));
	await bootedGame(page);
	const r = await page.evaluate(
		({ moonId, assist, throttle, gates, startKm, afterS }) => {
			const g = window.__seelite;
			const gate = g.dockingTolerances.V_GATE_KMS;
			const speedKms = gates * gate;
			const dt = g.units.MAX_DT;
			const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
			const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
			const len = (a) => Math.hypot(a.x, a.y, a.z);
			const moon = g.world.system.byId.get(moonId);
			if (!moon) return { error: `no ${moonId} at seed/system` };
			// Down onto the moon along a fixed direction, nose first, co-moving
			// with it plus `speedKms` inward.
			const down = (() => {
				const d = { x: -0.31, y: 0.62, z: -0.72 };
				const n = len(d);
				return { x: d.x / n, y: d.y / n, z: d.z / n };
			})();
			const V = g.nearScene.position.constructor;
			g.orientation.setFromUnitVectors(
				new V(0, 0, -1),
				new V(down.x, down.y, down.z),
			);
			g.rates = { pitch: 0, yaw: 0, roll: 0 };
			const rangeKm = moon.radiusKm + startKm;
			g.world.ship.pos = {
				x: moon.pos.x - down.x * rangeKm,
				y: moon.pos.y - down.y * rangeKm,
				z: moon.pos.z - down.z * rangeKm,
			};
			const carried = g.stationVelocity(moonId);
			g.world.ship.vel = {
				x: carried.x + down.x * speedKms,
				y: carried.y + down.y * speedKms,
				z: carried.z + down.z * speedKms,
			};
			// A frame body held from the boot (the arrival planet, the moon's own
			// parent) would win over the moon; let the nearest body decide.
			g.proximityFrameBodyId = null;
			g.assist = assist;
			g.throttle = throttle;
			const start = { fore: g.condition.fore, hull: g.condition.hull };
			let metAt = null;
			let cameraGapAtImpact = null;
			let lowestCameraGapKm = Number.POSITIVE_INFINITY;
			let lowestShipGapKm = Number.POSITIVE_INFINITY;
			let outwardAfterKms = null;
			let lastRadial = -speedKms;
			// A cost after the frame of impact: any later step on which a shield
			// or the hull fell. Read step to step rather than against the start,
			// because a shield recharges once it has gone unstruck long enough.
			let laterHits = 0;
			let metStep = null;
			let prevFore = start.fore;
			let prevHull = start.hull;
			const frames = new Set();
			const limit = Math.round((startKm / speedKms + afterS + 5) / dt);
			let i = 0;
			for (; i < limit; i++) {
				g.step(dt);
				g.render(dt);
				frames.add(g.frameBody?.id ?? null);
				const moonVel = g.stationVelocity(moonId);
				const out = sub(g.world.ship.pos, moon.pos);
				const outN = len(out);
				const unitOut = { x: out.x / outN, y: out.y / outN, z: out.z / outN };
				const radial = dot(sub(g.world.ship.vel, moonVel), unitOut);
				const cameraGapKm = len(sub(g.cameraSimPos, moon.pos)) - moon.radiusKm;
				lowestCameraGapKm = Math.min(lowestCameraGapKm, cameraGapKm);
				lowestShipGapKm = Math.min(lowestShipGapKm, outN - moon.radiusKm);
				// The frame of impact: the radial speed relative to the moon stops
				// being inward (a bounce, or a resting stop under thrust), or the
				// shields drop.
				if (
					metAt === null &&
					((lastRadial < -1e-6 && radial > -1e-6) ||
						g.condition.fore < start.fore ||
						g.condition.hull < start.hull ||
						g.dead)
				) {
					metAt = i * dt;
					metStep = i;
					cameraGapAtImpact = cameraGapKm;
					outwardAfterKms = radial;
				}
				lastRadial = radial;
				if (
					metStep !== null &&
					i > metStep &&
					(g.condition.fore < prevFore - 1e-9 ||
						g.condition.hull < prevHull - 1e-9)
				)
					laterHits++;
				prevFore = g.condition.fore;
				prevHull = g.condition.hull;
				if (g.dead) break;
				if (metAt !== null && i * dt > metAt + afterS) break;
			}
			const out = sub(g.world.ship.pos, moon.pos);
			return {
				moon: moonId,
				radiusKm: moon.radiusKm,
				frames: [...frames],
				regime: g.regime,
				assist: g.assist,
				metAtS: metAt,
				cameraGapAtImpactKm: cameraGapAtImpact,
				lowestCameraGapKm,
				lowestShipGapKm,
				endGapKm: len(out) - moon.radiusKm,
				outwardAfterKms,
				foreSpent: start.fore - g.condition.fore,
				hullSpent: start.hull - g.condition.hull,
				hullLeft: g.condition.hull,
				laterHits,
				dead: g.dead,
				lastExit: g.lastExit,
				law: {
					V_SCRAPE_KMS: g.collisionLaw.V_SCRAPE_KMS,
					RESTITUTION: g.collisionLaw.RESTITUTION,
					damage: g.collisionLaw.impactDamage(speedKms),
				},
				gateKms: gate,
				speedKms,
			};
		},
		{ moonId: MOON, assist, throttle, gates, startKm, afterS },
	);
	await page.close();
	return r;
};

// Row 1: assist off, coasting in at the docking gate. Bound 1 of §3 makes it
// survivable on every hull; the ship bounces at RESTITUTION and lives.
{
	const r = await approach({
		assist: false,
		throttle: 0,
		gates: 1,
		startKm: 0.3,
		afterS: 2,
	});
	console.log(`assist off at V_GATE: ${JSON.stringify(r)}`);
	check(
		"assist off: a ship meeting a moon at V_GATE stops at its surface and bounces",
		!r.error &&
			r.regime === "normal" &&
			r.metAtS !== null &&
			r.lowestShipGapKm > 0 &&
			Math.abs(r.outwardAfterKms / (r.law.RESTITUTION * r.gateKms) - 1) < 0.1,
		JSON.stringify(r),
	);
	check(
		"assist off: the cockpit camera is outside the moon on the frame of impact",
		r.cameraGapAtImpactKm !== null &&
			r.cameraGapAtImpactKm > 0 &&
			r.lowestCameraGapKm > 0,
		JSON.stringify(r),
	);
	check(
		"assist off: the impact lands through the damage path, and the ship survives it",
		!r.dead &&
			r.hullSpent === 0 &&
			Math.abs(r.foreSpent / r.law.damage - 1) < 0.1,
		JSON.stringify(r),
	);
}

// Row 2: assist on, a small throttle held toward the moon in its frame. The
// assist keeps pushing after the impact, so the ship ends resting on the
// surface — outside it, at no further cost: nothing falls after the frame of
// impact, and the hull is never touched.
{
	const r = await approach({
		assist: true,
		throttle: 0.04,
		gates: 0.8,
		startKm: 0.3,
		afterS: 4,
	});
	console.log(`assist on, throttle held: ${JSON.stringify(r)}`);
	check(
		"assist on: flown in the moon's frame, the ship stops and rests on its surface",
		!r.error &&
			r.frames.length === 1 &&
			r.frames[0] === r.moon &&
			r.metAtS !== null &&
			r.lowestShipGapKm > 0 &&
			r.endGapKm < 0.1 &&
			!r.dead,
		JSON.stringify(r),
	);
	check(
		"assist on: resting under thrust costs nothing after the frame of impact",
		r.metAtS !== null && r.laterHits === 0 && r.hullSpent === 0,
		JSON.stringify(r),
	);
	check(
		"assist on: the cockpit camera never enters the moon",
		r.cameraGapAtImpactKm !== null && r.lowestCameraGapKm > 0,
		JSON.stringify(r),
	);
}

// Row 3: a hit at the 2 km/s assist cap kills (§3 bound 2), by the kill path.
{
	const r = await approach({
		assist: false,
		throttle: 0,
		gates: 20,
		startKm: 1,
		afterS: 0.5,
	});
	console.log(`assist off at 2 km/s: ${JSON.stringify(r)}`);
	check(
		"a moon met at the assist cap destroys the ship, through the kill path",
		// `takeDamage` is the one damage path and the only writer of "ship
		// destroyed"; a death any other way would leave a different line.
		!r.error &&
			r.metAtS !== null &&
			r.dead &&
			r.hullLeft === 0 &&
			r.lastExit === "ship destroyed" &&
			r.lowestShipGapKm > 0,
		JSON.stringify(r),
	);
	check(
		"the cockpit camera is outside the moon on the frame of that impact too",
		r.cameraGapAtImpactKm !== null && r.cameraGapAtImpactKm > 0,
		JSON.stringify(r),
	);
}

await browser.close();
exit();
