import { describe, expect, test } from "bun:test";
import {
	type FieldPlan,
	type PlacementKind,
	fieldCentre,
	fieldCentreVelocity,
	FIELD_PROFILE,
	systemFields,
} from "../src/asteroid-field";
import {
	DEFAULT_CRUISE,
	advanceCruise,
	chargeAfterTravel,
	exitVelocity,
} from "../src/cruise";
import { isDisplayContact } from "../src/display-contact";
import { fieldContactsAt, nearestFieldPlan } from "../src/field-contact";
import { PLAYER_BASELINE_HULL } from "../src/hull";
import { relayFrameHolds } from "../src/pirate-relay";
import { RELAY_LOCAL_CARRIER_ID } from "../src/relay-slot";
import { isRockTargetId } from "../src/rock-target";
import {
	ASSIST_CAP_KMS,
	NO_ATTITUDE,
	advanceWorldClock,
	bodyAccelerationBound,
	bodyVelocity,
	flightPerformance,
	markShipPlaced,
	restoreWorld,
	stationHostIdOf,
	stepFlight,
} from "../src/sim";
import { MAX_DT, NEAR_FAR_KM } from "../src/units";
import {
	type Vec3,
	add,
	length,
	normalizeOr,
	scale,
	sub,
	v3,
} from "../src/vec3";
import { gameMethods } from "./lib/game-methods";

const WORLD_SEED = 47;
const PERF = flightPerformance(PLAYER_BASELINE_HULL);
const IDLE = { surge: 0, sway: 0, heave: 0 };
const ASSIST_IDLE_TOLERANCE_KMS = 1e-3;

const FIXTURES: Record<PlacementKind, { galaxy: number; system: number }> = {
	"refinery-orbit": { galaxy: 0, system: 0 },
	belt: { galaxy: 0, system: 4 },
	trojan: { galaxy: 0, system: 10 },
	"outer-orbit": { galaxy: 0, system: 14 },
	"outer-trojan": { galaxy: 1, system: 97 },
};

const METHODS = [
	"selectable",
	"masses",
	"targetBody",
	"bodyFor",
	"targetVelocity",
	"velocityOf",
	"targetParentId",
	"stepCruise",
	"dropOut",
	"updateLocalFrameBody",
	"nearestBody",
	"assistFrameSource",
	"assistFrame",
	"assistFrameMotion",
	"frameMotion",
	"localFrame",
	"localFrameSource",
	"bodyFrameSource",
	"setLocalFrame",
];

function subjectAt(galaxy: number, system: number) {
	const world = restoreWorld(WORLD_SEED, galaxy, system, 0);
	return Object.assign(
		Object.create(
			gameMethods(METHODS, {
				fieldContactsAt,
				nearestFieldPlan,
				fieldCentreVelocity,
				isRockTargetId,
				bodyVelocity,
				bodyAccelerationBound,
				isDisplayContact,
				stationHostIdOf,
				advanceCruise,
				advanceWorldClock,
				chargeAfterTravel,
				exitVelocity,
				markShipPlaced,
				relayFrameHolds,
				RELAY_LOCAL_CARRIER_ID,
				NEAR_FAR_KM,
				length,
				sub,
				scale,
				v3,
			}),
		),
		{
			world,
			contacts: [],
			selectableCache: null,
			massesCache: null,
			massesAt: NaN,
			targetId: null,
			cruiseParams: DEFAULT_CRUISE,
			chargeAu: 12,
			throttle: 1,
			regime: "cruise",
			detour: null,
			relayView: null,
			frameBody: null,
			frameField: null,
			proximityFrameBodyId: null,
			legStartedAtS: 0,
			stepDetour: () => true,
			saveDirty: () => {},
			nose(this: any) {
				return normalizeOr(
					sub(this.targetBody().pos, this.world.ship.pos),
					v3(1, 0, 0),
				);
			},
		},
	);
}

function planOf(g: any, kind: PlacementKind): FieldPlan {
	const { record, contents } = g.world.system;
	const plan = systemFields(record, contents).find((p) => p.kind === kind);
	if (!plan) throw new Error(`no ${kind} field in the fixture`);
	return plan;
}

function idleStepInOwnFrame(g: any, assist: boolean, nose: Vec3) {
	stepFlight(
		g.world.ship,
		{
			nose,
			up: v3(0, 1, 0),
			demand: IDLE,
			assist,
			attitude: NO_ATTITUDE,
			frame: g.assistFrameMotion(MAX_DT),
		},
		MAX_DT,
		PERF,
	);
}

function idleWithAssistInOwnFrame(g: any, seconds: number, nose = v3(0, 0, 1)) {
	g.regime = "normal";
	g.throttle = 0;
	for (let t = 0; t < seconds; t += MAX_DT) {
		g.updateLocalFrameBody();
		idleStepInOwnFrame(g, true, nose);
		advanceWorldClock(g.world, MAX_DT);
	}
	g.updateLocalFrameBody();
}

function dropAt(kind: PlacementKind) {
	const { galaxy, system } = FIXTURES[kind];
	const g = subjectAt(galaxy, system);
	const plan = planOf(g, kind);
	g.targetId = plan.id;
	g.world.ship.pos = add(fieldCentre(plan, 0), v3(0, 0, 2000));
	g.world.ship.vel = fieldCentreVelocity(plan, 0);
	for (let i = 0; i < 100 / MAX_DT && g.regime === "cruise"; i++)
		g.stepCruise(MAX_DT, null);
	expect(g.lastExit).toBe(`arrived at ${plan.id}`);
	return { g, plan };
}

const offset = (g: any, plan: FieldPlan) =>
	sub(g.world.ship.pos, fieldCentre(plan, g.world.gameTime));
const relativeSpeed = (g: any, plan: FieldPlan) =>
	length(sub(g.world.ship.vel, fieldCentreVelocity(plan, g.world.gameTime)));

describe("a ship dropped at a field flies in the field's frame (#1139)", () => {
	for (const kind of Object.keys(FIXTURES) as PlacementKind[]) {
		test(`${kind}: the assist holds station on the field centre for 60 s`, () => {
			const { g, plan } = dropAt(kind);
			const before = offset(g, plan);
			idleWithAssistInOwnFrame(g, 60);
			expect(relativeSpeed(g, plan)).toBeLessThan(ASSIST_IDLE_TOLERANCE_KMS);
			const smallestSemiKm = Math.min(...FIELD_PROFILE[plan.profile].semiKm);
			expect(length(sub(offset(g, plan), before))).toBeLessThan(smallestSemiKm);
			expect(g.assistFrame().label).toBe("FIELD FRAME");
		});
	}
});

function placedAt(g: any, pos: Vec3, vel: Vec3) {
	g.world.ship.pos = pos;
	g.world.ship.vel = vel;
	g.regime = "normal";
	g.updateLocalFrameBody();
}

describe("which frame wins beside a field (#1139)", () => {
	test("by nearest centre: the charted field inside it, its refinery at the refinery, under 1 m/s apart", () => {
		const g0 = subjectAt(0, 0);
		let covered = 0;
		for (const record of g0.world.galaxy.systems) {
			const g = subjectAt(0, record.index);
			const plan = systemFields(record, g.world.system.contents).find(
				(p) => p.kind === "refinery-orbit",
			);
			if (!plan) continue;
			covered++;
			const refinery = g.world.system.byId.get(plan.hostId);
			const centre = fieldCentre(plan, 0);
			placedAt(g, centre, fieldCentreVelocity(plan, 0));
			expect(g.assistFrame().label).toBe("FIELD FRAME");
			expect(g.frameBody?.id).toBe(refinery.id);
			const fieldVel = g.localFrame();
			placedAt(g, refinery.pos, fieldVel);
			expect(g.assistFrame().label).toBe("STATION FRAME");
			expect(g.frameField).toBeNull();
			expect(length(sub(g.localFrame(), fieldVel))).toBeLessThan(1e-3);
		}
		expect(covered).toBeGreaterThan(50);
	});

	test("away from every field, the frame is the nearest body's as before", () => {
		for (const { galaxy, system } of Object.values(FIXTURES)) {
			const g = subjectAt(galaxy, system);
			for (const body of g.world.system.bodies) {
				if (nearestFieldPlan(g.world.system, body.pos, 0, NEAR_FAR_KM))
					continue;
				placedAt(g, body.pos, v3());
				expect(g.frameField).toBeNull();
				expect(g.assistFrame().label).toBe(`${body.kind.toUpperCase()} FRAME`);
			}
		}
	});
});

describe("leaving a field's frame (#1139)", () => {
	const nose = v3(0, 0, 1);
	const coastingStepKms = (g: any) => {
		const before = { ...g.world.ship.vel };
		idleStepInOwnFrame(g, false, nose);
		return length(sub(g.world.ship.vel, before));
	};

	test("a rare field hands over to the star at the near layer's reach: the switch adds no impulse, and the assist then holds the star, as past a station", () => {
		for (const kind of [
			"belt",
			"trojan",
			"outer-orbit",
			"outer-trojan",
		] as const) {
			const { galaxy, system } = FIXTURES[kind];
			const g = subjectAt(galaxy, system);
			const plan = planOf(g, kind);
			const centre = fieldCentre(plan, 0);
			const vel = fieldCentreVelocity(plan, 0);
			placedAt(g, add(centre, scale(nose, NEAR_FAR_KM - 1)), vel);
			expect(g.assistFrame().label).toBe("FIELD FRAME");
			placedAt(g, add(centre, scale(nose, NEAR_FAR_KM + 1)), vel);
			expect(g.frameField).toBeNull();
			expect(g.assistFrame().label).toBe(
				g.frameBody ? `${g.frameBody.kind.toUpperCase()} FRAME` : "STAR FRAME",
			);
			expect(coastingStepKms(g)).toBeLessThan(1e-5);
			expect(length(sub(g.localFrame(), vel))).toBeGreaterThan(ASSIST_CAP_KMS);
		}
	});

	test("a charted field hands over to its refinery with no velocity to make up", () => {
		const { galaxy, system } = FIXTURES["refinery-orbit"];
		const g = subjectAt(galaxy, system);
		const plan = planOf(g, "refinery-orbit");
		const refinery = g.world.system.byId.get(plan.hostId);
		const centre = fieldCentre(plan, 0);
		const toward = normalizeOr(sub(refinery.pos, centre), nose);
		const midKm = length(sub(refinery.pos, centre)) / 2;
		const vel = fieldCentreVelocity(plan, 0);
		placedAt(g, add(centre, scale(toward, midKm - 0.01)), vel);
		expect(g.assistFrame().label).toBe("FIELD FRAME");
		const fieldVel = g.localFrame();
		placedAt(g, add(centre, scale(toward, midKm + 0.01)), vel);
		expect(g.assistFrame().label).toBe("STATION FRAME");
		expect(length(sub(g.localFrame(), fieldVel))).toBeLessThan(1e-3);
	});
});
