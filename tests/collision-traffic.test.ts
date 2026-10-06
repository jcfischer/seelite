/**
 * `docs/specs/collision.md` §9.1, the rows node #664 owes: ships and Traffic
 * collide.
 *
 * - **9.1.13** — ship against ship (C4b): momentum conserved, the relative
 *   normal velocity left at `RESTITUTION · v_n` separating, the same damage on
 *   each ship on its own side, and a courier against a carrier moves the
 *   courier. Then the wiring: `stepWorld` meets a flown fleet ship against
 *   the world and against the player.
 * - **§5** — a carrier's exemption keyed on its route phase, for every phase,
 *   with each exempt phase's boundaries in time read off the route law.
 * - **9.1.14** — a hull-reaching impact writes H3c's `disable` then
 *   `repair-start`, a shield-only one writes nothing, and none of it claims
 *   the player's gun. Then §6 item 1's corpus row.
 *
 * **The corpus row is red.** `scripts/measure-traffic-collision.ts` over 40
 * systems of seed 47 meets the world in four classes, and one of them — a
 * local approach whose straight line runs through a trade station — is met at
 * up to 8.96 km/s. The node says avoidance is filed below it rather than built
 * past it, so the gated half here **pins what it measured** and says so: a
 * change that moves a route, mends one class or opens another turns this red
 * and owes `docs/findings/traffic-collision-corpus.md` a re-run.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	type ShipMotion,
	RESTITUTION,
	V_SCRAPE_KMS,
	hullBox,
	impactDamage,
	pairSeparation,
	reachKm,
	shipImpulse,
	SEPARATION_KM,
	bodySphere,
	shipPose,
	sweepShip,
	sweepShipPair,
} from "../src/collision";
import { generateGalaxy } from "../src/galaxy";
import { HULL_SPECS, type HullId, PLAYER_BASELINE_HULL } from "../src/hull";
import { carrierKey } from "../src/carrier-key";
import { raiderAtDrop } from "../src/duel";
import {
	type Encounter,
	forceEncounter,
	landRaiderImpacts,
	stepEncounter,
} from "../src/encounter";
import { type Holdings, applyHoldEvent } from "../src/holdings";
import { emptyLadderRecord, emptyPending } from "../src/ladder";
import { PLAYER_KILL, raiderDestruction } from "../src/raider-wreck";
import { RAIDER_HULL_ID } from "../src/raider-slots";
import { emptyRequests } from "../src/requests";
import { newCommander } from "../src/station-commerce";
import { applyDamage, fullCondition, headOnPool } from "../src/ship-condition";
import {
	type FleetShip,
	type HullAttitude,
	PLAYER_SHIP_ID,
	bodyVelocity,
	flightPerformance,
	makeSystem,
	makeWorld,
	advanceWorldClock,
	projectedMayMeet,
	speedDemand,
	stationApertureFrame,
	stepFleet,
	stepWorld,
	worldStarts,
} from "../src/sim";
import {
	type TrafficCollision,
	type TrafficRoutePhase,
	projectSystemTrafficActor,
	trafficCollides,
	trafficCollisionClass,
} from "../src/station-route";
import {
	nextTrafficDepartureAtS,
	stationTrafficRoster,
} from "../src/station-traffic";
import { generateContents } from "../src/system";
import {
	impactCause,
	impactCauseOf,
	impactOutcome,
	trafficImpactTransitions,
} from "../src/traffic-engagement";
import { type EntryPose, slotBasis } from "../src/docking";
import {
	type TrafficSamples,
	presentedTrafficAttitude,
	presentedTrafficPos,
	presentedTrafficStep,
} from "../src/traffic-presentation";
import { STATION_GEOMETRY } from "../src/station";
import {
	type Vec3,
	add,
	cross,
	dot,
	length,
	scale,
	sub,
	v3,
} from "../src/vec3";
import {
	applyTransition,
	effectiveCarrier,
	newWorld,
} from "../src/world-state";
import {
	type CorpusResult,
	type Meeting,
	contentsCache,
	distinctMeetings,
	firstDepartureS,
	meetingClass,
	trafficCollisionCorpus,
} from "../scripts/lib/traffic-collision-corpus";

const box = (hull: HullId) => [
	hullBox(HULL_SPECS[hull].env, HULL_SPECS[hull].envCentre),
];

/** A ship flying straight along `vel` for one step, nose along `nose`. */
function flying(
	hull: HullId,
	start: Vec3,
	vel: Vec3,
	dt: number,
	nose = v3(0, 0, 1),
	up = v3(0, 1, 0),
): ShipMotion {
	return {
		massT: HULL_SPECS[hull].massT,
		primitives: box(hull),
		start: shipPose(start, nose, up),
		end: shipPose(add(start, scale(vel, dt)), nose, up),
		velStart: vel,
		velEnd: vel,
	};
}

/**
 * Seed 47's star, a sphere riding at `vel`, seen along `dir` outward from its
 * centre, with every ship nosed down onto it: how far a hull at `pos` stands
 * clear of it, where a hull stands `clearKm` above it, and where a second hull
 * stands `gapKm` outward of another. Both placements probe the gap rather
 * than adding up half-lengths.
 */
function starFixture(world: ReturnType<typeof makeWorld>, dir: Vec3) {
	const star = world.system.bodies.find((b) => b.kind === "star");
	if (!star) throw new Error("seed 47 has no star");
	const vel = bodyVelocity(world.system, star.id, world.gameTime);
	const nose = scale(dir, -1);
	const up = v3(0, 1, 0);
	const sphere = bodySphere(star.radiusKm);
	const starAt = shipPose(star.pos, v3(0, 0, 1), v3(0, 1, 0));
	const clearance = (hull: HullId, pos: Vec3) => {
		const gap = pairSeparation(
			box(hull)[0],
			shipPose(pos, nose, up),
			sphere,
			starAt,
		);
		return gap.overlap ? -1 : gap.distanceKm;
	};
	const above = (hull: HullId, clearKm: number) => {
		const probe = add(star.pos, scale(dir, star.radiusKm + 0.1));
		return add(probe, scale(dir, clearKm - clearance(hull, probe)));
	};
	const outward = (
		hull: HullId,
		of: { hull: HullId; pos: Vec3 },
		gapKm: number,
	) => {
		const probe = add(of.pos, scale(dir, 0.2));
		const gap = pairSeparation(
			box(hull)[0],
			shipPose(probe, nose, up),
			box(of.hull)[0],
			shipPose(of.pos, nose, up),
		);
		if (gap.overlap) throw new Error("the probe pose overlaps");
		return sub(probe, scale(dir, gap.distanceKm - gapKm));
	};
	return { star, vel, nose, up, clearance, above, outward };
}

const momentum = (m: number, v: Vec3) => scale(v, m);

/** The player at rest, nose along −z. */
const still = (): HullAttitude => ({
	nose: v3(0, 0, -1),
	up: v3(0, 1, 0),
	rates: { pitch: 0, yaw: 0, roll: 0 },
});

/** Nothing asked of the vents, with the assist off, so the step leaves the
 *  player's velocity where it was. */
const HANDS_OFF = {
	stick: { pitch: 0, yaw: 0, roll: 0 },
	turnAssist: true,
	translation: { demand: speedDemand(0), assist: false },
};

/**
 * A ship that starts the step at rest and ends it at `velEnd` — thrust
 * applied within the step — with its start placed so its box stands
 * `gapKm` short of `other`'s along −z. §3.1 reads a resting pair's closing
 * at the start of the step, so a pair touching like this bills nothing.
 */
function thrustingInto(
	hull: HullId,
	other: ShipMotion,
	gapKm: number,
	velEnd: Vec3,
	dt: number,
): ShipMotion {
	const { x, y } = other.start.origin;
	const probe = (z: number) =>
		pairSeparation(
			box(hull)[0],
			shipPose(v3(x, y, z), v3(0, 0, 1), v3(0, 1, 0)),
			other.primitives[0],
			other.start,
		);
	const z0 = other.start.origin.z - 1;
	const first = probe(z0);
	if (first.overlap) throw new Error("the probe pose overlaps");
	const start = v3(x, y, z0 + first.distanceKm - gapKm);
	return {
		massT: HULL_SPECS[hull].massT,
		primitives: box(hull),
		start: shipPose(start, v3(0, 0, 1), v3(0, 1, 0)),
		end: shipPose(add(start, scale(velEnd, dt)), v3(0, 0, 1), v3(0, 1, 0)),
		velStart: v3(),
		velEnd,
	};
}

/** The next step from where a pair left a ship, flying on straight. */
const onward = (
	m: ShipMotion,
	end: { pos: Vec3; vel: Vec3 },
	dt: number,
): ShipMotion => ({
	...m,
	start: { ...m.end, origin: end.pos },
	end: { ...m.end, origin: add(end.pos, scale(end.vel, dt)) },
	velStart: end.vel,
	velEnd: end.vel,
});

describe("collision.md §9.1.13: ship against ship (C4b)", () => {
	test("the impulse conserves momentum and leaves the pair separating at RESTITUTION · v_n", () => {
		const n = v3(0, 0, -1);
		for (const [ma, mb] of [
			[60, 60],
			[60, 14000],
			[14000, 46],
		]) {
			const kick = shipImpulse(n, -0.4, RESTITUTION * 0.4, ma, mb);
			const total = add(momentum(ma, kick.a), momentum(mb, kick.b));
			expect(length(total)).toBeLessThan(1e-9);
			// The relative normal velocity moves by exactly what was asked.
			expect(dot(sub(kick.a, kick.b), n)).toBeCloseTo(
				0.4 * (1 + RESTITUTION),
				12,
			);
		}
	});

	test("a courier against a carrier, head on: momentum kept, same damage, each on its own fore side", () => {
		const dt = 0.1;
		// The courier closes on the capital along +z, nose first; the carrier
		// sits still, nose toward it. Their boxes are 50 m apart at the start.
		const carrierHalf = HULL_SPECS.carrier.env.lengthKm / 2;
		const courierHalf = HULL_SPECS.courier.env.lengthKm / 2;
		const gap = 0.05;
		const closing = 1.0;
		const a = flying(
			"courier",
			v3(0, 0, -(carrierHalf + courierHalf + gap)),
			v3(0, 0, closing),
			dt,
		);
		const b = flying("carrier", v3(), v3(), dt, v3(0, 0, -1));
		const pair = sweepShipPair(a, b, dt);
		expect(pair.impacts).toHaveLength(1);
		const [hit] = pair.impacts;
		expect(hit.closingKms).toBeCloseTo(closing, 6);
		expect(hit.damage).toBe(impactDamage(hit.closingKms));
		// Same damage on each side, each side its own: both noses face the other.
		expect([hit.sideA, hit.sideB]).toEqual(["fore", "fore"]);

		const ma = a.massT;
		const mb = b.massT;
		const before = add(momentum(ma, a.velEnd), momentum(mb, b.velEnd));
		const after = add(momentum(ma, pair.a.vel), momentum(mb, pair.b.vel));
		expect(length(sub(after, before))).toBeLessThan(1e-9 * length(before));
		// Separating at RESTITUTION · v_n along the normal (B toward A).
		expect(dot(sub(pair.a.vel, pair.b.vel), hit.normal)).toBeCloseTo(
			RESTITUTION * closing,
			6,
		);
		// The courier moves; the carrier barely does.
		const courierDv = length(sub(pair.a.vel, a.velEnd));
		const carrierDv = length(sub(pair.b.vel, b.velEnd));
		expect(courierDv).toBeGreaterThan(1.4);
		expect(carrierDv).toBeLessThan(0.01);
		expect(courierDv / carrierDv).toBeCloseTo(mb / ma, 6);
		// And they end apart, box from box.
		const apart = pairSeparation(
			a.primitives[0],
			{ ...a.end, origin: pair.a.pos },
			b.primitives[0],
			{ ...b.end, origin: pair.b.pos },
		);
		expect(apart.overlap).toBe(false);
	});

	test("the same law holds with the heavy ship as the swept one", () => {
		const dt = 0.1;
		const carrierHalf = HULL_SPECS.carrier.env.lengthKm / 2;
		const courierHalf = HULL_SPECS.courier.env.lengthKm / 2;
		const a = flying(
			"carrier",
			v3(0, 0, -(carrierHalf + courierHalf + 0.02)),
			v3(0, 0, 0.6),
			dt,
		);
		const b = flying("courier", v3(), v3(), dt, v3(0, 0, -1));
		const pair = sweepShipPair(a, b, dt);
		expect(pair.impacts).toHaveLength(1);
		const before = add(
			momentum(a.massT, a.velEnd),
			momentum(b.massT, b.velEnd),
		);
		const after = add(
			momentum(a.massT, pair.a.vel),
			momentum(b.massT, pair.b.vel),
		);
		expect(length(sub(after, before))).toBeLessThan(1e-9 * length(before));
		// The courier is what moves, though it was struck rather than striking.
		expect(length(sub(pair.b.vel, b.velEnd))).toBeGreaterThan(
			100 * length(sub(pair.a.vel, a.velEnd)),
		);
		// The carrier was not shoved aside by its own correction either.
		expect(length(sub(pair.a.pos, a.end.origin))).toBeLessThan(0.001);
	});

	test("a struck ship's side is its own: a carrier hit astern takes it aft", () => {
		const dt = 0.1;
		const carrierHalf = HULL_SPECS.carrier.env.lengthKm / 2;
		const courierHalf = HULL_SPECS.courier.env.lengthKm / 2;
		const a = flying(
			"courier",
			v3(0, 0, -(carrierHalf + courierHalf + 0.05)),
			v3(0, 0, 1),
			dt,
		);
		// The carrier faces away from the courier.
		const b = flying("carrier", v3(), v3(), dt, v3(0, 0, 1));
		const [hit] = sweepShipPair(a, b, dt).impacts;
		expect([hit.sideA, hit.sideB]).toEqual(["fore", "aft"]);
	});

	test("a turning ship's side is read on the attitude its box was swept at, not a chord between its ends", () => {
		// Sage round 4: B turns 170° about its up across the step, and A flies
		// into it from 30° off its starting nose. Its box is swept turning
		// through the arc, so the side it is struck on is read off the nose on
		// that arc — the chord between the two end noses lags it by up to 38°
		// and puts this hit aft.
		const dt = 0.1;
		const up = v3(0, 1, 0);
		const th = (170 * Math.PI) / 180;
		const z0 = v3(0, 0, 1);
		const z1 = v3(Math.sin(th), 0, Math.cos(th));
		const b: ShipMotion = {
			massT: HULL_SPECS.courier.massT,
			primitives: box("courier"),
			start: shipPose(v3(), z0, up),
			end: shipPose(v3(), z1, up),
			velStart: v3(),
			velEnd: v3(),
		};
		const from = scale(
			v3(Math.sin(Math.PI / 6), 0, Math.cos(Math.PI / 6)),
			0.13,
		);
		const a = flying("courier", from, scale(from, -1 / dt), dt, v3(1, 0, 0));
		const [hit] = sweepShipPair(a, b, dt).impacts;
		const s = hit.timeS / dt;
		// The premise: the two readings disagree on this hit.
		const chord = add(z0, scale(sub(z1, z0), s));
		const arc = v3(Math.sin(th * s), 0, Math.cos(th * s));
		expect(dot(chord, hit.point)).toBeLessThan(0);
		expect(dot(arc, hit.point)).toBeGreaterThan(0);
		expect(hit.sideB).toBe("fore");
	});

	test("a turn alone into a still ship leaves the contact points separating at RESTITUTION · v_n", () => {
		// Sage round 11: a still carrier turning 90° about its up across the
		// step swings its nose into a still courier. Neither translates, so the
		// whole closing speed is the turn's, at the point where they meet —
		// and the impulse must take *those* points apart, not the origins.
		const dt = 0.1;
		const up = v3(0, 1, 0);
		const turnS = Math.PI / 2 / dt;
		const carrier: ShipMotion = {
			massT: HULL_SPECS.carrier.massT,
			primitives: box("carrier"),
			start: shipPose(v3(), v3(0, 0, 1), up),
			end: shipPose(v3(), v3(1, 0, 0), up),
			velStart: v3(),
			velEnd: v3(),
		};
		const courier = flying("courier", v3(0.124, 0, 0.124), v3(), dt);
		const omega = v3(0, turnS, 0);
		// The point's velocity on each ship, with each one's turn about its
		// own (still) origin.
		const turning = (p: Vec3) => cross(omega, p);
		for (const carrierIsA of [true, false]) {
			const [a, b] = carrierIsA ? [carrier, courier] : [courier, carrier];
			const pair = sweepShipPair(a, b, dt);
			expect(pair.ghost).toBe(false);
			expect(pair.impacts).toHaveLength(1);
			const [hit] = pair.impacts;
			expect(hit.resting).toBe(false);
			expect(hit.closingKms).toBeGreaterThan(V_SCRAPE_KMS);
			const spinA = carrierIsA ? turning(hit.point) : v3();
			const spinB = carrierIsA ? v3() : turning(hit.point);
			const pointRel = sub(add(pair.a.vel, spinA), add(pair.b.vel, spinB));
			expect(dot(pointRel, hit.normal)).toBeCloseTo(
				RESTITUTION * hit.closingKms,
				6,
			);
			// Momentum kept: the impulse is linear and equal and opposite.
			const after = add(
				momentum(a.massT, pair.a.vel),
				momentum(b.massT, pair.b.vel),
			);
			expect(length(after)).toBeLessThan(1e-9 * a.massT);
		}
	});

	test("a resting pair thrusting together bills nothing, and is held apart by mass", () => {
		const dt = 0.1;
		const carrier = flying("carrier", v3(), v3(), dt, v3(0, 0, -1));
		const b: ShipMotion = {
			...carrier,
			end: { ...carrier.end, origin: v3(0, 0, -0.002) },
			velEnd: v3(0, 0, -0.02),
		};
		const a = thrustingInto("courier", b, SEPARATION_KM, v3(0, 0, 0.05), dt);
		// The precondition: the single-ship sweep holds A without billing it.
		const alone = sweepShip(a, [b], dt);
		expect(alone.impacts).toEqual([]);
		expect(alone.ghosts).toEqual([]);
		expect(length(sub(alone.pos, a.end.origin))).toBeGreaterThan(1e-4);

		const pair = sweepShipPair(a, b, dt);
		expect(pair.impacts).toEqual([]);
		expect(pair.ghost).toBe(false);
		// Both moved, in the mass's proportions, and neither left overlapped.
		const apart = pairSeparation(
			a.primitives[0],
			{ ...a.end, origin: pair.a.pos },
			b.primitives[0],
			{ ...b.end, origin: pair.b.pos },
		);
		expect(apart.overlap).toBe(false);
		const movedA = length(sub(pair.a.pos, a.end.origin));
		const movedB = length(sub(pair.b.pos, b.end.origin));
		expect(movedA / movedB).toBeCloseTo(b.massT / a.massT, 6);
		// Momentum kept, and the pair no longer closing.
		const before = add(
			momentum(a.massT, a.velEnd),
			momentum(b.massT, b.velEnd),
		);
		const after = add(
			momentum(a.massT, pair.a.vel),
			momentum(b.massT, pair.b.vel),
		);
		expect(length(sub(after, before))).toBeLessThan(1e-9);
		expect(dot(sub(pair.a.vel, pair.b.vel), v3(0, 0, -1))).toBeGreaterThan(
			-1e-12,
		);
		// The next step starts touching, not inside: no ghost, nothing billed.
		const next = sweepShipPair(
			onward(a, pair.a, dt),
			onward(b, pair.b, dt),
			dt,
		);
		expect(next.ghost).toBe(false);
		expect(next.impacts).toEqual([]);
	});

	test("a projected B takes no share of a hold with nothing billed: A is moved out alone", () => {
		const dt = 0.1;
		const b = flying("carrier", v3(), v3(), dt, v3(0, 0, -1));
		const a = thrustingInto("courier", b, SEPARATION_KM, v3(0, 0, 0.05), dt);
		const alone = sweepShip(a, [b], dt);
		const pair = sweepShipPair(a, b, dt, { bProjected: true });
		expect(pair.impacts).toEqual([]);
		expect(pair.b.pos).toEqual(b.end.origin);
		expect(pair.b.vel).toEqual(b.velEnd);
		expect(pair.a.pos).toEqual(alone.pos);
		expect(pair.a.vel).toEqual(alone.vel);
	});

	test("two ships that never close never meet", () => {
		const dt = 0.1;
		const a = flying("courier", v3(-1, 0, 0), v3(0, 0, 1), dt);
		const b = flying("carrier", v3(1, 0, 0), v3(0, 0, 1), dt);
		expect(sweepShipPair(a, b, dt).impacts).toEqual([]);
	});
});

describe("stepWorld: a fleet ship meets the world and the player (node #664)", () => {
	const raider = (pos: Vec3, vel: Vec3, dt: number): FleetShip => ({
		id: "raider",
		projected: false,
		motion: flying("raider", sub(pos, scale(vel, dt)), vel, dt),
	});

	test("a raider flown into a planet meets it, and is left outside it", () => {
		const world = makeWorld(47);
		const planet = world.system.bodies.find((b) => b.kind === "planet");
		if (!planet) throw new Error("no planet");
		// Far from the player, falling onto the planet's surface at 2 km/s.
		const dt = 0.1;
		const dir = v3(1, 0, 0);
		const surface = add(planet.pos, scale(dir, planet.radiusKm));
		const start = add(surface, scale(dir, 0.1));
		// Falling at 2 km/s in the planet's own frame: it orbits at tens of
		// km/s, and a fall in star coordinates would miss it by kilometres.
		const fall = add(
			bodyVelocity(world.system, planet.id, world.gameTime),
			scale(dir, -2),
		);
		const ship: FleetShip = {
			id: "raider",
			projected: false,
			motion: flying("raider", start, fall, dt, scale(dir, -1)),
		};
		const flown = stepWorld(
			world,
			still(),
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[],
			[ship],
		);
		const [step] = flown.fleet;
		expect(step.impacts.map((i) => i.with)).toEqual([planet.id]);
		expect(step.impacts[0].closingKms).toBeGreaterThan(1.5);
		expect(length(sub(step.pos, planet.pos))).toBeGreaterThan(planet.radiusKm);
		// The planet is not a ship, and the player met nothing.
		expect(step.impacts[0].ship).toBe(false);
		expect(flown.shipImpacts).toEqual([]);
	});

	test("the player rams a raider: both take one damage, momentum is split by mass", () => {
		const world = makeWorld(47);
		const dt = 0.1;
		const half =
			(HULL_SPECS.courier.env.lengthKm + HULL_SPECS.raider.env.lengthKm) / 2;
		// The raider sits dead ahead of a player closing at 0.5 km/s.
		world.ship.vel = v3(0, 0, -0.5);
		const ahead = add(world.ship.pos, v3(0, 0, -(half + 0.03)));
		const ship = raider(ahead, v3(), dt);
		ship.motion.start = shipPose(ahead, v3(0, 0, 1), v3(0, 1, 0));
		ship.motion.end = shipPose(ahead, v3(0, 0, 1), v3(0, 1, 0));
		const playerBefore = { ...world.ship.vel };
		const flown = stepWorld(
			world,
			still(),
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[],
			[ship],
		);
		expect(flown.shipImpacts.map((i) => i.with)).toEqual(["raider"]);
		const [mine] = flown.shipImpacts;
		const [theirs] = flown.fleet[0].impacts;
		expect(theirs.with).toBe(PLAYER_SHIP_ID);
		expect(theirs.damage).toBe(mine.damage);
		expect(mine.damage).toBeGreaterThan(0);
		expect([mine.side, theirs.side]).toEqual(["fore", "fore"]);
		// Momentum, against the player's own step velocity (the assist is off
		// and no vent fired, so the step left it where it was).
		const mp = HULL_SPECS.courier.massT;
		const mr = HULL_SPECS.raider.massT;
		const before = momentum(mp, playerBefore);
		const after = add(
			momentum(mp, world.ship.vel),
			momentum(mr, flown.fleet[0].vel),
		);
		expect(length(sub(after, before))).toBeLessThan(1e-6);
	});

	test("a raider resting against the player and thrusting into it is held apart, and nothing is billed", () => {
		const world = makeWorld(47);
		const dt = 0.1;
		world.ship.vel = v3();
		const you: ShipMotion = {
			massT: HULL_SPECS.courier.massT,
			primitives: box("courier"),
			start: shipPose(world.ship.pos, v3(0, 0, -1), v3(0, 1, 0)),
			end: shipPose(world.ship.pos, v3(0, 0, -1), v3(0, 1, 0)),
			velStart: v3(),
			velEnd: v3(),
		};
		const motion = thrustingInto(
			"raider",
			you,
			SEPARATION_KM,
			v3(0, 0, 0.05),
			dt,
		);
		const flown = stepWorld(
			world,
			still(),
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[],
			[{ id: "raider", projected: false, motion }],
		);
		expect(flown.shipImpacts).toEqual([]);
		const [step] = flown.fleet;
		expect(step.impacts).toEqual([]);
		// The hold landed on both ships: neither ends where its own step put
		// it, and the two are not left overlapped for the next step's ghost.
		expect(length(sub(step.pos, motion.end.origin))).toBeGreaterThan(0);
		expect(length(sub(world.ship.pos, you.end.origin))).toBeGreaterThan(0);
		const apart = pairSeparation(
			box("courier")[0],
			{ ...you.end, origin: world.ship.pos },
			box("raider")[0],
			{ ...motion.end, origin: step.pos },
		);
		expect(apart.overlap).toBe(false);
		const before = momentum(HULL_SPECS.raider.massT, motion.velEnd);
		const after = add(
			momentum(HULL_SPECS.courier.massT, world.ship.vel),
			momentum(HULL_SPECS.raider.massT, step.vel),
		);
		expect(length(sub(after, before))).toBeLessThan(1e-9);
	});

	test("two projected carriers are never paired: a route against a route is the corpus row's", () => {
		const world = makeWorld(47);
		const dt = 0.1;
		const far = add(world.ship.pos, v3(500, 0, 0));
		const one: FleetShip = {
			id: "a",
			projected: true,
			motion: flying("freighter", far, v3(0, 0, 1), dt),
		};
		const two: FleetShip = {
			id: "b",
			projected: true,
			motion: flying("freighter", add(far, v3(0, 0, 0.12)), v3(0, 0, -1), dt),
		};
		const flown = stepWorld(
			world,
			still(),
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[],
			[one, two],
		);
		expect(flown.fleet.flatMap((f) => f.impacts)).toEqual([]);
		// The control: the same pair with one of them flown meets.
		const met = stepWorld(
			makeWorld(47),
			still(),
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[],
			[{ ...one, projected: false }, two],
		);
		expect(met.fleet[0].impacts.map((i) => i.with)).toEqual(["b"]);
		expect(met.fleet[1].impacts.map((i) => i.with)).toEqual(["a"]);
	});
});

describe("projectedMayMeet: a projection is met by anything flown (node #664)", () => {
	const dt = 0.1;
	const parked = (at: Vec3) => ({ start: at, end: at });

	test("a carrier far from the player but beside a raider is handed to the step", () => {
		const carrier = { pos: v3(3, 0, 0), vel: v3() };
		const player = parked(v3());
		const raider = parked(v3(3, 0, -0.1));
		expect(projectedMayMeet(carrier, [player], dt, 0.5)).toBe(false);
		expect(projectedMayMeet(carrier, [player, raider], dt, 0.5)).toBe(true);
	});

	test("the bound is the pair's relative travel: a frame both share adds nothing", () => {
		// Both carried at 30 km/s in a station's frame, 1 km apart: 3 km of
		// travel each, none of it toward the other.
		const frame = v3(30, 0, 0);
		const carrier = { pos: v3(0, 1, 0), vel: frame };
		const mover = { start: v3(), end: scale(frame, dt) };
		expect(projectedMayMeet(carrier, [mover], dt, 0.5)).toBe(false);
		// Closing at 6 km/s for the step closes 0.6 km of the 1: met.
		const closing = { pos: v3(0, 1, 0), vel: add(frame, v3(0, -6, 0)) };
		expect(projectedMayMeet(closing, [mover], dt, 0.5)).toBe(true);
	});
});

describe("stepWorld: a ship met before the aperture plane owns the tick (§4.2, node #664)", () => {
	const dt = 0.1;
	const SPEED = 1.0;
	const LEAD_KM = 0.06;

	/** The player on a trade station's axis, its centre `LEAD_KM` outside the
	 *  plane and closing at `SPEED`, so it crosses mid-step; and, given
	 *  `gapKm`, a raider riding with the station that far ahead of its box. */
	function enter(gapKm: number | null) {
		const world = makeWorld(47);
		const station = world.system.contents.stations.find(
			(s) => s.type === "trade" && world.system.byId.has(s.id),
		);
		if (!station) throw new Error("seed 47 has no placed trade station");
		const id = station.id;
		const body = world.system.byId.get(id);
		if (!body) throw new Error(`no ${id}`);
		const t = world.gameTime;
		const frame = stationApertureFrame(world.system, id, t);
		const vStation = bodyVelocity(world.system, id, t);
		world.ship.pos = add(
			body.pos,
			scale(frame.axis, STATION_GEOMETRY.trade.aperturePlaneKm + LEAD_KM),
		);
		world.ship.vel = add(vStation, scale(frame.axis, -SPEED));
		const nose = scale(frame.axis, -1);
		const { up } = slotBasis(frame);
		const at: HullAttitude = {
			nose,
			up,
			rates: { pitch: 0, yaw: 0, roll: 0 },
		};
		const before: EntryPose = {
			rel: sub(world.ship.pos, body.pos),
			vRel: sub(world.ship.vel, vStation),
			nose,
			up,
		};
		const fleet: FleetShip[] = [];
		if (gapKm !== null) {
			// Ahead along the nose, its box `gapKm` from the player's, found by
			// probing the gap rather than adding up half-lengths.
			const you = shipPose(world.ship.pos, nose, up);
			const probeAt = add(world.ship.pos, nose);
			const gap = pairSeparation(
				box("raider")[0],
				shipPose(probeAt, frame.axis, up),
				box("courier")[0],
				you,
			);
			if (gap.overlap) throw new Error("the probe pose overlaps");
			const pos = sub(probeAt, scale(nose, gap.distanceKm - gapKm));
			fleet.push({
				id: "raider",
				projected: false,
				motion: {
					massT: HULL_SPECS.raider.massT,
					primitives: box("raider"),
					start: shipPose(pos, frame.axis, up),
					end: shipPose(add(pos, scale(vStation, dt)), frame.axis, up),
					velStart: vStation,
					velEnd: vStation,
				},
			});
		}
		const step = stepWorld(
			world,
			at,
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[{ stationId: id, frame, before }],
			fleet,
		);
		return { step, id };
	}

	test("the control: with no ship in the way the plane is crossed mid-step", () => {
		const { step, id } = enter(null);
		expect(step.plane?.stationId).toBe(id);
		expect(step.plane?.timeS ?? 0).toBeCloseTo(LEAD_KM / SPEED, 2);
		expect(step.impacts).toEqual([]);
	});

	test("a raider met before the crossing owns the tick: the plane is not crossed, the meeting lands", () => {
		// Met at about 0.01 s, the plane at about 0.06 s.
		const { step } = enter(0.01);
		expect(step.plane).toBeNull();
		expect(step.shipImpacts.map((i) => i.with)).toEqual(["raider"]);
		expect(step.fleet[0].impacts.map((i) => i.with)).toEqual([PLAYER_SHIP_ID]);
	});

	test("a raider the step would meet only after the crossing is not met: the plane owns it", () => {
		// Met at about 0.08 s, after the plane's 0.06 s.
		const { step, id } = enter(0.08);
		expect(step.plane?.stationId).toBe(id);
		expect(step.shipImpacts).toEqual([]);
		expect(step.fleet[0].impacts.filter((i) => i.ship)).toEqual([]);
	});
});

describe("stepWorld: a ship met before a world impact owns the tick (§4.2, node #664)", () => {
	const dt = 0.1;
	/** Falling toward the star's surface at 2 km/s, from this far above it. */
	const FALL_KMS = 2;
	const HEIGHT_KM = 0.19;
	/** The gap between the falling ship's box and the heavy ship below it. */
	const GAP_KM = 0.01;

	/** A miner riding with the star, its box `GAP_KM` below `above`'s along
	 *  −`dir`, found by probing the gap rather than adding up half-lengths. */
	function below(
		above: { hull: HullId; pose: ReturnType<typeof shipPose> },
		dir: Vec3,
		nose: Vec3,
		vel: Vec3,
	): FleetShip {
		const probeAt = sub(above.pose.origin, dir);
		const gap = pairSeparation(
			box("miner")[0],
			shipPose(probeAt, nose, v3(0, 1, 0)),
			box(above.hull)[0],
			above.pose,
		);
		if (gap.overlap) throw new Error("the probe pose overlaps");
		const pos = add(probeAt, scale(dir, gap.distanceKm - GAP_KM));
		return {
			id: "miner",
			projected: false,
			motion: {
				massT: HULL_SPECS.miner.massT,
				primitives: box("miner"),
				start: shipPose(pos, nose, v3(0, 1, 0)),
				end: shipPose(add(pos, scale(vel, dt)), nose, v3(0, 1, 0)),
				velStart: vel,
				velEnd: vel,
			},
		};
	}

	/** A raider falling onto the star, and, given `blocked`, a miner between
	 *  it and the surface that it meets first. */
	function fleetFall(blocked: boolean) {
		const world = makeWorld(47);
		const dir = v3(1, 0, 0);
		const { star, vel, nose, clearance } = starFixture(world, dir);
		const start = add(star.pos, scale(dir, star.radiusKm + HEIGHT_KM));
		const fall = add(vel, scale(dir, -FALL_KMS));
		const raider: FleetShip = {
			id: "raider",
			projected: false,
			motion: flying("raider", start, fall, dt, nose),
		};
		const fleet = [raider];
		if (blocked)
			fleet.push(
				below({ hull: "raider", pose: raider.motion.start }, dir, nose, vel),
			);
		const flown = stepWorld(
			world,
			still(),
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[],
			fleet,
		);
		return { flown, star, fleet, clearance, vel };
	}

	test("the control: a raider falling onto the star meets it inside the step", () => {
		const { flown, star, fleet, clearance } = fleetFall(false);
		expect(clearance("raider", fleet[0].motion.start.origin)).toBeLessThan(
			FALL_KMS * dt,
		);
		expect(flown.fleet[0].impacts.map((i) => i.with)).toEqual([star.id]);
	});

	test("a raider that meets a ship first bills the ship and not the star its bounce turned it from", () => {
		const { flown, fleet, clearance, vel } = fleetFall(true);
		// The miner stands clear of the star, so whatever it meets is the
		// raider's doing.
		expect(clearance("miner", fleet[1].motion.start.origin)).toBeGreaterThan(
			0.05,
		);
		const [raider, miner] = flown.fleet;
		expect(raider.impacts.map((i) => i.with)).toEqual(["miner"]);
		expect(miner.impacts.map((i) => i.with)).toEqual(["raider"]);
		// Turned back: it leaves the step rising, and outside the star.
		expect(dot(sub(raider.vel, vel), v3(1, 0, 0))).toBeGreaterThan(0);
		expect(clearance("raider", raider.pos)).toBeGreaterThan(0);
	});

	/** The player falling onto the star, and, given `blocked`, a miner between
	 *  it and the surface that it meets first. */
	function playerFall(blocked: boolean) {
		const world = makeWorld(47);
		// `still()` points the nose along −z, so the player falls nose first.
		const dir = v3(0, 0, 1);
		const { star, vel, nose, clearance } = starFixture(world, dir);
		world.ship.pos = add(star.pos, scale(dir, star.radiusKm + HEIGHT_KM));
		world.ship.vel = add(vel, scale(dir, -FALL_KMS));
		const you = shipPose(world.ship.pos, nose, v3(0, 1, 0));
		const fleet = blocked
			? [below({ hull: "courier", pose: you }, dir, nose, vel)]
			: [];
		const flown = stepWorld(
			world,
			still(),
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[],
			fleet,
		);
		return { flown, star, you, fleet, clearance, world, dir, vel };
	}

	test("the control: the player falling onto the star meets it inside the step", () => {
		const { flown, star, you, clearance } = playerFall(false);
		expect(clearance("courier", you.origin)).toBeLessThan(FALL_KMS * dt);
		expect(flown.impacts.map((i) => i.bodyId)).toEqual([star.id]);
	});

	test("the player meeting a ship first bills the ship and not the star its bounce turned it from", () => {
		const { flown, you, fleet, clearance, world, dir, vel } = playerFall(true);
		expect(clearance("miner", fleet[0].motion.start.origin)).toBeGreaterThan(
			0.05,
		);
		expect(flown.impacts).toEqual([]);
		expect(flown.shipImpacts.map((i) => i.with)).toEqual(["miner"]);
		expect(flown.fleet[0].impacts.map((i) => i.with)).toEqual([PLAYER_SHIP_ID]);
		expect(dot(sub(world.ship.vel, vel), dir)).toBeGreaterThan(0);
		expect(clearance("courier", world.ship.pos)).toBeGreaterThan(0);
	});
});

describe("stepWorld: a pair stays apart after the world corrects one of them (node #664)", () => {
	const dt = 0.1;
	/** The patrol's clearance above the star: inside what the ram's mass
	 *  split pushes it down by, so the world has to hold it out again. */
	const PATROL_CLEARANCE_KM = 0.002;
	const GAP_KM = 0.01;
	const RAM_KMS = 0.3;

	/**
	 * Sage round 3's case: a patrol riding with seed 47's star just above
	 * its surface, not closing on it — so its world sweep waits on its ship
	 * meeting — and a raider ramming it from outside at `RAM_KMS`. The ram's
	 * mass split pushes the patrol into the star; the star holds it out,
	 * back toward the raider.
	 *
	 * Sage round 7's is the same with the patrol on its **projection**: the
	 * ram hands it to flight at the pose the split left it — inside the
	 * star — and a projected carrier was never swept against the world, so
	 * its first flown step ghosted the star.
	 */
	function ramAgainstStar(
		order: "raider-first" | "patrol-first",
		projected: boolean,
	) {
		const world = makeWorld(47);
		const dir = v3(1, 0, 0);
		const { vel, nose, up, clearance, above, outward } = starFixture(
			world,
			dir,
		);
		const patrolPos = above("patrol", PATROL_CLEARANCE_KM);
		const patrol: FleetShip = {
			id: "patrol",
			projected,
			motion: {
				massT: HULL_SPECS.patrol.massT,
				primitives: box("patrol"),
				start: shipPose(patrolPos, nose, up),
				end: shipPose(add(patrolPos, scale(vel, dt)), nose, up),
				velStart: vel,
				velEnd: vel,
			},
		};
		const raiderPos = outward(
			"raider",
			{ hull: "patrol", pos: patrolPos },
			GAP_KM,
		);
		const ram = add(vel, scale(dir, -RAM_KMS));
		const raider: FleetShip = {
			id: "raider",
			projected: false,
			motion: flying("raider", raiderPos, ram, dt, nose, up),
		};
		const fleet =
			order === "raider-first" ? [raider, patrol] : [patrol, raider];
		const flown = stepWorld(
			world,
			still(),
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[],
			fleet,
		);
		const end = (id: string) => {
			const step = flown.fleet.find((f) => f.id === id);
			if (!step) throw new Error(`no ${id}`);
			return step;
		};
		return { world, end, fleet, clearance, nose, up };
	}

	for (const projected of [false, true])
		for (const order of ["raider-first", "patrol-first"] as const)
			test(`a raider ramming a patrol against the star leaves the two apart, and outside it (${order}, ${projected ? "projected" : "flown"})`, () => {
				const { end, clearance, nose, up, world, fleet } = ramAgainstStar(
					order,
					projected,
				);
				const raider = end("raider");
				const patrol = end("patrol");
				// The ram is met, and billed once on each.
				expect(raider.impacts.filter((i) => i.ship).map((i) => i.with)).toEqual(
					["patrol"],
				);
				expect(patrol.impacts.filter((i) => i.ship).map((i) => i.with)).toEqual(
					["raider"],
				);
				// The world held the patrol: it ends outside the star.
				expect(clearance("patrol", patrol.pos)).toBeGreaterThan(0);
				expect(clearance("raider", raider.pos)).toBeGreaterThan(0);
				// And the two are not left overlapped for the next step to ghost.
				const apart = pairSeparation(
					box("raider")[0],
					shipPose(raider.pos, nose, up),
					box("patrol")[0],
					shipPose(patrol.pos, nose, up),
				);
				expect(apart.overlap).toBe(false);
				// Nor closing on each other along the line they met on.
				expect(
					dot(sub(raider.vel, patrol.vel), sub(raider.pos, patrol.pos)),
				).toBeGreaterThanOrEqual(-1e-12);
				// The next step from there meets no ghost — a projected patrol
				// now flown from where the meeting left it, as `landFleet` does.
				const next = fleet.map((ship) => {
					const step = end(ship.id);
					return {
						...ship,
						projected: false,
						motion: {
							...ship.motion,
							start: shipPose(step.pos, nose, up),
							end: shipPose(add(step.pos, scale(step.vel, dt)), nose, up),
							velStart: step.vel,
							velEnd: step.vel,
						},
					};
				});
				const after = stepWorld(
					world,
					still(),
					HANDS_OFF,
					dt,
					flightPerformance("courier"),
					box("courier"),
					[],
					next,
				);
				for (const step of after.fleet)
					expect([step.id, step.ghosts]).toEqual([step.id, []]);
			});
});

describe("stepWorld: a carrier a meeting hands to flight takes the correction the world-held player cannot (node #664)", () => {
	const dt = 0.1;
	/** Sage round 5's case: the courier this far clear of the star. */
	const PLAYER_CLEARANCE_KM = 0.00445;
	/** The gap a projected freighter closes across, and how fast. */
	const GAP_KM = 0.001;
	const CLOSING_KMS = 0.1;

	/**
	 * The player at rest with seed 47's star just above its surface, and a
	 * freighter on its projection closing on it from outside. The meeting's
	 * mass split drives the courier into the star; the player's second world
	 * look holds it out, back onto the freighter — which the meeting has
	 * handed to flight, so the freighter is the ship that can give way.
	 */
	function pinnedAgainstStar(projected: boolean) {
		const world = makeWorld(47);
		// `still()` points the nose along −z, so the star is under the nose.
		const dir = v3(0, 0, 1);
		const { star, vel, nose, up, clearance, above, outward } = starFixture(
			world,
			dir,
		);
		world.ship.pos = above("courier", PLAYER_CLEARANCE_KM);
		world.ship.vel = vel;
		const from = { ...world.ship.pos };
		const freighter: FleetShip = {
			id: "freighter",
			projected,
			motion: flying(
				"freighter",
				outward("freighter", { hull: "courier", pos: from }, GAP_KM),
				add(vel, scale(dir, -CLOSING_KMS)),
				dt,
				nose,
				up,
			),
		};
		const flown = stepWorld(
			world,
			still(),
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[],
			[freighter],
		);
		return { world, flown, star, freighter, clearance, nose, up, from };
	}

	for (const projected of [true, false])
		test(`the courier ends outside the star and apart from the freighter (${projected ? "projected" : "flown"})`, () => {
			const { world, flown, star, freighter, clearance, nose, up, from } =
				pinnedAgainstStar(projected);
			// It started clear of the star by less than the meeting pushes it.
			expect(clearance("courier", from)).toBeCloseTo(PLAYER_CLEARANCE_KM, 9);
			expect(flown.shipImpacts.map((i) => i.with)).toEqual(["freighter"]);
			const [step] = flown.fleet;
			expect(step.impacts.map((i) => i.with)).toEqual([PLAYER_SHIP_ID]);
			expect(clearance("courier", world.ship.pos)).toBeGreaterThan(0);
			expect(
				pairSeparation(
					box("courier")[0],
					shipPose(world.ship.pos, nose, up),
					box("freighter")[0],
					shipPose(step.pos, nose, up),
				).overlap,
			).toBe(false);
			// The next step from there meets no ghost: not the star, and not
			// the freighter, now flown from where the step left it.
			const next = stepWorld(
				world,
				still(),
				HANDS_OFF,
				dt,
				flightPerformance("courier"),
				box("courier"),
				[],
				[
					{
						...freighter,
						projected: false,
						motion: {
							...freighter.motion,
							start: shipPose(step.pos, nose, up),
							end: shipPose(add(step.pos, scale(step.vel, dt)), nose, up),
							velStart: step.vel,
							velEnd: step.vel,
						},
					},
				],
			);
			expect(next.ghosts).not.toContain(star.id);
			expect(next.fleet[0].ghosts).toEqual([]);
		});
});

describe("stepFleet: a ram after the world's meeting leaves both ships outside the star (sage round 6, node #664)", () => {
	const dt = 0.1;
	/**
	 * A patrol falling onto seed 47's star from `clearKm` above it at
	 * `fallKms`, and a raider behind it, `gapKm` further out, falling faster
	 * at `ramKms`, so the raider catches the patrol inside the step. In the
	 * `world-first` case the patrol meets the star before the raider meets it
	 * — its world meeting is resolved first, and the ram that follows pushed
	 * it back in, 3 cm under the surface, where the next step ghosts the star.
	 * In the `ship-first` case the raider meets it first and both meet the
	 * star after: the two were split by mass beside it, and the patrol was
	 * pushed in again.
	 */
	const CASES = {
		"world-first": { clearKm: 0.01, fallKms: 0.5, gapKm: 0.1, ramKms: 3 },
		"ship-first": { clearKm: 0.002, fallKms: 0.1, gapKm: 0.03, ramKms: 2 },
	} as const;

	function rammedOntoStar(which: keyof typeof CASES) {
		const { clearKm, fallKms, gapKm, ramKms } = CASES[which];
		const world = makeWorld(47);
		const dir = v3(1, 0, 0);
		const { star, vel, nose, up, clearance, above, outward } = starFixture(
			world,
			dir,
		);
		const patrolPos = above("patrol", clearKm);
		const patrol: FleetShip = {
			id: "patrol",
			projected: false,
			motion: flying(
				"patrol",
				patrolPos,
				add(vel, scale(dir, -fallKms)),
				dt,
				nose,
				up,
			),
		};
		const raider: FleetShip = {
			id: "raider",
			projected: false,
			motion: flying(
				"raider",
				outward("raider", { hull: "patrol", pos: patrolPos }, gapKm),
				add(vel, scale(dir, -ramKms)),
				dt,
				nose,
				up,
			),
		};
		const fleet = [patrol, raider];
		const step = (ships: FleetShip[]) => {
			const fromTime = world.gameTime;
			const starts = worldStarts(world.system, fromTime);
			advanceWorldClock(world, dt);
			return stepFleet(world, ships, starts, { fromTime, dt });
		};
		const steps = step(fleet);
		return { world, star, fleet, steps, step, clearance, nose, up, dir };
	}

	for (const which of ["world-first", "ship-first"] as const)
		test(`the patrol is held outside the star, apart from the raider, and billed for the star once (${which})`, () => {
			const { world, star, fleet, steps, step, clearance, nose, up, dir } =
				rammedOntoStar(which);
			const [patrol, raider] = steps;
			// Each meeting is billed once, in the order the step met them.
			expect(patrol.impacts.map((i) => i.with)).toEqual(
				which === "world-first" ? [star.id, "raider"] : ["raider", star.id],
			);
			expect(raider.impacts.filter((i) => i.ship).map((i) => i.with)).toEqual([
				"patrol",
			]);
			// Both end outside the star and apart from each other.
			expect(clearance("patrol", patrol.pos)).toBeGreaterThan(0);
			expect(clearance("raider", raider.pos)).toBeGreaterThan(0);
			expect(
				pairSeparation(
					box("raider")[0],
					shipPose(raider.pos, nose, up),
					box("patrol")[0],
					shipPose(patrol.pos, nose, up),
				).overlap,
			).toBe(false);
			// The patrol is not left falling into the star.
			const starVel = bodyVelocity(world.system, star.id, world.gameTime);
			expect(dot(sub(patrol.vel, starVel), dir)).toBeGreaterThanOrEqual(-1e-12);
			// The next step from there meets no ghost: the star is met, if at
			// all, and so is the other ship.
			const next = step(
				fleet.map((ship, index) => {
					const left = steps[index];
					return {
						...ship,
						motion: {
							...ship.motion,
							start: shipPose(left.pos, nose, up),
							end: shipPose(add(left.pos, scale(left.vel, dt)), nose, up),
							velStart: left.vel,
							velEnd: left.vel,
						},
					};
				}),
			);
			for (const ship of next)
				expect([ship.id, ship.ghosts]).toEqual([ship.id, []]);
		});
});

describe("stepWorld: a ram after the player's world meeting leaves the player outside the star (sage round 6, node #664)", () => {
	const dt = 0.1;
	/** The courier falls from this far above the star; a raider behind it,
	 *  this much further out, catches it after the star has. */
	const CLEAR_KM = 0.01;
	const FALL_KMS = 0.5;
	const GAP_KM = 0.1;
	const RAM_KMS = 3;

	test("the courier is held outside the star, apart from the raider, and billed for the star once", () => {
		const world = makeWorld(47);
		// `still()` points the nose along −z, so the star is under the nose.
		const dir = v3(0, 0, 1);
		const { star, vel, nose, up, clearance, above, outward } = starFixture(
			world,
			dir,
		);
		world.ship.pos = above("courier", CLEAR_KM);
		world.ship.vel = add(vel, scale(dir, -FALL_KMS));
		const raider: FleetShip = {
			id: "raider",
			projected: false,
			motion: flying(
				"raider",
				outward("raider", { hull: "courier", pos: world.ship.pos }, GAP_KM),
				add(vel, scale(dir, -RAM_KMS)),
				dt,
				nose,
				up,
			),
		};
		const flown = stepWorld(
			world,
			still(),
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[],
			[raider],
		);
		expect(flown.impacts.map((i) => i.bodyId)).toEqual([star.id]);
		expect(flown.shipImpacts.map((i) => i.with)).toEqual(["raider"]);
		const [step] = flown.fleet;
		expect(clearance("courier", world.ship.pos)).toBeGreaterThan(0);
		expect(clearance("raider", step.pos)).toBeGreaterThan(0);
		expect(
			pairSeparation(
				box("courier")[0],
				shipPose(world.ship.pos, nose, up),
				box("raider")[0],
				shipPose(step.pos, nose, up),
			).overlap,
		).toBe(false);
		// The next step from there meets no ghost.
		const next = stepWorld(
			world,
			still(),
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[],
			[
				{
					...raider,
					motion: {
						...raider.motion,
						start: shipPose(step.pos, nose, up),
						end: shipPose(add(step.pos, scale(step.vel, dt)), nose, up),
						velStart: step.vel,
						velEnd: step.vel,
					},
				},
			],
		);
		expect(next.ghosts).toEqual([]);
		expect(next.fleet[0].ghosts).toEqual([]);
	});
});

describe("stepFleet: the fleet meets the world and itself with no player in the step (node #664)", () => {
	/**
	 * Sage round 4: while the player cruises, the raider and the engaged
	 * carriers still fly, and `stepWorld` — the normal-flight step — is not
	 * run. `stepFleet` is the same passes without the player.
	 */
	const dt = 0.1;
	function fleetStep(
		build: (world: ReturnType<typeof makeWorld>) => FleetShip[],
	) {
		const world = makeWorld(47);
		const fleet = build(world);
		const player = { pos: { ...world.ship.pos }, vel: { ...world.ship.vel } };
		const fromTime = world.gameTime;
		const starts = worldStarts(world.system, fromTime);
		advanceWorldClock(world, dt);
		const steps = stepFleet(world, fleet, starts, { fromTime, dt });
		return { world, fleet, steps, player };
	}

	test("a raider flown into a planet meets it, and is left outside it", () => {
		let planetId = "";
		let planetRadius = 0;
		const { world, steps, player } = fleetStep((world) => {
			const planet = world.system.bodies.find((b) => b.kind === "planet");
			if (!planet) throw new Error("no planet");
			planetId = planet.id;
			planetRadius = planet.radiusKm;
			const dir = v3(1, 0, 0);
			const start = add(planet.pos, scale(dir, planet.radiusKm + 0.1));
			const fall = add(
				bodyVelocity(world.system, planet.id, world.gameTime),
				scale(dir, -2),
			);
			return [
				{
					id: "raider",
					projected: false,
					motion: flying("raider", start, fall, dt, scale(dir, -1)),
				},
			];
		});
		const [step] = steps;
		expect(step.impacts.map((i) => i.with)).toEqual([planetId]);
		const planet = world.system.byId.get(planetId);
		if (!planet) throw new Error("no planet");
		expect(length(sub(step.pos, planet.pos))).toBeGreaterThan(planetRadius);
		// The player is not in the step: nothing of it moved.
		expect(world.ship.pos).toEqual(player.pos);
		expect(world.ship.vel).toEqual(player.vel);
	});

	test("a step of no time sweeps nothing: every ship is where its own step left it", () => {
		const world = makeWorld(47);
		const ship: FleetShip = {
			id: "raider",
			projected: false,
			motion: flying("raider", v3(5e6, 0, 0), v3(0, 0, 1), 0),
		};
		const starts = worldStarts(world.system, world.gameTime);
		const [step] = stepFleet(world, [ship], starts, {
			fromTime: world.gameTime,
			dt: 0,
		});
		expect(step).toEqual({
			id: "raider",
			pos: ship.motion.end.origin,
			vel: ship.motion.velEnd,
			impacts: [],
			ghosts: [],
		});
	});

	test("a raider rams a flown carrier: both take one damage, each names the other", () => {
		const { steps } = fleetStep(() => {
			const far = v3(5e6, 0, 0);
			const half =
				(HULL_SPECS.raider.env.lengthKm + HULL_SPECS.freighter.env.lengthKm) /
				2;
			return [
				{
					id: "raider",
					projected: false,
					motion: flying(
						"raider",
						add(far, v3(0, 0, -(half + 0.05))),
						v3(0, 0, 1),
						dt,
					),
				},
				{
					id: "carrier",
					projected: false,
					motion: flying("freighter", far, v3(), dt),
				},
			];
		});
		const [raider, carrier] = steps;
		expect(raider.impacts.map((i) => i.with)).toEqual(["carrier"]);
		expect(carrier.impacts.map((i) => i.with)).toEqual(["raider"]);
		expect(raider.impacts[0].damage).toBe(carrier.impacts[0].damage);
		expect(raider.impacts[0].damage).toBeGreaterThan(0);
	});
});

describe("stepWorld: a pair that started overlapped is a ghost, and nothing pushes it (node #664)", () => {
	/**
	 * After sage round 4's case: the player at rest 60 m above seed 47's star
	 * and a projected freighter 80 m above it, their boxes overlapping at the
	 * start of the step. §4.3 leaves the pair untested, so nothing may move
	 * either ship for it — the push that keeps a met pair apart once moved
	 * the courier 44 m, into the star, and recorded nothing.
	 */
	test("the player is left where its own step put it, and outside the star", () => {
		const dt = 0.1;
		const world = makeWorld(47);
		const star = world.system.bodies.find((b) => b.kind === "star");
		if (!star) throw new Error("seed 47 has no star");
		const vel = bodyVelocity(world.system, star.id, world.gameTime);
		const dir = v3(0, 0, 1);
		const up = v3(0, 1, 0);
		world.ship.pos = add(star.pos, scale(dir, star.radiusKm + 0.06));
		world.ship.vel = vel;
		const you = shipPose(world.ship.pos, v3(0, 0, -1), up);
		const carrierAt = add(star.pos, scale(dir, star.radiusKm + 0.08));
		const carrier: FleetShip = {
			id: "carrier",
			projected: true,
			motion: flying("freighter", carrierAt, vel, dt, v3(0, 0, -1), up),
		};
		// The premise: the two share volume at the start of the step.
		expect(
			pairSeparation(
				box("courier")[0],
				you,
				box("freighter")[0],
				carrier.motion.start,
			).overlap,
		).toBe(true);
		const flown = stepWorld(
			world,
			still(),
			HANDS_OFF,
			dt,
			flightPerformance("courier"),
			box("courier"),
			[],
			[carrier],
		);
		expect(flown.shipImpacts).toEqual([]);
		expect(flown.fleet[0].impacts).toEqual([]);
		// Where its own step put it: at rest with the star, nothing added.
		const own = add(you.origin, scale(vel, dt));
		expect(length(sub(world.ship.pos, own))).toBeLessThan(1e-9);
		const sphere = bodySphere(star.radiusKm);
		const gap = pairSeparation(
			box("courier")[0],
			shipPose(world.ship.pos, v3(0, 0, -1), up),
			sphere,
			shipPose(star.pos, v3(0, 0, 1), up),
		);
		expect(gap.overlap).toBe(false);
	});
});

describe("presentedTrafficStep: a projection is swept along what is drawn (node #664)", () => {
	/** Two authority ticks 0.1 s apart whose correction carries the carrier
	 *  `2 · CORRECTION_KM` along +x, while each sample's own `vel` reads the
	 *  corpus row's 0.082 km/s. */
	const CORRECTION_KM = 0.5;
	const LAW_KMS = 0.082;
	function samples(at: Vec3): TrafficSamples {
		const vel = v3(LAW_KMS, 0, 0);
		return {
			prior: { pos: add(at, v3(-CORRECTION_KM, 0, 0)), vel },
			priorAtS: 0,
			current: { pos: add(at, v3(CORRECTION_KM, 0, 0)), vel },
			currentAtS: 0.1,
		};
	}

	test("the law the render path draws with: each sample predicted to the clock, then blended", () => {
		const s = samples(v3());
		// At the current tick the blend is 0, so it is drawn on the prior
		// sample's prediction; a span later, on the current one's.
		const atTick = presentedTrafficPos(s, 0.1);
		expect(atTick.x).toBeCloseTo(-CORRECTION_KM + LAW_KMS * 0.1, 12);
		const aSpanOn = presentedTrafficPos(s, 0.2);
		expect(aSpanOn.x).toBeCloseTo(CORRECTION_KM + LAW_KMS * 0.1, 12);
		// No prior: the current sample, predicted. Settled: not predicted.
		expect(presentedTrafficPos({ ...s, prior: null }, 0.2).x).toBeCloseTo(
			CORRECTION_KM + LAW_KMS * 0.1,
			12,
		);
		expect(
			presentedTrafficPos({ ...s, prior: null, settled: true }, 0.2).x,
		).toBe(CORRECTION_KM);
	});

	test("a step's velocity is its drawn displacement, and within one tick a step ends where the next starts", () => {
		const s = samples(v3());
		const a = presentedTrafficStep(s, 0.125, 0.05);
		const b = presentedTrafficStep(s, 0.175, 0.05);
		expect(length(sub(a.end, b.start))).toBe(0);
		expect(length(sub(scale(a.vel, 0.05), sub(a.end, a.start)))).toBeLessThan(
			1e-12,
		);
		// The correction is the motion: ten kilometres a second, not 0.082.
		expect(a.vel.x).toBeGreaterThan(100 * LAW_KMS);
	});

	test("across an authority tick, a step starts where the last sweep ended, and a ship in the jump is met", () => {
		const dt = 1 / 60;
		const vel = v3(LAW_KMS, 0, 0);
		const origin = makeWorld(47).ship.pos;
		// Tick 0.1's samples, and tick 0.2's, whose correction moves the
		// carrier 4 km from where tick 0.1 predicted it.
		const a: TrafficSamples = {
			prior: { pos: add(origin, v3(-0.01, 0, 0)), vel },
			priorAtS: 0,
			current: { pos: origin, vel },
			currentAtS: 0.1,
		};
		const b: TrafficSamples = {
			prior: a.current,
			priorAtS: 0.1,
			current: { pos: add(origin, v3(4, 0, 0)), vel },
			currentAtS: 0.2,
		};
		// The step before the tick ends on tick 0.1's samples; the step after
		// starts on tick 0.2's, at the same clock.
		const before = presentedTrafficStep(a, 0.2 - dt / 2, dt);
		const t = 0.2 - dt / 2 + dt;
		const fresh = presentedTrafficStep(b, t, dt);
		const carried = presentedTrafficStep(b, t, dt, {
			atS: t,
			pos: before.end,
			attitude: null,
		});
		// Drawn on consecutive frames, a hull and more apart: what the red
		// build skipped.
		const reach = reachKm(box("courier")) + reachKm(box("freighter")) + 0.01;
		const jump = length(sub(fresh.start, before.end));
		expect(jump).toBeGreaterThan(2 * reach);
		expect(carried.start).toEqual(before.end);
		expect(carried.end).toEqual(fresh.end);
		// A `from` at another clock is ignored.
		expect(
			presentedTrafficStep(b, t, dt, {
				atS: t - dt,
				pos: before.end,
				attitude: null,
			}).start,
		).toEqual(fresh.start);
		// The player at rest in the middle of the jump: no sweep that starts
		// where the carrier is drawn reaches it; the carried one does.
		const mid = scale(add(before.end, fresh.start), 0.5);
		const meet = (m: { start: Vec3; end: Vec3; vel: Vec3 }) => {
			const world = makeWorld(47);
			world.ship.pos = mid;
			world.ship.vel = v3();
			return stepWorld(
				world,
				still(),
				HANDS_OFF,
				dt,
				flightPerformance("courier"),
				box("courier"),
				[],
				[
					{
						id: "carrier",
						projected: true,
						motion: {
							massT: HULL_SPECS.freighter.massT,
							primitives: box("freighter"),
							start: shipPose(m.start, v3(1, 0, 0), v3(0, 1, 0)),
							end: shipPose(m.end, v3(1, 0, 0), v3(0, 1, 0)),
							velStart: m.vel,
							velEnd: m.vel,
						},
					},
				],
			).shipImpacts.map((i) => i.with);
		};
		expect(meet(before)).toEqual([]);
		expect(meet(fresh)).toEqual([]);
		expect(meet(carried)).toEqual(["carrier"]);
	});

	test("a carrier is swept turned as it is drawn turned: the prior attitude slerped by the pose's blend", () => {
		const yaw = (deg: number) => {
			const r = (deg * Math.PI) / 180;
			return v3(-Math.sin(r), 0, -Math.cos(r));
		};
		const samples = {
			prior: { pos: v3(), vel: v3(), nose: yaw(0), up: v3(0, 1, 0) },
			priorAtS: 0.1,
			current: { pos: v3(), vel: v3(), nose: yaw(90), up: v3(0, 1, 0) },
			currentAtS: 0.2,
		};
		const at = (s: number) => presentedTrafficAttitude(samples, s);
		const close = (a: Vec3 | undefined, b: Vec3) =>
			expect(length(sub(a ?? v3(NaN, 0, 0), b))).toBeLessThan(1e-9);
		// At the tick the prior's, a whole span on the current's, and between
		// them by the blend the pose is drawn with — not the current's alone.
		close(at(0.2)?.nose, yaw(0));
		close(at(0.25)?.nose, yaw(45));
		close(at(0.3)?.nose, yaw(90));
		close(at(0.25)?.up, v3(0, 1, 0));
		// An up off square to its nose is squared, as three's `lookAt` draws it.
		const skew = presentedTrafficAttitude(
			{
				current: { nose: yaw(0), up: v3(0, 1, -0.2) },
				currentAtS: 0,
				prior: null,
				priorAtS: 0,
			},
			0,
		);
		close(skew?.up, v3(0, 1, 0));
		// No prior: the current's.
		close(
			presentedTrafficAttitude({ ...samples, prior: null }, 0.2)?.nose,
			yaw(90),
		);
		// A step's two ends are the drawn attitudes at their own clocks, so
		// the box turns through the step as the hull does.
		const step = presentedTrafficStep(samples, 0.22, 1 / 60);
		close(step.startAttitude?.nose, at(0.22)?.nose ?? v3());
		close(step.endAttitude?.nose, at(0.22 + 1 / 60)?.nose ?? v3());
		expect(
			dot(step.startAttitude?.nose ?? v3(), step.endAttitude?.nose ?? v3()),
		).toBeLessThan(1 - 1e-6);
		// Across a tick, the attitude the last sweep ended on is carried too.
		const carried = presentedTrafficStep(samples, 0.22, 1 / 60, {
			atS: 0.22,
			pos: v3(),
			attitude: { nose: yaw(10), up: v3(0, 1, 0) },
		});
		close(carried.startAttitude?.nose, yaw(10));
	});

	test("a sample with no up is turned as three draws it: the shortest turn from forward", () => {
		const fromForward = new THREE.Quaternion();
		const lookAt = new THREE.Matrix4();
		const viaLaw = new THREE.Quaternion();
		for (const nose of [
			v3(0, 0, -1),
			v3(0, 0, 1),
			v3(1, 0, 0),
			v3(0.3, 0.8, -0.2),
			v3(-0.6, -0.1, 0.7),
		]) {
			const n = scale(nose, 1 / length(nose));
			const turned = presentedTrafficAttitude(
				{ current: { nose: n }, currentAtS: 0, prior: null, priorAtS: 0 },
				0,
			);
			if (!turned) throw new Error("no attitude");
			fromForward.setFromUnitVectors(
				new THREE.Vector3(0, 0, -1),
				new THREE.Vector3(n.x, n.y, n.z),
			);
			lookAt.lookAt(
				new THREE.Vector3(),
				new THREE.Vector3(turned.nose.x, turned.nose.y, turned.nose.z),
				new THREE.Vector3(turned.up.x, turned.up.y, turned.up.z),
			);
			viaLaw.setFromRotationMatrix(lookAt);
			expect(Math.abs(viaLaw.dot(fromForward))).toBeGreaterThan(1 - 1e-9);
		}
	});

	test("a carrier drawn crossing the player is met; swept on its `vel`, it was not", () => {
		const dt = 0.05;
		const fromS = 0.125;
		const at = makeWorld(47).ship.pos;
		const drawn = presentedTrafficStep(samples(at), fromS, dt);
		// Drawn from a quarter of a kilometre short of the player to as far
		// past it inside one step.
		expect(drawn.start.x - at.x).toBeCloseTo(-0.25, 1);
		expect(drawn.end.x - at.x).toBeCloseTo(0.25, 1);
		const meet = (end: Vec3, vel: Vec3) => {
			const world = makeWorld(47);
			world.ship.vel = v3();
			return stepWorld(
				world,
				still(),
				HANDS_OFF,
				dt,
				flightPerformance("courier"),
				box("courier"),
				[],
				[
					{
						id: "carrier",
						projected: true,
						motion: {
							massT: HULL_SPECS.freighter.massT,
							primitives: box("freighter"),
							start: shipPose(drawn.start, v3(1, 0, 0), v3(0, 1, 0)),
							end: shipPose(end, v3(1, 0, 0), v3(0, 1, 0)),
							velStart: vel,
							velEnd: vel,
						},
					},
				],
			);
		};
		// The red build's construction: the start plus `vel · dt`, 4 m.
		const law = v3(LAW_KMS, 0, 0);
		expect(meet(add(drawn.start, scale(law, dt)), law).shipImpacts).toEqual([]);
		// What is drawn: met, at the closing speed the drawn step has.
		const met = meet(drawn.end, drawn.vel).shipImpacts;
		expect(met.map((i) => i.with)).toEqual(["carrier"]);
		expect(met[0].closingKms).toBeGreaterThan(1);
	});
});

const ALL_PHASES: readonly TrafficRoutePhase[] = [
	"parked-home",
	"launch-queued",
	"departing",
	"local-departure",
	"cruise",
	"regenerating",
	"local-approach",
	"clearance-queued",
	"lane-queued",
	"arriving",
	"docked-away",
	"abstract-away",
	"lane-point-hold",
	"jump-windup",
	"hyperspace-away",
];

describe("collision.md §5: a carrier's exemption is keyed on its route phase", () => {
	test("every route phase has one answer, and the exempt ones mirror the player's three states", () => {
		const by = (cls: TrafficCollision) =>
			ALL_PHASES.filter((phase) => trafficCollisionClass(phase) === cls);
		// Parked in a berth, the scripted launch, the scripted hold-to-plane
		// and traversal — `docking.md` §12.3's three, as Traffic's phases.
		expect(by("exempt")).toEqual([
			"parked-home",
			"launch-queued",
			"departing",
			"arriving",
			"docked-away",
		]);
		// C5: cruise is its own regime with its own guards.
		expect(by("cruise")).toEqual(["cruise", "regenerating"]);
		expect(by("absent")).toEqual(["abstract-away", "hyperspace-away"]);
		expect(by("collides")).toEqual([
			"local-departure",
			"local-approach",
			"clearance-queued",
			"lane-queued",
			"lane-point-hold",
			"jump-windup",
		]);
		for (const phase of ALL_PHASES)
			expect(trafficCollides(phase)).toBe(
				trafficCollisionClass(phase) === "collides",
			);
	});

	test("the boundaries are §12.3's: the launch ends with the centre outside the plane, the arrival starts at the lane's grant", () => {
		const galaxy = generateGalaxy(0x5ee11e, 0);
		const record = galaxy.systems.find(
			(candidate) => generateContents(candidate).stations.length >= 2,
		);
		if (!record) throw new Error("multi-station fixture");
		const home = generateContents(record).stations[0];
		const actor = stationTrafficRoster(record.index, home)[0];
		let previous: ReturnType<typeof projectSystemTrafficActor> | null = null;
		/** The centre's height above the plane on the first tick out of the
		 *  launch, and the last tick of it. */
		let launchEnd: { last: number; first: number } | null = null;
		let arrivalStart: { laneStartedAtS: number | null; t: number } | null =
			null;
		const departure = nextTrafficDepartureAtS(actor.schedule, 0);
		const aboveThePlane = (
			projection: ReturnType<typeof projectSystemTrafficActor>,
			stationId: string,
			t: number,
		) => {
			const system = makeSystem(record, t);
			const frame = stationApertureFrame(system, stationId, t);
			const body = system.byId.get(stationId);
			if (!body) throw new Error(`no station ${stationId}`);
			return dot(sub(projection.pos, body.pos), frame.axis) - frame.planeKm;
		};
		for (let t = departure; t < departure + 900; t += 0.1) {
			const now = projectSystemTrafficActor({ record, actor, gameTime: t });
			if (
				previous?.phase === "departing" &&
				now.phase === "local-departure" &&
				previous.terminalStationId
			)
				launchEnd = {
					last: aboveThePlane(previous, previous.terminalStationId, t - 0.1),
					first: aboveThePlane(now, previous.terminalStationId, t),
				};
			if (previous?.phase !== "arriving" && now.phase === "arriving")
				arrivalStart = { laneStartedAtS: now.laneStartedAtS, t };
			if (now.phase === "docked-away") break;
			previous = now;
		}
		if (!launchEnd) throw new Error("no launch was flown");
		// §12.3: the exemption ends when the centre has cleared the plane
		// outward. The launch's last tick is at most its release away from it,
		// and the first collidable tick is outside.
		expect(launchEnd.first).toBeGreaterThan(0);
		expect(launchEnd.last).toBeLessThan(0.05);
		expect(arrivalStart).not.toBeNull();
		// The arrival's first tick is the lane's own start: the hold-to-plane
		// is scripted from the moment the lane is granted, never before.
		expect(arrivalStart?.t ?? 0).toBeGreaterThanOrEqual(
			arrivalStart?.laneStartedAtS ?? Number.POSITIVE_INFINITY,
		);
		expect(
			(arrivalStart?.t ?? 0) - (arrivalStart?.laneStartedAtS ?? 0),
		).toBeLessThan(0.1 + 1e-9);
	}, 15_000);
});

describe("collision.md §9.1.14: an impact on a carrier goes through H3d's route", () => {
	const record = (() => {
		const found = generateGalaxy(0x5ee11e, 0).systems.find(
			(candidate) => generateContents(candidate).stations.length >= 2,
		);
		if (!found) throw new Error("multi-station fixture");
		return found;
	})();
	const home = generateContents(record).stations[0];
	const actor = stationTrafficRoster(record.index, home)[0];
	const AT = 5_000;
	const whole = fullCondition(actor.hullId);

	test("a hull-reaching impact writes disable then repair-start, named for the impact", () => {
		// Enough to open the fore shields and reach hull.
		const struck = applyDamage(whole, whole.fore + 1, "fore");
		expect(struck.hull).toBeLessThan(whole.hull);
		const outcome = impactOutcome(whole, struck, "operational");
		expect(outcome).toBe("divert");
		const cause = impactCause(null);
		const events = trafficImpactTransitions(
			record.index,
			actor,
			outcome,
			"operational",
			AT,
			cause,
		);
		expect(events.map((e) => e.kind)).toEqual(["disable", "repair-start"]);
		expect(events[0].cause).toEqual(cause);
		// The player flew into it — a direct party — but not with the gun.
		expect(events[0].cause.playerRole).toBe("direct");
		expect(events[0].cause).not.toEqual(PLAYER_KILL);
		let world = newWorld(1);
		for (const event of events)
			world = applyTransition(world, 0, actor.key, event);
		const row = effectiveCarrier(world.galaxies[0], actor.key, AT + 1);
		expect(row.condition).toBe("repairing");
		expect(row.recovery?.kind).toBe("repair");
	});

	test("an impact nobody fired names what was met, and writes no knowledge", () => {
		const cause = impactCause("station-trade");
		expect(cause).toEqual({
			causeKind: "collision",
			actorId: "station-trade",
			playerRole: "none",
		});
	});

	test("a shield-only impact writes nothing", () => {
		const grazed = applyDamage(whole, 1, "fore");
		expect(grazed.hull).toBe(whole.hull);
		const outcome = impactOutcome(whole, grazed, "operational");
		expect(outcome).toBe("shields");
		expect(
			trafficImpactTransitions(
				record.index,
				actor,
				outcome,
				"operational",
				AT,
				impactCause(null),
			),
		).toEqual([]);
	});

	test("an impact below V_SCRAPE costs nothing, so it writes nothing", () => {
		expect(impactDamage(V_SCRAPE_KMS)).toBe(0);
		expect(impactOutcome(whole, whole, "operational")).toBe("nothing");
	});

	test("a diverted carrier struck again is not diverted twice", () => {
		const struck = applyDamage(whole, whole.fore + 1, "fore");
		expect(impactOutcome(whole, struck, "repairing")).toBe("nothing");
	});

	test("a kill by impact is the kill's transitions, named for the impact", () => {
		const dead = applyDamage(whole, headOnPool(whole) * 2, "fore");
		const outcome = impactOutcome(whole, dead, "operational");
		expect(outcome).toBe("kill");
		const events = trafficImpactTransitions(
			record.index,
			actor,
			outcome,
			"operational",
			AT,
			impactCause("station-trade"),
		);
		expect(events.map((e) => e.kind)).toEqual(["destroy"]);
		expect(events[0].cause.causeKind).toBe("collision");
		// From a repair, the kill interrupts first, as the gun's does.
		expect(
			trafficImpactTransitions(
				record.index,
				actor,
				outcome,
				"repairing",
				AT,
				impactCause(null),
			).map((e) => e.kind),
		).toEqual(["interrupt", "destroy"]);
	});
});

describe("distinctMeetings: a meeting's severity is its worst step (sage round 7, node #664)", () => {
	const step = (atS: number, kind: Meeting["kind"], closingKms: number) =>
		({
			key: "carrier",
			atS,
			phase: "local-approach",
			met: "station-trade",
			kind,
			closingKms,
			phaseAgeS: atS - 10,
		}) satisfies Meeting;

	test("a ghost followed by an impact in one meeting is one impact at the impact's closing speed", () => {
		const met = distinctMeetings([
			step(12, "ghost", 0),
			step(12.5, "impact", 8.959),
			step(13, "impact", 2),
		]);
		expect(met).toHaveLength(1);
		expect(met[0]).toEqual({ ...step(12, "impact", 8.959) });
	});

	test("a meeting after a new phase entry is its own", () => {
		const later = { ...step(40, "impact", 1), phaseAgeS: 0 };
		expect(distinctMeetings([step(12, "ghost", 0), later])).toEqual([
			step(12, "ghost", 0),
			later,
		]);
	});
});

describe("collision.md §9.1.14: §6 item 1's corpus row", () => {
	const galaxy = generateGalaxy(47, 0);
	const contentsFor = contentsCache(galaxy);
	const run = (index: number, windowS: number, includeExempt = false) => {
		const record = galaxy.systems.find((r) => r.index === index);
		if (!record) throw new Error(`no system ${index}`);
		const fromS = Math.floor(firstDepartureS(galaxy, record, contentsFor));
		return trafficCollisionCorpus(galaxy, record, contentsFor, {
			stepS: 0.5,
			fromS,
			toS: fromS + windowS,
			includeExempt,
		});
	};
	const classes = (result: CorpusResult) => {
		const out: Record<string, number> = {};
		for (const m of distinctMeetings(result.meetings))
			out[meetingClass(m)] = (out[meetingClass(m)] ?? 0) + 1;
		return out;
	};

	test("RED, pinned: system 9's local approach runs through its trade station at 8.96 km/s", () => {
		const result = run(9, 1800);
		// The N behind it, so a run that swept nothing cannot read as clear.
		expect(result.steps["local-approach"]).toBeGreaterThan(200);
		expect(result.steps["local-departure"]).toBeGreaterThan(400);
		expect(classes(result)).toEqual({ "approach-through": 1 });
		const [through] = distinctMeetings(result.meetings);
		expect(through.met).toContain("station-trade");
		// Billed, and far past what a hull survives: a divert at best.
		expect(through.closingKms).toBeGreaterThan(8.9);
		expect(through.closingKms).toBeGreaterThan(V_SCRAPE_KMS);
	}, 30_000);

	test("RED, pinned: system 0's launches touch at the aperture and at the release point, under V_SCRAPE", () => {
		const result = run(0, 1800);
		expect(result.steps["local-departure"]).toBeGreaterThan(4000);
		expect(result.steps["lane-queued"]).toBeGreaterThan(1000);
		expect(result.pairSteps).toBeGreaterThan(0);
		expect(classes(result)).toEqual({
			"launch-aperture": 3,
			"release-point": 1,
		});
		// Both classes are touches: they cost nothing and divert nothing.
		for (const m of distinctMeetings(result.meetings))
			expect(m.closingKms).toBeLessThan(V_SCRAPE_KMS);
		// Cruise is counted apart under C5, and here met nothing.
		expect(result.cruiseMeetings).toEqual([]);
	}, 60_000);

	// glossary-ignore: pad
	test("the red build: sweeping the exempt phases meets the pad role's deck and berths", () => {
		const result = run(0, 600, true);
		const met = distinctMeetings(result.meetings);
		// §9.1.8's split: a pad role's deck and berths are solid, so a // glossary-ignore: pad
		// parked, launching or arriving carrier meets them without §5.
		expect(
			met.some(
				(m) =>
					m.met.includes("station-refinery") &&
					trafficCollisionClass(m.phase) === "exempt",
			),
		).toBe(true);
		expect(met.length).toBeGreaterThan(20);
		// And every meeting the green run sees over the same window is one the
		// red run sees too: sweeping the exempt phases adds meetings, it does
		// not drop or re-read one in a collidable phase.
		const green = run(0, 600).meetings;
		expect(green.length).toBeGreaterThan(0);
		const same = (a: Meeting, b: Meeting) =>
			a.key === b.key &&
			a.met === b.met &&
			a.phase === b.phase &&
			a.atS === b.atS;
		const missing = green.filter(
			(g) => !result.meetings.some((r) => same(g, r)),
		);
		expect(missing).toEqual([]);
	}, 60_000);
});

describe("collision.md §3: a kill by impact names the impact, and pays only the player's own ram", () => {
	test("the cause is the meeting that did the most damage, and the player's id names the player", () => {
		expect(
			impactCauseOf(
				[
					{ with: "station-trade", damage: 0 },
					{ with: PLAYER_SHIP_ID, damage: 40 },
				],
				PLAYER_SHIP_ID,
			),
		).toEqual(impactCause(null));
		expect(
			impactCauseOf(
				[
					{ with: PLAYER_SHIP_ID, damage: 1 },
					{ with: "planet-2", damage: 900 },
				],
				PLAYER_SHIP_ID,
			),
		).toEqual(impactCause("planet-2"));
	});

	const holdingsAt = (): Holdings => ({
		commander: newCommander(PLAYER_BASELINE_HULL),
		requests: emptyRequests(),
		ladders: emptyLadderRecord(),
		ladderPending: emptyPending(),
	});
	const raiderKill = (cause: ReturnType<typeof impactCause> | undefined) =>
		applyHoldEvent(holdingsAt(), newWorld(0x5ee11e), {
			kind: "carrier",
			galaxyIndex: 0,
			key: carrierKey(3, "raider-00"),
			transition: raiderDestruction(3, 5_000, cause),
			hull: RAIDER_HULL_ID,
		});

	test("a raider that flew into a station alone is destroyed, and pays nobody", () => {
		const out = raiderKill(impactCause("station-trade"));
		expect(out.holdings.ladderPending.combat).toBe(0);
		// The world still hears the destroy, named for what it met.
		expect(
			effectiveCarrier(out.world.galaxies[0], carrierKey(3, "raider-00"), 5_001)
				.condition,
		).toBe("destroyed");
	});

	test("the player's own ram pays as the gun does: the same path a kill by fire takes", () => {
		const rammed = raiderKill(impactCause(null));
		const shot = raiderKill(undefined);
		expect(rammed.holdings.ladderPending.combat).toBeGreaterThan(0);
		expect(rammed.holdings.ladderPending.combat).toBe(
			shot.holdings.ladderPending.combat,
		);
	});

	test("a raider a collision finishes is destroyed in the same tick, its wreck where it came apart", () => {
		const start = forceEncounter(() => true, 3, 0, "ahead", 10, 3);
		if (!start) throw new Error("no raider");
		const pilotShip = { pos: v3(), vel: v3() };
		const duel: Encounter = {
			...start,
			phase: "duel",
			raider: {
				flight: raiderAtDrop(v3(0, 0, -3), pilotShip, 7),
				condition: fullCondition("raider"),
			},
		};
		const full = fullCondition("raider");
		const lethal = full.fore + full.aft + full.hull + 1;
		const pos = v3(0.4, 0, -2.6);
		const vel = v3(0, 0.3, 0);
		// A ram that kills the pilot too holds the clock, and no duel step
		// comes after it: the kill is in the tick or it is nowhere.
		const killed = landRaiderImpacts(
			duel,
			{ pos, vel, impacts: [{ damage: lethal, side: "fore" }] },
			null,
		);
		expect(killed?.encounter.phase).toBe("over");
		expect(killed?.encounter.end).toBe("destroyed");
		expect(killed?.wreck).toEqual({ pos, vel });
		// A survivable meeting lands on its condition and its pose, and the
		// duel goes on.
		const bumped = landRaiderImpacts(
			duel,
			{ pos, vel, impacts: [{ damage: 5, side: "aft" }] },
			null,
		);
		expect(bumped?.wreck).toBeNull();
		expect(bumped?.encounter.phase).toBe("duel");
		expect(bumped?.encounter.raider?.condition).toEqual(
			applyDamage(full, 5, "aft"),
		);
		expect(bumped?.encounter.raider?.flight.ship).toEqual({ pos, vel });
		// The view the duel step drew stood where the raider was before the
		// meeting moved it; the hull and the scanner draw where it ended.
		const drawn = {
			key: duel.slot.key,
			name: duel.name,
			pos: v3(0, 0, -3),
			vel: v3(0, 0, -0.2),
			nose: v3(0, 0, 1),
			up: v3(0, 1, 0),
		};
		const seen = landRaiderImpacts(
			duel,
			{ pos, vel, impacts: [{ damage: 5, side: "aft" }] },
			drawn,
		);
		expect(seen?.contact).toEqual({ ...drawn, pos, vel });
		expect(seen?.contact?.pos).not.toBe(pos);
		// No view, nothing drawn; a kill takes the view away.
		expect(bumped?.contact).toBeNull();
		expect(
			landRaiderImpacts(
				duel,
				{ pos, vel, impacts: [{ damage: lethal, side: "fore" }] },
				drawn,
			)?.contact,
		).toBeNull();
		// Outside a duel there is no raider in flight to land anything on.
		expect(
			landRaiderImpacts(start, { pos, vel, impacts: [] }, null),
		).toBeNull();
	});

	test("a raider that reaches a duel step at no hull is destroyed there, even into cruise", () => {
		const start = forceEncounter(() => true, 3, 0, "ahead", 10, 3);
		if (!start) throw new Error("no raider");
		const pilotShip = { pos: v3(), vel: v3() };
		const dead: Encounter = {
			...start,
			phase: "duel",
			raider: {
				flight: raiderAtDrop(v3(0, 0, -3), pilotShip, 7),
				condition: { ...fullCondition("raider"), fore: 0, aft: 0, hull: 0 },
			},
		};
		for (const inCruise of [false, true]) {
			const step = stepEncounter(dead, {
				gameTime: 20,
				dt: 0.1,
				inCruise,
				pilot: {
					ship: pilotShip,
					nose: v3(0, 0, -1),
					aimOrigin: v3(),
					aimNose: v3(0, 0, -1),
					hull: 100,
					frame: { start: v3(), end: v3() },
				},
				shot: { fired: false, damage: 0 },
			});
			expect([inCruise, step.encounter.end]).toEqual([inCruise, "destroyed"]);
			expect(step.wreck?.pos.z).toBeCloseTo(-3, 6);
		}
	});
});
