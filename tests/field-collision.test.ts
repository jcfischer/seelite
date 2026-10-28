import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as asteroidField from "../src/asteroid-field";
import {
	FIELD_PROFILE,
	type FieldPlan,
	type Rock,
	fieldCells,
	fieldCentre,
	fieldRocks,
	rockLocal,
	rockPose,
	rotateByQuat,
	systemFields,
} from "../src/asteroid-field";
import {
	mayMeet,
	reachKm as shipReachKm,
	shipPrimitives,
	solidReach,
} from "../src/collision";
import {
	archetypePieces,
	fieldRockSolids,
	prebuildRockPieces,
	rockFrameAt,
	rockId,
	rockSolid,
	setRockShapeSource,
} from "../src/field-collision";
import { ROCK_ARCHETYPES, rockArchetype, spinQuat } from "../src/field-lod";
import { decodeRockHeightfields } from "../src/rock-heightfields";
import { HULL_SPECS } from "../src/hull";
import { type RockPieces, envelopeAt } from "../src/rock-pieces";
import {
	type World,
	flightPerformance,
	makeWorldAtSystem,
	markShipPlaced,
	speedDemand,
	stepWorld,
} from "../src/sim";
import { add, length, scale, sub, v3 } from "../src/vec3";

const DT = 0.1;
const hull = shipPrimitives(HULL_SPECS.miner, false);
const perf = flightPerformance("miner");
const HULL_REACH_KM = shipReachKm(hull);
const attitude = { nose: v3(1, 0, 0), up: v3(0, 0, 1) };

function fieldWorld() {
	const world = makeWorldAtSystem(47, 0);
	const [plan] = systemFields(world.system.record, world.system.contents);
	const rocks = fieldRocks(world.system.record, plan);
	return { world, plan, rocks };
}

const biggest = (rocks: Rock[]): Rock =>
	rocks.reduce((a, b) => (b.radiusKm > a.radiusKm ? b : a));

function fly(world: World) {
	return stepWorld(
		world,
		{ ...attitude, rates: { pitch: 0, yaw: 0, roll: 0 } },
		{
			stick: { pitch: 0, yaw: 0, roll: 0 },
			turnAssist: false,
			translation: { demand: speedDemand(0), assist: false },
		},
		DT,
		perf,
		hull,
	);
}

function placeOnFace(
	world: World,
	plan: FieldPlan,
	rock: Rock,
	gapKm: number,
	closingKms: number,
) {
	const pose = rockFrameAt(plan, rock, world.gameTime);
	const e = envelopeAt(archetypePieces(rockArchetype(rock)), v3(0, 0, 1));
	const out = pose.z;
	world.ship.pos = add(pose.origin, scale(out, e * rock.radiusKm + gapKm));
	world.ship.vel = sub(
		rockPose(plan, rock, world.gameTime).vel,
		scale(out, closingKms),
	);
	return { out, pose };
}

describe("the flown ship against field rocks (node #969)", () => {
	test("a rock never leaves its lattice cell", () => {
		const { plan, rocks } = fieldWorld();
		const profile = FIELD_PROFILE[plan.profile];
		const cells = fieldCells(profile);
		for (const rock of rocks)
			for (let t = 0; t < 8 * 3600; t += 1731) {
				const local = rockLocal(rock, t);
				const cell = cells[rock.slot];
				for (const axis of ["x", "y", "z"] as const)
					expect(Math.abs(local[axis] - cell[axis])).toBeLessThanOrEqual(
						profile.cellKm / 2 - rock.radiusKm,
					);
			}
	});

	test("only rocks in cells within reach of the step are swept, and none a step can meet is missed", () => {
		const { world, plan, rocks } = fieldWorld();
		const clock = { fromTime: 1000, toTime: 1000 + DT };
		let rand = 12345;
		const next = () => (rand = (rand * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
		let swept = 0;
		let needed = 0;
		for (let n = 0; n < 40; n++) {
			const centre = rockPose(
				plan,
				rocks[Math.floor(next() * rocks.length)],
				1000,
			).pos;
			const start = add(
				centre,
				scale(v3(next() - 0.5, next() - 0.5, next() - 0.5), 0.2),
			);
			const end = add(
				start,
				scale(v3(next() - 0.5, next() - 0.5, next() - 0.5), 60 * DT),
			);
			const ship = { start, end, reachKm: HULL_REACH_KM };
			const got = fieldRockSolids(world.system, ship, clock);
			const ids = new Set(got.owner);
			const meets = rocks.filter((rock) => {
				const solid = rockSolid(plan, rock, clock);
				return mayMeet(ship, {
					start: solid.start.origin,
					end: solid.end.origin,
					reachKm: solidReach(solid),
				});
			});
			for (const rock of meets) expect(ids.has(rockId(plan, rock))).toBe(true);
			swept += got.owner.length;
			needed += meets.length;
			expect(got.owner.length).toBeLessThan(rocks.length / 4);
		}
		expect(needed).toBeGreaterThanOrEqual(15);
		expect(swept).toBeLessThanOrEqual(needed + 40 * 4);
	}, 60_000);

	test("a step far from every field sweeps no rock", () => {
		const { world } = fieldWorld();
		const far = {
			start: v3(1e9, 0, 0),
			end: v3(1e9, 1, 0),
			reachKm: HULL_REACH_KM,
		};
		expect(
			fieldRockSolids(world.system, far, { fromTime: 0, toTime: DT }).owner,
		).toEqual([]);
	});

	test("both ends of a rock's pose come from the clock, spin as the mesh is drawn", () => {
		const { plan, rocks } = fieldWorld();
		const rock = biggest(rocks);
		const clock = { fromTime: 4321, toTime: 4321.1 };
		const solid = rockSolid(plan, rock, clock);
		for (const [pose, vel, t] of [
			[solid.start, solid.velStart, clock.fromTime],
			[solid.end, solid.velEnd, clock.toTime],
		] as const) {
			const want = rockPose(plan, rock, t);
			expect(pose.origin).toEqual(want.pos);
			expect(vel).toEqual(want.vel);
			const q = (() => {
				const s = spinQuat(rock, want.spinAngle);
				const p = plan.rotation;
				return {
					w: p.w * s.w - p.x * s.x - p.y * s.y - p.z * s.z,
					x: p.w * s.x + p.x * s.w + p.y * s.z - p.z * s.y,
					y: p.w * s.y - p.x * s.z + p.y * s.w + p.z * s.x,
					z: p.w * s.z + p.x * s.y - p.y * s.x + p.z * s.w,
				};
			})();
			for (const [axis, e] of [
				[pose.x, v3(1, 0, 0)],
				[pose.y, v3(0, 1, 0)],
				[pose.z, v3(0, 0, 1)],
			] as const) {
				const drawn = rotateByQuat(q, e);
				expect(length(sub(axis, drawn))).toBeLessThan(1e-12);
			}
		}
		expect(length(sub(solid.end.origin, solid.start.origin))).toBeGreaterThan(
			0,
		);
	});

	test("an impact at a rock face names the rock and reads the closing speed in its frame", () => {
		const { world, plan, rocks } = fieldWorld();
		const rock = biggest(rocks);
		placeOnFace(world, plan, rock, 0.3, 0.5);
		expect(length(world.ship.vel)).toBeGreaterThan(5);
		let hit: ReturnType<typeof fly>["impacts"][number] | undefined;
		world.rockPlacement = { placed: false, rocks: new Set() };
		for (let i = 0; i < 40 && !hit; i++) hit = fly(world).impacts[0];
		expect(hit).toBeDefined();
		expect(hit!.bodyId).toBe(rockId(plan, rock));
		expect(hit!.closingKms).toBeGreaterThan(0.2);
		expect(hit!.closingKms).toBeLessThan(0.6);
	});

	test("stepWorld meets a field rock on the deployed cutter before the stowed hull", () => {
		const impact = (deployed: boolean) => {
			const { world, plan, rocks } = fieldWorld();
			const rock = biggest(rocks);
			const { pose, out } = placeOnFace(world, plan, rock, 0.15, 2);
			world.rockPlacement = { placed: false, rocks: new Set() };
			const step = stepWorld(
				world,
				{
					nose: scale(out, -1),
					up: pose.y,
					rates: { pitch: 0, yaw: 0, roll: 0 },
				},
				{
					stick: { pitch: 0, yaw: 0, roll: 0 },
					turnAssist: false,
					translation: { demand: speedDemand(0), assist: false },
				},
				DT,
				perf,
				shipPrimitives(HULL_SPECS.miner, deployed),
			);
			expect(step.ghosts).toEqual([]);
			expect(step.impacts).toHaveLength(1);
			expect(step.impacts[0].bodyId).toBe(rockId(plan, rock));
			return step.impacts[0];
		};
		const cutter = impact(true);
		const stowed = impact(false);
		expect(cutter.part).toBe("cutter");
		expect(stowed.part).toBe("hull");
		expect(cutter.timeS).toBeLessThan(stowed.timeS - 0.001);
	});

	test("pressed against a spinning rock, the ship rides it without sinking or jitter", () => {
		const { world, plan, rocks } = fieldWorld();
		const rock = biggest(rocks);
		placeOnFace(world, plan, rock, 0.2, 0.04);
		world.rockPlacement = { placed: false, rocks: new Set() };
		let landed = false;
		for (let i = 0; i < 200 && !landed; i++)
			landed = fly(world).impacts.length > 0;
		expect(landed).toBe(true);
		const offset = () =>
			sub(world.ship.pos, rockPose(plan, rock, world.gameTime).pos);
		let last = offset();
		let contacts = 0;
		for (let i = 0; i < 300; i++) {
			const inward = scale(offset(), -1 / length(offset()));
			world.ship.vel = add(
				rockPose(plan, rock, world.gameTime).vel,
				scale(inward, 0.01),
			);
			const step = fly(world);
			expect(step.ghosts).toEqual([]);
			for (const impact of step.impacts) {
				expect(impact.bodyId).toBe(rockId(plan, rock));
				expect(impact.damage).toBe(0);
				contacts++;
			}
			const now = offset();
			expect(length(sub(now, last))).toBeLessThan(0.003);
			expect(length(now)).toBeGreaterThan(rock.radiusKm * 0.3);
			last = now;
		}
		expect(contacts).toBeGreaterThan(250);
	});

	test("a ship placed inside a rock ghosts the whole rock and flies out", () => {
		const { world, plan, rocks } = fieldWorld();
		const rock = biggest(rocks);
		const here = rockPose(plan, rock, world.gameTime);
		world.ship.pos = add(
			here.pos,
			scale(rockFrameAt(plan, rock, world.gameTime).x, 0.05),
		);
		world.ship.vel = add(here.vel, v3(0, 0, 0.05));
		markShipPlaced(world);
		let ghosted = 0;
		for (let i = 0; i < 400; i++) {
			const step = fly(world);
			expect(step.impacts).toEqual([]);
			ghosted += Number(step.ghosts.includes(rockId(plan, rock)));
			if (
				length(sub(world.ship.pos, rockPose(plan, rock, world.gameTime).pos)) >
				rock.radiusKm * 2 + 0.2
			)
				break;
		}
		expect(ghosted).toBeGreaterThan(0);
		expect(
			length(sub(world.ship.pos, rockPose(plan, rock, world.gameTime).pos)),
		).toBeGreaterThan(rock.radiusKm * 2);
	});

	test("a prebuild skips what a tick built, keeps what a tick builds meanwhile, and drops results once the shapes are swapped", async () => {
		const decoded = decodeRockHeightfields(
			new Uint8Array(readFileSync("src/models/rock-heightfields.bin")),
		);
		const built = (archetype: number) =>
			({ archetype }) as unknown as RockPieces;
		try {
			setRockShapeSource(() => decoded);
			const first = archetypePieces(0);
			const asked: number[] = [];
			let tickBuilt: RockPieces | undefined;
			await prebuildRockPieces(async (archetype) => {
				asked.push(archetype);
				if (archetype === 3) tickBuilt = archetypePieces(3);
				return built(archetype);
			});
			expect(asked).toEqual(
				Array.from({ length: ROCK_ARCHETYPES - 1 }, (_, i) => i + 1),
			);
			expect(archetypePieces(0)).toBe(first);
			expect(archetypePieces(3)).toBe(tickBuilt as RockPieces);
			expect(archetypePieces(5)).toEqual(built(5));

			setRockShapeSource(() => decoded);
			const late: number[] = [];
			await prebuildRockPieces(async (archetype) => {
				late.push(archetype);
				if (archetype === 2) setRockShapeSource(() => decoded);
				return built(archetype);
			});
			expect(late).toEqual([0, 1, 2]);
			expect(archetypePieces(2)).not.toEqual(built(2));
		} finally {
			setRockShapeSource(() => decoded);
		}
	}, 30_000);

	test("each rock's id names its field and slot, so no two rocks share an owner", () => {
		const { plan, rocks } = fieldWorld();
		expect(rockId({ id: "field-00" }, { slot: 17 })).toBe("field-00:rock-17");
		expect(new Set(rocks.map((rock) => rockId(plan, rock))).size).toBe(
			rocks.length,
		);
	});

	test("a repeated field query reuses its system plans and rock lattice", () => {
		const { world, plan, rocks } = fieldWorld();
		const record = world.system.record;
		let reads = 0;
		Object.defineProperty(world.system, "record", {
			get: () => {
				reads++;
				return record;
			},
		});
		const rock = biggest(rocks);
		const clock = { fromTime: world.gameTime, toTime: world.gameTime + DT };
		const ship = {
			start: rockPose(plan, rock, clock.fromTime).pos,
			end: rockPose(plan, rock, clock.toTime).pos,
			reachKm: HULL_REACH_KM,
		};
		const first = fieldRockSolids(world.system, ship, clock);
		expect(first.owner).toContain(rockId(plan, rock));
		expect(reads).toBeGreaterThan(0);
		const before = reads;
		expect(fieldRockSolids(world.system, ship, clock)).toEqual(first);
		expect(reads).toBe(before);
	});

	test("a step inside one occupied cell poses only that cell's rock", () => {
		const { world, plan, rocks } = fieldWorld();
		const cells = fieldCells(FIELD_PROFILE[plan.profile]);
		const rock = rocks.reduce((a, b) =>
			length(cells[b.slot]) < length(cells[a.slot]) ? b : a,
		);
		const clock = { fromTime: world.gameTime, toTime: world.gameTime + DT };
		const centreAt = (time: number) =>
			add(
				fieldCentre(plan, time),
				rotateByQuat(plan.rotation, cells[rock.slot]),
			);
		const ship = {
			start: centreAt(clock.fromTime),
			end: centreAt(clock.toTime),
			reachKm: HULL_REACH_KM,
		};
		const pose = spyOn(asteroidField, "rockPose");
		try {
			fieldRockSolids(world.system, ship, clock);
			expect(pose.mock.calls.map(([p, r, t]) => [p.id, r.slot, t])).toEqual([
				[plan.id, rock.slot, clock.fromTime],
				[plan.id, rock.slot, clock.toTime],
			]);
		} finally {
			pose.mockRestore();
		}
	});
});
