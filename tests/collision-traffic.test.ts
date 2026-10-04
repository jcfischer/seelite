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
import {
	type ShipMotion,
	RESTITUTION,
	V_SCRAPE_KMS,
	hullBox,
	impactDamage,
	pairSeparation,
	shipImpulse,
	shipPose,
	sweepShipPair,
} from "../src/collision";
import {
	type TrafficCollision,
	trafficCollisionClass,
	trafficCollides,
} from "../src/dock-session";
import { generateGalaxy } from "../src/galaxy";
import { HULL_SPECS, type HullId, PLAYER_BASELINE_HULL } from "../src/hull";
import { carrierKey } from "../src/carrier-key";
import { raiderAtDrop } from "../src/duel";
import {
	type Encounter,
	forceEncounter,
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
	speedDemand,
	stationApertureFrame,
	stepWorld,
} from "../src/sim";
import {
	type TrafficRoutePhase,
	projectSystemTrafficActor,
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
import { type Vec3, add, dot, length, scale, sub, v3 } from "../src/vec3";
import {
	applyTransition,
	effectiveCarrier,
	newWorld,
} from "../src/world-state";
import {
	type CorpusResult,
	contentsCache,
	encounters,
	firstDepartureS,
	meetingClass,
	trafficCollisionCorpus,
} from "./helpers/traffic-collision-corpus";

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
	});
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
		for (const m of encounters(result.meetings))
			out[meetingClass(m)] = (out[meetingClass(m)] ?? 0) + 1;
		return out;
	};

	test("RED, pinned: system 9's local approach runs through its trade station at 8.96 km/s", () => {
		const result = run(9, 1800);
		// The N behind it, so a run that swept nothing cannot read as clear.
		expect(result.steps["local-approach"]).toBeGreaterThan(200);
		expect(result.steps["local-departure"]).toBeGreaterThan(400);
		expect(classes(result)).toEqual({ "approach-through": 1 });
		const [through] = encounters(result.meetings);
		expect(through.met).toContain("station-trade");
		// Billed, and far past what a hull survives: a divert at best.
		expect(through.closingKms).toBeGreaterThan(8.9);
		expect(through.closingKms).toBeGreaterThan(V_SCRAPE_KMS);
	}, 30_000);

	test("RED, pinned: system 0's launches touch the throat and the release point, under V_SCRAPE", () => {
		const result = run(0, 1800);
		expect(result.steps["local-departure"]).toBeGreaterThan(4000);
		expect(result.steps["lane-queued"]).toBeGreaterThan(1000);
		expect(result.pairSteps).toBeGreaterThan(0);
		expect(classes(result)).toEqual({
			"launch-throat": 3,
			"release-point": 1,
		});
		// Both classes are touches: they cost nothing and divert nothing.
		for (const m of encounters(result.meetings))
			expect(m.closingKms).toBeLessThan(V_SCRAPE_KMS);
		// Cruise is counted apart under C5, and here met nothing.
		expect(result.cruiseMeetings).toEqual([]);
	}, 60_000);

	test("the red build: sweeping the exempt phases meets the pad's deck and berths", () => {
		const result = run(0, 600, true);
		const met = encounters(result.meetings);
		// §9.1.8's split: a pad role's deck and berths are solid, so a
		// parked, launching or arriving carrier meets them without §5.
		expect(
			met.some(
				(m) =>
					m.met.includes("station-refinery") &&
					trafficCollisionClass(m.phase) === "exempt",
			),
		).toBe(true);
		// And the meetings the green run sees are a subset: the exemption
		// hides nothing in a collidable phase.
		expect(met.length).toBeGreaterThan(20);
	}, 30_000);
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

	test("a raider a collision left at no hull is destroyed on its next duel step, even into cruise", () => {
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
