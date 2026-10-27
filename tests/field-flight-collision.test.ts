import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
	type FieldPlan,
	type Rock,
	fieldRocks,
	rockPose,
	systemFields,
} from "../src/asteroid-field";
import {
	shipPose,
	sweepShip,
	reachKm as shipReachKm,
	shipPrimitives,
} from "../src/collision";
import {
	archetypePieces,
	fieldRockSolids,
	prebuildRockPieces,
	rockFrameAt,
	rockSolid,
	setRockShapeSource,
} from "../src/field-collision";
import { rockArchetype } from "../src/field-lod";
import { decodeRockHeightfields } from "../src/rock-heightfields";
import { HULL_SPECS } from "../src/hull";
import { buildRockPieces, envelopeAt } from "../src/rock-pieces";
import { rockPiecesThread } from "../src/rock-pieces-thread";
import {
	type World,
	flightPerformance,
	makeWorldAtSystem,
	speedDemand,
	stepWorld,
} from "../src/sim";
import { type Vec3, add, length, scale, sub, v3 } from "../src/vec3";

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
	test("pieces built on a worker match the main thread's, stall it less than half as long as an inline build, and leave a tick nothing to build", async () => {
		const decoded = decodeRockHeightfields(
			new Uint8Array(readFileSync("src/models/rock-heightfields.bin")),
		);
		let reads = 0;
		const countingSource = () => {
			reads++;
			return decoded;
		};
		const longestStallMs = async (work: () => Promise<void>) => {
			let last = performance.now();
			let longest = 0;
			const beat = setInterval(() => {
				const now = performance.now();
				longest = Math.max(longest, now - last);
				last = now;
			}, 2);
			await work();
			clearInterval(beat);
			return Math.max(longest, performance.now() - last);
		};
		try {
			setRockShapeSource(countingSource);
			const inline = await longestStallMs(() =>
				prebuildRockPieces(async (archetype, field) => {
					if (archetype >= 2) throw new Error("control arm stops at two");
					return buildRockPieces(field);
				}).catch(() => {}),
			);
			setRockShapeSource(countingSource);
			const { world, plan, rocks } = fieldWorld();
			const rock = biggest(rocks);
			const thread = rockPiecesThread();
			const offThread = await longestStallMs(() =>
				prebuildRockPieces(thread.build).finally(thread.close),
			);
			console.log(
				`longest main-thread stall: ${inline.toFixed(0)} ms building inline, ${offThread.toFixed(0)} ms on the worker`,
			);
			expect(inline).toBeGreaterThan(100);
			expect(offThread).toBeLessThan(inline / 2);
			const before = reads;
			const archetype = rockArchetype(rock);
			expect(archetypePieces(archetype)).toEqual(
				buildRockPieces(decoded.fields[archetype], {
					label: `archetype ${archetype}`,
				}),
			);
			placeOnFace(world, plan, rock, 0.3, 0.5);
			world.rockPlacement = { placed: false, rocks: new Set() };
			let impacts = 0;
			for (let i = 0; i < 40 && impacts === 0; i++)
				impacts = fly(world).impacts.length;
			expect([impacts > 0, reads - before]).toEqual([true, 0]);
		} finally {
			setRockShapeSource(() => decoded);
		}
	}, 30_000);

	test("collision cost stays within #956's 0.71 ms per rock in reach, and the reach set adds almost none", () => {
		if (process.env.SEELITE_FIELD_COST_RUN !== "isolated") {
			const measured = spawnSync(
				process.execPath,
				[
					"test",
					import.meta.path,
					"--test-name-pattern",
					"collision cost stays",
				],
				{
					env: { ...process.env, SEELITE_FIELD_COST_RUN: "isolated" },
					encoding: "utf8",
					timeout: 25_000,
				},
			);
			process.stdout.write(measured.stdout);
			process.stderr.write(measured.stderr);
			if (measured.error) throw measured.error;
			expect(measured.status).toBe(0);
			return;
		}
		const { world, plan, rocks } = fieldWorld();
		const rock = biggest(rocks);
		const t = world.gameTime;
		const clock = { fromTime: t, toTime: t + DT };
		placeOnFace(world, plan, rock, 0.15, 2);
		const start = { ...world.ship.pos };
		const vel = { ...world.ship.vel };
		const end = add(start, scale(vel, DT));
		const ship = { start, end, reachKm: HULL_REACH_KM };
		const reached = fieldRockSolids(world.system, ship, clock).owner.length;
		expect(reached).toBe(1);
		const solid = rockSolid(plan, rock, clock);
		const motion = {
			primitives: hull,
			start: shipPose(start, attitude.nose, attitude.up),
			end: shipPose(end, attitude.nose, attitude.up),
			velStart: vel,
			velEnd: vel,
		};
		expect(sweepShip(motion, [solid], DT).impacts.length).toBeGreaterThan(0);
		const tick = (offset: Vec3) => () => {
			world.gameTime = t;
			world.ship.pos = add(start, offset);
			world.ship.vel = { ...vel };
			world.rockPlacement = { placed: false, rocks: new Set() };
			return fly(world);
		};
		const inFieldTick = tick(v3());
		const awayTick = tick(v3(1e6, 0, 0));
		const workloads = {
			query: () => fieldRockSolids(world.system, ship, clock).owner.length,
			sweep: () => sweepShip(motion, [solid], DT).impacts.length,
			inField: () => inFieldTick().impacts.length,
			away: () => awayTick().impacts.length,
		};
		const times: Record<keyof typeof workloads, number[]> = {
			query: [],
			sweep: [],
			inField: [],
			away: [],
		};
		const names = ["query", "sweep", "inField", "away"] as const;
		for (const name of names) for (let i = 0; i < 20; i++) workloads[name]();
		for (let batch = 0; batch < 7; batch++)
			for (const name of names) {
				let work = 0;
				const t0 = performance.now();
				for (let i = 0; i < 50; i++) work += workloads[name]();
				times[name].push((performance.now() - t0) / 50);
				expect(work).toBe(name === "away" ? 0 : 50);
			}
		const fastestMs = (name: keyof typeof workloads): number => {
			const sorted = [...times[name]].sort((a, b) => a - b);
			console.log(
				`host CPU ${name}, ${name === "away" ? 0 : reached} rock in reach: fastest batch ${sorted[0].toFixed(3)} ms/tick, median ${sorted[3].toFixed(3)}, slowest ${sorted[6].toFixed(3)}, 7 interleaved batches × 50 ticks`,
			);
			return sorted[0];
		};
		const query = fastestMs("query");
		const sweep = fastestMs("sweep");
		const inField = fastestMs("inField");
		const away = fastestMs("away");
		expect(query).toBeLessThan(0.05);
		expect(inField - away).toBeLessThanOrEqual(2 * sweep + 0.15);
		const perRock = (inField - away) / reached;
		if (process.env.CI)
			console.log(
				`CI runner: ${perRock.toFixed(3)} ms per rock in reach, logged; #956's 0.71 ms budget is a figure of the hardware machine and is held only there`,
			);
		else expect(perRock).toBeLessThanOrEqual(0.71);
	}, 30_000);
});
