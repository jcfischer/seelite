/**
 * The sky behind everything: two populations, and what each one owes.
 *
 * ## The two halves of this file assert different kinds of thing, on purpose
 *
 * `faintField` is a **draw**. Its rows are the ones any seeded generator owes:
 * same seed, same buffers; the scatter uniform over the sphere and not over the
 * angles; the buffers the length the count promises. Those were the whole file
 * while the sky was one invented population, and they are still the right rows
 * for the half that is invented.
 *
 * `systemField` is not a draw. Its points are the other 255 systems, so
 * element-by-element equality against a stored answer would be a claim about
 * `galaxy.ts` and `galaxy-frame.ts` wearing a backdrop test's clothes. So the
 * rows below recompute the bearing through the shipped `skyBearing` and hold the
 * buffer against **that**, which is a stronger check than a golden array and
 * names the thing it actually checks: the layer is the transform, 255 times. A
 * golden array would survive the transform being replaced by anything that
 * reproduced today's numbers; this does not survive the transform being
 * inverted, or `galaxy.ts` moving a system, which are the two failures worth
 * having a red run for.
 *
 * The third kind of row is the one between the two layers: no invented star
 * outshines a real one. That is a relationship, not a figure, which is what the
 * map's #294 note says survives a change of subject — the rows that held through
 * #202's finish change were the ones comparing two readings rather than pinning
 * a code.
 */
import { describe, expect, test } from "bun:test";
import {
	BRIGHT_CEILING_LY,
	BRIGHT_FLOOR_LY,
	BRIGHT_SIZE_K,
	BRIGHT_SIZE_MAX,
	BRIGHT_SIZE_MID_LY,
	BRIGHT_SIZE_MIN,
	FAINT_SIZE_MAX,
	brightSizeLy,
	faintField,
	systemField,
} from "../src/backdrop";
import {
	SYSTEMS_PER_GALAXY,
	distanceLy,
	generateGalaxy,
	startSystem,
} from "../src/galaxy";
import { skyBearing, skyFrame } from "../src/galaxy-frame";
import { generateContents, starClassFor } from "../src/system";
import { photosphereTintLinear } from "../src/star-colour";
import { BACKDROP_RADIUS } from "../src/units";

/** Fixed by hand and not derived: a galaxy is a layout search, and the seed
 *  that finds a connected one on the first attempt is worth knowing. */
const WORLD = 7919;
const galaxy = generateGalaxy(WORLD, 0);
const observer = startSystem(galaxy);
const field = systemField(galaxy, observer);

/** The systems the observer is not, in the order `systemField` documents. */
const others = galaxy.systems.filter((s) => s.index !== observer.index);

/** One point of a field as a plain triple. */
const triple = (a: Float32Array, i: number) => [
	a[i * 3],
	a[i * 3 + 1],
	a[i * 3 + 2],
];

/** Slack for a *size* that has been through a `Float32Array`.
 *
 * Sized to the quantity, not to the layer: the sizes live at 0.012 to 0.055,
 * where float32 spacing is about 4e-9, so 1e-7 is roughly twenty-five steps of
 * storage noise and nothing more. The bearing rows above read figures of order
 * `BACKDROP_RADIUS` and are held with `toBeCloseTo(…, 4)` for that reason; one
 * tolerance written for one magnitude and used at another is how a row stops
 * measuring what its comment says it measures.
 */
const F32_SIZE = 1e-7;

const radiusOf = (positions: Float32Array, i: number) =>
	Math.hypot(...triple(positions, i));

describe("faintField — the invented population", () => {
	test("the same seed gives the same sky", () => {
		const a = faintField(42, 500);
		const b = faintField(42, 500);
		expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
		expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
		expect(Array.from(a.sizes)).toEqual(Array.from(b.sizes));
	});

	test("a different seed gives a different one", () => {
		const a = faintField(42, 500);
		const b = faintField(43, 500);
		expect(Array.from(a.positions)).not.toEqual(Array.from(b.positions));
	});

	test("the buffers are the length the count promises", () => {
		const f = faintField(7, 128);
		expect(f.count).toBe(128);
		expect(f.positions.length).toBe(128 * 3);
		expect(f.colors.length).toBe(128 * 3);
		expect(f.sizes.length).toBe(128);
	});

	test("every star sits on the sphere", () => {
		// Not "within" — on. The layer has no depth of its own and is re-centred
		// on the camera every frame, so a star at a different radius is not
		// further away, it is just a different size for no reason.
		const f = faintField(2026, 400);
		for (let i = 0; i < f.count; i++)
			// float32 storage, so the radius round-trips to about seven figures.
			expect(Math.abs(radiusOf(f.positions, i) - BACKDROP_RADIUS)).toBeLessThan(
				1e-3,
			);
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
		const f = faintField(31337, 4000);
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
		const f = faintField(11, 1000);
		let warm = 0;
		for (let i = 0; i < f.count; i++) {
			const [r, g, b] = triple(f.colors, i);
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

describe("systemField — the 255 systems that are actually there", () => {
	test("one point for every other system, and none for the observer", () => {
		expect(field.count).toBe(SYSTEMS_PER_GALAXY - 1);
		expect(field.positions.length).toBe((SYSTEMS_PER_GALAXY - 1) * 3);
		// The count alone would also be satisfied by drawing the observer's own
		// position and dropping some other system, so the pairing is checked
		// rather than inferred: every entry of `others` is accounted for below,
		// and this row says the arithmetic is 256 − 1 rather than 256.
		expect(others.length).toBe(field.count);
	});

	test("the bearings are `galaxy-frame`'s, not a copy of them", () => {
		// The row this file was rewritten around. It recomputes through
		// `skyBearing` rather than restating an answer, so what it holds is
		// "the layer is the transform", and an inverted transform, a second
		// frame, or a moved system each go red here.
		//
		// It is also the ordering claim, because the bearings are distinct — the
		// row after this one is what makes that a fact rather than a hope — so
		// comparing point `i` against `others[i]` pins which system draws where.
		const frame = skyFrame(observer.seed);
		others.forEach((other, i) => {
			const want = skyBearing(frame, observer.pos, other.pos);
			if (want === null)
				throw new Error(
					`the observer and system ${other.index} carry no bearing`,
				);
			const got = triple(field.positions, i);
			expect(got[0]).toBeCloseTo(want.x * BACKDROP_RADIUS, 4);
			expect(got[1]).toBeCloseTo(want.y * BACKDROP_RADIUS, 4);
			expect(got[2]).toBeCloseTo(want.z * BACKDROP_RADIUS, 4);
		});
	});

	test("no two systems share a bearing, so a point identifies exactly one system", () => {
		// What makes the row above an ordering claim rather than a set claim: if
		// two systems ever landed on the same direction, the buffer would carry
		// two indistinguishable points and nothing downstream could say which
		// system a bright point is. Measured here rather than assumed — with 255
		// directions on a sphere the closest pair is degrees apart, and if the
		// generator ever ships a pair that is not, that is worth a red run in the
		// file that draws them.
		const keys = new Set<string>();
		for (let i = 0; i < field.count; i++) {
			const [x, y, z] = triple(field.positions, i);
			keys.add(
				`${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`,
			);
		}
		expect(keys.size).toBe(field.count);
	});

	test("every point sits at the backdrop radius, not at its own distance", () => {
		// `BACKDROP_RADIUS` is where the background layer draws a *direction*,
		// not how far the thing is. A sky ordered by distance has nothing to put
		// at a radius, so distance travels in the size and a point drawn at
		// `distanceLy` would sit outside the layer's frustum and vanish.
		for (let i = 0; i < field.count; i++)
			expect(
				Math.abs(radiusOf(field.positions, i) - BACKDROP_RADIUS),
			).toBeLessThan(1e-3);
	});

	test("the same observer, twice, gets the same sky", () => {
		const again = systemField(galaxy, observer);
		expect(Array.from(again.positions)).toEqual(Array.from(field.positions));
		expect(Array.from(again.colors)).toEqual(Array.from(field.colors));
		expect(Array.from(again.sizes)).toEqual(Array.from(field.sizes));
	});

	test("a different observer sees a different sky", () => {
		const other = galaxy.systems[(observer.index + 97) % SYSTEMS_PER_GALAXY];
		expect(other.index).not.toBe(observer.index);
		const theirs = systemField(galaxy, other);
		// Both skies hold the same 255 *systems* — every system but the one it is
		// drawn for — so the difference has to be in where they land, and the
		// first eight floats are not a strong enough reading of that. Every
		// position is compared, and the pair is asked to disagree somewhere.
		expect(theirs.positions.some((v, i) => v !== field.positions[i])).toBe(
			true,
		);
	});

	test("a point's colour is its own system's sun, at the one photosphere exposure", () => {
		// The layer's whole claim is that a bright point *is* a system. Drawing
		// it in an invented colour would make that claim true of the bearings and
		// false of the picture. And the colour is normalised rather than raw:
		// #59's rule that a generated tint carries hue and not exposure, so the
		// distance is the only thing left carrying brightness.
		others.forEach((other, i) => {
			const want = photosphereTintLinear(starClassFor(other.seed).color);
			const got = triple(field.colors, i);
			expect(got[0]).toBeCloseTo(want[0], 5);
			expect(got[1]).toBeCloseTo(want[1], 5);
			expect(got[2]).toBeCloseTo(want[2], 5);
		});
	});

	test("the class the point wears is the class the system's sun is", () => {
		// `starClassFor` re-draws the first value of the `BODIES` stream rather
		// than reading it out of a generated system, because generating 255
		// systems to colour 255 points on every jump is not a price worth paying.
		// That is only safe while the two draws agree, and nothing but this row
		// says they do.
		for (const other of others.slice(0, 40))
			expect(starClassFor(other.seed).cls).toBe(
				generateContents(other).star.cls,
			);
	});

	test("the layer shows every star class the generator ships", () => {
		// A row on the colours above would pass on one class alone, and one class
		// would be a sky that cannot be a picture of a population.
		const classes = new Set(others.map((s) => starClassFor(s.seed).cls));
		expect([...classes].sort()).toEqual(["A", "F", "G", "K", "M"]);
	});

	test("size falls as distance rises, and never leaves the band", () => {
		const byDistance = others
			.map((other, i) => ({ i, d: distanceLy(observer.pos, other.pos) }))
			.sort((a, b) => a.d - b.d);
		let previous = Infinity;
		for (const { i, d } of byDistance) {
			const size = field.sizes[i];
			expect(size).toBeGreaterThanOrEqual(BRIGHT_SIZE_MIN);
			expect(size).toBeLessThanOrEqual(BRIGHT_SIZE_MAX);
			expect(size).toBeLessThanOrEqual(previous + F32_SIZE);
			previous = size;
			expect(Number.isFinite(d)).toBe(true);
		}
	});

	test("the size law is the inverse square, with named clamps", () => {
		// The mid of the band is the *median separation* between two systems, which
		// is a named constant rather than a number beside the shader: it is a
		// measurement, and `scripts/measure-sky-density.ts` is where it comes from.
		const mid = Math.sqrt(BRIGHT_SIZE_MIN * BRIGHT_SIZE_MAX);
		expect(brightSizeLy(BRIGHT_SIZE_MID_LY)).toBeCloseTo(mid, 8);
		// Reciprocal, not linear: half the distance is not twice the size of the
		// far end, it is the far end of the *band* once the ceiling bites.
		expect(brightSizeLy(BRIGHT_SIZE_MID_LY * 2)).toBeLessThan(mid);
		expect(brightSizeLy(BRIGHT_SIZE_MID_LY / 2)).toBeGreaterThan(mid);
		// Both clamps are reachable, and reachable *where the exported constants
		// say they bite*. That is the whole point of those two being exported
		// numbers rather than prose: `docs/specs/galaxy-generation.md` §12 quotes
		// both distances, and before they were constants the sentence beside a
		// moved `K` was free to say anything. A boundary is two rows, because a
		// distance quoted as "where it bites" is wrong if the law has already
		// bitten a light year earlier.
		// `toBeCloseTo` rather than `toBe` at the boundary: the distance and the
		// size are on opposite sides of the same quotient, and `K / (K / MAX)`
		// landing one ulp under `MAX` would leave the clamp unfired. That is a
		// coin flip about IEEE754, not about the law, and a row that fails on it
		// would be a red light pointing at the wrong thing. Past the boundary the
		// exact rows stay, because there the clamp has plainly fired.
		expect(brightSizeLy(BRIGHT_CEILING_LY)).toBeCloseTo(BRIGHT_SIZE_MAX, 9);
		expect(brightSizeLy(BRIGHT_CEILING_LY * 1.001)).toBeLessThan(
			BRIGHT_SIZE_MAX,
		);
		expect(brightSizeLy(BRIGHT_FLOOR_LY)).toBeCloseTo(BRIGHT_SIZE_MIN, 9);
		expect(brightSizeLy(BRIGHT_FLOOR_LY * 0.999)).toBeGreaterThan(
			BRIGHT_SIZE_MIN,
		);
		// The ordering is the claim: a sky whose ceiling sat beyond its floor
		// would clamp every point to one size and still pass a row that only asks
		// whether each clamp is reachable.
		expect(BRIGHT_CEILING_LY).toBeLessThan(BRIGHT_FLOOR_LY);
		// And both sit *inside* the distances the game actually draws, which is
		// the difference between a clamp that shapes the picture and one that is
		// off at the end of a dial nobody reaches. The near end is the shipped
		// `BRIGHT_SIZE_MID_LY` — the measured median separation — because that is
		// the distance the corpus is dense at; `measure-sky-density.ts sky` prints
		// the observed range the clamps sit within.
		expect(BRIGHT_CEILING_LY).toBeLessThan(BRIGHT_SIZE_MID_LY);
		expect(BRIGHT_FLOOR_LY).toBeGreaterThan(BRIGHT_SIZE_MID_LY);
	});

	test("the size law refuses a distance that is not a distance", () => {
		// A NaN here is a missing star rather than an exception, which is the
		// quiet-garbage failure the map's instrument rule is about.
		expect(() => brightSizeLy(Number.NaN)).toThrow();
		expect(() => brightSizeLy(-1)).toThrow();
	});
});

describe("the two layers, beside each other", () => {
	test("no invented star outshines a real one", () => {
		// The relationship #431 was written to decide. The invented layer
		// outnumbers the real one by an order of magnitude in every direction —
		// the two ratios are `measure-sky-density.ts` band mode's to print and §12's
		// to carry, and are not repeated in a test comment — so the sky cannot survive as
		// structure on count; brightness is the only channel left, and a channel
		// with no floor under it is a channel that drifts the first time somebody
		// tunes the texture. Held as a relationship rather than as two figures.
		for (const seed of [1, 42, 31337, 2026]) {
			const faint = faintField(seed, 4000);
			let ceiling = 0;
			for (const s of faint.sizes) ceiling = Math.max(ceiling, s);
			expect(ceiling).toBeLessThan(BRIGHT_SIZE_MIN);
		}
		expect(FAINT_SIZE_MAX).toBeLessThan(BRIGHT_SIZE_MIN);
	});

	test("a second observer's sky is still 255 points, whoever they are", () => {
		// The off-by-one that would survive the first row: an observer at the
		// front of the list, one at the back, and one in the middle all exclude
		// exactly one system, themselves.
		for (const index of [0, 1, 128, SYSTEMS_PER_GALAXY - 1]) {
			const record = galaxy.systems[index];
			expect(systemField(galaxy, record).count).toBe(SYSTEMS_PER_GALAXY - 1);
		}
	});
});
