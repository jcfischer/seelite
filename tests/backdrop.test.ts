/**
 * The star field: determinism, and the geometry that makes it read as a sky.
 *
 * Determinism is the claim the map's constraints put in writing — "the same
 * seed always produces the same galaxy" — and it is checked here rather than
 * only in `probe-boot.mjs` because it costs nothing here. The probe checks the
 * seed reaches the *page*, which is a different failure (a boot path that
 * forgets to pass it along); this checks the generator itself.
 *
 * The distribution check is the one that would otherwise be found by eye, late.
 * Drawing two spherical angles uniformly is the classic star-field mistake and
 * it bunches points at the poles — obvious once you fly to one, invisible in
 * a screenshot pointed anywhere else.
 */
import { expect, test, describe } from "bun:test";
import { starField } from "../src/backdrop";
import { BACKDROP_RADIUS } from "../src/units";

describe("starField", () => {
	test("the same seed gives the same sky", () => {
		const a = starField(42, 500);
		const b = starField(42, 500);
		expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
		expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
		expect(Array.from(a.sizes)).toEqual(Array.from(b.sizes));
	});

	test("a different seed gives a different one", () => {
		const a = starField(42, 500);
		const b = starField(43, 500);
		expect(Array.from(a.positions)).not.toEqual(Array.from(b.positions));
	});

	test("the buffers are the length the count promises", () => {
		const f = starField(7, 128);
		expect(f.count).toBe(128);
		expect(f.positions.length).toBe(128 * 3);
		expect(f.colors.length).toBe(128 * 3);
		expect(f.sizes.length).toBe(128);
	});

	test("every star sits on the sphere", () => {
		// Not "within" — on. The layer has no depth of its own and is re-centred
		// on the camera every frame, so a star at a different radius is not
		// further away, it is just a different size for no reason.
		const f = starField(2026, 400);
		for (let i = 0; i < f.count; i++) {
			const r = Math.hypot(
				f.positions[i * 3],
				f.positions[i * 3 + 1],
				f.positions[i * 3 + 2],
			);
			// float32 storage, so the radius round-trips to about seven figures.
			expect(Math.abs(r - BACKDROP_RADIUS)).toBeLessThan(1e-3);
		}
	});

	test("the scatter is uniform over the sphere, not over the angles", () => {
		// The failure this catches: drawing latitude uniformly puts far too many
		// stars near the poles. Under a correct construction the fraction of stars
		// in any band of `y` equals that band's fraction of the diameter — so the
		// top fifth of the sphere holds about a fifth of the stars, not a third.
		//
		// The tolerance is wide because 4,000 samples in five bins has real
		// binomial spread: one standard deviation is ~0.6% of the total, so ±4
		// percentage points is well over six sigma of noise and still far inside
		// the ~10-point excess the pole-bunching bug produces.
		const f = starField(31337, 4000);
		const bins = [0, 0, 0, 0, 0];
		for (let i = 0; i < f.count; i++) {
			const y = f.positions[i * 3 + 1] / BACKDROP_RADIUS; // -1..1
			const bin = Math.min(4, Math.floor(((y + 1) / 2) * 5));
			bins[bin]++;
		}
		for (const n of bins) {
			expect(n / f.count).toBeGreaterThan(0.2 - 0.04);
			expect(n / f.count).toBeLessThan(0.2 + 0.04);
		}
	});

	test("colours are in range and mostly warm", () => {
		const f = starField(11, 1000);
		let warm = 0;
		for (let i = 0; i < f.count; i++) {
			const [r, g, b] = [
				f.colors[i * 3],
				f.colors[i * 3 + 1],
				f.colors[i * 3 + 2],
			];
			for (const c of [r, g, b]) {
				expect(c).toBeGreaterThanOrEqual(0);
				expect(c).toBeLessThanOrEqual(1);
			}
			if (r > b) warm++;
		}
		// The module biases the temperature draw by cubing it, so red-through-white
		// should dominate and blue-white should be the exception. Asserted as a
		// majority rather than a figure: the exact split is a tuning choice, the
		// direction is the design.
		expect(warm / f.count).toBeGreaterThan(0.6);
	});
});
