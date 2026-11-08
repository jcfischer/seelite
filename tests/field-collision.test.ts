import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as asteroidField from "../src/asteroid-field";
import {
	FIELD_EXTENT_KM,
	fieldCentre,
	fieldRocks,
	type Rock,
	rockLocal,
	rockPose,
	rotateByQuat,
	systemFields,
} from "../src/asteroid-field";
import { mayMeet, shipPrimitives, solidReach } from "../src/collision";
import {
	archetypePieces,
	fieldRockSolids,
	prebuildRockPieces,
	ROCK_BUCKET_KM,
	rockFrameAt,
	rockId,
	rockSolid,
	setRockShapeSource,
} from "../src/field-collision";
import { ROCK_ARCHETYPES, spinQuat } from "../src/field-lod";
import { HULL_SPECS } from "../src/hull";
import { decodeRockHeightfields } from "../src/rock-heightfields";
import type { RockPieces } from "../src/rock-pieces";
import {
	makeWorldAtSystem,
	markShipPlaced,
	speedDemand,
	stepWorld,
} from "../src/sim";
import { add, length, scale, sub, v3 } from "../src/vec3";
import {
	biggest,
	DT,
	fieldWorld,
	fly,
	HULL_REACH_KM,
	perf,
	placeOnFace,
} from "./lib/field-rock-fixtures";

describe("the flown ship against field rocks (node #969)", () => {
	test("a rock stays within its drift of its anchor at every clock", () => {
		const { rocks } = fieldWorld();
		for (const rock of rocks)
			for (let t = 0; t < 8 * 3600; t += 1731)
				expect(
					length(sub(rockLocal(rock, t), rock.anchor)),
				).toBeLessThanOrEqual(rock.driftKm + 1e-9);
	});

	test("only rocks in buckets within reach of the step are swept, and none a step can meet is missed", () => {
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

	test("a bucket holds several rocks, and a step reaching one reaches them all", () => {
		const { world, plan, rocks } = fieldWorld();
		const clock = { fromTime: world.gameTime, toTime: world.gameTime + DT };
		const bucketOf = (rock: Rock) =>
			[rock.anchor.x, rock.anchor.y, rock.anchor.z]
				.map((v) => Math.floor(v / ROCK_BUCKET_KM))
				.join();
		const sharers = new Map<string, Rock[]>();
		for (const rock of rocks)
			sharers.set(bucketOf(rock), [
				...(sharers.get(bucketOf(rock)) ?? []),
				rock,
			]);
		const crowded = [...sharers.values()].sort(
			(p, q) => q.length - p.length,
		)[0];
		expect(crowded.length).toBeGreaterThan(1);
		for (const rock of crowded) {
			const at = rockPose(plan, rock, clock.fromTime).pos;
			const got = fieldRockSolids(
				world.system,
				{ start: at, end: at, reachKm: HULL_REACH_KM },
				clock,
			);
			expect(got.owner).toContain(rockId(plan, rock));
		}
	});

	test("a high-speed crossing of the whole field, on both profiles, finds what a full traversal finds", () => {
		let crossed = 0;
		for (const profile of ["charted", "rare"] as const) {
			const found = [47, 0x5ee11e].flatMap((seed) =>
				Array.from({ length: 64 }, (_, index) => {
					const world = makeWorldAtSystem(seed, index);
					const plan = systemFields(
						world.system.record,
						world.system.contents,
					).find((f) => f.profile === profile);
					return plan ? { world, plan } : [];
				}).flat(),
			)[0];
			const { world, plan } = found;
			const rocks = fieldRocks(world.system.record, plan);
			const clock = { fromTime: 2000, toTime: 2000 + DT };
			for (const rock of rocks.slice(0, 24)) {
				const at = rockPose(plan, rock, clock.fromTime).pos;
				const toCentre = sub(fieldCentre(plan, clock.fromTime), at);
				const clear = (2 * FIELD_EXTENT_KM[profile] + 10) / length(toCentre);
				const ship = {
					start: add(at, scale(toCentre, -clear)),
					end: add(
						rockPose(plan, rock, clock.toTime).pos,
						scale(toCentre, clear),
					),
					reachKm: HULL_REACH_KM,
				};
				expect(length(sub(ship.start, ship.end))).toBeGreaterThan(
					2 * FIELD_EXTENT_KM[profile],
				);
				const got = fieldRockSolids(world.system, ship, clock);
				const owners = (others: readonly Rock[]) =>
					others
						.filter((other) => {
							const solid = rockSolid(plan, other, clock);
							return mayMeet(ship, {
								start: solid.start.origin,
								end: solid.end.origin,
								reachKm: solidReach(solid),
							});
						})
						.map((other) => rockId(plan, other));
				const expected = owners(rocks);
				expect(got.owner).toEqual(expected);
				expect(expected).toContain(rockId(plan, rock));
				crossed += expected.length;
			}
		}
		expect(crossed).toBeGreaterThan(48);
	}, 60_000);

	test("flown in steps through the densest cluster, a ship aimed at a rock strikes a rock at every speed", () => {
		const { world, plan, rocks } = fieldWorld();
		const near = (rock: Rock) =>
			rocks.filter((o) => length(sub(rock.anchor, o.anchor)) < 8).length;
		const peak = rocks.reduce((a, b) => (near(b) > near(a) ? b : a));
		expect(near(peak)).toBeGreaterThan(80);
		const t0 = world.gameTime;
		for (const closingKms of [0.2, 2, 20, 200]) {
			world.gameTime = t0;
			const here = rockPose(plan, peak, t0);
			const from = v3(1, 0, 0);
			const standoff = peak.radiusKm + Math.max(1.5, closingKms * DT * 3);
			world.ship.pos = add(here.pos, scale(from, standoff));
			world.ship.vel = sub(here.vel, scale(from, closingKms));
			world.rockPlacement = { placed: false, rocks: new Set() };
			let struck: string | undefined;
			for (let i = 0; i < 200 && !struck; i++)
				struck = fly(world).impacts.find((hit) =>
					hit.bodyId.startsWith(`${plan.id}:rock-`),
				)?.bodyId;
			expect(struck).toBeDefined();
		}
	});

	test("a ship left inside a moved rock by an older save ghosts it, and strikes nothing on the way out", () => {
		const { world, plan, rocks } = fieldWorld();
		const rock = biggest(rocks);
		const here = rockPose(plan, rock, world.gameTime);
		world.ship.pos = here.pos;
		world.ship.vel = add(here.vel, v3(0, 0, 0.1));
		markShipPlaced(world);
		const ghosted = new Set<string>();
		for (let i = 0; i < 120; i++) {
			const step = fly(world);
			for (const id of step.ghosts) ghosted.add(id);
			expect(step.impacts.map((hit) => hit.bodyId)).not.toContain(
				rockId(plan, rock),
			);
		}
		expect(ghosted.has(rockId(plan, rock))).toBe(true);
	});

	test("a step poses only the rocks in buckets its reach names", () => {
		const { world, plan, rocks } = fieldWorld();
		const rock = rocks[Math.floor(rocks.length / 2)];
		const clock = { fromTime: world.gameTime, toTime: world.gameTime + DT };
		const at = rockPose(plan, rock, clock.fromTime).pos;
		const ship = { start: at, end: at, reachKm: HULL_REACH_KM };
		const pose = spyOn(asteroidField, "rockPose");
		try {
			fieldRockSolids(world.system, ship, clock);
			const posed = new Set(pose.mock.calls.map(([, r]) => r.slot));
			expect(posed.has(rock.slot)).toBe(true);
			expect(posed.size).toBeLessThan(rocks.length / 8);
			const envelope = Math.max(...rocks.map((r) => r.radiusKm + r.driftKm));
			const named = HULL_REACH_KM + envelope + 2 * ROCK_BUCKET_KM + 0.1;
			const local = rockLocal(rock, clock.fromTime);
			for (const other of rocks)
				if (posed.has(other.slot))
					for (const axis of ["x", "y", "z"] as const)
						expect(
							Math.abs(other.anchor[axis] - local[axis]),
						).toBeLessThanOrEqual(named);
		} finally {
			pose.mockRestore();
		}
	});
});
