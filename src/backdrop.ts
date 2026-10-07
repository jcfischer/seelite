/**
 * The sky behind everything: two populations, one shader, and only one of them
 * invented.
 *
 * Headless on purpose — it produces plain typed arrays and knows nothing about
 * Three.js. Two reasons, and only the second is about tests:
 *
 * 1. It is the one part of the backdrop that has to be *identical* between two
 *    runs of the same seed, and a function returning buffers is something a
 *    test can compare element by element. A function that returned a
 *    `THREE.Points` would not be.
 * 2. The renderer's job is to wrap these in a `BufferGeometry`, which is three
 *    lines and no decisions.
 *
 * ## Which half is which
 *
 * This file used to claim its points were "the bright, nameable stars — the ones
 * that are also systems you can jump to", and drew 4,000 of them scattered
 * uniformly without reading the galaxy; #100's design, shipped as a fiction. The
 * history is §12's and the PR's to tell. What a reader of this module needs is
 * the two producers:
 *
 * - **{@link systemField} is the claim.** One point per other system — 255, a
 *   system cannot see itself — at its true bearing through `galaxy-frame.ts`, in
 *   the colour of the sun a pilot finds there, sized by distance.
 * - **{@link faintField} is the fiction**, and stays one, because 255 points is
 *   not a night; it supplies the density the real layer cannot and nothing else.
 *
 * The findings behind those two sentences — how thin the real layer is, what the
 * invented layer is allowed to reach, what each costs — are measurements, so they
 * live once, in `docs/specs/galaxy-generation.md` §12, whose source is
 * `scripts/measure-sky-density.ts`. This file carried three copies of two of them
 * for a round of review, which is the drift that rule exists to stop.
 *
 * ## Why two buffers, and so two `Points`
 *
 * Not because there are two ideas — there is one sky — but because **the two
 * layers go stale on different days.** The faint population is a function of the
 * world seed and is built once. The derived layer is a function of which system
 * the player is standing in and is rebuilt on every witchspace transition.
 * One geometry would mean re-uploading 4,255 vertices to change 255 of them; two
 * means an arrival reallocates its own three small buffers and the texture is
 * never touched again — what that costs in bytes and milliseconds is printed by
 * `measure-sky-density.ts cost` and carried by §12, not by this comment.
 * They share one `ShaderMaterial`, because everything that differs between them
 * is already in the attributes and a second material would be a second program
 * for an identical shader.
 *
 * ## What the picture is made of, and where the figures live
 *
 * Three findings decided this file's shape, and they are measurements rather
 * than opinions, so they are written down once — in
 * `docs/specs/galaxy-generation.md` §12, whose
 * source is `scripts/measure-sky-density.ts`. Only the two that a dial here
 * depends on are restated, beside the dial:
 *
 * - The cluster is oblate (`GALAXY_FLATTENING_Q`), but its plane is a **gentle
 *   ridge** in a sky rather than a band, and the invented layer outnumbers the
 *   real one by an order of magnitude in every direction. So a count cannot
 *   carry the cluster's shape; brightness is the only channel that can, which is
 *   what the two size bands below are for. The loud structure is the cone on the
 *   centre, and that one comes free from bearings nobody tuned.
 * - The sky is thin enough that **distance has to be what carries brightness**,
 *   because there is nothing else to order 255 points by.
 *
 * ## The law on each point, and the invariant between the layers
 *
 * Three rules, one line each — §12 carries the paragraphs, and this file already
 * carried them near-verbatim alongside the spec and `CONTEXT.md`, which is the
 * same triplication of a figure that this node spent five rounds removing.
 *
 * - **Size is flux:** an additive disc's light goes as `size²`, so `size ∝ 1/d`
 *   *is* flux `∝ 1/d²` — #100's inverse square, no invented exponent, no dial.
 * - **Colour is class, never exposure** (#59 one scale down), which is what makes
 *   the size law a statement about distance and one thing only.
 * - **No invented point is drawn larger than the smallest real star:**
 *   {@link FAINT_SIZE_MAX} sits under {@link BRIGHT_SIZE_MIN}, held in
 *   `tests/backdrop.test.ts`, and that ordering is the picture's legibility: the
 *   bright points are the places you can go and the grain behind them is not.
 *   **Its scope is the size, and the sentence used to claim more than that.** A
 *   point's delivered light is `size²` times its tint, the two layers' tints are on
 *   different authoring scales ({@link faintField}'s ramp is picked by eye in linear
 *   light and is not normalised, while {@link systemField}'s is), and `grain` mode
 *   prints the share of the invented population whose luma is high enough that a
 *   *largest* invented point outshines a *smallest* real one, and — jointly, each
 *   point's own size against its own tint — what share actually does it. Both rows
 *   print in `measure-sky-density.ts grain`; neither figure is repeated here, because
 *   the marginal one is a bound at maximum size and was read as a share once already.
 *   Closing the gap is a colour decision, not a size one: normalise the
 *   ramp to the same photosphere exposure or drop `FAINT_SIZE_MAX` further, and both
 *   move the look, so it is #433's sheet to settle.
 *
 * **All three are laws of the buffers, and in cruise the screen breaks them on
 * purpose (#537).** While the light shift is drawn, the star shader pulls every
 * point's colour toward the starbow and scales its size by 0.7–1.6× with its
 * Doppler factor (`light-shift.ts`), so on screen colour is no longer class alone
 * and a beamed faint point can outsize an unbeamed real one. At rest it is off,
 * and the buffers are what the tests hold.
 */

import { type Galaxy, type SystemRecord, distanceLy } from "./galaxy";
import { skyBearing, skyFrame } from "./galaxy-frame";
import { streamFor } from "./rng";
import { photosphereTintLinear } from "./star-colour";
import { starClassFor } from "./system";
import { BACKDROP_RADIUS } from "./units";

export interface StarField {
	/** xyz triples on a sphere of radius `BACKDROP_RADIUS`. */
	positions: Float32Array;
	/** rgb triples, 0..1, **linear light** — the space the shader multiplies in.
	 *
	 * It has two producers, and they get there differently, which is worth naming
	 * because #433's bake reads this same attribute. {@link systemField} derives
	 * each triple from the star-class hex through `star-colour.ts`, so its values
	 * carry #59's one photosphere exposure and an actual sRGB→linear transfer.
	 * {@link faintField} authors its ramp by eye *in this space*, with no
	 * transfer: an eye-picked `0.38` is here a **linear** 0.38, which is a darker
	 * number than the eye that chose it imagined. Both are therefore legal per
	 * this declaration and they are not the same act of authoring. Whether the
	 * invented ramp should be re-authored in sRGB and transferred is a look call
	 * on #433's sheet — it moves the grain's colour, not its size, and this node
	 * deliberately did not spend its one look change on it.
	 */
	colors: Float32Array;
	/** Per-point size, in the units `PointsMaterial` wants. */
	sizes: Float32Array;
	count: number;
}

/**
 * How many invented points the sky carries.
 *
 * A density, not a budget. It is set to the order of magnitude of a human
 * naked-eye sky — the densities on both sides, and how far the real layer falls
 * short of that, are §12's to carry and `measure-sky-density.ts band` to reprint
 * — and the draw is nothing either way: the research puts the point where a
 * `Points` layer starts costing anything nearer 10⁵, so cutting this buys no
 * milliseconds and thins the night.
 */
export const FAINT_COUNT = 4000;

/**
 * The invented population's size band, in the units the point shader wants.
 *
 * The law is `min + span · u⁶`: a steep curve so the field is mostly faint
 * pinpricks with a few brighter ones. A flat distribution reads as static rather
 * than as a sky, which is why the shape is kept from the version of this file
 * that was the whole sky.
 *
 * The band sits **entirely below** the derived layer's floor, and §12's counts
 * are why it has to: the invented layer outnumbers the real one by an order of
 * magnitude in every direction, so how much light each layer contributes is the
 * only channel left in which the real layer is visible as structure.
 *
 * **What that costs, stated rather than left to be noticed:** over `size²`, which
 * is what an additive disc delivers as light, this band costs the invented layer a
 * large fraction of what the law it replaced gave it — and almost none of it comes
 * off the typical point, because what the invariant actually removes is the old
 * law's bright tail: its handful of oversized discs, at random bearings, at sizes
 * indistinguishable from the systems the sky is a picture *of*. The ratio, the two
 * bands' moments and the px conversion are §12's to carry and
 * `measure-sky-density.ts grain` to reprint; what to make of the resulting night
 * is #433's sheet.
 */
export const FAINT_SIZE_MIN = 0.0048;
export const FAINT_SIZE_SPAN = 0.0048;
export const FAINT_SIZE_MAX = FAINT_SIZE_MIN + FAINT_SIZE_SPAN;

/**
 * The derived layer's size band, in the same units the point shader wants; what
 * each end of it looks like in a real sky is §12's.
 *
 * `FAINT_SIZE_MAX` under {@link BRIGHT_SIZE_MIN} is a relationship, held by a
 * test; read those four numbers as one rule about which layer is allowed to be
 * bright, not as four settings.
 */
export const BRIGHT_SIZE_MIN = 0.012;
export const BRIGHT_SIZE_MAX = 0.055;

/**
 * The distance at which a real system draws at the middle of the band.
 *
 * **21.1 ly is a measurement**: the **pooled** median separation between two systems
 * in a 256-system galaxy, one sample per ordered observer-to-system pair, printed by
 * `scripts/measure-sky-density.ts sky` and carried by §12 rather than by this comment.
 * **Pooled** is the word that matters: the median *of* every observer's own median
 * separation is a different statistic and runs higher, and this constant was anchored
 * to that one for a round. The middle of a reciprocal law is the geometric mean of the
 * two clamps, so this single figure sets where the whole sky sits: move it and every
 * star in the game moves up or down together, which is why it is a measured number
 * rather than a pleasant one.
 */
export const BRIGHT_SIZE_MID_LY = 21.1;

/** The law's constant: `size = K / d`, which is flux `∝ 1/d²` drawn at constant
 *  surface brightness — the geometric mid of the band, placed at the measured
 *  mid distance.
 *
 *  Exported because the two clamps are *this* divided by the two band ends, and
 *  an instrument that wants to say where the law saturates has to divide the
 *  same constant rather than re-multiply the three dials and hope. */
export const BRIGHT_SIZE_K =
	BRIGHT_SIZE_MID_LY * Math.sqrt(BRIGHT_SIZE_MIN * BRIGHT_SIZE_MAX);

/**
 * Where the law reaches its ceiling, in light years: `K / MAX`.
 *
 * A named constant rather than a figure in a comment because the comment is what
 * #431's first review round got wrong: the header quoted 9.07 ly beside a `K`
 * that had moved, and nothing could catch it. `tests/backdrop.test.ts` now holds
 * the distance against the law, and `measure-sky-density.ts` prints it beside the
 * share of the sky the ceiling actually catches.
 */
export const BRIGHT_CEILING_LY = BRIGHT_SIZE_K / BRIGHT_SIZE_MAX;

/** Where the law reaches its floor, in light years: `K / MIN`. See
 *  {@link BRIGHT_CEILING_LY} for why it is a constant and not a comment. */
export const BRIGHT_FLOOR_LY = BRIGHT_SIZE_K / BRIGHT_SIZE_MIN;

/**
 * A real system's drawn size from how far away it is.
 *
 * The reciprocal is the design; the two clamps are what make it drawable, and
 * where they bite is {@link BRIGHT_CEILING_LY} and {@link BRIGHT_FLOOR_LY} —
 * computed from these constants, printed by `measure-sky-density.ts sky`, and
 * asserted by `tests/backdrop.test.ts`, which is the only way a documented
 * distance stays true after someone moves a dial. What each one catches in a
 * real sky is §12's to carry.
 *
 * Exported because it is the dial. A test holds the mid and both clamps against
 * this function rather than against a buffer, and #433's bake will read the same
 * law for the haze it lays behind these same points.
 */
export function brightSizeLy(ly: number): number {
	if (!Number.isFinite(ly) || ly < 0)
		// A NaN here draws nothing and says nothing, which is the quiet garbage
		// the map's instrument rule refuses. A degenerate distance is a broken
		// galaxy, and a broken galaxy should stop the frame it is in.
		throw new Error(`brightSizeLy: distance is not a distance (${ly})`);
	const raw = BRIGHT_SIZE_K / ly;
	return raw < BRIGHT_SIZE_MIN
		? BRIGHT_SIZE_MIN
		: raw > BRIGHT_SIZE_MAX
			? BRIGHT_SIZE_MAX
			: raw;
}

/**
 * Roughly-blackbody star colour, from a 0..1 "how hot is it" parameter.
 *
 * Not a physical fit and does not need to be: it interpolates a red-orange
 * through white to a blue-white, which is the range the eye reads as "stars"
 * and covers what a real sky looks like at this level of abstraction. A real
 * Planck curve is a candidate refinement, not a correctness fix.
 *
 * This ramp belongs to the **invented** population. The real systems do not use
 * it: their colour is derived, from the class each system's own draw picked —
 * see {@link systemField}.
 */
function starColor(t: number): [number, number, number] {
	// Two segments, meeting at white. Warm stars are the common case, so the
	// distribution that feeds this is biased toward the low end, not this ramp.
	if (t < 0.5) {
		const k = t / 0.5;
		return [1, 0.62 + 0.38 * k, 0.38 + 0.62 * k];
	}
	const k = (t - 0.5) / 0.5;
	return [1 - 0.28 * k, 1 - 0.1 * k, 1];
}

/**
 * `count` invented stars, uniformly scattered over a sphere, from the world seed.
 *
 * **Uniform on the sphere, not on (θ, φ).** Drawing both angles uniformly
 * bunches points at the poles — the classic mistake, and a visible one against
 * a black sky. `z` is drawn uniformly instead and the ring radius follows from
 * it, which is the standard area-preserving construction.
 *
 * Drawn from `STREAMS.backdrop`, so the sky does not move when the market
 * generator gains a draw — the tag #100 named for exactly that. It is *not* the
 * tag the sky's orientation comes from: `DOMAIN.SKY_FRAME` is #430's, and
 * sharing a stream would make which way the band lies a function of how many
 * stars were scattered.
 *
 * This is the layer that used to be the whole file. Its scatter is still
 * uniform, which is now the right answer rather than the only answer: it is the
 * texture of a night, and the structure in the sky belongs to the other one.
 */
export function faintField(worldSeed: number, count = FAINT_COUNT): StarField {
	const rand = streamFor(worldSeed, "backdrop");
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);
	const sizes = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		const z = rand() * 2 - 1;
		const ring = Math.sqrt(Math.max(0, 1 - z * z));
		const theta = rand() * Math.PI * 2;
		positions[i * 3] = Math.cos(theta) * ring * BACKDROP_RADIUS;
		positions[i * 3 + 1] = z * BACKDROP_RADIUS;
		positions[i * 3 + 2] = Math.sin(theta) * ring * BACKDROP_RADIUS;

		// Biased warm: cubing a uniform draw puts most stars at the red end,
		// which is both what the real sky does and what keeps the handful of
		// blue-white ones reading as exceptional.
		const t = rand() ** 3;
		const [r, g, b] = starColor(t);
		colors[i * 3] = r;
		colors[i * 3 + 1] = g;
		colors[i * 3 + 2] = b;

		// Magnitude: a steep power so the field is mostly faint pinpricks with a
		// few bright ones. A flat distribution reads as noise rather than as a
		// sky.
		sizes[i] = FAINT_SIZE_MIN + FAINT_SIZE_SPAN * rand() ** 6;
	}

	return { positions, colors, sizes, count };
}

/**
 * The sky as the galaxy looks from one system: every other system, once, at its
 * true bearing.
 *
 * Nothing here is drawn from a random stream, and that is the point. Every
 * number in these buffers is derived — the direction from `skyBearing` through
 * the observer's seeded frame (#430), the distance from the shipped positions,
 * the hue from the class the *other* system's own draw picked. So the same
 * galaxy and the same observer return the same buffers with no stream to keep
 * still, and `tests/backdrop.test.ts` can hold them against the modules that
 * produced them instead of against a golden array that would survive the
 * transform being replaced by anything reproducing today's numbers.
 *
 * **The points come out in `galaxy.systems` order, with the observer skipped**,
 * which is what lets a point be traced back to the system it is. No two
 * systems' bearings coincide — that is a test row too — so the correspondence is
 * one-to-one and the order is load-bearing rather than cosmetic.
 *
 * **Cost, per arrival rather than per frame:** one extra draw call, 255 bearings
 * and 255 star-class draws, and three `Float32Array`s. CPU arithmetic is the only
 * kind this half has; what it *draws* is 255 more points on one more draw call,
 * and #433 prices that on the sheet.
 * There is no pool, because a pool would trade a number nobody can measure for a
 * stale tail nobody can see.
 */
export function systemField(galaxy: Galaxy, observer: SystemRecord): StarField {
	const frame = skyFrame(observer.seed);
	const others = galaxy.systems.filter((s) => s.index !== observer.index);
	const count = others.length;
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);
	const sizes = new Float32Array(count);

	others.forEach((other, i) => {
		const bearing = skyBearing(frame, observer.pos, other.pos);
		if (bearing === null)
			// Two systems standing on the same light year, which is a direction
			// `skyBearing` cannot answer. Nothing upstream promises it cannot
			// happen: §5's connectivity solve spaces bodies that are *too close*,
			// which is a different predicate from no two sharing a point, so the
			// refusal lives here. The alternative to refusing is quietly drawing
			// 254 points for a galaxy of 256, which is how a missing star reaches
			// a player with every row still green.
			throw new Error(
				`systemField: system ${other.index} carries no bearing from ${observer.index}`,
			);
		const [r, g, b] = photosphereTintLinear(starClassFor(other.seed).color);
		// A direction, scaled to where the background layer draws directions.
		// Not a distance: `BACKDROP_RADIUS` is this layer's convention for
		// "far enough that it cannot parallax", the size carries the distance,
		// and a point placed at `distanceLy` would sit outside the backdrop
		// camera's frustum and never draw at all.
		positions[i * 3] = bearing.x * BACKDROP_RADIUS;
		positions[i * 3 + 1] = bearing.y * BACKDROP_RADIUS;
		positions[i * 3 + 2] = bearing.z * BACKDROP_RADIUS;
		colors[i * 3] = r;
		colors[i * 3 + 1] = g;
		colors[i * 3 + 2] = b;
		sizes[i] = brightSizeLy(distanceLy(observer.pos, other.pos));
	});

	return { positions, colors, sizes, count };
}

/**
 * How a star is drawn: a small sharp point whose brightness is its light
 * (#719, the principal's yes on the view sheet, 2026-10-07).
 *
 * The size law above is unchanged — a stored size still encodes flux as
 * `size²`. What changed is how the shader spends it. Until #719 it drew a soft
 * disc `size × pixelScale` pixels across, so a star's light was its area, and
 * the bright layer read as large orange discs. Now every star is a core
 * `coreScale` of the canvas height across, and the light the disc delivered,
 * `(size × pixelScale)²`, is the core's intensity at `fluxGain`. Above 1 the
 * core is HDR, capped at `hdrCap`, and the excess goes into a small coloured
 * halo up to four core widths, so the bright layer still reads as brighter
 * than the field (#434) without growing a disc.
 *
 * The dials were set by eye on the view sheet. `starPoint` is the rule; the
 * star shader in `main.ts` computes the same expression per vertex from these
 * values, because GLSL cannot call it.
 */
export const STAR_POINT = Object.freeze({
	coreScale: 0.0012,
	coreMinPx: 1.5,
	fluxGain: 0.35,
	hdrCap: 6,
	haloWeight: 0.5,
});

/** The core's diameter in pixels for a canvas this many pixels high. */
export function starCorePx(canvasHeightPx: number): number {
	return Math.max(STAR_POINT.coreMinPx, canvasHeightPx * STAR_POINT.coreScale);
}

/** One star's drawn point: core intensity, halo weight, and sprite size. */
export function starPoint(
	size: number,
	pixelScale: number,
	corePx: number,
): { corePx: number; intensity: number; halo: number; spritePx: number } {
	const discPx = size * pixelScale;
	const intensity = Math.min(
		STAR_POINT.hdrCap,
		(STAR_POINT.fluxGain * discPx * discPx) / (corePx * corePx),
	);
	const excess = Math.max(0, intensity - 1);
	const spread = 1 + Math.min(3, 1.2 * Math.sqrt(excess));
	return {
		corePx,
		intensity,
		halo: (STAR_POINT.haloWeight * excess) / STAR_POINT.hdrCap,
		spritePx: corePx * spread + 2,
	};
}
