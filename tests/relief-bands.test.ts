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
	BAKE_MAX_PX_PER_TEXEL,
	RELIEF_BAND_HYSTERESIS,
	RELIEF_OFF_BELOW_PX,
	SCREEN_SPACE_BELOW_PX,
	focalPx,
	projectedRadiusPx,
	peakPxPerCubeTexel,
	pxPerCubeTexel,
	reliefPathFor,
	surfacePathFor,
} from "../src/relief-bands";
import { radiusAtTexelRatio } from "./lib/texel-radius";
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

/**
 * #208's band, and why it is arithmetic rather than a chosen pixel figure.
 *
 * A cube-map texel subtends a fixed angle; the visible cap of a sphere shrinks
 * as the camera approaches while the disc grows. So the resolution question the
 * node asks ("256 or 512 per layer?") has an answer that is a *function* of
 * apparent size, and the interesting part of it is that no face size serves a
 * filling planet.
 */
describe("the bake band", () => {
	// The repo's own framing: fov 60, a 900 px frame.
	const FOCAL = focalPx(900, 60);

	test("the px-per-texel table this node's proposal was posted with", () => {
		// Not a restatement of the docstring's table — this recomputes every cell
		// from the two things the frame loop actually has, so a change to the
		// formula reddens here and the docstring is the thing that goes stale
		// visibly rather than silently.
		//
		// `radiusPx = focal / m` is how the frame loop's `projectedRadiusPx` and
		// this function are the same fact, which is why `m` is not an argument.
		const cell = (m: number, facePx: number) =>
			Number(pxPerCubeTexel(FOCAL / m, FOCAL, facePx).toFixed(2));

		expect(cell(1.02, 256)).toBe(23.64);
		expect(cell(1.02, 512)).toBe(11.82);
		expect(cell(1.02, 1024)).toBe(5.91);
		expect(cell(2, 512)).toBe(1.14);
		expect(cell(3, 512)).toBe(0.65);
		expect(cell(8, 256)).toBe(0.41);
		expect(cell(20, 256)).toBe(0.16);

		// And the **peak**, which is the other question and about 2.5x this at
		// the band's own threshold. Kept beside the average so the pair cannot
		// drift into being read as one number (sage, PR #256).
		const peak = (m: number, facePx: number) =>
			Number(peakPxPerCubeTexel(FOCAL / m, FOCAL, facePx).toFixed(2));
		expect(peak(1.02, 512)).toBe(152.23);
		expect(peak(2, 512)).toBe(3.04);
		expect(peak(3, 512)).toBe(1.52);
		expect(peak(8, 256)).toBe(0.87);
		// The threshold the band actually selects on, read both ways.
		expect(cell(2.18, 512)).toBeCloseTo(1.0, 1);
		expect(peak(2.18, 512)).toBeCloseTo(2.58, 1);
	});

	test("no face size a GPU will allocate serves a filling planet", () => {
		// The finding, as a check rather than as prose. Doubling the faces halves
		// the pixels per texel, so this is the claim that the doubling has to go on
		// far past anything sane — and it is what makes #208 a band rather than a
		// replacement for the procedural program.
		//
		const fill = FOCAL / 1.02;
		for (const facePx of [2048, 4096])
			expect(
				pxPerCubeTexel(fill, FOCAL, facePx),
				`${facePx} px faces`,
			).toBeGreaterThan(BAKE_MAX_PX_PER_TEXEL);
		// The size it would take, to within a power of two — and the point is what
		// that costs rather than that it exists: six faces of 8192 is 1.6 GB per
		// body at RGBA8, on one planet, so the refusal is memory and not
		// arithmetic. By the **peak** measure even this is 9.5 screen pixels per
		// texel at the sub-camera point, which is the sharper way to say it: the
		// average reaching parity does not mean the worst pixel has.
		expect(pxPerCubeTexel(fill, FOCAL, 8192)).toBeLessThanOrEqual(
			BAKE_MAX_PX_PER_TEXEL,
		);
		expect(peakPxPerCubeTexel(fill, FOCAL, 8192)).toBeGreaterThan(9);
	});

	test("inside the surface there is no cap and no finite answer", () => {
		// A caller must not silently bake a body the camera is inside: `m ≤ 1` has
		// no visible cap at all, and any finite number here would read as "one
		// texel covers this many pixels" for a geometry that does not exist.
		expect(pxPerCubeTexel(FOCAL, FOCAL, 512)).toBe(Number.POSITIVE_INFINITY);
		expect(pxPerCubeTexel(FOCAL * 2, FOCAL, 512)).toBe(
			Number.POSITIVE_INFINITY,
		);
		// And a disc of no size, which is what a body at infinity reads as.
		expect(pxPerCubeTexel(0, FOCAL, 512)).toBe(Number.POSITIVE_INFINITY);
	});

	test("512 px faces reach parity at about two radii, where four-tap begins", () => {
		// The composition claim: #208's band starts where #207's top band starts,
		// so the two do not fight over the same rung. Bisected rather than asserted
		// as a figure, because the figure is derived and would drift with the fov.
		const crossingPx = radiusAtTexelRatio(FOCAL, 512, BAKE_MAX_PX_PER_TEXEL);
		expect(FOCAL / crossingPx).toBeGreaterThan(1.8);
		expect(FOCAL / crossingPx).toBeLessThan(2.4);
		// And the disc at that crossing is inside #207's four-tap band, so a body
		// leaving the bake lands on four-tap and not on screen-space.
		expect(crossingPx).toBeGreaterThan(SCREEN_SPACE_BELOW_PX);
		expect(reliefPathFor(crossingPx, null)).toBe("four-tap");
	});

	test("a class that cannot bake is handed straight to #207's bands", () => {
		// The whole of `bakeable: false` — a gas giant, a star, a venusian deck, or
		// a rocky body whose cube has not landed yet. Every rung must read exactly
		// what #207 alone reads, or the two bands are two answers to one question.
		for (const m of [1.02, 2, 3, 8, 20, 60, 400]) {
			const radiusPx = FOCAL / m;
			expect(surfacePathFor(radiusPx, null, false, FOCAL, 512)).toBe(
				reliefPathFor(radiusPx, null),
			);
		}
	});

	test("the band holds and releases on the right sides, and it is a ratio", () => {
		// The hysteresis, stepped twice — the reason this module is pure. Note the
		// direction: baked is the band *below* the threshold, so the widened limit
		// is the one that keeps a body baked, and getting that backwards gives a
		// body that recompiles on alternate frames at exactly the range a slow
		// approach spends seconds at.
		const at = (ratio: number) => radiusAtTexelRatio(FOCAL, 512, ratio);
		const inBand = at(BAKE_MAX_PX_PER_TEXEL * 1.02);
		const outside = at(BAKE_MAX_PX_PER_TEXEL * 1.2);
		const wellInside = at(BAKE_MAX_PX_PER_TEXEL * 0.5);

		// Coming from a procedural path: the bare limit, so the hysteresis band is
		// not a second chance to be admitted.
		expect(surfacePathFor(inBand, "four-tap", true, FOCAL, 512)).toBe(
			"four-tap",
		);
		expect(surfacePathFor(wellInside, "four-tap", true, FOCAL, 512)).toBe(
			"baked",
		);
		// Already baked: held through the band, released past it.
		expect(surfacePathFor(inBand, "baked", true, FOCAL, 512)).toBe("baked");
		expect(surfacePathFor(outside, "baked", true, FOCAL, 512)).toBe("four-tap");
	});

	test("a smaller cube leaves the band further out", () => {
		// `facePx` is the resolution of the cube this body actually has, not the
		// resolution its layer would like — a body still carrying the approach
		// layer's 256 must stop being drawn from it earlier than one that has
		// re-baked at 512. One argument, so a caller cannot hold the two apart.
		// 2.4 radii: 0.88 px per texel on a 512 cube and 1.76 on a 256, and the
		// disc is 324.8 px, which is inside #207's four-tap band — so the body
		// that leaves the bake here lands on four-tap and the two thresholds are
		// visibly independent.
		const m = 2.4;
		const radiusPx = FOCAL / m;
		expect(surfacePathFor(radiusPx, "baked", true, FOCAL, 512)).toBe("baked");
		expect(surfacePathFor(radiusPx, "baked", true, FOCAL, 256)).toBe(
			"four-tap",
		);
	});

	test("a body that has just appeared lands in the band its size says", () => {
		// `current: null` is a body after a jump or on its first frame. It inherits
		// nothing — the same rule #207's own bands follow, and the reason the
		// hysteresis cannot be written as "keep what you had".
		expect(surfacePathFor(FOCAL / 20, null, true, FOCAL, 256)).toBe("baked");
		expect(surfacePathFor(FOCAL / 1.02, null, true, FOCAL, 512)).toBe(
			"four-tap",
		);
	});
});
