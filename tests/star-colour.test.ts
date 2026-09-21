/**
 * One author for "what a star's colour looks like when it is drawn".
 *
 * Two consumers read this: `planet-surface.ts`, which paints a photosphere, and
 * `backdrop.ts`, which paints the systems as points. Both are tinted by a
 * **generated** colour — the class the system's own draw picked — and #59's
 * ruling is that such a tint carries hue and not exposure. Two modules applying
 * that rule with two copies of the arithmetic is the drift this file exists to
 * prevent, and the second copy would be invisible: it would differ by a
 * percentage point and every star in the game would simply sit slightly
 * differently on the exposure ramp.
 *
 * The conversion from a hex triple to linear light is the part with an
 * implementation on the other side of the seam — three's own `ColorManagement` —
 * so the equivalence is measured rather than assumed. Move the formula and this
 * goes red against the library it has to agree with.
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { codeOf, srcFiles } from "./lib/source-scan";
import { STAR_CLASSES } from "../src/system";
import {
	PHOTOSPHERE_LUMA,
	hexToLinearRgb,
	photosphereTintLinear,
	rec709Luma,
	srgbToLinear,
} from "../src/star-colour";

/** Every class the generator can ship, plus the corners a palette can hide in. */
const HEXES = [
	...STAR_CLASSES.map((c) => c.color),
	0x000000,
	0xffffff,
	0xff0000,
	0x00ff00,
	0x0000ff,
	0x010101,
];

describe("hexToLinearRgb — three's own conversion, written out", () => {
	test("it agrees with THREE.Color for every colour the game can draw", () => {
		for (const hex of HEXES) {
			const mine = hexToLinearRgb(hex);
			const theirs = new THREE.Color(hex).toArray();
			expect(mine[0]).toBeCloseTo(theirs[0], 8);
			expect(mine[1]).toBeCloseTo(theirs[1], 8);
			expect(mine[2]).toBeCloseTo(theirs[2], 8);
		}
	});

	test("black stays black and white stays at one", () => {
		expect(hexToLinearRgb(0x000000)).toEqual([0, 0, 0]);
		for (const c of hexToLinearRgb(0xffffff)) expect(c).toBeCloseTo(1, 8);
	});

	test("the transfer function is the standard one at its knee", () => {
		// Below the knee the sRGB curve is a straight line through the origin,
		// which is why a dark colour is *darker* in linear light than a naive
		// /255 would suggest. 0.04045 is the knee; the two sides have to agree at
		// it or every dark star is off by the slope discontinuity.
		expect(srgbToLinear(0)).toBe(0);
		expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 8);
		expect(srgbToLinear(0.04046)).toBeGreaterThan(srgbToLinear(0.04044));
	});
});

describe("photosphereTintLinear — hue yes, exposure no", () => {
	test("every tint lands at the one luma, whatever it started at", () => {
		for (const hex of HEXES) {
			const [r, g, b] = photosphereTintLinear(hex);
			const luma = rec709Luma(r, g, b);
			if (hex === 0x000000) {
				// Black has no hue to preserve and no exposure to normalise to.
				// Dividing by its luma would be a division by zero rather than a
				// dark star, so it is the one colour that passes through.
				expect([r, g, b]).toEqual([0, 0, 0]);
				continue;
			}
			expect(luma).toBeCloseTo(PHOTOSPHERE_LUMA, 8);
		}
	});

	test("the tint is a positive scaling of the colour, so the hue is untouched", () => {
		for (const hex of HEXES) {
			if (hex === 0x000000) continue;
			const raw = hexToLinearRgb(hex);
			const tint = photosphereTintLinear(hex);
			// The scale is taken off the first channel that has one: a primary
			// like `0xff0000` carries exact zeros, and `0/0` is a NaN that would
			// read as a broken scaling. A zero channel *staying* zero is the
			// scaling property for that channel, and the loop below asserts it.
			const pivot = raw.findIndex((v) => v !== 0);
			const k = tint[pivot] / raw[pivot];
			expect(k).toBeGreaterThan(0);
			for (let i = 0; i < 3; i++) expect(tint[i]).toBeCloseTo(k * raw[i], 10);
		}
	});

	test("the classes the generator ships all draw at one exposure", () => {
		// #59's actual complaint: a *neutral* class clips all three channels
		// together and comes out a flat lamp, because its raw luma is higher than
		// a warm class's. Normalised, the five classes differ in hue only.
		const lumas = STAR_CLASSES.map((c) =>
			rec709Luma(...photosphereTintLinear(c.color)),
		);
		for (const l of lumas) expect(l).toBeCloseTo(PHOTOSPHERE_LUMA, 8);
		// And they were not already equal, or this file is guarding nothing.
		const raw = STAR_CLASSES.map((c) => rec709Luma(...hexToLinearRgb(c.color)));
		expect(Math.max(...raw) / Math.min(...raw)).toBeGreaterThan(1.05);
	});
});

describe("the luma rule has one author", () => {
	test("no second module declares it, under any name", () => {
		// The number moved out of `planet-surface.ts` when the points layer
		// needed it. A scan is the only form of this claim that a fifth consumer
		// cannot walk past — and the scan has to look for the **value**, not for
		// the identifier, because `const luma = 0.55` in a third module is the
		// drift this is afraid of and it declares nothing called
		// `PHOTOSPHERE_LUMA`. Both shapes are checked: the shipped name in two
		// files, and a fresh binding of the literal anywhere else in `src/`.
		const declared = srcFiles().filter((file) =>
			/export const PHOTOSPHERE_LUMA\b/.test(codeOf(file)),
		);
		expect(declared).toEqual(["src/star-colour.ts"]);

		const rebound = srcFiles()
			.filter((file) => file !== "src/star-colour.ts")
			.filter((file) =>
				/\b(?:const|let)\s+\w*(?:luma|Luma|LUMA)\w*\s*(?::\s*number)?\s*=\s*0\.55\b/.test(
					codeOf(file),
				),
			);
		expect(rebound).toEqual([]);
	});

	test("the star surface reads it rather than restating it", () => {
		const surface = codeOf("src/planet-surface.ts");
		expect(surface).toMatch(/from "\.\/star-colour"/);
		expect(surface).not.toMatch(/PHOTOSPHERE_LUMA\s*=\s*0?\./);
	});
});
