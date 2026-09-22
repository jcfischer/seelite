/**
 * What a star's colour looks like when something draws it.
 *
 * Two consumers, one rule. `planet-surface.ts` paints a photosphere;
 * `backdrop.ts` paints the same systems as points in the sky. Both take the
 * tint from a **generated** colour — the class that system's own draw picked out
 * of `system.ts` — and
 * [#59](https://github.com/jcfischer/seelite/issues/59) ruled what happens next:
 * a generated tint may carry **hue and not exposure**, because an emissive whose
 * brightness comes from its own palette puts every neutral star at one
 * exposure's peak and clips all three channels together, which is a flat white
 * lamp rather than a star. So the tint is scaled onto one luma and the class is
 * left with only its colour to say.
 *
 * ## Why a module rather than a line in each consumer
 *
 * The exposure is a tuned figure — 0.55 was set against the star shader's own
 * 1.52 peak gain — and a second copy of it does not fail, it *drifts*: the
 * consumer with the older number keeps rendering, slightly off the rest of the
 * sky, and the only way to notice is to compare two pictures. `backdrop.ts` is
 * headless and `planet-surface.ts` is nothing but Three.js, so the number could
 * not live in either of them without one importing the other. That is this file.
 *
 * ## Why the conversion is written out at all
 *
 * Converting an sRGB hex to linear light has a correct answer and an
 * implementation already in the bundle — three's `ColorManagement`. It is
 * written out here because a headless module cannot call it without importing
 * three, which is the coupling `tests/headless.test.ts` exists to refuse. The
 * risk of writing it twice is exactly the risk that module guards against, so
 * `tests/star-colour.test.ts` measures the two implementations against each
 * other over every colour the game can draw. That row, not this paragraph, is
 * what keeps the copy honest.
 */

/**
 * The one luma every photosphere is drawn at.
 *
 * 0.55 puts the star shader's peak (1.52 × 0.55 ≈ 0.84) under the tone curve's
 * knee for a neutral tint and leaves the warm end almost where it already was —
 * the fix pulls the bright classes down to a working exposure rather than
 * pushing every class up to one.
 *
 * **The measurement it came from is here, in one place.** The evidence is a
 * neutral tint clipping all three channels at once, which draws a flat white disc:
 * measured on `?seed=15`, whose star is `0xf8f7ff`, a disc mean of 235 with a
 * granulation spread of 2.8 against 199 and 4.5 for a warm one — the difference
 * between a lamp and a star. Those two figures describe the build *before* this
 * constant existed and cannot be re-derived from the tree, because nothing ships a
 * way to disable the normalisation; what `probe-planet-surfaces.mjs` checks on every
 * run is the property they were evidence for, that the disc has granulation and the
 * bloom pass is not where it comes from. `planet-surface.ts`'s `photosphereTint` is
 * this constant's consumer, not its owner.
 */
export const PHOTOSPHERE_LUMA = 0.55;

/**
 * Rec. 709 luma coefficients — the weights a luminance reading is taken with
 * here, and the same ones `probe-planet-surfaces.mjs` measures pixels with.
 *
 * Named rather than inlined because two consumers read a luma, and a luma
 * computed with the other pair of coefficients is a different quantity that
 * looks identical in a diff.
 */
const REC709_R = 0.2126;
const REC709_G = 0.7152;
const REC709_B = 0.0722;

/** A linear-light triple, `[r, g, b]`, each in 0..1. */
export type LinearRgb = readonly [number, number, number];

/**
 * The standard sRGB electro-optical transfer, per channel.
 *
 * Piecewise, and the knee matters: below 0.04045 the curve is a straight line
 * through the origin, so the darkest codes are *darker* in linear light than a
 * naive `/255` suggests. This is three's `SRGBToLinear` written in the textbook
 * spelling — `c/12.92` and `((c+0.055)/1.055)^2.4` are the same two expressions
 * as three's `c*0.0773993808` and `(c*0.9478672986+0.0521327014)^2.4`, to the
 * last figure — and the equivalence is a test row, not a claim.
 */
export const srgbToLinear = (c: number): number =>
	c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/** A packed `0xrrggbb` hex, as `system.ts`'s star classes carry it, in linear light. */
export function hexToLinearRgb(hex: number): LinearRgb {
	// The floor and the mask are three's `setHex` spelled the same way: the low
	// 24 bits, high byte first, each divided by 255 *before* the transfer.
	const r = ((hex >> 16) & 255) / 255;
	const g = ((hex >> 8) & 255) / 255;
	const b = (hex & 255) / 255;
	return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

/** Perceptual-ish luma of a linear-light triple. */
export const rec709Luma = (r: number, g: number, b: number): number =>
	REC709_R * r + REC709_G * g + REC709_B * b;

/**
 * A star class's colour at the one exposure every photosphere is drawn at.
 *
 * A positive scaling of {@link hexToLinearRgb}, so the hue survives whole and
 * only the exposure changes. Black passes through unscaled: it has no hue to
 * preserve and dividing by its luma is a division by zero rather than a dark
 * star. No class the generator ships is black, and a colour that starts at zero
 * in every channel is a palette bug worth seeing rather than a case to hide.
 */
export function photosphereTintLinear(hex: number): LinearRgb {
	const [r, g, b] = hexToLinearRgb(hex);
	const luma = rec709Luma(r, g, b);
	if (luma <= 0) return [0, 0, 0];
	const k = PHOTOSPHERE_LUMA / luma;
	return [r * k, g * k, b * k];
}
