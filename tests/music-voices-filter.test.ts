import { describe, expect, test } from "bun:test";
import { SVF_STABLE, svfLimit, svfStep } from "../src/music-voices";

describe("the state-variable filter", () => {
	test("rings out for every coefficient and damping a voice can ask for", () => {
		const unstable: string[] = [];
		for (const g of [0.05, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2])
			for (const damp of [0.1, 0.5, 1, 1.62, 2]) {
				const lp = new Float64Array(1);
				const bp = new Float64Array(1);
				let peak = 0;
				for (let n = 0; n < 5000; n++) {
					const y = svfStep(lp, bp, 0, g, n === 0 ? 1 : 0, damp, false);
					peak = Math.max(peak, Math.abs(y), Math.abs(bp[0]));
				}
				if (!(peak < 10)) unstable.push(`g ${g} damp ${damp}: ${peak}`);
			}
		expect(unstable).toEqual([]);
	});

	test("the limit sits inside the stability edge and leaves a coefficient below it alone", () => {
		for (const damp of [0.1, 1, 1.62, 2]) {
			const g = svfLimit(damp);
			expect(g * (g + 2 * damp)).toBeCloseTo(SVF_STABLE, 9);
			expect(g * (g + 2 * damp)).toBeLessThan(4);
		}
		const lp = new Float64Array(1);
		const bp = new Float64Array(1);
		svfStep(lp, bp, 0, 0.5, 1, 1, false);
		expect(svfStep(lp, bp, 0, 0.5, 0, 1, false)).toBe(0.25);
	});
});

test("safe coefficients preserve the impulse, including the rounded margin boundary", () => {
	for (const [g, damp] of [
		[0.5, 0.1],
		[0.5, 0.5],
		[0.5, 1],
		[0.5, 2],
		[1.6349351572897473, 0.1],
	]) {
		expect(g * (g + 2 * damp)).toBeLessThanOrEqual(SVF_STABLE);
		const lp = new Float64Array(1);
		const bp = new Float64Array(1);
		expect(svfStep(lp, bp, 0, g, 1, damp, true)).toBe(g);
		expect(lp[0]).toBe(0);
		expect(svfStep(lp, bp, 0, g, 0, damp, false)).toBe(g * g);
	}
});
