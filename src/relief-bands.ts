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
 * **One import, and it is a type**, so nothing of `planet-shaders.ts` — three
 * included — reaches the built module. Not a leaf in the sense `units.ts` and
 * `vec3.ts` are, which have no import line at all; near enough to one that the
 * band rule can be stepped twice and compared in a headless test, which is the
 * only way to check hysteresis. Hysteresis is a state machine, and a state
 * machine inside a render loop is one nothing can drive.
 * `tests/headless.test.ts` holds the type-only property, because a value import
 * of the same name would compile and would drag a renderer in behind it.
 */
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
): ReliefPath {
	// Rising into a band takes the threshold; falling out of one takes the
	// threshold divided by the band, so the two directions differ by exactly
	// `RELIEF_BAND_HYSTERESIS` and a disc inside it keeps what it has.
	const off =
		current === "none"
			? RELIEF_OFF_BELOW_PX
			: RELIEF_OFF_BELOW_PX / RELIEF_BAND_HYSTERESIS;
	const screen =
		current === "four-tap"
			? SCREEN_SPACE_BELOW_PX / RELIEF_BAND_HYSTERESIS
			: SCREEN_SPACE_BELOW_PX;
	if (radiusPx < off) return "none";
	if (radiusPx < screen) return "screen-space";
	return "four-tap";
}

/**
 * How many screen pixels one cube-map texel covers, at this apparent size.
 *
 * #208 asks which face resolution a baked planet needs, and the answer is not a
 * preference. A cube texel subtends a fixed **angle** — about `90° / facePx` at
 * face centre — while the visible cap of a sphere at `m` radii spans
 * `2·acos(1/m)` of surface arc across the disc's projected diameter. Approach a
 * body and the disc grows while the cap it shows *shrinks*, so the two move
 * against each other and no face size closes the gap.
 *
 * Read off the repo's own fov 60 and a 900 px frame (`focalPx` 779.4), over
 * #207's rungs, in screen pixels per texel:
 *
 *     m       disc radius px   256      512     1024
 *     1.02        764.1        23.64    11.82    5.91
 *     2           389.7         2.28     1.14    0.57
 *     3           259.8         1.30     0.65    0.32
 *     8            97.4         0.41     0.21    0.10
 *     20           39.0         0.16     0.08    0.04
 *
 * A **filling** planet would need faces around 6,000 px to reach one pixel per
 * texel. That is the finding that shapes this node: the bake cannot serve the
 * frame #248 measured at 43.5 ms, and 512 px faces reach parity at about two
 * radii — which is exactly where #207's four-tap band already begins.
 *
 * `m` is recovered from the apparent radius rather than passed, because the
 * frame loop has the apparent radius already and the two carry the same fact:
 * `radiusPx = focal / m`. Inside the surface (`m ≤ 1`) there is no cap and no
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
 * The most screen pixels one cube texel may cover before the bake is refused.
 *
 * One, and it is a resolution argument rather than a tuned figure: at one pixel
 * per texel a sampled cube carries every detail the screen can show, and above
 * it the surface is being magnified — soft where the procedural program is
 * crisp. It is the single authored constant of the band; the *threshold in
 * pixels* is derived from it through `pxPerCubeTexel`, so it follows the
 * viewport and the face size instead of being a magic 390 that is right for one
 * window height and wrong for every other.
 */
export const BAKE_MAX_PX_PER_TEXEL = 1;

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
