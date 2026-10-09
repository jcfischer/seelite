import { test, expect } from "bun:test";
import {
	anchorPose,
	anchorAssembly,
	cutterPosition,
	rockContactZ,
	MINING,
} from "./kinematics";

test("four deployed anchors meet the sloped rock surface around the cutter", () => {
	const feet = [0, 1, 2, 3].map((i) => anchorPose(i, 1).foot);
	expect(new Set(feet.map((p) => p.join(","))).size).toBe(4);
	for (const [x, y, z] of feet) {
		expect(z).toBe(rockContactZ(x, y));
		expect(Math.hypot(x, y - MINING.cutterY)).toBeGreaterThan(
			MINING.ringRadius * 2,
		);
	}
});
test("folded arms remain alongside hull; extension stays finite throughout the swing", () => {
	for (let i = 0; i < 4; i++)
		for (let t = 0; t <= 1; t += 0.025) {
			const p = anchorPose(i, t);
			expect(p.length).toBeGreaterThan(8);
			expect(p.direction.every(Number.isFinite)).toBe(true);
			expect(Math.sign(p.foot[0])).toBe(Math.sign(p.base[0]));
		}
	for (let i = 0; i < 4; i++) {
		const p = anchorPose(i, 0);
		expect(p.foot[2]).toBeLessThan(p.base[2]);
		expect(Math.abs(p.foot[0])).toBeLessThan(10);
	}
});
test("cutter feed is independent from anchor pose, ends exactly at rock", () => {
	expect(cutterPosition(1) + MINING.toothReach).toBe(MINING.rockZ);
	expect(cutterPosition(1) - cutterPosition(0)).toBeGreaterThan(10);
});
test("out-of-range controls clamp and invalid numbers fail closed", () => {
	expect(cutterPosition(4)).toBe(cutterPosition(1));
	expect(anchorPose(0, -1)).toEqual(anchorPose(0, 0));
	expect(() => cutterPosition(NaN)).toThrow();
	expect(() => anchorPose(8, 0.5)).toThrow();
});

test("elbow booms have enough sleeve overlap throughout deployment", () => {
	for (let i = 0; i < 4; i++)
		for (let n = 0; n <= 100; n++) {
			const p = anchorAssembly(i, n / 100);
			expect(p.upperLength).toBeGreaterThan(8.5);
			expect(p.lowerLength).toBeGreaterThan(8);
			expect(p.elbow.every(Number.isFinite)).toBe(true);
		}
});
