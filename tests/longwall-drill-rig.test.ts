import { describe, expect, test } from "bun:test";
import {
	anchorAssembly,
	anchorPose,
	MINING,
	rockContactZ,
} from "../src/longwall-drill-rig";

type V = [number, number, number];
const SIGNS = [
	{ index: 0, sx: -1, sy: 1 },
	{ index: 1, sx: 1, sy: 1 },
	{ index: 2, sx: -1, sy: -1 },
	{ index: 3, sx: 1, sy: -1 },
];
const dist = (a: readonly number[], b: readonly number[]) =>
	Math.hypot(...a.map((n, i) => n - b[i]));
const norm = (v: readonly number[]) => Math.hypot(...v);

describe("rockContactZ", () => {
	test("the cutting seat inside seven metres of the cutter axis is level", () => {
		expect(rockContactZ(5, MINING.cutterY)).toBe(MINING.rockZ);
		expect(rockContactZ(-4, MINING.cutterY + 5)).toBe(MINING.rockZ);
	});

	test("beyond twelve metres the facet slopes 0.75 m per metre of x", () => {
		expect(rockContactZ(17, MINING.cutterY + 14)).toBeCloseTo(
			MINING.rockZ - 0.75 * 17,
			9,
		);
		expect(rockContactZ(-17, MINING.cutterY - 14)).toBeCloseTo(
			MINING.rockZ + 0.75 * 17,
			9,
		);
	});

	test("between seat and slope the blend is the smoothstep of (r - 7) / 5", () => {
		expect(
			rockContactZ(8, MINING.cutterY + Math.sqrt(9.5 ** 2 - 8 ** 2)),
		).toBeCloseTo(MINING.rockZ - 0.75 * 8 * 0.5, 9);
		const t = 0.2;
		const smooth = t * t * (3 - 2 * t);
		expect(
			rockContactZ(6, MINING.cutterY + Math.sqrt(8 ** 2 - 6 ** 2)),
		).toBeCloseTo(MINING.rockZ - 0.75 * 6 * smooth, 9);
	});

	test("distance is measured from the cutter axis, above and below it alike", () => {
		expect(rockContactZ(9, MINING.cutterY + 9)).toBeCloseTo(
			rockContactZ(9, MINING.cutterY - 9),
			9,
		);
	});
});

describe("anchorPose", () => {
	test("rejects an anchor that does not exist", () => {
		for (const bad of [-1, 4, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => anchorPose(bad, 0)).toThrow("Unknown anchor");
	});

	test("rejects a deployment that is not a number", () => {
		for (const bad of [Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => anchorPose(0, bad)).toThrow("Non-finite pose");
	});

	test("deployment clamps to the mechanical stops", () => {
		expect(anchorPose(1, -3)).toEqual(anchorPose(1, 0));
		expect(anchorPose(1, 7)).toEqual(anchorPose(1, 1));
	});

	test("each anchor sits in its own corner, stowed and deployed", () => {
		for (const { index, sx, sy } of SIGNS) {
			const stowed = anchorPose(index, 0);
			const deployed = anchorPose(index, 1);
			expect(stowed.base).toEqual([sx * 6, sy * 2, 13]);
			expect(deployed.base).toEqual(stowed.base);
			expect(stowed.foot[0]).toBeCloseTo(sx * 8, 9);
			expect(stowed.foot[1]).toBeCloseTo(sy * 3, 9);
			expect(stowed.foot[2]).toBeCloseTo(-5, 9);
			const y = MINING.cutterY + sy * 14;
			expect(deployed.foot).toEqual([sx * 17, y, rockContactZ(sx * 17, y)]);
		}
	});

	test("a given target replaces the fixture deployed foot but not the stowed one", () => {
		const target: V = [11, 3, 40];
		expect(anchorPose(1, 1, target).foot).toEqual(target);
		expect(anchorPose(1, 0, target).foot).toEqual(anchorPose(1, 0).foot);
		const mid = anchorPose(1, 0.5, target);
		const fixture = anchorPose(1, 0.5);
		expect(mid.foot).not.toEqual(fixture.foot);
		const aim = [11 - 6, 3 - 2, 40 - 13];
		const dir = [
			aim[0] / norm(aim) + (8 - 6) / norm([2, 1, -18]),
			aim[1] / norm(aim) + (3 - 2) / norm([2, 1, -18]),
			aim[2] / norm(aim) + (-5 - 13) / norm([2, 1, -18]),
		];
		const n = norm(dir);
		expect(mid.direction[0]).toBeCloseTo(dir[0] / n, 9);
		expect(mid.direction[1]).toBeCloseTo(dir[1] / n, 9);
		expect(mid.direction[2]).toBeCloseTo(dir[2] / n, 9);
	});

	test("length runs linearly from stowed to deployed reach", () => {
		for (const { index } of SIGNS) {
			const la = dist(anchorPose(index, 0).foot, anchorPose(index, 0).base);
			const lb = dist(anchorPose(index, 1).foot, anchorPose(index, 1).base);
			expect(anchorPose(index, 0).length).toBeCloseTo(la, 9);
			expect(anchorPose(index, 1).length).toBeCloseTo(lb, 9);
			for (const t of [0.25, 0.5, 0.9])
				expect(anchorPose(index, t).length).toBeCloseTo(la + (lb - la) * t, 9);
		}
	});

	test("midway the direction blends the two unit directions and the foot follows it", () => {
		for (const { index } of SIGNS) {
			const s = anchorPose(index, 0);
			const d = anchorPose(index, 1);
			const unit = (p: typeof s) =>
				p.foot.map(
					(n, i) => (n - p.base[i]) / norm(p.foot.map((m, k) => m - p.base[k])),
				);
			const us = unit(s);
			const ud = unit(d);
			for (const t of [0.25, 0.5, 0.75]) {
				const blend = us.map((n, i) => n * (1 - t) + ud[i] * t);
				const k = norm(blend);
				const p = anchorPose(index, t);
				expect(norm(p.direction)).toBeCloseTo(1, 9);
				for (let i = 0; i < 3; i++) {
					expect(p.direction[i]).toBeCloseTo(blend[i] / k, 9);
					expect(p.foot[i]).toBeCloseTo(
						p.base[i] + p.direction[i] * p.length,
						9,
					);
				}
			}
		}
	});
});

describe("anchorAssembly", () => {
	test("the elbow is 48% along the strut, kicked outward and along the corner's side by deployment", () => {
		for (const { index, sx, sy } of SIGNS) {
			for (const t of [0, 0.5, 1]) {
				const a = anchorAssembly(index, t);
				const p = anchorPose(index, t);
				expect(a.base).toEqual(p.base);
				expect(a.foot).toEqual(p.foot);
				const expected = [
					p.base[0] + (p.foot[0] - p.base[0]) * 0.48 + sx * 5 * t,
					p.base[1] + (p.foot[1] - p.base[1]) * 0.48 + sy * 3 * t,
					p.base[2] + (p.foot[2] - p.base[2]) * 0.48,
				];
				for (let i = 0; i < 3; i++)
					expect(a.elbow[i]).toBeCloseTo(expected[i], 9);
				expect(a.upperLength).toBeCloseTo(dist(a.elbow, a.base), 9);
				expect(a.lowerLength).toBeCloseTo(dist(a.foot, a.elbow), 9);
			}
		}
	});

	test("a target moves the foot and the elbow with it", () => {
		const target: V = [-9, 6, 42];
		const a = anchorAssembly(0, 1, target);
		expect(a.foot).toEqual(target);
		expect(a.elbow[0]).toBeCloseTo(-6 + (-9 + 6) * 0.48 - 5, 9);
		expect(a.elbow[1]).toBeCloseTo(2 + (6 - 2) * 0.48 + 3, 9);
	});

	test("deployment is clamped before the elbow kick", () => {
		expect(anchorAssembly(3, 9).elbow).toEqual(anchorAssembly(3, 1).elbow);
		expect(anchorAssembly(3, -9).elbow).toEqual(anchorAssembly(3, 0).elbow);
	});
});
