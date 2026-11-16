/**
 * Which fragment program a planet gets, from how big it looks — node #207.
 *
 * The only level of detail before this was vertex count: 32x16 in the far layer
 * and 96x64 otherwise. A four-pixel disc ran the same fragment shader as a
 * full-screen one, and #248's ladder priced that shader — at device scale 2 a
 * filling planet is 43.5 ms, of which **27.7 is the normal perturbation
 * alone**, four extra `height()` calls per fragment. The bands stop paying for
 * detail there are no pixels to show.
 *
 * **Both imports are types**, so neither the appearance vocabulary nor
 * `planet-shaders.ts` — three behind it — reaches the built module. Not a leaf
 * in the sense `units.ts` and `vec3.ts` are, which have no import line at all;
 * near enough to one that the band rule can be stepped twice and compared in a
 * headless test, which is the only way to check hysteresis. Hysteresis is a
 * state machine, and a state machine inside a render loop is one nothing can
 * drive. `tests/headless.test.ts` holds the type-only property, because a
 * value import of either name would compile and would drag a renderer in
 * behind it.
 */
import type { SurfaceClass } from "./planet-appearance";
import type { ReliefPath } from "./planet-shaders";

/**
 * Below this many pixels of apparent radius, no relief at all.
 *
 * About one part in twenty of a 900 px frame's height. Under it the disc is a
 * bright dot with a terminator, and #248 measured the whole planet at 0.1 ms
 * there against 2.4 ms for the rest of the frame — so the saving in this band
 * is real but unmeasurable, and no test here asserts one. It is built because
 * it costs nothing to build and because the alternative is 150 noise calls a
 * fragment for a body four pixels across.
 */
export const RELIEF_OFF_BELOW_PX = 40;

/**
 * Below this many pixels, the screen-space path; above it, four-tap.
 *
 * 300 px of radius is a disc filling two thirds of a 900 px frame's height,
 * which is where the four-tap path's finer resolution starts being visible —
 * it is the one that resolves detail below two pixels, and below two pixels is
 * where the screen-space path quantises (`planet-classes.glsl.ts`).
 *
 * **This is where the value is.** At 3 radii the disc is 259.8 px and #248's
 * ladder reads 10.4 ms four-tap against 5.3 screen-space at device scale 2 —
 * so the band is worth 5.1 ms at the rung it is nearest to.
 *
 * **And this is what the node cannot decide on its own.** At a *filling*
 * planet, 2 radii and closer, the threshold keeps four-tap by construction, so
 * #207 leaves the 43.5 ms frame exactly as it is. Moving it up is #217's
 * per-class relief policy arriving by another door, and it is a look change at
 * fill: the principal rules on that, not this node.
 */
export const SCREEN_SPACE_BELOW_PX = 300;

/**
 * The band a threshold is not re-crossed inside, as a ratio.
 *
 * The same shape and the same figure as `HANDOFF_HYSTERESIS` (`units.ts`), and
 * for a sharper reason than the layer handoff has. Every band change is a
 * **shader recompile**: the path is a `#define`, so the two programs are
 * different programs. A body sitting on a threshold — which is what a body on
 * a slow approach does for several seconds — would recompile on alternate
 * frames, and a recompile is a hitch the player sees.
 *
 * Restated rather than imported so this module stays a leaf; the value is the
 * same by intent and `tests/relief-bands.test.ts` is where that is written
 * down. It is not the same *decision*: this one is about compile hitches and
 * that one is about draw order, and they could diverge.
 */
export const RELIEF_BAND_HYSTERESIS = 1.05;

/**
 * The focal length in pixels, for a vertical field of view over a height.
 *
 * **CSS pixels, not drawing-buffer pixels**, and the reason is that a cost dial
 * must not move a look. `renderScale` (#225) steps the drawing buffer
 * 1 → 0.75 → 0.5 under the player; in buffer pixels a planet at a fixed range
 * would cross a band when the player changed a *performance* setting, so
 * turning the resolution down would also flatten the terrain. One dial, two
 * effects, and the second invisible from the row that caused it.
 *
 * The trade is that a retina player pays the four-tap path over four times the
 * fragments at the same apparent size. That is the correct trade: the disc is
 * the same size on the glass and shows the same detail, and paying for detail
 * that is visible is what the bands are for.
 */
export const focalPx = (cssHeightPx: number, fovDeg: number): number =>
	cssHeightPx / 2 / Math.tan((fovDeg * Math.PI) / 360);

/**
 * A body's apparent radius in pixels.
 *
 * **Physical kilometres for both arguments, so the layer scale cancels.** A
 * body's layer is its distance (#15) and each layer draws at its own factor,
 * but that factor multiplies radius and distance alike. Reading a scaled radius
 * against an unscaled distance would flip a band at the handoff with nothing
 * about the picture having changed — and reading either back out of an
 * `Object3D` is what this repo forbids outright.
 *
 * The small-angle form rather than `atan`: the two agree to a percent out to a
 * quarter of the frame and diverge only where the disc is already filling it,
 * which is deep inside the top band either way.
 */
export const projectedRadiusPx = (
	radiusKm: number,
	distanceKm: number,
	focal: number,
): number => (distanceKm > 0 ? (radiusKm / distanceKm) * focal : 0);

/**
 * The program for a disc of this apparent radius, given the one it has now.
 *
 * `current` is `null` for a body that has just appeared — after a jump, or on
 * its first frame — and such a body lands in the band its size says rather than
 * inheriting a neighbour's.
 *
 * Written as one rule over two thresholds rather than as two independent ones,
 * because two would let a body fall from four-tap past the middle band when the
 * upper release happened to be tested against the lower threshold.
 */
export function reliefPathFor(
	radiusPx: number,
	current: ReliefPath | null,
): Exclude<ReliefPath, "analytic-gradient"> {
	// Rising into a band takes the threshold; falling out of one takes the
	// threshold divided by the band, so the two directions differ by exactly
	// `RELIEF_BAND_HYSTERESIS` and a disc inside it keeps what it has.
	const off =
		current === "none"
			? RELIEF_OFF_BELOW_PX
			: RELIEF_OFF_BELOW_PX / RELIEF_BAND_HYSTERESIS;
	const screen =
		current === "four-tap" || current === "analytic-gradient"
			? SCREEN_SPACE_BELOW_PX / RELIEF_BAND_HYSTERESIS
			: SCREEN_SPACE_BELOW_PX;
	if (radiusPx < off) return "none";
	if (radiusPx < screen) return "screen-space";
	return "four-tap";
}

/**
 * Screen pixels per cube texel **averaged over the visible cap**.
 *
 * How much of the height field a cube can hold at the size the body is drawn:
 * the disc's diameter divided by the number of texels the visible cap spans. A
 * cube texel subtends a fixed angle — at face centre `2 / facePx` radians — and
 * the cap at `m` radii spans `2·acos(1/m)` of surface arc, so approaching a body
 * grows the disc while shrinking the cap it shows and the two move against each
 * other.
 *
 * **This is the average and not a bound, and the difference is sage's**
 * (PR #256). At the sub-camera point the surface is face-on and the same texel
 * spans `peakPxPerCubeTexel` below — 2.5 times this at two and a half radii —
 * so a docstring calling this "the most screen pixels one texel may cover" was
 * false by that factor. Both are kept because they answer different questions
 * and the wrong one was being asked:
 *
 * - the **peak** is what magnification looks like at the worst pixel;
 * - the **average** is how much of the height field the cube can hold at the
 *   size the body is drawn, which is what the band is actually choosing on.
 *
 * **The two framings this node measured cannot separate them, and an earlier
 * version of this docstring claimed they could** on figures that were wrong by
 * a factor of two. What the probe compares is 4 radii on a 256 face and 2.5
 * radii on a 512: the peaks there are *identical* at 2.030 and the averages are
 * 0.907 and 0.825, so the two measures order the two rungs the same way and
 * neither is refuted. The disagreements are 2.1% and 1.2% of the disc mean.
 * The average is selected on for the resolution argument above and not because
 * anything here measured it to be the better predictor; the peak is exported
 * beside it so nobody has to infer the magnification from a number that is not
 * one.
 *
 * Read off the repo's own fov 60 and a 900 px frame (`focalPx` 779.4):
 *
 *     m       disc radius px   256      512     1024
 *     1.02        764.1        23.64    11.82    5.91
 *     2           389.7         2.28     1.14     0.57
 *     3           259.8         1.30     0.65     0.32
 *     8            97.4         0.41     0.21     0.10
 *     20           39.0         0.16     0.08     0.04
 *
 * A **filling** planet would need faces around 6,000 px to reach one screen
 * pixel per texel even by this measure, and 150,000 by the peak. That is the
 * finding that shapes the node: the bake cannot be sharp at a frame it can
 * nonetheless draw for 7.9 ms instead of 44.6.
 *
 * `m` is recovered from the apparent radius rather than passed, because the
 * frame loop has the apparent radius already and the two carry the same fact:
 * `radiusPx = focal / m`. Inside the surface (`m <= 1`) there is no cap and no
 * finite answer, which is `Infinity` rather than a clamp — a caller must not
 * silently bake a body the camera is inside.
 */
export function pxPerCubeTexel(
	radiusPx: number,
	focal: number,
	facePx: number,
): number {
	if (radiusPx <= 0 || facePx <= 0) return Number.POSITIVE_INFINITY;
	const m = focal / radiusPx;
	if (!(m > 1)) return Number.POSITIVE_INFINITY;
	const capDeg = (2 * Math.acos(1 / m) * 180) / Math.PI;
	const texelsAcross = capDeg / (90 / facePx);
	return (2 * radiusPx) / texelsAcross;
}

/**
 * Screen pixels per cube texel **at the worst pixel** — the sub-camera point.
 *
 * There the surface is face-on and the arc a texel subtends is divided by the
 * *altitude* rather than by the distance to the body's centre, so this rises
 * without bound as the camera lands. A cube face's texels are not uniform in
 * angle either: its directions are `normalize(u, v, 1)` with `u` spanning
 * [-1, 1] across `facePx` texels, so at face centre one texel is `2 / facePx`
 * radians and towards a corner it is less — the centre is the widest and
 * therefore the one a bound is about.
 *
 * Nothing selects on this. It exists because the band selects on an *average*
 * and a reader is owed the number that average is not: at the band's own
 * threshold the peak magnification is about 2.5x, and calling the average a
 * bound is the claim sage caught (PR #256).
 *
 *     m       256      512     1024
 *     1.02   304.5    152.2     76.1
 *     2        6.09     3.04     1.52
 *     3        3.04     1.52     0.76
 *     8        0.87     0.43     0.22
 */
export function peakPxPerCubeTexel(
	radiusPx: number,
	focal: number,
	facePx: number,
): number {
	if (radiusPx <= 0 || facePx <= 0) return Number.POSITIVE_INFINITY;
	const m = focal / radiusPx;
	if (!(m > 1)) return Number.POSITIVE_INFINITY;
	return (focal * (2 / facePx)) / (m - 1);
}

/**
 * How coarse a cube may be, in screen pixels per texel averaged over the cap,
 * before the bake is refused.
 *
 * One, which is parity by that measure: the cube holds a texel for every pixel
 * the disc covers — **one CSS pixel**, which is not one of the player's.
 * `focalPx` is deliberately in CSS pixels so a resolution dial cannot move a
 * look (its own docstring argues that), and the consequence is that on a
 * device-scale-2 display the band admits a cube at *two* physical pixels per
 * texel. Every table here and the cost tables the node quotes are the same
 * framing measured two ways, and the word "parity" belongs to the CSS one
 * (sage, PR #256, round 4). It is **not** parity at the worst pixel, where the same
 * threshold is about 2.5 screen pixels per texel — see `peakPxPerCubeTexel`,
 * and see why the average is nonetheless the criterion that predicts agreement.
 *
 * What the figure is worth, measured rather than argued:
 *
 * - a terran world at 2 radii on a 512 face — 1.14 by this measure, just past
 *   the threshold and only reachable with the band pinned — reads 0.13% of
 *   pixels moved past 24/255 between the two programs, and the frames cannot be
 *   told apart by eye;
 * - `probe-planet-surfaces.mjs` compares patch means at 4 radii on a 256 face
 *   (0.907) and 2.5 radii on a 512 (0.825), with `four-tap` pinned on the
 *   control arm, and reads 2.1% and 1.2% of the disc mean against a corrupted
 *   bake's 47.6% and 31.8%.
 *
 * What is *not* claimed is that nothing changes. `planet-terminator` frames a
 * body at about 4.3 radii on a 256 face — 0.83 — and the baked surface there is
 * visibly **smoother**, 4.76% of the frame against a same-build control of
 * 0.00%. **The cause is not established.** An earlier version of this said it
 * was the mip chain and quoted 0.55 pixels per texel at that framing; the
 * repo's own arithmetic puts it at 0.83, where the LOD is near zero and mip 0
 * dominates, so the explanation and its figure were both wrong and no arm with
 * mipmaps off or a 512 face forced was ever run (sage, PR #256, round 4). What
 * is measured is the difference, not its mechanism. So this constant is the dial the principal rules on, and lowering it
 * trades the near rungs back for sharpness — **all of them**, which an earlier
 * version of this line understated (sage, PR #256, round 3). At 1 a 512 face
 * enters at 2.184 radii and a 256 at 3.689. At 0.5 those become 3.689 and
 * 6.728, so the 3-radius frame (0.648 on a 512) falls outside the band along
 * with the 2-radius one: 10.8 ms and 24.8 ms both stay procedural and what is
 * left is 8 radii and beyond. There is no setting that keeps 3 r and gives up
 * 2 r, because one face size covers both.
 */
export const BAKE_MAX_PX_PER_TEXEL = 1;

/**
 * The cube face sizes a body may hold, smallest first.
 *
 * **Chosen by apparent size, not by render layer**, and the first version of
 * this node got that wrong in a way nothing rendered differently. It gave the
 * `near` layer 512 and the other two 256 — which reads sensibly and is dead
 * code, because `massiveLayerFor` (`units.ts`) admits a massive body to
 * `approach` or `far` and **never** to `near`: the near layer is for stations
 * and the ship. Every planet in the game held a 256 cube however close it got,
 * and the 512 rung was never allocated.
 *
 * Two sizes and a cap of 512. A 256 face reaches `BAKE_MAX_PX_PER_TEXEL` at
 * about 3.69 radii and a 512 at about 2.18, so the second rung is what brings
 * the **3-radius** frame inside the band — 10.8 ms procedural against 3.5 baked,
 * at device scale 2. The 2-radius frame is *outside* it: 2 is nearer than 2.18,
 * and its 24.8-against-5.3 was measured with the band pinned. An earlier version
 * of this sentence claimed both and contradicted itself in its own numbers
 * (sage, PR #256, round 4). A third rung
 * would buy the 1.5-radius frame and cost 64 MB on one body, and no rung any
 * GPU will allocate reaches a *filling* planet: `pxPerCubeTexel`'s table has a
 * 512 face at 152 screen pixels per texel there.
 */
export const BAKE_FACE_SIZES = [256, 512] as const;

/**
 * The face size this body should hold, given the one it has.
 *
 * The **smallest** that reaches parity, so a body two hundred radii away is not
 * holding 16 MB to be drawn four pixels across; the largest allowed when none
 * does, because a body inside the cap's reach is about to leave the band anyway
 * and re-baking it smaller on the way in would be two recompiles instead of
 * none.
 *
 * Hysteresis on the size it already has, for the reason every band here has it:
 * a re-bake is twelve full-screen evaluations of the most expensive shader in
 * the game, and a body on a slow approach sits on a threshold for seconds.
 */
export function bakeFacePxFor(
	radiusPx: number,
	focal: number,
	current: number | null,
): number {
	for (const facePx of BAKE_FACE_SIZES) {
		const limit =
			facePx === current
				? BAKE_MAX_PX_PER_TEXEL * RELIEF_BAND_HYSTERESIS
				: BAKE_MAX_PX_PER_TEXEL;
		if (pxPerCubeTexel(radiusPx, focal, facePx) <= limit) return facePx;
	}
	return BAKE_FACE_SIZES[BAKE_FACE_SIZES.length - 1];
}

/**
 * What draws a body's surface: a baked cube, or one of #207's relief programs.
 *
 * `"baked"` is not a `ReliefPath` and deliberately does not join that union —
 * the baked program has no relief path at all, because the normal comes out of
 * a texture rather than out of `height()`. A body drawn baked has no meaningful
 * answer to "which relief program", and widening `ReliefPath` would have every
 * consumer of it silently accept one.
 */
export type SurfacePath = "baked" | ReliefPath;

/**
 * Every drawable planet class; a star has its own fragment program.
 *
 * Derived from the appearance vocabulary through a type-only import. If
 * `SurfaceClass` gains a member, this selector's record no longer type checks
 * until the policy is amended; the runtime test also compares it to the perf
 * roster.
 */
export type PlanetReliefClass = Exclude<SurfaceClass, "star">;

/**
 * The full-detail procedural relief program each class ships with (#224).
 *
 * This is deliberately a complete record rather than a default plus one
 * exception. A newly introduced surface class must make the compiler reject
 * this policy until it has been looked at, instead of quietly inheriting a
 * path whose visual trade-off was never reviewed. The apparent-size and bake
 * bands remain separate: this policy only replaces their full-detail
 * `"four-tap"` rung.
 */
export type PlanetReliefPolicy = {
	[K in PlanetReliefClass]: Extract<
		ReliefPath,
		| "four-tap"
		| "screen-space"
		| (K extends "terran" ? "analytic-gradient" : never)
	>;
};

export const PLANET_RELIEF_PATHS = {
	terran: "screen-space",
	desert: "screen-space",
	ice: "screen-space",
	lava: "screen-space",
	venusian: "screen-space",
	airless: "four-tap",
	jovian: "screen-space",
	iceGiant: "screen-space",
} as const satisfies PlanetReliefPolicy;

/**
 * Apply #224's class policy after the apparent-size and bake bands chose a
 * path. Forced perf-panel paths do not call this function, so A/B measurement
 * can still select either compiled relief program for every class.
 */
export function surfacePathWithClassPolicy(
	surface: SurfaceClass,
	path: SurfacePath,
): SurfacePath {
	if (surface === "star" || path !== "four-tap") return path;
	return PLANET_RELIEF_PATHS[surface];
}

/**
 * The program for a disc of this apparent radius — #208's band over #207's.
 *
 * `bakeable` is the class's own answer (`planet-bake.ts`): a class whose
 * `surface()` reads `time` cannot be baked, and a body with no cube yet cannot
 * be drawn from one. `facePx` is the resolution of **the cube this body
 * actually has**, so a body carrying an approach-layer 256 cube crosses out of
 * the band further away than one carrying a near-layer 512.
 *
 * The hysteresis is on the *ratio*, not on a pixel threshold, for the reason
 * `RELIEF_BAND_HYSTERESIS` gives: every crossing is a program swap, and a body
 * on a slow approach sits on the threshold for seconds.
 */
export function surfacePathFor(
	radiusPx: number,
	current: SurfacePath | null,
	bakeable: boolean,
	focal: number,
	facePx: number,
): SurfacePath {
	const relief = () =>
		reliefPathFor(radiusPx, current === "baked" ? null : current);
	if (!bakeable) return relief();
	// Held in the band once entered, released past it — the same direction as
	// `layerFor`, and note which way "in" is here: baked is the band *below* the
	// threshold, so the widened limit is the one that keeps a body baked.
	const limit =
		current === "baked"
			? BAKE_MAX_PX_PER_TEXEL * RELIEF_BAND_HYSTERESIS
			: BAKE_MAX_PX_PER_TEXEL;
	return pxPerCubeTexel(radiusPx, focal, facePx) <= limit ? "baked" : relief();
}
