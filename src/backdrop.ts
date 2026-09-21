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
 * ## What the old docstring claimed, and what is now true
 *
 * This file used to say its points were "the bright, nameable stars — the ones
 * that are also systems you can jump to", and drew 4,000 of them scattered
 * uniformly over a sphere without ever reading the galaxy. The claim was
 * [#100](https://github.com/jcfischer/seelite/issues/100)'s design; the code was
 * a fiction at roughly fifteen times the density of the thing it said it was a
 * picture of. Both halves exist now, separately, and the file names which is
 * which.
 *
 * - **{@link systemField} is the claim.** One point per other system — 255, a
 *   system cannot see itself — at its true bearing through `galaxy-frame.ts`, in
 *   the colour of the sun a pilot finds there, sized by distance. Measured over
 *   81,920 observers: **6.18 points per 1000 square degrees** (against Earth's
 *   145 brightest stars at 3.51), a median **nearest** neighbour of **3.06 ly**,
 *   a median neighbour of **21.5 ly**, a median farthest of **38.0 ly** with the
 *   worst at **48.8**. `scripts/measure-sky-density.ts` prints all of it. #100's
 *   receipt quoted two of these mislabelled — its "median 21.1 ly" is the median
 *   *neighbour*, not the median *nearest* neighbour, which is nearly seven times
 *   closer, and that difference is the difference between a sky with one bright
 *   star in it and one with a handful.
 * - **{@link faintField} is the fiction**, and stays one, because 255 points is
 *   not a night. Earth's whole naked-eye sky is of order five thousand stars, so
 *   the real layer is twenty times short of the density a person reads as *sky*,
 *   and the invented population supplies that and nothing else.
 *
 * ## Why two buffers, and so two `Points`
 *
 * Not because there are two ideas — there is one sky — but because **the two
 * layers go stale on different days.** The faint population is a function of the
 * world seed and is rebuilt never. The derived layer is a function of which
 * system the player is standing in and is rebuilt on every hyperspace arrival.
 * One geometry would mean re-uploading 4,255 vertices to change 255 of them; two
 * means an arriving system costs 3 kB and the texture costs nothing ever again.
 * They share one `ShaderMaterial`, because everything that differs between them
 * is already in the attributes and a second material would be a second program
 * for an identical shader.
 *
 * ## What the sky is a picture *of*, measured
 *
 * The cluster is oblate (`GALAXY_FLATTENING_Q`), and #430 ruled that this is
 * where its shape becomes visible. What the measurement says is that the
 * visibility is in the *cone and the ordering*, and not in the band:
 *
 * - **46.3% of a sky's points sit within 20° of the cluster's plane**, against
 *   34.2% for a uniform sphere — a **1.35× excess**, ×1.41 inside ±10°. That is
 *   #100's 1.31× re-measured through the shipped transform, and it is a gentle
 *   ridge rather than a band: 8.4 points per 1000 sq deg inside ±20° against 5.0
 *   outside.
 * - **The core is the loud one.** A star near the cluster's rim puts **24.5%** of
 *   its neighbours inside a 20° cone on the centre, eight times uniform; one near
 *   the core manages 6.7%, because from the middle the core is every direction at
 *   once.
 * - **Brightness is where the structure lives**, because it is the only channel
 *   left. A uniform 4,000 is 97 points per 1000 sq deg everywhere, so the
 *   invented layer outnumbers the real one **11.6 : 1 inside the band and 19.2 : 1
 *   outside it** — `band` mode prints both. Nothing about the count can carry a
 *   band at those odds, which is what the two size bands below are for.
 *
 * The cone and the ordering therefore come free: they fall out of bearings nobody
 * tuned. The band comes free too, at exactly the strength #430 said it would, and
 * this file is where that gets checked rather than asserted.
 *
 * ## The law on each point, and the invariant between the layers
 *
 * - **Size is flux.** The shader draws an additive soft disc, so the light a
 *   point contributes goes as its size squared, and drawing a star at `size ∝
 *   1/d` is flux `∝ 1/d²` at constant surface brightness. That is #100's inverse
 *   square with no invented exponent and no dial — and see the colour rule for
 *   what makes "distance is the only thing carrying brightness" true rather than
 *   hopeful.
 * - **Colour is class, never exposure.** A point takes the hue of its system's
 *   own star class, normalised through `star-colour.ts` to the one photosphere
 *   exposure — #59's rule one scale down. Here it does a second job: a tint that
 *   carried its own exposure would put an M dwarf's point well under an F star's
 *   and the size law would stop being a statement about distance.
 * - **No invented star outshines a real one.** `FAINT_SIZE_MAX` sits under
 *   {@link BRIGHT_SIZE_MIN}, held in `tests/backdrop.test.ts`. That hierarchy is
 *   the picture's legibility: the bright points are the places you can go, and
 *   the grain behind them is not.
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
	/** rgb triples, 0..1, linear. */
	colors: Float32Array;
	/** Per-point size, in the units `PointsMaterial` wants. */
	sizes: Float32Array;
	count: number;
}

/**
 * How many invented points the sky carries.
 *
 * A density, not a budget. At 4,000 the layer is 97 points per 1000 square
 * degrees, which is the order of magnitude of a human naked-eye sky; the draw is
 * nothing either way (the research puts the point where a `Points` layer starts
 * costing anything nearer 10⁵), so cutting it buys no milliseconds and thins the
 * night.
 */
export const FAINT_COUNT = 4000;

/**
 * The invented population's size band, in the units the point shader wants.
 *
 * The law is `min + span · u⁶`: a steep power so the field is mostly faint
 * pinpricks with a few brighter ones. A flat distribution reads as static rather
 * than as a sky, which is why the shape is kept from the version of this file
 * that was the whole sky.
 *
 * The band sits **entirely below** the derived layer's floor, and the measurement
 * in the header is why it has to: the invented layer outnumbers the real one
 * eleven to one inside the cluster's plane and nineteen to one outside it, so how
 * much light each layer contributes is the only channel left in which the real
 * layer is visible as structure.
 *
 * **What that costs, stated rather than left to be noticed:** the law this band
 * replaces was `0.006 + 0.05·u⁶`, whose median point drew 4.1 px on a 900-px-tall
 * canvas and whose top of range drew 17.6 px — as large as the derived layer's
 * *brightest* star, which is the inversion the paragraph above forbids. This band
 * draws a 1.7 px median and a 3.0 px maximum, so the expected value of `size²` —
 * what an additive disc delivers as light — is **a tenth of what it was**. The
 * grain is texture and not subjects; whether a tenth is still enough of a night is
 * a question for #433's sheet, and the number belongs here so that sheet is
 * argued with rather than looked at.
 */
export const FAINT_SIZE_MIN = 0.0048;
export const FAINT_SIZE_SPAN = 0.0048;
export const FAINT_SIZE_MAX = FAINT_SIZE_MIN + FAINT_SIZE_SPAN;

/**
 * The derived layer's size band, at 3.8 to 17 px on a 900-px-tall canvas.
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
 * **21.5 ly is a measurement** — the median neighbour distance over 81,920
 * observers — and `scripts/measure-sky-density.ts` is where it comes from. The
 * middle of a reciprocal law is the geometric mean of the two clamps, so this one
 * figure sets where the whole sky sits: move it and every star in the game moves
 * up or down together.
 */
export const BRIGHT_SIZE_MID_LY = 21.5;

/** The law's constant: `size = K / d`, which is flux `∝ 1/d²` drawn at constant
 *  surface brightness. The geometric mid of the band, placed at the measured mid
 *  distance. */
const BRIGHT_SIZE_K =
	BRIGHT_SIZE_MID_LY * Math.sqrt(BRIGHT_SIZE_MIN * BRIGHT_SIZE_MAX);

/**
 * A real system's drawn size from how far away it is.
 *
 * The reciprocal is the design; the two clamps are what make it drawable, and
 * both are measured rather than assumed — `measure-sky-density.ts sky` prints the
 * share of the sky each one actually catches:
 *
 * - The **ceiling** bites inside **9.07 ly** (`K / MAX`), where a soft additive
 *   disc is already mostly bloom. Measured, **8.6% of points saturate there —
 *   21.9 of a sky's 255**, so every sky carries a couple of dozen stars at the
 *   same top brightness. What the clamp gives up is the ordering *within* that
 *   handful, which is the price of not drawing the nearest system in a close
 *   pair as a 178 px blob; and an eye at the top of a magnitude scale does
 *   roughly the same thing anyway.
 * - The **floor** bites beyond **51.0 ly** (`K / MIN`), and catches **0.03% of
 *   points** — one star in about fourteen skies, at the very edge of the
 *   cluster. The worst farthest-neighbour over 81,920 observers is 48.8 ly
 *   against a floor at 51.0, so this clamp is a guard rail a re-solved
 *   `GALAXY_RADIUS_LY` would lean on, not a term that shapes today's picture. It
 *   is stated rather than left as a coincidence, because the day it starts
 *   biting it bites silently: a floored star is simply a small one.
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
 * **Cost, per arrival rather than per frame:** one frame draw, 255 bearings and
 * 255 star-class draws, measured at **0.036 ms** in
 * `measure-sky-density.ts cost` (bun, headless — CPU arithmetic, which is the
 * only kind this half has; what it *draws* is 255 more points on one more draw
 * call, and #433 prices that on the sheet). Three `Float32Array`s totalling about
 * 4 kB are allocated per arrival and the old ones go; there is no pool, because
 * a pool would trade a number nobody can measure for a stale tail nobody can
 * see. That cost is free enough to pay on every jump, which is the reason the
 * layer is its own buffer rather than 255 rows inside the faint one.
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
			// Two systems standing on the same light year. The layout generator
			// cannot ship that — every position is a fresh draw, and a duplicate
			// would still have to survive §5's connectivity solve — but the
			// alternative to refusing is quietly drawing 254 points for a galaxy
			// of 256, which is how a missing star reaches a player.
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
