/**
 * The lighting environment: what a reflection is a reflection *of*.
 *
 * #99 replaced a flat `AmbientLight` with a hemisphere term and an image-based
 * one, because Elite Dangerous hulls are mostly reading reflections and this
 * game reflected nothing — `scene.environment` was unset repo-wide, so every
 * `metalness` above zero was subtracting diffuse and adding nothing back.
 *
 * What is checked here is the half a browser cannot see cheaply: that the
 * radiance model is deterministic, finite, and shaped like a star — brightest
 * toward the star direction, falling monotonically away from it, never
 * negative. The equirectangular buffer is generated from that model, so the
 * same claims carry to it.
 *
 * **What this file cannot check, said plainly.** It cannot check that the
 * buffer is *oriented* the way `three` samples it. The mapping from a pixel to
 * a direction is stated once, in `light-rig.ts`, and any test here that
 * restated it would agree with it by construction — including a flipped one.
 * A bake handed to the renderer back-to-front puts the reflection on the side
 * away from the star, which looks wrong and measures fine. That is
 * `probe-light-rig.mjs`'s job: it renders one station front-lit and once more
 * backlit, differences each against the same frame with the environment
 * dropped, and requires the front-lit difference to be the larger. Both halves
 * of that were watched go red on a build with the defect — reversed on a
 * flipped bake, zero on both arms with no bake at all.
 */
import { describe, expect, test } from "bun:test";
import {
	BAKE_STAR_DIR,
	ENV_HEIGHT,
	ENV_WIDTH,
	LIGHT_RIG,
	envRadiance,
	equirectEnvironment,
} from "../src/light-rig";

/** A warm G-type tint, and a neutral one. #59's finding is that the neutral end
 *  is where an emissive tint stops carrying detail; the same palette is used
 *  here so the two ends are both exercised. */
const WARM = 0xfff0d8;
const NEUTRAL = 0xf8f7ff;

const unit = (x: number, y: number, z: number): [number, number, number] => {
	const l = Math.hypot(x, y, z);
	return [x / l, y / l, z / l];
};

/** Directions at a given angle from the star, sampled around the cone so a
 *  result is not an accident of one azimuth. */
function atAngle(deg: number, samples = 8): [number, number, number][] {
	const a = (deg * Math.PI) / 180;
	const out: [number, number, number][] = [];
	for (let i = 0; i < samples; i++) {
		const phi = (i / samples) * Math.PI * 2;
		// BAKE_STAR_DIR is +X, so the cone spans the YZ plane around it.
		out.push(
			unit(
				Math.cos(a),
				Math.sin(a) * Math.cos(phi),
				Math.sin(a) * Math.sin(phi),
			),
		);
	}
	return out;
}

const luma = ([r, g, b]: [number, number, number]) =>
	0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("the radiance model is a star and a floor", () => {
	test("the star direction is the brightest direction there is", () => {
		const at = envRadiance(BAKE_STAR_DIR, WARM);
		for (const d of [10, 45, 90, 135, 180].flatMap((deg) => atAngle(deg)))
			expect(luma(envRadiance(d, WARM))).toBeLessThan(luma(at));
	});

	test("brightness falls off the star, step by step, and never rises again", () => {
		// Every step, not just the ends: a lobe with a bump in it would pass a
		// first-versus-last comparison and read as a second light source.
		//
		// Strict below 90° and flat at or beyond it, which is the model rather
		// than a tolerance: the star terms are clamped at the horizon, so the
		// whole far hemisphere is the floor exactly. Asserting a strict fall
		// there would be asserting a gradient the rig does not have — and the
		// hemisphere light is what supplies one on that side.
		let previous = luma(envRadiance(BAKE_STAR_DIR, WARM));
		for (const deg of [1, 2, 5, 10, 20, 40, 60, 89, 90, 120, 150, 180]) {
			const here = atAngle(deg).map((d) => luma(envRadiance(d, WARM)));
			// The cone is symmetric about the star axis, so every azimuth on it
			// must agree — an asymmetry here is a second term leaking in.
			for (const v of here) expect(v).toBeCloseTo(here[0], 10);
			if (deg < 90) expect(here[0]).toBeLessThan(previous);
			else expect(here[0]).toBeLessThanOrEqual(previous);
			previous = here[0];
		}
	});

	test("the far side is lit, but barely", () => {
		// Space has no ambient light; a screen with no detail in the shadows has
		// no information in it either — the same argument the flat ambient this
		// replaces was added for. The floor is what carries that, so it must be
		// above zero and far below the star.
		const away = luma(envRadiance(atAngle(180)[0], WARM));
		const at = luma(envRadiance(BAKE_STAR_DIR, WARM));
		expect(away).toBeGreaterThan(0);
		expect(away).toBeLessThan(at / 100);
	});

	test("nothing is negative or non-finite, at any tint", () => {
		for (const tint of [WARM, NEUTRAL, 0x000000, 0xffffff])
			for (const deg of [0, 30, 90, 150, 180])
				for (const d of atAngle(deg))
					for (const c of envRadiance(d, tint)) {
						expect(Number.isFinite(c)).toBe(true);
						expect(c).toBeGreaterThanOrEqual(0);
					}
	});

	test("the tint carries hue, and the floor does not follow it", () => {
		// The star half is the tint's; the floor is a fixed cool cast, because a
		// red star does not make the empty sky red.
		const warmAt = envRadiance(BAKE_STAR_DIR, 0xff4400);
		expect(warmAt[0]).toBeGreaterThan(warmAt[2]);
		const away = atAngle(180)[0];
		expect(envRadiance(away, 0xff4400)).toEqual(envRadiance(away, 0x0044ff));
	});
});

describe("the equirectangular buffer", () => {
	test("is the size the constants promise, RGBA", () => {
		const env = equirectEnvironment(WARM);
		expect(env.width).toBe(ENV_WIDTH);
		expect(env.height).toBe(ENV_HEIGHT);
		expect(env.data.length).toBe(ENV_WIDTH * ENV_HEIGHT * 4);
	});

	test("the same tint gives the same bake", () => {
		// It is baked once at load and never regenerated, so this is less about
		// determinism across runs than about the model holding no state — a
		// closure counter in it would make the second system in a session light
		// differently from the first.
		expect(Array.from(equirectEnvironment(WARM).data)).toEqual(
			Array.from(equirectEnvironment(WARM).data),
		);
	});

	test("a different tint gives a different bake", () => {
		expect(Array.from(equirectEnvironment(WARM).data)).not.toEqual(
			Array.from(equirectEnvironment(NEUTRAL).data),
		);
	});

	test("alpha is opaque everywhere and no channel is negative", () => {
		const { data } = equirectEnvironment(WARM);
		for (let i = 0; i < data.length; i += 4) {
			expect(data[i + 3]).toBe(1);
			for (let c = 0; c < 3; c++) expect(data[i + c]).toBeGreaterThanOrEqual(0);
		}
	});

	test("the buffer's brightest texel is the one the model puts the star at", () => {
		// Not a claim about `three`'s sampling — see the header. It is the
		// weaker claim that the writer and the model agree, which is what fails
		// if the row/column loop is transposed.
		const { data, width, height } = equirectEnvironment(WARM);
		let best = -1;
		let bestAt = -1;
		for (let i = 0; i < width * height; i++) {
			const v = luma([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
			if (v > best) {
				best = v;
				bestAt = i;
			}
		}
		const x = bestAt % width;
		const y = Math.floor(bestAt / width);
		// `atan2(0, 1) / 2π + 0.5` is u = 0.5 and `asin(0) / π + 0.5` is v = 0.5,
		// and texels are sampled at their centres — so u = 0.5 falls exactly
		// between columns 127 and 128, which carry the same value. Naming both
		// rather than picking one: an even resolution has no centre texel, and a
		// test that asserted one would be asserting the tie-break in this scan.
		expect([width / 2 - 1, width / 2]).toContain(x);
		expect([height / 2 - 1, height / 2]).toContain(y);
	});
});

describe("the rig's constants", () => {
	test("the fill is dimmer than the sun it fills for", () => {
		// The fill exists because a backlit hull rendered as a black cutout, and
		// it is off-axis on purpose. A fill that reached the sun's intensity
		// would be a second star the player can fly around.
		expect(LIGHT_RIG.fill.intensity).toBeLessThan(LIGHT_RIG.sun.intensity);
	});

	test("the hemisphere's ground is darker than its sky", () => {
		// The whole reason it replaces a flat ambient: a flat lift has no
		// gradient, so a flat-lit hull has no edges.
		const l = (hex: number) =>
			luma([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]);
		expect(l(LIGHT_RIG.hemisphere.ground)).toBeLessThan(
			l(LIGHT_RIG.hemisphere.sky),
		);
	});

	test("the low quality setting drops the environment and nothing else", () => {
		// #98: this node must ship a low setting and say what it drops. The
		// hemisphere is the same cost as the flat ambient it replaced, so there
		// is nothing to gain by dropping it; the image-based term is the one
		// with a per-fragment cost.
		expect(LIGHT_RIG.quality.low.environment).toBe(false);
		expect(LIGHT_RIG.quality.high.environment).toBe(true);
		expect(LIGHT_RIG.quality.low.hemisphere).toBe(
			LIGHT_RIG.quality.high.hemisphere,
		);
		expect(LIGHT_RIG.quality.low.exposure).toBe(
			LIGHT_RIG.quality.high.exposure,
		);
	});
});
