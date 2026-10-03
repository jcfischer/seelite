/**
 * An ordinary carrier under fire (`civilian-combat.md` H2, H3): the shared
 * condition model, its own hull's handling, and a reaction per role.
 */
import { describe, expect, test } from "bun:test";
import { type CarrierKey, carrierKey } from "../src/carrier-key";
import {
	ARMED_TRAFFIC_HULLS,
	type Engagement,
	engage,
	flownVoyageOrdinal,
	flyingTrafficActors,
	parkedHomeTrafficActors,
	stepEngagement,
	strikeClock,
	type EngagementStep,
	ASSAULT_FIRE_S,
	trafficDestruction,
	trafficDiversion,
	trafficHitRadiusKm,
	trafficInSights,
	trafficKillTransitions,
	trafficPresence,
} from "../src/traffic-engagement";
import type { DuelPilot } from "../src/duel";
import {
	PLAYER_KILL,
	RAIDER_REPAIR_S,
	RAIDER_WRECK_S,
	dropManifestCanisters,
} from "../src/raider-wreck";
import {
	advanceTo,
	applyTransition,
	effectiveCarrier,
	newWorld,
	parseWorld,
	serializeWorld,
} from "../src/world-state";
import { HULL_SPECS, type HullId } from "../src/hull";
import {
	TRAFFIC_HULL_POOLS,
	nextTrafficDepartureAtS,
	stationTrafficRoster,
	trafficScheduleAt,
} from "../src/station-traffic";
import { PULSE_LASER, SHIELD_POOL, fullCondition } from "../src/ship-condition";
import { flightPerformance, steadyFrame } from "../src/sim";
import { add, length, normalizeOr, scale, sub, v3 } from "../src/vec3";
import { carrierManifest } from "../src/carrier-manifest";
import { generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";
import {
	OFFENCE_HEAT,
	type Offence,
	type OffenceFacts,
	type Standing,
	assaultCharged,
	chargeOffence,
} from "../src/legal";
import { carrierStanding } from "../src/carrier-standing";

/** Every hull any station roster flies, so a row is not a hand-picked subset. */
const ROSTER_HULLS = [
	...new Set(Object.values(TRAFFIC_HULL_POOLS).flat()),
].sort();
const CIVILIAN_HULLS = ROSTER_HULLS.filter((h) => !ARMED_TRAFFIC_HULLS.has(h));
const ARMED_HULLS = ROSTER_HULLS.filter((h) => ARMED_TRAFFIC_HULLS.has(h));

const DT = 1 / 60;
const KEY = carrierKey(12, "station-trade/traffic-02");

/** A civilian `km` ahead of a stationary player, flying away at rest. */
function ahead(hullId: HullId, km: number, seed = 5): Engagement {
	return engage(
		{
			key: KEY,
			hullId,
			pos: v3(0, 0, -km),
			vel: v3(),
			nose: v3(0, 0, -1),
			up: v3(0, 1, 0),
			voyageOrdinal: 0,
		},
		seed,
		{ assaultAlreadyCharged: false },
	);
}

/** A pilot who keeps the nose and the beam on the target and holds the trigger. */
function chaser(
	target: Engagement,
	from: { pos: ReturnType<typeof v3> },
): DuelPilot {
	const nose = normalizeOr(sub(target.flight.ship.pos, from.pos), v3(0, 0, -1));
	return {
		ship: { pos: from.pos, vel: v3() },
		nose,
		aimOrigin: from.pos,
		aimNose: nose,
		hull: 100,
		frame: steadyFrame(v3()),
	};
}

const SHOT = { fired: true, damage: PULSE_LASER.damagePerS * DT };

/** One shield side and the hull at the pulse's rate, no recharge (H2). */
const secondsOnTarget = (hull: HullId) =>
	(SHIELD_POOL + HULL_SPECS[hull].integrity) / PULSE_LASER.damagePerS;

describe("H2: the shared condition model", () => {
	test("an engaged carrier starts at its hull's full condition", () => {
		expect(ROSTER_HULLS.length).toBeGreaterThanOrEqual(8);
		for (const hull of ROSTER_HULLS)
			expect(ahead(hull, 2).condition).toEqual(fullCondition(hull));
	});

	test("is hit at its own hull's half-length", () => {
		expect(trafficHitRadiusKm("freighter")).toBe(
			HULL_SPECS.freighter.env.lengthKm / 2,
		);
		const r = trafficHitRadiusKm("freighter");
		expect(
			trafficInSights(v3(), v3(0, 0, -1), v3(r * 0.9, 0, -2), "freighter"),
		).toBe(true);
		expect(
			trafficInSights(v3(), v3(0, 0, -1), v3(r * 1.1, 0, -2), "freighter"),
		).toBe(false);
	});

	test("dies after about a shield side and its hull on target", () => {
		// Held in the beam, recharge never starts: every frame is a hit.
		let e = ahead("courier", 1);
		let frames = 0;
		for (; frames < 60 * 120; frames++) {
			// Pin it in the beam so the row is about the arithmetic, not the chase.
			e = {
				...e,
				flight: { ...e.flight, ship: { pos: v3(0, 0, -1), vel: v3() } },
			};
			const step = stepEngagement(e, chaser(e, { pos: v3() }), SHOT, DT);
			e = step.engagement;
			if (step.destroyed) break;
		}
		const seconds = frames * DT;
		expect(seconds).toBeGreaterThan(secondsOnTarget("courier") - 1);
		expect(seconds).toBeLessThan(secondsOnTarget("courier") + 1);
	});

	test("a Porter is about 45 s on target, a miner 54, a courier 34, a patrol 32", () => {
		expect(Math.round(secondsOnTarget("freighter"))).toBe(45);
		expect(Math.round(secondsOnTarget("miner"))).toBe(54);
		expect(Math.round(secondsOnTarget("courier"))).toBe(34);
		expect(Math.round(secondsOnTarget("patrol"))).toBe(32);
	});
});

describe("H3: the reaction per role", () => {
	test("the armed roles are patrol and interceptor", () => {
		expect([...ARMED_TRAFFIC_HULLS].sort()).toEqual(["interceptor", "patrol"]);
	});

	/**
	 * The engagement's opening: a pilot holding still, beam on the ship, who
	 * fires for the first `strikeS` seconds and then lets go.
	 */
	function fly(hull: HullId, seconds: number, strikeS = 1) {
		let e = ahead(hull, 3, 11);
		const phases = new Set<string>();
		let fired = false;
		const player = v3(0, 0, 0);
		for (let t = 0; t < seconds; t += DT) {
			const pilot = chaser(e, { pos: player });
			const shot = t < strikeS ? SHOT : { fired: false, damage: 0 };
			const step = stepEngagement(e, pilot, shot, DT);
			e = step.engagement;
			phases.add(e.flight.phase);
			if (step.returnFire) fired = true;
			if (step.destroyed) break;
		}
		return { phases, fired, e };
	}

	test("a civilian hull only evades and flees, and never fires", () => {
		expect(CIVILIAN_HULLS.length).toBeGreaterThanOrEqual(6);
		for (const hull of CIVILIAN_HULLS) {
			// Held under fire the whole time, which is when an attacker would
			// shoot back.
			const run = fly(hull, 30, 30);
			expect(run.fired).toBe(false);
			for (const phase of run.phases)
				expect(["evade", "flee"]).toContain(phase);
		}
	});

	test("every armed hull fights back", () => {
		expect(ARMED_HULLS).toEqual(["interceptor", "patrol"]);
		for (const hull of ARMED_HULLS) {
			const run = fly(hull, 30);
			expect(run.fired).toBe(true);
			expect(run.phases.has("attack")).toBe(true);
		}
	});

	test("flies on its own hull's thrust, not the raider's", () => {
		let e = ahead("freighter", 5);
		const pilot: DuelPilot = {
			ship: { pos: v3(0, 0, 0), vel: v3() },
			nose: v3(1, 0, 0),
			aimOrigin: v3(),
			aimNose: v3(1, 0, 0),
			hull: 100,
			frame: steadyFrame(v3()),
		};
		// A fleeing ship already nosed away runs at full throttle.
		e = { ...e, flight: { ...e.flight, phase: "flee", maneuverSeconds: 30 } };
		const quiet = { fired: false, damage: 0 };
		const steps = 30;
		for (let i = 0; i < steps; i++)
			e = stepEngagement(e, pilot, quiet, DT).engagement;
		const speed = length(e.flight.ship.vel);
		const expected = flightPerformance("freighter").thrustKms2 * steps * DT;
		expect(speed).toBeCloseTo(expected, 2);
		expect(speed).toBeLessThan(
			flightPerformance("raider").thrustKms2 * steps * DT,
		);
	});
});

describe("a kill is the carrier's destroy, and the slot is replaced", () => {
	test("with the player's provenance, a scheduled replacement by the home station", () => {
		const event = trafficDestruction(12, "station-trade", 500);
		expect(event.kind).toBe("destroy");
		expect(event.cause).toEqual(PLAYER_KILL);
		if (event.kind !== "destroy" || !event.schedule)
			throw new Error("no schedule");
		expect(event.schedule.startsAt).toBe(500 + RAIDER_WRECK_S);
		expect(event.schedule.completesAt).toBe(
			500 + RAIDER_WRECK_S + RAIDER_REPAIR_S,
		);
		expect(event.schedule.cause).toEqual({
			causeKind: "traffic-replacement",
			actorId: "12:station-trade",
			playerRole: "none",
		});
	});

	test("only an operational carrier flies its projection, and its replacement flies again", () => {
		const actors = [
			{ key: KEY },
			{ key: carrierKey(12, "station-trade/traffic-03") },
		];
		let world = newWorld(1);
		world = applyTransition(
			world,
			0,
			KEY,
			trafficDestruction(12, "station-trade", 100),
		);
		const at = (t: number) =>
			flyingTrafficActors(actors, (key) =>
				effectiveCarrier(world.galaxies[0], key, t),
			);
		expect(at(100).map((a) => a.key)).toEqual([actors[1].key]);
		expect(at(100 + RAIDER_WRECK_S + 1).map((a) => a.key)).toEqual([
			actors[1].key,
		]);
		const replaced = 100 + RAIDER_WRECK_S + RAIDER_REPAIR_S;
		expect(at(replaced).map((a) => a.key)).toEqual(actors.map((a) => a.key));
		expect(
			effectiveCarrier(world.galaxies[0], KEY, replaced).instanceOrdinal,
		).toBe(1);
	});
});

describe("a fight beside a station is flown in its frame", () => {
	test("an armed hull closes on a pilot co-moving with a fast frame, as it would at rest", () => {
		// A station's frame moves ~30 km/s (#104). The lead point was built from
		// the player's *absolute* velocity, so beside a station it aimed tens of
		// kilometres along the orbit and the patrol ran away from the fight.
		const frameVel = v3(30, -20, 0);
		const closest = (frame: ReturnType<typeof v3>) => {
			let e = engage(
				{
					key: KEY,
					hullId: "patrol",
					pos: v3(0, 0, -7),
					vel: frame,
					nose: v3(0, 0, -1),
					up: v3(0, 1, 0),
					voyageOrdinal: 0,
				},
				3,
				{ assaultAlreadyCharged: false },
			);
			let player = v3();
			let nearest = Number.POSITIVE_INFINITY;
			for (let t = 0; t < 20; t += DT) {
				const pilot: DuelPilot = {
					ship: { pos: player, vel: frame },
					nose: v3(0, 0, -1),
					aimOrigin: player,
					aimNose: v3(0, 0, -1),
					hull: 100,
					frame: steadyFrame(frame),
				};
				e = stepEngagement(
					e,
					pilot,
					{ fired: false, damage: 0 },
					DT,
				).engagement;
				player = add(player, scale(frame, DT));
				nearest = Math.min(nearest, length(sub(e.flight.ship.pos, player)));
			}
			return nearest;
		};
		const atRest = closest(v3());
		const moving = closest(frameVel);
		expect(atRest).toBeLessThan(3);
		expect(moving).toBeLessThan(3);
	});
});

describe("the voyage a hold is drawn for (carrier-identity F11)", () => {
	test("is the visit the route projects, not the schedule's next one", () => {
		// A return running late is projected as the previous visit while the
		// schedule has moved on; the hold is the flown visit's (sage #368).
		expect(flownVoyageOrdinal({ visitAwayOrdinal: 6 }, 7)).toBe(6);
	});

	test("falls back to the schedule only without a route", () => {
		expect(flownVoyageOrdinal(undefined, 7)).toBe(7);
		expect(flownVoyageOrdinal({}, 7)).toBe(7);
	});

	test("is fixed on the engagement, whatever the schedule does during the fight", () => {
		const e = engage(
			{
				key: KEY,
				hullId: "freighter",
				pos: v3(0, 0, -2),
				vel: v3(),
				nose: v3(0, 0, -1),
				up: v3(0, 1, 0),
				voyageOrdinal: 4,
			},
			1,
			{ assaultAlreadyCharged: false },
		);
		let stepped = e;
		for (let i = 0; i < 600; i++)
			stepped = stepEngagement(
				stepped,
				chaser(stepped, { pos: v3() }),
				SHOT,
				DT,
			).engagement;
		expect(stepped.voyageOrdinal).toBe(4);
	});
});

describe("a kill drops the manifest a scan would show (F6, H11)", () => {
	test("the canisters are carrierManifest's lines, one each, for every roster hull", () => {
		for (const hullId of ROSTER_HULLS)
			for (let voyage = 0; voyage < 6; voyage++) {
				const manifest = carrierManifest(0x5ee11e, KEY, 1, voyage, {
					holdT: HULL_SPECS[hullId].holdT,
					government: voyage % 8,
				});
				const drop = dropManifestCanisters({
					systemSeed: 0x5ee11e,
					key: KEY,
					manifest,
					killedAt: 100 + voyage,
					pos: v3(),
					vel: v3(),
					frameVel: v3(),
					frameBodyId: null,
				});
				expect(
					drop.map((c) => ({ good: c.commodity, tonnes: c.tonnes })),
				).toEqual([...manifest]);
			}
	});
});

/**
 * A real roster actor, because the divert's clock is its **home schedule's**
 * departure clock (`civilian-combat.md` H3c) and a hand-built schedule would be
 * a second copy of the roster law rather than a test of it.
 */
const DIVERT_RECORD = (() => {
	const found = generateGalaxy(0x5ee11e, 0).systems.find(
		(candidate) => generateContents(candidate).stations.length >= 2,
	);
	if (!found) throw new Error("multi-station fixture");
	return found;
})();
const DIVERT_HOME = generateContents(DIVERT_RECORD).stations[0];
const DIVERT_ACTOR = stationTrafficRoster(DIVERT_RECORD.index, DIVERT_HOME)[0];
const DIVERT_AT = 5_000;

/** Every transition #365 writes at one strike, applied in one tick. */
function divertOne(world: ReturnType<typeof newWorld>, at = DIVERT_AT) {
	for (const event of trafficDiversion(DIVERT_RECORD.index, DIVERT_ACTOR, at))
		world = applyTransition(world, 0, DIVERT_ACTOR.key, event);
	return world;
}

/** The `repair-start` of one divert at `at`, narrowed once. Rows that assert the
 *  pair itself build the events by hand; this is for the ones that only need the
 *  booking. */
function divertStart(at = DIVERT_AT) {
	const start = trafficDiversion(DIVERT_RECORD.index, DIVERT_ACTOR, at)[1];
	if (start.kind !== "repair-start") throw new Error("no repair start");
	return start;
}

describe("H3c: the diverting hit is a disable, then a repair, in one tick", () => {
	test("the player disables it and its home station books the repair", () => {
		const events = trafficDiversion(
			DIVERT_RECORD.index,
			DIVERT_ACTOR,
			DIVERT_AT,
		);
		expect(events.map((e) => e.kind)).toEqual(["disable", "repair-start"]);
		// One tick, not two: H3c's pair is one act, and `applyTransition` refuses
		// a write before the clock the first one moved.
		for (const event of events) expect(event.occurredAt).toBe(DIVERT_AT);
		expect(events[0].cause).toEqual(PLAYER_KILL);

		const start = events[1];
		if (start.kind !== "repair-start") throw new Error("no repair start");
		// The work is the berth's, not the offender's — so it writes no knowledge.
		expect(start.cause.playerRole).toBe("none");
		expect(start.cause.actorId).toBe(
			`${DIVERT_RECORD.index}:${DIVERT_ACTOR.homeStationId}`,
		);
		expect(start.completesAt).toBe(
			nextTrafficDepartureAtS(
				DIVERT_ACTOR.schedule,
				DIVERT_AT + RAIDER_REPAIR_S,
			),
		);
	});

	test("the absence is the shipped repair duration, never shorter, and ends on a departure", () => {
		const start = divertStart();
		// H3d's T is a floor: the principal ruled the rejoin lands on a departure,
		// because a carrier whose repair ends mid-leg re-enters a schedule it
		// never flew and pops out of its berth into the middle of a leg.
		expect(start.completesAt).toBeGreaterThanOrEqual(
			DIVERT_AT + RAIDER_REPAIR_S,
		);
		expect(start.completesAt - (DIVERT_AT + RAIDER_REPAIR_S)).toBeLessThan(
			DIVERT_ACTOR.schedule.cycleS,
		);
		expect(
			nextTrafficDepartureAtS(DIVERT_ACTOR.schedule, start.completesAt),
		).toBe(start.completesAt);
		expect(
			trafficScheduleAt(DIVERT_ACTOR, start.completesAt + 0.01).desired,
		).toBe("away");
	});

	test("applied, it is repairing at its own ordinal, inside the episode the strike opened", () => {
		const world = divertOne(newWorld(1));
		const carrier = effectiveCarrier(
			world.galaxies[0],
			DIVERT_ACTOR.key,
			DIVERT_AT,
		);
		expect(carrier.condition).toBe("repairing");
		// H3c: the same ship. Only a replacement ever moves the ordinal.
		expect(carrier.instanceOrdinal).toBe(0);
		expect(carrier.recovery?.kind).toBe("repair");

		const episode = world.galaxies[0].episodes[DIVERT_ACTOR.key];
		expect(episode.closed).toBe(false);
		expect(episode.initiating.kind).toBe("disable");
		expect(episode.initiating.cause).toEqual(PLAYER_KILL);
		expect(episode.intervention?.kind).toBe("repair-start");
	});

	test("it comes back at the same ordinal, and that is where its schedule departs", () => {
		const world = divertOne(newWorld(1));
		const start = divertStart();
		const back = (t: number) =>
			effectiveCarrier(world.galaxies[0], DIVERT_ACTOR.key, t);
		expect(back(start.completesAt - 0.01).condition).toBe("repairing");
		const operational = back(start.completesAt);
		expect(operational.condition).toBe("operational");
		expect(operational.instanceOrdinal).toBe(0);
	});

	test("a second strike cannot divert it twice", () => {
		// `main.ts` gates the write on `operational`, and the gate is real: the
		// module throws rather than no-oping, so a repeat would take the frame
		// down with it rather than quietly miss a transition.
		const world = divertOne(newWorld(1));
		const again = trafficDiversion(
			DIVERT_RECORD.index,
			DIVERT_ACTOR,
			DIVERT_AT + 10,
		)[0];
		expect(() => applyTransition(world, 0, DIVERT_ACTOR.key, again)).toThrow(
			"cannot disable a carrier that is repairing",
		);
	});

	test("it is gone from its route across the save, not just across the frame", () => {
		// The checkpoint's "across a save" row. `saveEnvelope` is what writes the
		// world, and it advances the clock first — so the round trip is taken the
		// way the store takes it, not the way a test would.
		const world = advanceTo(divertOne(newWorld(1)), DIVERT_AT + 60);
		const restored = parseWorld(serializeWorld(world));
		const row = effectiveCarrier(
			restored.galaxies[0],
			DIVERT_ACTOR.key,
			DIVERT_AT + 60,
		);
		expect(trafficPresence(row)).toBe("parked-home");
		expect(
			parkedHomeTrafficActors([DIVERT_ACTOR], () => row).map((a) => a.key),
		).toEqual([DIVERT_ACTOR.key]);
		// And no new field was needed to get there: the divert is one row and one
		// episode, both of which the save already knew how to carry. That claim
		// rides on the two assertions above — the row and the projection survive a
		// serialize/parse with the divert still standing — and not on a version
		// check, because there is no version check that could hold it: `parseWorld`
		// refuses any `worldSchemaVersion` but the shipped one, so a row comparing
		// the round-tripped version with the constant is a row that cannot fail.
	});
});

describe("H3d: the trigger is a hit that reaches hull points", () => {
	test("shields alone move nothing; the first frame that spends hull points diverts", () => {
		// Held in the beam, pinned, so the row is about the arithmetic and not
		// the chase — the same rig H2's time-on-target row is built on.
		let e = ahead("courier", 1);
		let firstHullFrame = -1;
		let hullFrames = 0;
		for (let frame = 0; frame < 60 * 120; frame++) {
			e = {
				...e,
				flight: { ...e.flight, ship: { pos: v3(0, 0, -1), vel: v3() } },
			};
			const step = stepEngagement(e, chaser(e, { pos: v3() }), SHOT, DT);
			if (step.hullStruck) {
				if (firstHullFrame < 0) firstHullFrame = frame;
				hullFrames++;
			}
			e = step.engagement;
			if (step.destroyed) break;
		}
		const shieldsGone = SHIELD_POOL / PULSE_LASER.damagePerS;
		// Nothing before the shield side is off: a pilot who only strips shields
		// changes nothing in the world, and shields recharge (H3d).
		expect(firstHullFrame * DT).toBeGreaterThanOrEqual(shieldsGone);
		expect(firstHullFrame * DT).toBeLessThan(shieldsGone + DT * 2);
		// Every frame after that spends hull points too, up to the kill.
		expect(hullFrames).toBeGreaterThan(1);
	});
});

describe("H3b: where a diverted carrier is while it repairs", () => {
	const carrierAt = (world: ReturnType<typeof newWorld>, t: number) =>
		effectiveCarrier(world.galaxies[0], DIVERT_ACTOR.key, t);

	test("a divert is parked at home; a replacement under construction is absent", () => {
		expect(trafficPresence({ condition: "operational" })).toBe("flying");
		// The one state that is not absent: the world remembers it is sitting in
		// its own berth, so it is drawn there rather than nowhere.
		expect(
			trafficPresence({ condition: "repairing", recovery: { kind: "repair" } }),
		).toBe("parked-home");
		// A replacement is a ship that does not exist yet. Drawing it in a berth
		// would be drawing the carrier the player killed.
		expect(
			trafficPresence({
				condition: "repairing",
				recovery: { kind: "replacement" },
			}),
		).toBe("absent");
		expect(trafficPresence({ condition: "destroyed" })).toBe("absent");
	});

	test("the struck one leaves the flying set and joins the parked one", () => {
		const other = stationTrafficRoster(DIVERT_RECORD.index, DIVERT_HOME)[1];
		const actors = [DIVERT_ACTOR, other];
		let world = newWorld(1);
		world = applyTransition(
			world,
			0,
			other.key,
			trafficDestruction(DIVERT_RECORD.index, other.homeStationId, DIVERT_AT),
		);
		world = divertOne(world);
		const at = (t: number) =>
			effectiveCarrier(world.galaxies[0], DIVERT_ACTOR.key, t);
		const conditionOf = (t: number) => (key: typeof KEY) =>
			effectiveCarrier(world.galaxies[0], key, t);

		const struck = DIVERT_ACTOR.key;
		const flying = flyingTrafficActors(actors, conditionOf(DIVERT_AT)).map(
			(a) => a.key,
		);
		expect(flying).not.toContain(struck);
		// The destroyed one is neither flying nor parked: it is not drawn at all.
		expect(
			parkedHomeTrafficActors(actors, conditionOf(DIVERT_AT)).map((a) => a.key),
		).toEqual([struck]);
		// And at the completion it flies again, which is its next departure.
		const start = divertStart();
		expect(at(start.completesAt).condition).toBe("operational");
		expect(
			flyingTrafficActors(actors, conditionOf(start.completesAt)).map(
				(a) => a.key,
			),
		).toContain(struck);
		expect(
			parkedHomeTrafficActors(actors, conditionOf(start.completesAt)),
		).toEqual([]);
	});
});

describe("a kill on the way home stays reachable (H3c)", () => {
	test("of an operational carrier it is still the one destroy change 1 shipped", () => {
		expect(
			trafficKillTransitions(
				DIVERT_RECORD.index,
				DIVERT_ACTOR,
				"operational",
				DIVERT_AT,
			),
		).toEqual([
			trafficDestruction(
				DIVERT_RECORD.index,
				DIVERT_ACTOR.homeStationId,
				DIVERT_AT,
			),
		]);
	});

	test("of a repairing one it interrupts the repair, then destroys it with its replacement", () => {
		// `destroy` is legal from `operational` and `disabled` only, so the kill
		// of a repairing carrier is two facts — and the schedule only a `destroy`
		// can carry.
		const struckAt = 100;
		const killedAt = struckAt + RAIDER_REPAIR_S / 2;
		const events = trafficKillTransitions(
			DIVERT_RECORD.index,
			DIVERT_ACTOR,
			"repairing",
			killedAt,
		);
		expect(events.map((e) => e.kind)).toEqual(["interrupt", "destroy"]);
		expect(events[0].cause).toEqual(PLAYER_KILL);

		let world = divertOne(newWorld(1), struckAt);
		// The kill has to land while the repair is still running — which is the
		// whole point of the row, and the reason the clock is picked from it.
		expect(
			effectiveCarrier(world.galaxies[0], DIVERT_ACTOR.key, killedAt).condition,
		).toBe("repairing");
		for (const event of events)
			world = applyTransition(world, 0, DIVERT_ACTOR.key, event);
		const at = (t: number) =>
			effectiveCarrier(world.galaxies[0], DIVERT_ACTOR.key, t);
		expect(at(killedAt).condition).toBe("destroyed");
		expect(at(killedAt + RAIDER_WRECK_S).recovery?.kind).toBe("replacement");
		const replaced = killedAt + RAIDER_WRECK_S + RAIDER_REPAIR_S;
		expect(at(replaced).condition).toBe("operational");
		// H1: it died, so what comes back is a new ship.
		expect(at(replaced).instanceOrdinal).toBe(1);
	});
});

/**
 * A system seed under which `key`'s first instance reads each standing at each
 * clock. Standing is derived from the system seed (`carrier-standing.ts`), and
 * the world-state rows below do not read it, so the seed the law is handed is
 * free to pick — and picking it by search is what keeps a row from restating a
 * draw.
 */
const seedWhere = (
	key: CarrierKey,
	...wanted: [Standing, number][]
): number => {
	for (let seed = 1; seed < 500_000; seed++)
		if (wanted.every(([s, at]) => carrierStanding(seed, key, 0, at) === s))
			return seed;
	throw new Error(`no seed reads ${JSON.stringify(wanted)} for ${key}`);
};

/**
 * The facts `Game` hands `chargeOffence` for one act against `key`, read off
 * the carrier's row as it stood before the act's own transition (#633 D2):
 * the instance, and the strike's clock through `strikeClock`.
 */
const offenceAgainst = (
	offence: Offence,
	now: number,
	row: { instanceOrdinal: number } & Parameters<typeof strikeClock>[0],
	systemSeed: number,
	key: CarrierKey = DIVERT_ACTOR.key,
): OffenceFacts => ({
	offence,
	galaxy: 0,
	now,
	systemSeed,
	carrier: {
		key,
		instanceOrdinal: row.instanceOrdinal,
		struckAt: strikeClock(row),
	},
	victim: v3(),
	stations: [],
});

describe("H9: a kill supersedes the strike that preceded it", () => {
	/** The row the pilot's offence is judged against: read at the clock the
	 *  offence lands, exactly as `main.ts` reads it. */
	const rowAt = (world: ReturnType<typeof newWorld>, at: number) =>
		effectiveCarrier(world.galaxies[0], DIVERT_ACTOR.key, at);
	const KILL_AT = DIVERT_AT + 10;
	/** Clean at the strike and at the kill. */
	const CLEAN = seedWhere(
		DIVERT_ACTOR.key,
		["clean", DIVERT_AT],
		["clean", KILL_AT],
	);

	test("a strike on a carrier nobody has fired on yet costs the whole 15", () => {
		const world = newWorld(1);
		const before = rowAt(world, DIVERT_AT);
		expect(strikeClock(before)).toBe(null);
		expect(
			chargeOffence(world, offenceAgainst("struck", DIVERT_AT, before, CLEAN))
				.heat,
		).toBe(15);
	});

	test("strike then kill on one Clean carrier costs 40, not 55", () => {
		// The strike is charged against the row before its divert, as the
		// game does; the kill lands while the divert is still running, which
		// is what makes it the same incident rather than a second offence.
		const fresh = newWorld(1);
		const strike = chargeOffence(
			divertOne(fresh),
			offenceAgainst("struck", DIVERT_AT, rowAt(fresh, DIVERT_AT), CLEAN),
		);
		const home = rowAt(strike.world, KILL_AT);
		expect(trafficPresence(home)).toBe("parked-home");
		expect(strikeClock(home)).toBe(DIVERT_AT);
		const kill = chargeOffence(
			strike.world,
			offenceAgainst("destroyed", KILL_AT, home, CLEAN),
		);
		expect(strike.heat).toBe(15);
		expect(kill.heat).toBe(25);
		expect(strike.heat + kill.heat).toBe(OFFENCE_HEAT.destroyed);
	});

	test("a strike that cost nothing is not credited to the kill that follows it", () => {
		const world = divertOne(newWorld(1));
		const completes = divertStart().completesAt;
		// H4 writes no heat for an offence against a Wanted carrier, so a strike
		// that landed while the target was Wanted charged nothing — and the kill
		// is worth its full 40 even though the row still shows the divert
		// standing. The standing the strike was judged on comes from the strike's
		// own clock, which the row carries: `startedAt` is the `repair-start`'s
		// `occurredAt`, which is the `disable`'s, because H3c writes both in one
		// tick. Standing is never saved, so that clock is the whole record.
		//
		// The rotation has to turn inside the repair for this to be a test of
		// the clock at all — Wanted at the strike, Clean by the kill — so the kill
		// is taken at the last second the carrier is still at home.
		const killAt = completes - 1;
		const repairing = rowAt(world, killAt);
		expect(trafficPresence(repairing)).toBe("parked-home");
		expect(repairing.recovery?.startedAt).toBe(DIVERT_AT);
		const turned = seedWhere(
			DIVERT_ACTOR.key,
			["wanted", DIVERT_AT],
			["clean", killAt],
		);
		expect(
			chargeOffence(
				world,
				offenceAgainst("destroyed", killAt, repairing, turned),
			).heat,
		).toBe(40);
		// And a carrier at home with no strike clock to read — a disable with
		// no repair written — charges nothing as paid either.
		const unclocked = { instanceOrdinal: 0, condition: "disabled" as const };
		expect(trafficPresence(unclocked)).toBe("parked-home");
		expect(strikeClock(unclocked)).toBe(null);
		expect(
			chargeOffence(
				newWorld(1),
				offenceAgainst("destroyed", KILL_AT, unclocked, CLEAN),
			).heat,
		).toBe(40);
	});

	test("a second strike in the same incident adds nothing", () => {
		const world = divertOne(newWorld(1));
		expect(
			chargeOffence(
				world,
				offenceAgainst("struck", KILL_AT, rowAt(world, KILL_AT), CLEAN),
			).heat,
		).toBe(0);
	});

	test("once the repair has completed, the next offence is a new incident and pays in full", () => {
		const world = divertOne(newWorld(1));
		// The completion closes the incident lazily, on the read — and a kill
		// against the ship that came back is a fresh 40, not a 25 top-up.
		const completes = divertStart().completesAt;
		const back = rowAt(world, completes);
		expect(back.condition).toBe("operational");
		expect(strikeClock(back)).toBe(null);
		const steady = seedWhere(
			DIVERT_ACTOR.key,
			["clean", DIVERT_AT],
			["clean", completes],
		);
		expect(
			chargeOffence(world, offenceAgainst("destroyed", completes, back, steady))
				.heat,
		).toBe(40);
	});

	test("the strike is read off the carrier's row, because the ledger keeps only the latest episode", () => {
		let world = divertOne(newWorld(1));
		const strike = world.galaxies[0].episodes[DIVERT_ACTOR.key];
		expect(strike.closed).toBe(false);
		expect(strike.initiating.kind).toBe("disable");

		const events = trafficKillTransitions(
			DIVERT_RECORD.index,
			DIVERT_ACTOR,
			"repairing",
			DIVERT_AT + 10,
		);
		for (const event of events)
			world = applyTransition(world, 0, DIVERT_ACTOR.key, event);
		// §5's accepted cost of the bound: the kill's own episode replaces the
		// strike's summary wholesale. Nothing in `episodes` still says a strike
		// happened — which is why H9's supersession is read from the carrier's
		// condition (`strikeClock`, handed to `chargeOffence`), where the divert
		// is still standing, and not from the episode ledger.
		expect(world.galaxies[0].episodes[DIVERT_ACTOR.key].initiating.kind).toBe(
			"destroy",
		);
	});
});

describe("H4's sustained-fire clock (#396)", () => {
	/**
	 * Aimed fire from a pilot who keeps the nose on the target, `frames` of it,
	 * reporting each step. A civilian flees, so the beam does not land on every
	 * frame — which is the point of `landedFireS` and the reason every row below
	 * is written around *seconds that landed* rather than frames elapsed.
	 */
	/** The marksman who stays where he is: parked at the origin, nose on target. */
	const seated = (e: Engagement) => chaser(e, { pos: v3() });

	/**
	 * Hold the trigger for `frames`, naming the marksman who shoots.
	 *
	 * **The pilot is a parameter and not a copy of this loop.** A civilian flees,
	 * so whether a frame lands anything is a fact about where the shooter is
	 * standing, and a rig that hardcodes one pilot grows a hand-rolled second
	 * loop the moment a row needs the other — which is how a file ends up with
	 * four copies of the same flight, each free to differ from the others in a
	 * detail nobody meant to vary.
	 */
	function holdFire(
		start: Engagement,
		frames: number,
		pilot: (e: Engagement) => DuelPilot,
		{
			each = () => {},
			firing = true,
			until,
		}: {
			/** Report each step, for a row that counts crossings rather than sums. */
			each?: (step: EngagementStep, index: number) => void;
			/** Pull the trigger, every frame or by index. */
			firing?: boolean | ((index: number) => boolean);
			/** Stop on the first step this answers true, after `each` has seen it.
			 *  A row about *when* something happens needs the frame it happened on,
			 *  and without an exit every such row would hand-roll its own loop —
			 *  which is how a rig ends up with four copies of the same flight, each
			 *  free to differ from the others in a detail nobody meant to vary. */
			until?: (step: EngagementStep, index: number) => boolean;
		} = {},
	): Engagement {
		let e = start;
		for (let i = 0; i < frames; i++) {
			const on = typeof firing === "boolean" ? firing : firing(i);
			const step = stepEngagement(
				e,
				pilot(e),
				on ? SHOT : { fired: false, damage: 0 },
				DT,
			);
			e = step.engagement;
			each(step, i);
			if (until?.(step, i)) break;
		}
		return e;
	}

	/**
	 * A pilot who never lets the range open: re-seated two kilometres along the
	 * line to the target every frame. The fleeing ship outruns a stationary
	 * marksman's cone within a few seconds, and a row about a clock that has to
	 * survive the gaps cannot be written against a target that simply escapes.
	 */
	function tracker(target: Engagement): DuelPilot {
		const dir = normalizeOr(sub(target.flight.ship.pos, v3()), v3(0, 0, -1));
		const pos = sub(target.flight.ship.pos, scale(dir, 2));
		return {
			ship: { pos, vel: v3() },
			nose: dir,
			aimOrigin: pos,
			aimNose: dir,
			hull: 100,
			frame: steadyFrame(v3()),
		};
	}

	test("the first landed hit is reported once, on the frame it lands", () => {
		let said = 0;
		const e = holdFire(ahead("freighter", 2), 60, seated, {
			each: (s) => {
				if (s.firstHit) said++;
			},
		});
		expect(said).toBe(1);
		// One hit, and nothing charged for it: the hail is not an accusation, and
		// a pilot who grazed a citizen on the way past is not yet an offender.
		expect(e.assaultCharged).toBe(false);
	});

	test("it charges at the seconds it declares, and not a frame sooner", () => {
		const declared = ASSAULT_FIRE_S / DT;
		let crossed = -1;
		const engagement = holdFire(ahead("freighter", 2), 6000, seated, {
			each: (s, i) => {
				if (s.assaultCrossed && crossed < 0) crossed = i;
			},
			until: (s) => s.assaultCrossed,
		});
		expect(crossed).toBeGreaterThan(0);
		// Within a frame of the declared figure. `landedFireS` sums a third of a
		// millisecond sixty times a second, so the crossing is not exactly on it;
		// what the row refuses is a clock that runs short or never crosses at all.
		expect(Math.abs(crossed - declared)).toBeLessThanOrEqual(1);
		expect(engagement.landedFireS).toBeGreaterThanOrEqual(ASSAULT_FIRE_S);
		expect(engagement.assaultCharged).toBe(true);
	});

	test("once it has charged it charges no more, however long the fight runs", () => {
		let charges = 0;
		const e = holdFire(ahead("freighter", 2), 900, seated, {
			each: (s) => {
				if (s.assaultCrossed) charges++;
			},
		});
		expect(charges).toBe(1);
		expect(e.assaultCharged).toBe(true);
		expect(e.landedFireS).toBeGreaterThan(ASSAULT_FIRE_S);
	});

	test("the clock holds across the gaps between hits", () => {
		// Two seconds of fire, five seconds of coasting to line up again, then as
		// much more as the fleeing target allows. A clock that reset between hits
		// would make the charge a marksmanship test and hand one who jinks a
		// discount on the same act.
		let e = ahead("freighter", 2);
		let charged = 0;
		/** One leg of the fight: the tracking pilot, the trigger in or off. */
		const fire = (from: Engagement, frames: number, on: boolean) =>
			holdFire(from, frames, tracker, {
				each: (step) => {
					if (step.assaultCrossed) charged++;
				},
				firing: on,
			});
		e = fire(e, 120, true);
		const held = e.landedFireS;
		expect(held).toBeGreaterThan(0);
		expect(held).toBeLessThan(ASSAULT_FIRE_S);
		// Coasting neither adds to the clock nor takes anything off it.
		const coasted = fire(e, 300, false);
		expect(coasted.landedFireS).toBe(held);
		expect(charged).toBe(0);
		// Back on for two more seconds — two seconds, because the charge arrives
		// whenever the held seconds pass the figure and no earlier.
		const back = fire(coasted, 120, true);
		expect(back.landedFireS).toBeGreaterThan(held);
		expect(charged).toBe(back.landedFireS >= ASSAULT_FIRE_S ? 1 : 0);
		const finished = fire(back, 600, true);
		expect(charged).toBe(1);
		expect(finished.assaultCharged).toBe(true);
	});

	test("a stray hit under the threshold hails and files nobody", () => {
		// Both halves of the free-shot case at once: half a second of a laser that
		// grazed a hull on the way past is not a deliberate act, so nothing is
		// charged and no station is filed as a hearer — and yet the victim said
		// something to the pilot who hit it, on that first frame.
		let hailed = 0;
		let charged = 0;
		const e = holdFire(ahead("freighter", 2), 30, seated, {
			each: (s) => {
				if (s.firstHit) hailed++;
				if (s.assaultCrossed) charged++;
			},
		});
		expect(hailed).toBe(1);
		expect(charged).toBe(0);
		expect(e.landedFireS).toBeLessThan(ASSAULT_FIRE_S);
		expect(e.assaultCharged).toBe(false);
	});

	test("a fight resumed after a reload is the same incident, not a fresh clock", () => {
		// The double charge #396 rules out by name. The world says the assault on
		// this carrier is paid — it was charged, and the charge left its mark —
		// so a fight resumed after a reload starts latched: the clock never
		// crosses again, because it never started.
		const operational = {
			instanceOrdinal: 0,
			condition: "operational" as const,
		};
		const clean = seedWhere(KEY, ["clean", 0], ["clean", 60]);
		const paid = chargeOffence(
			newWorld(1),
			offenceAgainst("assault", 0, operational, clean, KEY),
		);
		expect(paid.heat).toBe(13);
		const resumed = engage(
			{
				key: KEY,
				hullId: "freighter",
				pos: v3(0, 0, -2),
				vel: v3(),
				nose: v3(0, 0, -1),
				up: v3(0, 1, 0),
				voyageOrdinal: 0,
			},
			5,
			{
				assaultAlreadyCharged: assaultCharged(
					paid.world.galaxies[0].legalStatus,
					KEY,
				),
			},
		);
		expect(resumed.landedFireS).toBe(0);
		expect(resumed.assaultCharged).toBe(true);
		let charged = 0;
		const e = holdFire(resumed, 900, seated, {
			each: (s) => {
				if (s.assaultCrossed) charged++;
			},
		});
		expect(charged).toBe(0);
		// The seconds still accumulate — the law does not need them, but a reader
		// of the readout should see the fight, not a clock frozen at zero.
		expect(e.landedFireS).toBeGreaterThan(ASSAULT_FIRE_S);
		// And the law reads it as paid, whatever the carrier's own row says. Its
		// row has nothing to say — an operational ship under fire, no strike
		// clock — and the five seconds are still not billed twice.
		expect(strikeClock(operational)).toBe(null);
		expect(
			chargeOffence(
				paid.world,
				offenceAgainst("assault", 60, operational, clean, KEY),
			).heat,
		).toBe(0);
	});

	test("a strike on top of a paid assault is charged the difference", () => {
		// **The whole ladder, as the three legs a pilot actually walks**, each
		// charged against the row `Game` would read: five seconds of fire on the
		// flying carrier, the strike that diverts it, the kill that finishes it
		// at home. The divert and the kill read their row before their own
		// transition, and the kill's row is the divert's, carrying its clock.
		const ASSAULT_AT = DIVERT_AT - 10;
		const KILL_AT = DIVERT_AT + 10;
		const seed = seedWhere(
			DIVERT_ACTOR.key,
			["clean", ASSAULT_AT],
			["clean", DIVERT_AT],
			["clean", KILL_AT],
		);
		const rowAt = (world: ReturnType<typeof newWorld>, at: number) =>
			effectiveCarrier(world.galaxies[0], DIVERT_ACTOR.key, at);
		const fresh = newWorld(1);
		const assault = chargeOffence(
			fresh,
			offenceAgainst("assault", ASSAULT_AT, rowAt(fresh, ASSAULT_AT), seed),
		);
		const struckBefore = rowAt(assault.world, DIVERT_AT);
		const strike = chargeOffence(
			divertOne(assault.world),
			offenceAgainst("struck", DIVERT_AT, struckBefore, seed),
		);
		const home = rowAt(strike.world, KILL_AT);
		expect(trafficPresence(home)).toBe("parked-home");
		const kill = chargeOffence(
			strike.world,
			offenceAgainst("destroyed", KILL_AT, home, seed),
		);
		// Literals, for the H9 rows' reason in `tests/legal.test.ts`: a figure
		// derived through the module passes on the module's own mistake.
		const legs = [assault.heat, strike.heat, kill.heat];
		expect(legs).toEqual([13, 2, 25]);
		expect(legs.reduce((a, b) => a + b, 0)).toBe(OFFENCE_HEAT.destroyed);
	});
});
