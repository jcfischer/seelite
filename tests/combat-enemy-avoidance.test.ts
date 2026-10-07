/**
 * Node #665: the NPC controller steers clear of stations, stars, planets
 * and moons (`collision.md` §6 item 2, §11 item 4).
 *
 * Since node #664 a raider and an engaged carrier are collidable on the
 * player's rules, and `combat-enemy.ts` steered on its target alone, so a
 * raider whose run on a pilot beside a station crossed the station flew into
 * it. The rows here fly the production steps — `stepDuel` for the raider,
 * `stepEngagement` for a carrier — beside real stations of real systems, and
 * meet the world through `stepFleet`, so an impact is the sweep's against
 * each station's own proxy and each body's sphere, not this file's sphere.
 *
 * **What is counted is runs that end on a surface, never a minimum distance**
 * (#30, PR #33): a gap floors at zero and reads the same for a ship that
 * stopped clear and one standing on the hull. Each regime's row flies the
 * same corpus blind (`solids: []`) as its control, and the control must be
 * red, so the row is shown able to fail.
 *
 * **The three regimes are the player's** (map Constraint, #5/#10). The
 * controller always flies its own assist on; what changes is the pilot it
 * fights. With the pilot's assist on the pilot holds station in the station's
 * frame; with it off the pilot drifts at 3 km/s, faster than any assist will
 * hold, so the lead point runs the pursuit across the station; and in cruise
 * the duel is over (`stepEncounter` ends it), so the ship still flying is an
 * engaged carrier. It is held in the pilot's frame, which the pilot has
 * taken to the star's, so a carrier that was moving with its station when
 * the pilot left is braked toward star rest and dragged back into the
 * station, which orbits at tens of km/s (86.7 at the fastest in 200 start
 * systems).
 */

import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { hullBox, reachKm, shipPose } from "../src/collision";
import {
	AVOID_CLEARANCE_KM,
	type CombatEnemyState,
	GUN_RANGE_KM,
	avoidSolids,
	avoidanceHorizonS,
	createCombatEnemy,
	stepEnemyShip,
} from "../src/combat-enemy";
import { type Raider, raiderAtDrop, stepDuel } from "../src/duel";
import { HULL_SPECS, type HullId } from "../src/hull";
import { RAIDER_HULL_ID } from "../src/raider-slots";
import { fullCondition } from "../src/ship-condition";
import {
	AVOID_SCAN_KM,
	type AvoidSphere,
	type Ship,
	type World,
	advanceWorldClock,
	avoidanceSolids,
	bodyVelocity,
	flightPerformance,
	makeWorld,
	stationApertureFrame,
	stepFleet,
	worldSolids,
	worldStarts,
} from "../src/sim";
import { STATION_GEOMETRY } from "../src/station";
import { proxyReachKm, stationProxyOf } from "../src/station-proxy";
import { TRAFFIC_HULL_POOLS } from "../src/station-traffic";
import {
	ARMED_TRAFFIC_HULLS,
	type Engagement,
	engage,
	stepEngagement,
} from "../src/traffic-engagement";
import {
	type Vec3,
	add,
	cross,
	dot,
	frameAcross,
	length,
	normalizeOr,
	scale,
	sub,
	v3,
} from "../src/vec3";
import { codeOf, methodBodyOf } from "./lib/source-scan";

const DT = 1 / 30;
/** Seeds whose start systems carry all three placed station roles between
 *  them: trade everywhere, a refinery at 1, 2, 3 and 9, a shipyard at 2, 3,
 *  9 and 47 — so the Coriolis, the Works and the Gantry's keel are each
 *  in the corpus. */
const SEEDS = [1, 2, 3, 9, 47];
/** Approach bearings round each station, in radians. */
const BEARINGS = [0, 1.7, 3.9];

type Regime = "assist-on" | "assist-off" | "cruise";

interface Run {
	/** What the ship met first, or `null` if it met nothing. */
	met: string | null;
	/** Share of frames the ship's gun fired on the pilot. */
	fireShare: number;
	/** Share of frames the ship was all but still against the station, under
	 *  0.3 km/s — a controller stalled by its own brake reads high here. */
	stillShare: number;
}

function placedStations(world: World) {
	return world.system.contents.stations.filter((s) =>
		world.system.byId.has(s.id),
	);
}

function stationCount(seed: number): number {
	return placedStations(makeWorld(seed)).length;
}

/** The ship's step as a swept motion, between where it stood and where its
 *  own step put it. */
function motionOf(
	hull: HullId,
	before: CombatEnemyState,
	after: CombatEnemyState,
) {
	return {
		massT: HULL_SPECS[hull].massT,
		primitives: [hullBox(HULL_SPECS[hull].env, HULL_SPECS[hull].envCentre)],
		start: shipPose(before.ship.pos, before.nose, before.up),
		end: shipPose(after.ship.pos, after.nose, after.up),
		velStart: before.ship.vel,
		velEnd: after.ship.vel,
	};
}

/**
 * One NPC step met against the world, as the game meets it: the world's
 * starts snapshotted, the clock advanced, the ship swept through `stepFleet`.
 * Returns the solid it met first, or `null`, and the ship where the sweep
 * left it.
 */
function sweepStep(
	world: World,
	hull: HullId,
	before: CombatEnemyState,
	after: CombatEnemyState,
): { met: string | null; ship: Ship } {
	const t = world.gameTime;
	const starts = worldStarts(world.system, t);
	advanceWorldClock(world, DT);
	const [swept] = stepFleet(
		world,
		[{ id: "npc", projected: false, motion: motionOf(hull, before, after) }],
		starts,
		{ fromTime: t, dt: DT },
	);
	const met = swept.impacts.find((impact) => !impact.ship);
	return {
		met: met ? met.with : null,
		ship: { pos: swept.pos, vel: swept.vel },
	};
}

interface FlyOptions {
	seed: number;
	stationIndex: number;
	bearing: number;
	regime: Regime;
	avoid: boolean;
	hull?: HullId;
	open?: boolean;
	/** The pilot at the station's mouth, inside its keep-out, rather than just
	 *  outside it. */
	atMouth?: boolean;
	/** An armed carrier the pilot provoked fights instead of the raider. */
	armed?: HullId;
}

/**
 * One ship fighting beside one real station, met against the world.
 *
 * `open` flies the same fight with the world switched off — no solids and no
 * sweep — which is the open-space fight a duel beside a station is compared
 * with.
 */
function flyBesideStation(o: FlyOptions): Run {
	const world = makeWorld(o.seed);
	const system = world.system;
	const placed = placedStations(world);
	const station = placed[o.stationIndex % placed.length];
	const where = () => {
		const body = system.byId.get(station.id);
		if (!body) throw new Error(`${station.id} is not placed`);
		return body.pos;
	};
	const stationVel = (t: number) => bodyVelocity(system, station.id, t);
	const keep = proxyReachKm(stationProxyOf(station)) + AVOID_CLEARANCE_KM;
	const dir = normalizeOr(
		v3(Math.cos(o.bearing), 0.4 * Math.sin(3 * o.bearing), Math.sin(o.bearing)),
		v3(1, 0, 0),
	);
	const across = frameAcross(dir);
	const hull =
		o.regime === "cruise"
			? (o.hull ?? "freighter")
			: (o.armed ?? RAIDER_HULL_ID);

	// The pilot, relative to the station. In cruise the pilot has gone: far
	// down the track and leaving at cruise speed, which the carrier reads only
	// as a bearing to run from.
	const mouthKm = STATION_GEOMETRY[station.type].aperturePlaneKm + 0.3;
	const mouth = (t: number) =>
		scale(stationApertureFrame(system, station.id, t).axis, mouthKm);
	let pilotRel = scale(dir, keep + 0.8);
	if (o.atMouth) pilotRel = mouth(world.gameTime);
	let pilotDrift = v3();
	if (o.regime === "assist-off") {
		pilotRel = add(pilotRel, scale(across, -8));
		pilotDrift = scale(across, 3);
	}

	let raider: Raider | null = null;
	let carrier: Engagement | null = null;
	if (o.regime === "cruise") {
		// Beside the station and moving with it, as the pilot left it, ahead
		// on its track so the star frame it is now held in drags it back
		// into the station.
		const track = normalizeOr(stationVel(world.gameTime), v3(1, 0, 0));
		carrier = engage(
			{
				key: carrierKey(1, "station-trade/traffic-00"),
				hullId: hull,
				pos: add(
					where(),
					add(
						scale(track, keep + 3 + 2 * Math.sin(o.bearing)),
						scale(cross(track, dir), 0.2 * Math.cos(o.bearing)),
					),
				),
				vel: stationVel(world.gameTime),
				nose: track,
				up: null,
				voyageOrdinal: 0,
			},
			o.seed * 31 + o.stationIndex,
			{ assaultAlreadyCharged: false, byPilot: false },
		);
	} else if (o.armed) {
		const start = add(
			where(),
			add(scale(dir, -12), scale(across, 0.3 * Math.sin(5 * o.bearing))),
		);
		carrier = engage(
			{
				key: carrierKey(1, "station-shipyard/traffic-00"),
				hullId: o.armed,
				pos: start,
				vel: stationVel(world.gameTime),
				nose: normalizeOr(sub(add(where(), pilotRel), start), dir),
				up: null,
				voyageOrdinal: 0,
			},
			o.seed * 31 + o.stationIndex,
			{ assaultAlreadyCharged: false, byPilot: true },
		);
	} else {
		raider = {
			flight: raiderAtDrop(
				add(
					where(),
					add(scale(dir, -12), scale(across, 0.3 * Math.sin(5 * o.bearing))),
				),
				{ pos: add(where(), pilotRel), vel: stationVel(world.gameTime) },
				o.seed * 7 + o.stationIndex,
			),
			condition: fullCondition(RAIDER_HULL_ID),
		};
	}

	const steps = o.regime === "cruise" ? 900 : 1200;
	let fired = 0;
	let still = 0;
	for (let i = 0; i < steps; i++) {
		const t = world.gameTime;
		const flight = raider ? raider.flight : (carrier as Engagement).flight;
		const track = normalizeOr(stationVel(t), v3(1, 0, 0));
		const pilotPos =
			o.regime === "cruise"
				? add(where(), scale(track, -1e6))
				: add(where(), o.atMouth ? mouth(t) : pilotRel);
		const pilotVel =
			o.regime === "cruise"
				? scale(track, -3e5)
				: add(stationVel(t), pilotDrift);
		const nose = normalizeOr(sub(flight.ship.pos, pilotPos), v3(0, 0, -1));
		const solids =
			o.avoid && !o.open ? avoidanceSolids(system, t, [flight.ship.pos]) : [];
		const pilot = {
			ship: { pos: pilotPos, vel: pilotVel },
			nose,
			aimOrigin: pilotPos,
			aimNose: nose,
			hull: 100,
			frame:
				o.regime === "cruise"
					? { start: v3(), end: v3() }
					: { start: stationVel(t), end: stationVel(t + DT) },
			solids,
		};
		const quiet = { fired: false, damage: 0 };
		let after: CombatEnemyState;
		if (raider) {
			const step = stepDuel(raider, pilot, quiet, DT);
			if (step.raiderHit) fired++;
			raider = step.raider;
			after = raider.flight;
		} else {
			const step = stepEngagement(carrier as Engagement, pilot, quiet, DT);
			if (step.returnFire) fired++;
			carrier = step.engagement;
			after = carrier.flight;
		}
		if (o.open) {
			advanceWorldClock(world, DT);
			continue;
		}
		const { met, ship } = sweepStep(world, hull, flight, after);
		if (met !== null)
			return {
				met,
				fireShare: fired / (i + 1),
				stillShare: still / (i + 1),
			};
		if (length(sub(ship.vel, stationVel(world.gameTime))) < 0.3) still++;
		if (raider) raider = { ...raider, flight: { ...raider.flight, ship } };
		else if (carrier)
			carrier = { ...carrier, flight: { ...carrier.flight, ship } };
	}
	return { met: null, fireShare: fired / steps, stillShare: still / steps };
}

function corpus(
	regime: Regime,
	avoid: boolean,
	extra: Pick<FlyOptions, "hull" | "open" | "atMouth" | "armed"> = {},
): Run[] {
	const runs: Run[] = [];
	for (const seed of SEEDS)
		for (
			let stationIndex = 0;
			stationIndex < stationCount(seed);
			stationIndex++
		)
			for (const bearing of BEARINGS)
				runs.push(
					flyBesideStation({
						seed,
						stationIndex,
						bearing,
						regime,
						avoid,
						...extra,
					}),
				);
	return runs;
}

const struck = (runs: Run[]) => runs.filter((run) => run.met !== null).length;

describe("the figures the avoidance is built from", () => {
	test("the clearance covers every hull's own box, so a centre outside the keep-out is a hull outside the solid", () => {
		for (const [id, spec] of Object.entries(HULL_SPECS)) {
			const hullReach = reachKm([hullBox(spec.env, spec.envCentre)]);
			expect([id, hullReach < AVOID_CLEARANCE_KM]).toEqual([id, true]);
		}
	});

	test("every station keep-out in the corpus is inside the raider's gun range, so a duel beside it keeps a gun run", () => {
		let widest = 0;
		for (const seed of SEEDS)
			for (const station of placedStations(makeWorld(seed)))
				widest = Math.max(
					widest,
					proxyReachKm(stationProxyOf(station)) + AVOID_CLEARANCE_KM,
				);
		// The Gantry's keel is the widest reach a station has.
		expect(widest).toBeGreaterThan(2);
		expect(widest).toBeLessThan(GUN_RANGE_KM / 2);
	});

	test("the horizon is read off the hull, and the scan reaches past every hull's longest one", () => {
		const raider = avoidanceHorizonS(flightPerformance("raider"), 2);
		const freighter = avoidanceHorizonS(flightPerformance("freighter"), 2);
		// A freighter turns at 0.45 rad/s against the raider's 1.1.
		expect(freighter).toBeGreaterThan(raider);
		// Faster closing reads further, until no more can come off in the frame.
		expect(avoidanceHorizonS(flightPerformance("raider"), 3)).toBeGreaterThan(
			raider,
		);
		expect(avoidanceHorizonS(flightPerformance("raider"), 90)).toBe(
			avoidanceHorizonS(flightPerformance("raider"), 4),
		);
		// The fastest body over 200 start systems, measured fresh, closing on a
		// ship held still in the star's frame, inside the longest horizon.
		let fastest = 0;
		for (let seed = 1; seed <= 200; seed++) {
			const world = makeWorld(seed);
			for (const body of world.system.bodies)
				fastest = Math.max(
					fastest,
					length(bodyVelocity(world.system, body.id, world.gameTime)),
				);
		}
		// The figure `AVOID_SCAN_KM`'s comment quotes.
		expect(fastest).toBeCloseTo(86.66, 2);
		// Every hull a controller flies: the raider and every Traffic roster
		// hull. The capitals fly under none.
		const flown = new Set<HullId>([
			RAIDER_HULL_ID,
			...Object.values(TRAFFIC_HULL_POOLS).flat(),
		]);
		const longest = Math.max(
			...[...flown].map((id) => avoidanceHorizonS(flightPerformance(id), 1e9)),
		);
		expect(longest).toBeCloseTo(22.3, 1);
		// And it is the miner's, as that comment says.
		expect(longest).toBe(avoidanceHorizonS(flightPerformance("miner"), 1e9));
		expect(AVOID_SCAN_KM).toBeGreaterThan(longest * 100);
	});
});

describe("avoidanceSolids: what the controller is handed", () => {
	test("every solid body and placed station within the scan, a station on its proxy's reach, each with its own velocity", () => {
		for (const seed of SEEDS) {
			const world = makeWorld(seed);
			const { system } = world;
			for (const station of placedStations(world)) {
				const body = system.byId.get(station.id);
				if (!body) throw new Error("unplaced");
				const near = add(body.pos, v3(3, 0, 0));
				const solids = avoidanceSolids(system, world.gameTime, [near]);
				const own = solids.find((s) => s.id === station.id);
				expect(own?.radiusKm).toBe(proxyReachKm(stationProxyOf(station)));
				expect(own?.vel).toEqual(
					bodyVelocity(system, station.id, world.gameTime),
				);
				// Nothing outside the scan, and nothing that is not solid.
				for (const solid of solids) {
					const kind = system.byId.get(solid.id)?.kind;
					expect([solid.id, kind]).toEqual([
						solid.id,
						expect.stringMatching(/^(star|planet|moon|station)$/),
					]);
					expect(
						length(sub(solid.pos, near)) - solid.radiusKm,
					).toBeLessThanOrEqual(AVOID_SCAN_KM);
				}
				// Every solid body inside the scan is there.
				for (const b of system.bodies) {
					if (!["star", "planet", "moon"].includes(b.kind)) continue;
					const inScan = length(sub(b.pos, near)) - b.radiusKm <= AVOID_SCAN_KM;
					expect([b.id, solids.some((s) => s.id === b.id)]).toEqual([
						b.id,
						inScan,
					]);
				}
			}
		}
	});

	test("in reach of everything, it hands the controller exactly the solids the sweep meets", () => {
		for (const seed of SEEDS) {
			const world = makeWorld(seed);
			const { system } = world;
			const t = world.gameTime;
			// Near every body there is, so every solid is in the scan.
			const near = system.bodies.map((b) => b.pos);
			const avoided = new Set(
				avoidanceSolids(system, t, near).map((s) => s.id),
			);
			// A ship whose bounding sphere reaches every solid there is.
			const { owner } = worldSolids(
				system,
				{ start: v3(), end: v3(), reachKm: 1e12 },
				worldStarts(system, t),
				{ fromTime: t, toTime: t },
			);
			const swept = new Set(owner);
			expect([seed, [...avoided].sort()]).toEqual([seed, [...swept].sort()]);
			expect(avoided.size).toBeGreaterThan(placedStations(world).length);
		}
	});

	test("a ship in deep space is handed nothing", () => {
		const world = makeWorld(47);
		expect(
			avoidanceSolids(world.system, world.gameTime, [v3(9e9, 0, 0)]),
		).toEqual([]);
	});
});

describe("a ship fighting beside a station does not fly into it, under all three regimes", () => {
	for (const regime of ["assist-on", "assist-off", "cruise"] as const) {
		test(`${regime}: blind, the corpus meets the station; avoiding, no run does`, () => {
			const blind = corpus(regime, false);
			const avoiding = corpus(regime, true);
			// The control is red: without the solids the runs end on a surface.
			expect(struck(blind)).toBeGreaterThan(blind.length / 2);
			expect(avoiding.filter((r) => r.met !== null).map((r) => r.met)).toEqual(
				[],
			);
		});
	}

	test("cruise: every civilian roster hull, the slowest-turning included, gets out of a station's way", () => {
		const civilians = [...new Set(Object.values(TRAFFIC_HULL_POOLS).flat())]
			.filter((h) => !ARMED_TRAFFIC_HULLS.has(h))
			.sort();
		expect(civilians).toContain("freighter");
		for (const hull of civilians) {
			const runs = SEEDS.map((seed) =>
				flyBesideStation({
					seed,
					stationIndex: 0,
					bearing: 0,
					regime: "cruise",
					avoid: true,
					hull,
				}),
			);
			expect([hull, struck(runs)]).toEqual([hull, 0]);
		}
	});
});

describe("a duel beside a station stays a duel", () => {
	for (const regime of ["assist-on", "assist-off"] as const) {
		test(`${regime}: the raider still fires on a pilot sitting on the station, near its open-space rate`, () => {
			const open = corpus(regime, false, { open: true });
			const beside = corpus(regime, true);
			const mean = (runs: Run[]) =>
				runs.reduce((sum, r) => sum + r.fireShare, 0) / runs.length;
			// Measured over the 39 runs: 0.271 open against 0.191 beside with the
			// pilot's assist on, 0.169 against 0.168 off, and the lowest run
			// beside fired on 10.3% of frames. The bands are wide of both.
			expect(mean(beside)).toBeGreaterThan(0.6 * mean(open));
			expect(Math.min(...beside.map((r) => r.fireShare))).toBeGreaterThan(0.05);
		});
	}

	/**
	 * The pilot at the station's mouth, 0.3 km out from its aperture plane —
	 * inside the keep-out, where a pilot about to dock or just launched is.
	 * No turn clears a run at them, so the raider and an armed carrier the
	 * pilot provoked hold off at the keep-out with their noses on the run.
	 * Measured over the 39 runs, the share of frames each fires on against
	 * the same fight in open space: raider 0.277 against 0.287, patrol 0.298
	 * against 0.296, interceptor 0.295 against 0.291, the lowest run 0.242;
	 * blind, 29, 27 and 30 runs met the station. Before the hold-off, bent
	 * round, they fired on 0.044 to 0.048 and some runs never fired.
	 */
	for (const armed of [undefined, "patrol", "interceptor"] as const) {
		test(`a pilot at the mouth, inside the keep-out: ${armed ?? "the raider"} holds off and keeps firing`, () => {
			const extra = { atMouth: true, armed };
			const blind = corpus("assist-on", false, extra);
			const open = corpus("assist-on", false, { ...extra, open: true });
			const beside = corpus("assist-on", true, extra);
			const mean = (runs: Run[], f: (r: Run) => number) =>
				runs.reduce((sum, r) => sum + f(r), 0) / runs.length;
			expect(struck(blind)).toBeGreaterThan(blind.length / 2);
			expect(struck(beside)).toBe(0);
			expect(mean(beside, (r) => r.fireShare)).toBeGreaterThan(
				0.8 * mean(open, (r) => r.fireShare),
			);
			expect(Math.min(...beside.map((r) => r.fireShare))).toBeGreaterThan(0.15);
			// Holding off is not hovering: no run sits still against the station
			// for half the fight (the most measured is 0.346).
			expect(Math.max(...beside.map((r) => r.stillShare))).toBeLessThan(0.5);
		});
	}
});

describe("a star, a planet and a moon", () => {
	/** A raider routed with the pilot above a body, so its run is straight
	 *  down. Flown with its own assist on in the body's frame; the pilot's
	 *  regime is not read, since the pilot is a fixed point above the body. */
	function fleeInto(
		seed: number,
		kind: "star" | "planet" | "moon",
		bearing: number,
		avoid: boolean,
	) {
		const world = makeWorld(seed);
		const { system } = world;
		const body = system.bodies.find((b) => b.kind === kind);
		if (!body) throw new Error(`no ${kind} at seed ${seed}`);
		const up = normalizeOr(
			v3(Math.cos(bearing), Math.sin(bearing), 0.3),
			v3(1, 0, 0),
		);
		const where = () => {
			const placed = system.byId.get(body.id);
			if (!placed) throw new Error(`${body.id} is not placed`);
			return placed.pos;
		};
		const bodyVel = (t: number) => bodyVelocity(system, body.id, t);
		let raider: Raider = {
			flight: raiderAtDrop(
				add(where(), scale(up, body.radiusKm + 6)),
				{
					pos: add(where(), scale(up, body.radiusKm + 12)),
					vel: bodyVel(world.gameTime),
				},
				seed,
			),
			// Under the flee threshold: it runs from the pilot, downward.
			condition: { ...fullCondition(RAIDER_HULL_ID), hull: 5 },
		};
		for (let i = 0; i < 600; i++) {
			const t = world.gameTime;
			const pilotPos = add(where(), scale(up, body.radiusKm + 12));
			const nose = scale(up, -1);
			const before = raider.flight;
			const step = stepDuel(
				raider,
				{
					ship: { pos: pilotPos, vel: bodyVel(t) },
					nose,
					aimOrigin: pilotPos,
					aimNose: v3(0, 0, 1),
					hull: 100,
					frame: { start: bodyVel(t), end: bodyVel(t + DT) },
					solids: avoid ? avoidanceSolids(system, t, [before.ship.pos]) : [],
				},
				{ fired: false, damage: 0 },
				DT,
			);
			const { met, ship } = sweepStep(
				world,
				RAIDER_HULL_ID,
				before,
				step.raider.flight,
			);
			if (met !== null) return met;
			raider = { ...step.raider, flight: { ...step.raider.flight, ship } };
		}
		return null;
	}

	for (const kind of ["star", "planet", "moon"] as const)
		test(`a raider routed straight at a ${kind} flies into it blind, and skims it avoiding`, () => {
			const blind: (string | null)[] = [];
			const avoiding: (string | null)[] = [];
			for (const seed of SEEDS)
				for (const bearing of BEARINGS) {
					blind.push(fleeInto(seed, kind, bearing, false));
					avoiding.push(fleeInto(seed, kind, bearing, true));
				}
			expect(blind.filter((m) => m !== null).length).toBe(blind.length);
			expect(avoiding.filter((m) => m !== null)).toEqual([]);
		});
});

describe("the law, on its own", () => {
	const perf = flightPerformance(RAIDER_HULL_ID);
	const station = (pos: Vec3, vel = v3()): AvoidSphere => ({
		id: "s",
		pos,
		vel,
		radiusKm: 0.62,
	});

	test("a solid beyond the horizon leaves the heading alone; the same solid inside it bends it", () => {
		const ship = { pos: v3(), vel: v3(2, 0, 0) };
		const ahead = v3(1, 0, 0);
		const horizonKm = avoidanceHorizonS(perf, 2) * 2;
		const far = avoidSolids(
			ship,
			ahead,
			ahead,
			2,
			v3(),
			[station(v3(horizonKm + 5, 0, 0))],
			perf,
			v3(100, 0, 0),
		);
		expect(far).toEqual({
			desired: ahead,
			maxSpeedKms: Number.POSITIVE_INFINITY,
			avoiding: null,
		});
		const near = avoidSolids(
			ship,
			ahead,
			ahead,
			2,
			v3(),
			[station(v3(6, 0.05, 0))],
			perf,
			v3(100, 0, 0),
		);
		expect(near.avoiding).toBe("s");
		// Bent off the bearing past the keep-out's cone, not reversed.
		const cone = Math.asin((0.62 + AVOID_CLEARANCE_KM) / 6);
		const off = Math.acos(dot(near.desired, normalizeOr(v3(6, 0.05, 0), v3())));
		expect(off).toBeGreaterThan(cone);
		expect(off).toBeLessThan(Math.PI / 2);
	});

	test("predicted in the solid's frame (#362): a co-moving station off the path at 30 km/s changes nothing", () => {
		// Station frame and station both run 30 km/s along +x; the station is
		// 5 km ahead along that track, and the ship is heading off it at 2 km/s
		// relative. Read on absolute velocity the ship would be "on" a path into
		// the station at 32 km/s.
		const frame = v3(30, 0, 0);
		const ship = { pos: v3(), vel: add(frame, v3(0, 0, -2)) };
		const heading = v3(0, 0, -1);
		const out = avoidSolids(
			ship,
			heading,
			heading,
			2,
			frame,
			[station(v3(5, 0, 0), frame)],
			perf,
			v3(0, 0, -50),
		);
		expect(out).toEqual({
			desired: heading,
			maxSpeedKms: Number.POSITIVE_INFINITY,
			avoiding: null,
		});
	});

	test("thrust along a nose still on the solid is cut while the nose comes round", () => {
		const ship = { pos: v3(), vel: v3(1.5, 0, 0) };
		const nose = v3(1, 0, 0);
		const away = v3(0, 0, 1);
		const out = avoidSolids(
			ship,
			nose,
			away,
			2,
			v3(),
			[station(v3(3, 0, 0))],
			perf,
			v3(0, 0, 50),
		);
		expect(out.maxSpeedKms).toBe(0);
		const nosedAway = avoidSolids(
			ship,
			away,
			away,
			2,
			v3(),
			[station(v3(3, 0, 0))],
			perf,
			v3(0, 0, 50),
		);
		expect(nosedAway.maxSpeedKms).toBe(Number.POSITIVE_INFINITY);
	});

	test("a target inside the keep-out is held off: the nose stays on the run, and the speed is what the ship can stop from", () => {
		// A pilot at the mouth, 0.3 km off a 0.62 km station's centre: inside
		// its keep-out. Bending round could never reach them.
		const solid = station(v3(0, 0, 0));
		const target = v3(-0.3, 0, 0);
		const run = (gapKm: number) => {
			const pos = v3(-(0.62 + AVOID_CLEARANCE_KM + gapKm), 0, 0);
			const heading = normalizeOr(sub(target, pos), v3(1, 0, 0));
			return {
				heading,
				out: avoidSolids(
					{ pos, vel: scale(heading, 2) },
					heading,
					heading,
					2,
					v3(),
					[solid],
					perf,
					target,
				),
			};
		};
		const far = run(4);
		expect(far.out.desired).toEqual(far.heading);
		expect(far.out.avoiding).toBe("s");
		// Closer in, less speed: what half the retro can take off in the gap.
		const near = run(0.5);
		expect(near.out.maxSpeedKms).toBeLessThan(far.out.maxSpeedKms);
		expect(near.out.maxSpeedKms).toBeCloseTo(
			Math.sqrt(perf.retroKms2 * 0.5),
			9,
		);
		// A hair outside the keep-out, still held off: the nose on the run and
		// all but no speed left to close with.
		const edge = run(1e-6);
		expect(edge.out.desired).toEqual(edge.heading);
		expect(edge.out.maxSpeedKms).toBeCloseTo(
			Math.sqrt(perf.retroKms2 * 1e-6),
			9,
		);
		expect(edge.out.maxSpeedKms).toBeLessThan(0.01);
		// On the keep-out itself it is inside, and is steered out instead: the
		// heading turns away from the station and the throttle is cut.
		const onIt = run(0);
		expect(dot(onIt.out.desired, onIt.heading)).toBeLessThan(0);
		expect(onIt.out.maxSpeedKms).toBe(0);
		// A station moving in the frame cannot be stopped short of: gone round.
		const moving = avoidSolids(
			{ pos: v3(-2, 0, 0), vel: v3(2, 0, 0) },
			v3(1, 0, 0),
			v3(1, 0, 0),
			2,
			v3(),
			[station(v3(0, 0, 0), v3(-3, 0, 0))],
			perf,
			target,
		);
		expect(dot(moving.desired, v3(1, 0, 0))).toBeLessThan(0.99);
	});

	test("a ship placed inside the keep-out is steered out, not pinned (#30's inside-the-sphere case)", () => {
		const solid = station(v3(0.9, 0, 0));
		const ship = { pos: v3(), vel: v3() };
		const out = avoidSolids(
			ship,
			v3(1, 0, 0),
			v3(1, 0, 0),
			1,
			v3(),
			[solid],
			perf,
			v3(5, 0, 0),
		);
		expect(out.avoiding).toBe("s");
		expect(dot(out.desired, v3(1, 0, 0))).toBeLessThan(0);
		// Flown, it leaves the keep-out.
		let enemy = createCombatEnemy(
			{ pos: v3(5, 0, 0), vel: v3() },
			v3(-1, 0, 0),
		);
		enemy = { ...enemy, ship: { pos: v3(), vel: v3() } };
		for (let i = 0; i < 300; i++)
			enemy = stepEnemyShip(
				enemy,
				{ pos: v3(5, 0, 0), vel: v3() },
				v3(-1, 0, 0),
				{
					targetHull: 100,
					targetEnergy: 100,
					targetHeatLocked: false,
					playerHull: 100,
				},
				false,
				DT,
				{
					laserOrigin: v3(5, 0, 0),
					laserNose: v3(-1, 0, 0),
					hitRadiusKm: 0.03,
					frame: undefined,
					performance: perf,
					intent: "attacker",
					solids: [solid],
				},
			).state;
		expect(length(sub(enemy.ship.pos, solid.pos))).toBeGreaterThan(
			solid.radiusKm + AVOID_CLEARANCE_KM,
		);
	});

	test("in open space a fight flies bit-identically with or without solids beside it, and draws nothing extra", () => {
		const far: AvoidSphere[] = [
			station(v3(5e5, 0, 0)),
			station(v3(0, -9e4, 0)),
		];
		const player = { pos: v3(), vel: v3() };
		for (const seed of [1, 2, 3]) {
			let a = createCombatEnemy(player, v3(0, 0, -1), seed);
			let b = a;
			for (let i = 0; i < 900; i++) {
				const readout = {
					targetHull: 100,
					targetEnergy: 100,
					targetHeatLocked: false,
					playerHull: 100,
				};
				const opts = {
					laserOrigin: player.pos,
					laserNose: v3(0, 0, -1),
					hitRadiusKm: 0.03,
					frame: undefined,
					performance: perf,
					intent: "attacker" as const,
				};
				const sa = stepEnemyShip(
					a,
					player,
					v3(0, 0, -1),
					readout,
					i % 7 === 0,
					DT,
					{
						...opts,
						solids: [],
					},
				);
				const sb = stepEnemyShip(
					b,
					player,
					v3(0, 0, -1),
					readout,
					i % 7 === 0,
					DT,
					{
						...opts,
						solids: far,
					},
				);
				expect(sb).toEqual(sa);
				a = sa.state;
				b = sb.state;
			}
		}
	});
});

describe("the game hands its fights the solids", () => {
	/**
	 * Nothing headless runs `Game`, so a `solids: []` written into `main.ts`
	 * would leave every row above green while the raider flew blind again.
	 * Read off the source: one list per frame from the builder, handed to the
	 * raider's step and the engagements' step, and placed on both pilots.
	 */
	test("main.ts builds the list with avoidanceSolids and passes it to both fights", () => {
		const main = codeOf("src/main.ts");
		const loop =
			/const solids = this\.fightSolids\(\);\s*this\.stepRaider\(dt, shot, solids\);\s*this\.stepRelay\(shot, dt\);\s*this\.stepTrafficEngagements\(dt, shot, solids\);/;
		expect(main).toMatch(loop);
		expect(methodBodyOf(main, "fightSolids")).toContain(
			"avoidanceSolids(this.world.system, this.world.gameTime, near)",
		);
		// Each pilot carries the list it was handed, and nowhere is an empty
		// one written in its place.
		expect(methodBodyOf(main, "stepRaider")).toMatch(/\bsolids,/);
		expect(methodBodyOf(main, "stepTrafficEngagements")).toMatch(/\bsolids,/);
		expect(main).not.toMatch(/solids:\s*\[\]/);
	});
});
