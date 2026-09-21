/**
 * Simplex noise.
 *
 * Vendored from seekolous along with the module, and kept because the module
 * was kept: nothing in seelite draws a field from this yet — the nebula bake
 * and any planetary surface are both downstream of decisions still open on the
 * map — so these tests are the only thing standing between a copied file and a
 * quietly broken one.
 *
 * The continuity check is the load-bearing one. A hash masquerading as noise
 * passes a determinism test and fails that.
 */
import { describe, expect, test } from "bun:test";
import { SimplexNoise } from "../src/noise";

const grid = (n: SimplexNoise, step = 3.7, count = 24) =>
	Array.from({ length: count }, (_, i) => n.fbm(i * step, i * step * 0.5));

describe("SimplexNoise", () => {
	test("one seed gives one landscape", () => {
		expect(grid(new SimplexNoise(42))).toEqual(grid(new SimplexNoise(42)));
	});

	test("different seeds give different ones", () => {
		expect(grid(new SimplexNoise(42))).not.toEqual(grid(new SimplexNoise(43)));
	});

	test("is a continuous field — nearby points have nearby values", () => {
		// The property that makes it terrain rather than static. A hash masquerading
		// as noise passes a determinism test and fails this one.
		const n = new SimplexNoise(7);
		let worst = 0;
		for (let x = 0; x < 40; x += 0.5) {
			const step = Math.abs(n.fbm(x, 3) - n.fbm(x + 0.01, 3));
			worst = Math.max(worst, step);
		}
		expect(worst).toBeLessThan(0.1);
	});

	test("stays in a bounded range", () => {
		const n = new SimplexNoise(2026);
		let lo = Infinity;
		let hi = -Infinity;
		for (let x = 0; x < 200; x += 1.3)
			for (let y = 0; y < 200; y += 7.1) {
				const v = n.fbm(x, y);
				lo = Math.min(lo, v);
				hi = Math.max(hi, v);
			}
		expect(lo).toBeGreaterThan(-2);
		expect(hi).toBeLessThan(2);
		// and it actually varies — a constant field would satisfy the bounds
		expect(hi - lo).toBeGreaterThan(0.2);
	});

	test("more octaves add detail rather than replacing the shape", () => {
		const n = new SimplexNoise(11);
		const coarse = n.fbm(12.5, 8.25, 1);
		const fine = n.fbm(12.5, 8.25, 6);
		expect(fine).not.toBe(coarse);
		expect(Math.abs(fine - coarse)).toBeLessThan(1);
	});
});
