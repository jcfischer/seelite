import { describe, expect, test } from "bun:test";
import {
	shipPose,
	shipPrimitives,
	sweepShip,
	type SolidMotion,
	type SweepOptions,
} from "../src/collision";
import { HULL_SPECS } from "../src/hull";
import { buildRockPieces } from "../src/rock-pieces";
import {
	flightPerformance,
	jumpWorldTo,
	makeWorld,
	markShipPlaced,
	resetWorldToStart,
	restoreWorld,
	speedDemand,
	stepWorld,
} from "../src/sim";
import { add, length, scale, sub, v3, type Vec3 } from "../src/vec3";
import { DT, solid } from "./fixtures/rock-sweep";

const rock = solid(
	buildRockPieces({ res: 64, r: new Float32Array(6 * 64 * 64).fill(0.8) }),
	0.4,
);
const primitives = shipPrimitives(HULL_SPECS.miner, false);
function motion(a: Vec3, b: Vec3): SolidMotion {
	const vel = scale(sub(b, a), 1 / DT);
	return {
		primitives,
		start: shipPose(a, v3(1, 0, 0), v3(0, 0, 1)),
		end: shipPose(b, v3(1, 0, 0), v3(0, 0, 1)),
		velStart: vel,
		velEnd: vel,
	};
}

describe("placement-gated rock ghosts (node #960)", () => {
	test("G1 a placed half-inside ship slides out across pieces without impact, then meets the rock on re-entry", () => {
		let pos = v3(0, 0, 0.32);
		let options: SweepOptions = { placed: true };
		let ghostSteps = 0;
		for (let i = 0; i < 30; i++) {
			const end = add(pos, v3(0.02, 0, 0));
			const result = sweepShip(motion(pos, end), [rock], DT, options);
			expect(result.impacts).toEqual([]);
			expect(result.pos).toEqual(end);
			ghostSteps += Number(result.rockGhosts.length > 0);
			options = { rockGhosts: result.rockGhosts };
			pos = result.pos;
		}
		expect(ghostSteps).toBeGreaterThan(1);
		expect(options.rockGhosts).toEqual([]);
		const back = sweepShip(motion(pos, v3(0, 0, 0.32)), [rock], DT, options);
		expect(back.impacts).toHaveLength(1);
		expect(back.rockGhosts).toEqual([]);
	});

	test("G2 an unplaced 1mm overlap pressed in at 1m/s stays within 0.2m", () => {
		const approach = motion(v3(0, 0, 0.4), v3(0, 0, 0.3));
		const hit = sweepShip(approach, [rock], DT);
		expect(hit.impacts).toHaveLength(1);
		const normal = hit.impacts[0].normal;
		let clear = hit.pos;
		let overlap = sub(hit.pos, scale(normal, 0.001));
		for (let i = 0; i < 32; i++) {
			const mid = scale(add(clear, overlap), 0.5);
			if (sweepShip(motion(mid, mid), [rock], DT).ghosts.length > 0)
				overlap = mid;
			else clear = mid;
		}
		const inside = sub(clear, scale(normal, 0.000001));
		expect(sweepShip(motion(inside, inside), [rock], DT).ghosts).toEqual([0]);
		let pos = inside;
		for (let i = 0; i < 300; i++) {
			const end = sub(pos, scale(normal, 0.001 * DT));
			const result = sweepShip(motion(pos, end), [rock], DT);
			expect(result.rockGhosts).toEqual([]);
			pos = result.pos;
			expect(length(sub(pos, inside))).toBeLessThanOrEqual(0.0002);
		}
	});

	test("a placement outside the rock cannot arm a later overlap", () => {
		const first = sweepShip(motion(v3(0, 0, 0.5), v3(0, 0, 0.45)), [rock], DT, {
			placed: true,
		});
		expect(first.rockGhosts).toEqual([]);
		const next = sweepShip(motion(first.pos, v3(0, 0, 0.2)), [rock], DT, {
			rockGhosts: first.rockGhosts,
		});
		expect(next.impacts).toHaveLength(1);
	});

	test("a whole-rock ghost still meets other solids", () => {
		const other: SolidMotion = {
			...motion(v3(), v3()),
			start: rock.start,
			end: rock.end,
			primitives: [
				{ kind: "sphere", radiusKm: 0.01, centre: v3(0.1, 0, 0.32) },
			],
		};
		const result = sweepShip(
			motion(v3(0, 0, 0.32), v3(0.2, 0, 0.32)),
			[rock, other],
			DT,
			{ placed: true },
		);
		expect(result.rockGhosts).toEqual([0]);
		expect(result.impacts).toHaveLength(1);
		expect(result.impacts[0].solid).toBe(1);
	});

	test("a cutter-only placement overlap ghosts the whole rock", () => {
		const ship = motion(v3(0, 0, 0.4), v3(0.02, 0, 0.4));
		const cutter = {
			...primitives[0],
			centre: v3(0, -0.1, 0),
			part: "cutter" as const,
		};
		expect(sweepShip(ship, [rock], DT).ghosts).toEqual([]);
		ship.primitives = [...primitives, cutter];
		const result = sweepShip(ship, [rock], DT, { placed: true });
		expect(result.rockGhosts).toEqual([0]);
		expect(result.impacts).toEqual([]);
		expect(result.pos).toEqual(ship.end.origin);
	});

	test("initial placement survives Ship replacement, restore and reset; explicit placement rearms it", () => {
		for (const world of [makeWorld(47), restoreWorld(47, 0, 17, 123)]) {
			const run = (id: string) => {
				const at = motion(world.ship.pos, world.ship.pos);
				return stepWorld(
					world,
					{
						nose: v3(1, 0, 0),
						up: v3(0, 0, 1),
						rates: { pitch: 0, yaw: 0, roll: 0 },
					},
					{
						stick: { pitch: 0, yaw: 0, roll: 0 },
						turnAssist: false,
						translation: { demand: speedDemand(0), assist: false },
					},
					DT,
					flightPerformance("miner"),
					primitives,
					[],
					[],
					[
						{
							id,
							motion: {
								...rock,
								start: {
									...rock.start,
									origin: sub(at.start.origin, v3(0, 0, 0.32)),
								},
								end: {
									...rock.end,
									origin: sub(at.start.origin, v3(0, 0, 0.32)),
								},
							},
						},
					],
				);
			};
			const savedShape = JSON.stringify(world.ship);
			world.ship = { pos: { ...world.ship.pos }, vel: { ...world.ship.vel } };
			expect(run("first").impacts).toEqual([]);
			expect(JSON.stringify(world.ship)).toBe(savedShape);
			world.ship = { ...world.ship };
			world.ship.vel = v3(0.1, 0, 0);
			expect(run("first").impacts).toEqual([]);
			expect(run("new-rock").impacts.length).toBeGreaterThan(0);
			markShipPlaced(world);
			expect(run("new-rock").impacts).toEqual([]);
			resetWorldToStart(world);
			world.ship.vel = v3(0.1, 0, 0);
			expect(run("reset-rock").impacts).toEqual([]);
			jumpWorldTo(
				world,
				world.galaxy.systems[(world.system.record.index + 1) % 256],
			);
			world.ship.vel = v3(0.1, 0, 0);
			expect(run("arrival-rock").impacts).toEqual([]);
		}
	});
});
