/**
 * Picking a planet's fragment program by how big it looks — node #207.
 *
 * The only level of detail before this was vertex count. A four-pixel disc ran
 * the same fragment shader as a full-screen one: 100 to 150 noise calls a
 * fragment on the four-tap path, for a planet the player cannot see the surface
 * of. #248's ladder priced what that path is worth — 64% of a filling frame is
 * the normal perturbation alone — and the bands are what stop paying it where
 * the pixels are not there to show it.
 *
 * The band function is pure and lives here rather than in the frame loop for
 * that reason: hysteresis is a state machine, and a state machine inside a
 * render loop is one nothing can step twice and compare.
 */
import { describe, expect, test } from "bun:test";
import {
	RELIEF_BAND_HYSTERESIS,
	RELIEF_OFF_BELOW_PX,
	SCREEN_SPACE_BELOW_PX,
	focalPx,
	projectedRadiusPx,
	reliefPathFor,
} from "../src/relief-bands";
import { CLASS_GLSL, RELIEF } from "../src/planet-classes.glsl";
import { fragmentFor } from "../src/planet-shaders";

describe("the projection the bands read", () => {
	/**
	 * **CSS pixels, and the reason is that a cost dial must not move a look.**
	 *
	 * `renderScale` (#225) steps the drawing buffer 1 → 0.75 → 0.5 under the
	 * player. In drawing-buffer pixels a planet at a fixed range would cross a
	 * band when the player changed a *performance* setting, so turning the
	 * resolution down would also flatten the terrain — one dial, two effects,
	 * and the second one invisible in the settings row that caused it.
	 *
	 * The trade is that a retina player pays the four-tap path over twice the
	 * fragments of a non-retina one at the same apparent size, which is correct:
	 * the disc is the same size on the glass and shows the same detail.
	 */
	test("the focal length comes from the CSS height and the vertical fov", () => {
		// 900 CSS px tall at 60° vertical: half the height over tan(half the fov).
		expect(focalPx(900, 60)).toBeCloseTo(779.42, 2);
		// Twice the height is twice the focal length, so a disc's pixel radius
		// scales with the window rather than with the buffer.
		expect(focalPx(1800, 60)).toBeCloseTo(2 * focalPx(900, 60), 6);
	});

	/**
	 * **Layer-independent, and that is a correctness requirement.**
	 *
	 * A body's layer is its distance (#15) and each layer draws at its own
	 * scale, but the scale multiplies the radius and the distance alike, so it
	 * cancels. Reading a scaled radius against an unscaled distance — or against
	 * a position taken back out of an `Object3D`, which this repo forbids —
	 * would make the band flip at the handoff with nothing about the picture
	 * having changed.
	 */
	test("a scale applied to both radius and distance cancels", () => {
		const f = focalPx(900, 60);
		const plain = projectedRadiusPx(6000, 18000, f);
		for (const scale of [1e-3, 1e-5]) {
			expect(projectedRadiusPx(6000 * scale, 18000 * scale, f)).toBeCloseTo(
				plain,
				9,
			);
		}
	});

	test("a body at or behind the camera has no radius on screen", () => {
		expect(projectedRadiusPx(6000, 0, focalPx(900, 60))).toBe(0);
		expect(projectedRadiusPx(6000, -1, focalPx(900, 60))).toBe(0);
	});
});

describe("the bands", () => {
	const f = focalPx(900, 60);
	/** The apparent radius of a body seen from `radii` of its own radii. */
	const atRadii = (radii: number) => projectedRadiusPx(1, radii, f);

	test("the two thresholds are ordered and exported", () => {
		expect(RELIEF_OFF_BELOW_PX).toBeLessThan(SCREEN_SPACE_BELOW_PX);
		expect(RELIEF_BAND_HYSTERESIS).toBeGreaterThan(1);
	});

	/**
	 * The three bands, entered from below so hysteresis cannot flatter them.
	 *
	 * `null` as the previous path is a body that has just appeared — after a
	 * jump, or on the first frame — and it must land in the band its size says
	 * rather than in whichever one the last body was in.
	 */
	test("a fresh body lands in the band its size says", () => {
		expect(reliefPathFor(1, null)).toBe("none");
		expect(reliefPathFor(RELIEF_OFF_BELOW_PX / 2, null)).toBe("none");
		expect(reliefPathFor(SCREEN_SPACE_BELOW_PX / 2, null)).toBe("screen-space");
		expect(reliefPathFor(SCREEN_SPACE_BELOW_PX * 4, null)).toBe("four-tap");
	});

	/**
	 * **Monotonic**: a bigger disc never gets a cheaper program. Asserted over a
	 * sweep rather than at the thresholds, because the failure this catches is a
	 * comparison written the wrong way round in one of the two bands, which
	 * three hand-picked points can miss.
	 */
	test("bigger is never cheaper", () => {
		const rank = { none: 0, "screen-space": 1, "four-tap": 2 } as const;
		let previous = -1;
		for (let px = 1; px < 4000; px += 7) {
			const here = rank[reliefPathFor(px, null)];
			expect(here).toBeGreaterThanOrEqual(previous);
			previous = here;
		}
	});

	/**
	 * **Hysteresis, which is the whole reason this is a function of two
	 * arguments.**
	 *
	 * Every band change is a shader recompile. A body sitting on a threshold —
	 * which is what a body on a slow approach does for several seconds — would
	 * recompile on alternate frames without this, and a recompile is a hitch.
	 * The band is the same shape as `HANDOFF_HYSTERESIS` (`units.ts`) and for
	 * the same reason.
	 */
	test("a disc that crosses up and back inside the band keeps its program", () => {
		const up = SCREEN_SPACE_BELOW_PX * 1.02;
		expect(reliefPathFor(up, "screen-space")).toBe("four-tap");
		// Back down a little, but not past the band: it stays on the expensive
		// path rather than flapping.
		const back = SCREEN_SPACE_BELOW_PX / RELIEF_BAND_HYSTERESIS + 1;
		expect(reliefPathFor(back, "four-tap")).toBe("four-tap");
		// And past it, it drops.
		const clear = SCREEN_SPACE_BELOW_PX / RELIEF_BAND_HYSTERESIS - 1;
		expect(reliefPathFor(clear, "four-tap")).toBe("screen-space");
	});

	test("the lower threshold has the same band", () => {
		const up = RELIEF_OFF_BELOW_PX * 1.02;
		expect(reliefPathFor(up, "none")).toBe("screen-space");
		expect(
			reliefPathFor(
				RELIEF_OFF_BELOW_PX / RELIEF_BAND_HYSTERESIS + 0.5,
				"screen-space",
			),
		).toBe("screen-space");
		expect(
			reliefPathFor(
				RELIEF_OFF_BELOW_PX / RELIEF_BAND_HYSTERESIS - 0.5,
				"screen-space",
			),
		).toBe("none");
	});

	/**
	 * **A body may not skip a band on the way down**, and this is the check that
	 * a two-threshold hysteresis was written as one rule rather than as two
	 * independent ones. Falling from four-tap straight to none would mean the
	 * upper band's release was being tested against the lower threshold.
	 */
	test("falling from the top lands in the middle band, not past it", () => {
		const tiny = 1;
		expect(reliefPathFor(tiny, "four-tap")).toBe("none");
		// …but only because `tiny` is below both. Just under the upper release it
		// must stop at screen-space.
		const justUnder = SCREEN_SPACE_BELOW_PX / RELIEF_BAND_HYSTERESIS - 1;
		expect(reliefPathFor(justUnder, "four-tap")).toBe("screen-space");
	});

	/**
	 * The rungs #248's ladder priced, so the two nodes' numbers line up against
	 * one band table rather than against two readings of it.
	 *
	 * This is also the row that corrects #248's own receipt: I wrote there that
	 * 3 radii was "still past the top band", and it is not — 259.8 px against a
	 * 300 px threshold. The correction is posted on that node.
	 */
	test("the ladder's rungs land where the arithmetic says", () => {
		expect(reliefPathFor(atRadii(200), null)).toBe("none");
		expect(reliefPathFor(atRadii(30), null)).toBe("none");
		expect(reliefPathFor(atRadii(8), null)).toBe("screen-space");
		expect(reliefPathFor(atRadii(3), null)).toBe("screen-space");
		expect(reliefPathFor(atRadii(2), null)).toBe("four-tap");
		expect(reliefPathFor(atRadii(1.02), null)).toBe("four-tap");
	});
});

/**
 * The three programs, read out of the source they compile from.
 *
 * A `#define` that misses is silent: the material compiles, links, renders and
 * carries the same name, which is the failure `shader-splice.ts` exists for
 * elsewhere in this repo. Here the risk is nesting — `RELIEF_NONE` wraps a
 * block that already contained `RELIEF_SCREEN_SPACE`, so an unbalanced `#endif`
 * would produce a program that still compiles and still perturbs.
 */
describe("the three fragment programs", () => {
	const sources = {
		"four-tap": fragmentFor("terran", "four-tap"),
		"screen-space": fragmentFor("terran", "screen-space"),
		none: fragmentFor("terran", "none"),
	};

	test("each path defines its own macro and no other", () => {
		expect(sources["four-tap"]).not.toContain("#define RELIEF_SCREEN_SPACE");
		expect(sources["four-tap"]).not.toContain("#define RELIEF_NONE");
		expect(sources["screen-space"]).toContain("#define RELIEF_SCREEN_SPACE");
		expect(sources["screen-space"]).not.toContain("#define RELIEF_NONE");
		expect(sources.none).toContain("#define RELIEF_NONE");
		expect(sources.none).not.toContain("#define RELIEF_SCREEN_SPACE");
	});

	/**
	 * **Balanced conditionals**, which is the nesting check. Counted rather than
	 * parsed: the shapes here are `#ifdef`/`#else`/`#endif` with no `#if`, so a
	 * count is the whole of the grammar, and an off-by-one is exactly the bug.
	 */
	test("every conditional block is closed", () => {
		for (const [path, source] of Object.entries(sources)) {
			const opens = (source.match(/^#ifn?def /gm) ?? []).length;
			const closes = (source.match(/^#endif/gm) ?? []).length;
			expect(`${path}: ${opens} open`).toBe(`${path}: ${closes} open`);
		}
	});

	/**
	 * The airless class carries its own relief function, and #207's band has to
	 * reach it too — otherwise the one class whose relief is a crater walk keeps
	 * paying for it at four pixels across.
	 */
	/**
	 * **The airless class's own relief has its own guard, and the first version
	 * of this test could not see it** (sage, PR #254).
	 *
	 * It asserted that `RELIEF` carries an `#ifdef RELIEF_NONE` and that the
	 * airless program defines the macro — both true with `craterRelief` left
	 * wide open, because `craterRelief` is in `CLASS_GLSL.airless` and not in
	 * `RELIEF`. So the one class whose relief is a crater walk could have gone on
	 * paying for it at four pixels across, under a green test.
	 *
	 * What is asserted now is the guard itself, inside that function's body, and
	 * that it comes before the walk — a guard after the first
	 * `cratersAndGradient` would compile and would save nothing.
	 */
	test("the airless class's crater relief is guarded, before the walk", () => {
		const body = CLASS_GLSL.airless;
		const start = body.indexOf("vec3 craterRelief(");
		expect(start).toBeGreaterThanOrEqual(0);
		const fn = body.slice(start, body.indexOf("\n}", start));
		const guard = fn.indexOf("#ifdef RELIEF_NONE");
		expect(guard).toBeGreaterThanOrEqual(0);
		expect(fn.slice(guard, fn.indexOf("#endif", guard))).toContain("return N;");
		expect(guard).toBeLessThan(fn.indexOf("cratersAndGradient"));
		// And the shared one, which is a different function in a different chunk.
		expect(RELIEF).toContain("#ifdef RELIEF_NONE");
	});
});
