/**
 * Which way the galaxy lies from inside a system.
 *
 * [#430](https://github.com/jcfischer/seelite/issues/430). Ratified in
 * `galaxy-generation.md` §11; this module is that section's arithmetic, and the
 * two disagree only ever by accident.
 *
 * ## The gap this closes
 *
 * `galaxy.ts` places 256 systems in a **galaxy space** whose reference plane is
 * `y = 0` — `GALAXY_FLATTENING_Q` flattens onto that axis, and the chart's
 * drop-lines fall to it. A system's own **world frame** has its reference plane
 * on `z = 0`: `hud.ts`'s attitude reference calls its normal "up", and `main.ts`
 * rolls the horizon against `v3(0, 0, 1)`. Before this module, nothing in `src/`
 * related the two. `git grep -iE 'galactic|galaxyFrame|fromGalaxy'` over `src/`
 * returned the Galactic Hyperdrive and nothing else, so *"which way from here is
 * the cluster's core"* had no answer — and the derived sky
 * [#100](https://github.com/jcfischer/seelite/issues/100) ruled in is nothing but
 * answers to that question.
 *
 * ## What the transform is, and what it is not
 *
 * **One seeded rotation per system, drawn from its own domain tag**, carrying
 * galaxy-space directions into that system's world frame. It is isotropic: the
 * galactic plane's normal lands anywhere on the world sphere, and the frame rolls
 * about that image as well. #100 rejected the aligned-frames option — one
 * transform for every system, or one that keeps every orbital plane parallel to
 * the cluster's — because it gives every sky the same band tilt, which throws
 * away the per-system variety the decision was bought for. Isotropy is also the
 * honest physics: nothing about a star's own planetary plane is related to the
 * shape of a cluster 24 light years across.
 *
 * **No rule keeps the band out of its own sun.** Under an isotropic draw the
 * galactic pole lands near the star's direction in roughly one system in eight,
 * and the band there is washed out by glare. That is accepted rather than
 * engineered away: a rejection rule would make the frame a loop rather than a
 * draw, and would couple the sky to where the system's own star sits — which is
 * the coupling every domain tag in `domains.ts` exists to prevent.
 *
 * ## The flattening is geometry, not a distortion to undo
 *
 * `systemFromPosition` divides a position's `y` by `GALAXY_FLATTENING_Q`. That
 * quotient is the **profile coordinate** for the spec's §4 gradients, and it is
 * the only place it belongs: the stored position *is* the fiction's shape, an
 * oblate cluster, so a bearing is taken from the stored positions exactly as
 * they stand. Unflattening before differencing is a mistake that no test can see
 * as wrong, because the result is still a unit vector.
 *
 * ## Why a function, and not a line in the renderer
 *
 * #99's finding at one scale up. `setFromUnitVectors(BAKE_STAR_DIR, STAR_DIR)`
 * written in `main.ts` was correct and *indistinguishable from its own inverse*
 * by anything this repo could run — swapping the arguments left
 * `probe-light-rig.mjs` green, because the inverse lands the lobe 2θ away and θ
 * was small for the seed the probe flies. A transform stated in a renderer is a
 * claim; the same transform as a function is a claim something can break. So
 * `tests/galaxy-frame.test.ts` holds the round trip, the handedness, and — the
 * one that actually breaks an inversion — the two parameters the frame reports,
 * measured back off the rotation by a second arithmetic.
 *
 * ## Headless, like `backdrop.ts` and `light-rig.ts`
 *
 * No Three.js, and no `Object3D` in sight: a frame is a unit quaternion over
 * plain objects, so the headless tier can hold it element by element and
 * `main.ts` has three lines of wrapping and no decisions.
 *
 * ## What this module does not own
 *
 * The bake, the points layer, and the sheet — all three are siblings below #100
 * and blocked on this. And it does not decide *what* the sky shows: it answers
 * only where a galaxy-space direction is in a system's own sky.
 *
 * One thing it deliberately does not offer: a "which way is the band" helper. The
 * angle any direction makes with the cluster's plane is `dot(direction,
 * frame.pole)`, one line, and a function for it would be a second answer to a
 * question the pole already answers.
 */

import { DOMAIN } from "./domains";
import { stream } from "./galaxy";
import {
	type Quat4,
	quatAxisAngle,
	quatMul,
	rotateBy,
	rotateByInverse,
	shortestArc,
} from "./quat";
import { type Vec3, lengthSq, normalizeOr, scale, sub, v3 } from "./vec3";

/**
 * The cluster's reference-plane normal, in galaxy space.
 *
 * **The one copy of this direction in `src/`.** The chart had its own
 * `new THREE.Vector3(0, 1, 0)`; `tests/galaxy-frame.test.ts` now forbids it,
 * because a sky and a chart that each carry their own idea of which way the
 * galaxy lies will drift and nothing headless will notice.
 */
export const GALACTIC_NORMAL: Vec3 = v3(0, 1, 0);

/**
 * A reference direction *inside* the cluster's reference plane, in galaxy space.
 *
 * The plane has no natural east — turning the cluster about its own normal is a
 * symmetry of an oblate spheroid, so nothing in its shape prefers a direction —
 * and still the roll has to be measured *from* somewhere to be a number rather
 * than a feeling. `+x` is the chart's horizontal: `galaxy-map.ts` draws galaxy
 * `x` into mesh `x` with no axis swap, and its camera sits on `+z` looking back
 * at the origin, so `+x` is screen-right with the cluster unyawed. The chart's
 * default view then turns the cluster itself about the normal by `DEFAULT_YAW` =
 * 0.6 rad, which is the chart's camera and not this frame's business.
 *
 * So this is a convention and not a fact. What the frame needs is **one** named
 * in-plane direction; that it is this one is convenience, and
 * `GALACTIC_EAST × roll` is the only thing that depends on it.
 */
export const GALACTIC_EAST: Vec3 = v3(1, 0, 0);

/**
 * The normal of a **system's** reference plane, in the system's world frame.
 *
 * This is the codomain's claim, not this module's to invent: bodies orbit near it
 * (`system.ts` tilts each by a small inclination) and `hud.ts`'s horizon line is
 * rolled against it. `tests/galaxy-frame.test.ts` asserts `main.ts` still rolls
 * against `z = 0`, because if that moves, every bearing this module returns
 * silently re-aims.
 */
export const SYSTEM_PLANE_NORMAL: Vec3 = v3(0, 0, 1);

/**
 * The cluster's centre, in galaxy space.
 *
 * The density profile is centred here (`CORE_RADIUS_LY = R/√2`), so "toward the
 * core" is "toward the origin" and not toward some other landmark. #100 measured
 * what that is worth looking at: integrated `1/d²` varies only 2.17× from core to
 * rim, while the density in a 20° cone toward the core runs ×1.8 to ×6.8–8.3. The
 * bearing is the picture; the brightness almost never is.
 */
export const GALACTIC_CORE: Vec3 = v3(0, 0, 0);

/** Below this separation, two positions carry no bearing between them.
 *  `BEARING_MIN_LY` is a nanometre at human scale and ten orders of magnitude
 *  below the nearest-neighbour mean of 5.45 ly, so nothing real is refused —
 *  the predicate is there for the caller that passes the same position twice. */
const BEARING_MIN_LY = 1e-9;

/** One system's sky: the rotation, and the two numbers it was drawn from. */
export interface SkyFrame {
	/** Galaxy space → this system's world frame, as `[x, y, z, w]`. Feed it
	 *  straight to `THREE.Quaternion.set` or `fromArray`. */
	readonly q: Quat4;
	/** Where the cluster's reference-plane normal lands in this system's sky.
	 *  Equal to `galaxyToSystem(frame, GALACTIC_NORMAL)`, carried out so a caller
	 *  that wants the band's axis does not recompose it. */
	readonly pole: Vec3;
	/** The frame's spin about {@link pole}, right-handed, in (−π, π]. */
	readonly rollRad: number;
}

/**
 * The frame for one system, from that system's own seed.
 *
 * Take a `SystemRecord`'s `seed`, the same way every other per-system draw does
 * (`stream(record.seed, DOMAIN.X)`). It is a function of that seed alone: not of
 * the galaxy walk that produced it, not of how many draws any other domain has
 * made since.
 *
 * **Three draws from `DOMAIN.SKY_FRAME`, in a fixed order** — the pole's cosine,
 * its azimuth, then the roll. `ARRIVAL` in `domains.ts` is the cautionary tale
 * for reusing a tag: drawing this from `POS` would replay the stream the
 * position already consumed and lock the sky's tilt to where the system sits,
 * deterministic and invisible.
 *
 * **The pole is uniform on the sphere, not uniform in the angles** — the same
 * construction as a system's own position draw and seekolous's sky before it:
 * `cos θ` is drawn directly, and the ring radius follows. Drawing θ and φ both
 * uniformly bunches the poles, which would be a sky with a preference it never
 * chose. With the pole uniform and the roll uniform on the circle, the frame is
 * uniform over orientations — no axis favoured, no tilt preferred.
 */
export function skyFrame(systemSeed: number): SkyFrame {
	const rand = stream(systemSeed, DOMAIN.SKY_FRAME);
	const cosPolar = 2 * rand() - 1;
	const azimuth = Math.PI * 2 * rand();
	const sinPolar = Math.sqrt(Math.max(0, 1 - cosPolar * cosPolar));
	const pole = v3(
		sinPolar * Math.cos(azimuth),
		sinPolar * Math.sin(azimuth),
		cosPolar,
	);
	// Mapped into (−π, π] so the reported number is comparable across systems and
	// a test can hold the spread without wrapping.
	const rollRad = (2 * rand() - 1) * Math.PI;

	const arc = shortestArc(GALACTIC_NORMAL, pole);
	// A drawn pole is on the unit sphere by construction, so `null` here is a
	// broken draw upstream. Throwing is the honest refusal: an identity frame on
	// that path would put every sky's band exactly on the flight horizon and read
	// as a design choice rather than as a bug.
	if (arc === null)
		throw new Error("skyFrame: the drawn pole carries no direction");
	// Roll *after* the arc — `quatMul(a, b)` applies `b` first. Flipping these two
	// is a wrong sky that still round trips: see the file header and the test.
	return { q: quatMul(quatAxisAngle(pole, rollRad), arc), pole, rollRad };
}

/** A galaxy-space direction — a difference between two systems, or the way to the
 *  core — as it lies in one system's own sky. */
export function galaxyToSystem(frame: SkyFrame, directionGalaxy: Vec3): Vec3 {
	return rotateBy(frame.q, directionGalaxy);
}

/** The inverse: a direction a pilot is looking along, in the galaxy's terms. What
 *  a "point at that smudge and ask what it is" feature reads. */
export function systemToGalaxy(frame: SkyFrame, directionSystem: Vec3): Vec3 {
	return rotateByInverse(frame.q, directionSystem);
}

/**
 * The unit direction from one system to another, in the observer's sky.
 *
 * **The difference is taken in galaxy space and carried across afterwards.** The
 * observer's frame is the only one that applies, so carrying each position
 * separately — with each system's own frame — and differencing after is not the
 * same computation and not the same answer; it is the shape of mistake #99 was
 * about, returning a plausible unit vector.
 *
 * **Returns `null` when the two are the same place.** A zero difference carries
 * no bearing, and a caller handed a zero vector cannot tell it from a direction.
 *
 * The bright layer #431 draws is this function, 255 times, once per observer.
 */
export function skyBearing(
	frame: SkyFrame,
	fromLy: Vec3,
	toLy: Vec3,
): Vec3 | null {
	const delta = sub(toLy, fromLy);
	// Refused on separation, *before* normalising: `normalizeOr` falls back only on
	// an exact zero, so a difference of 1e-300 divides into a denormal and comes
	// out as a direction that is a rounding artefact. The threshold is the refusal;
	// the unit step after it has nothing left to refuse.
	if (lengthSq(delta) < BEARING_MIN_LY * BEARING_MIN_LY) return null;
	return rotateBy(frame.q, normalizeOr(delta, v3(0, 0, 0)));
}

/**
 * The way back to the cluster's core, in the observer's sky.
 *
 * `skyBearing` toward {@link GALACTIC_CORE}, spelled out because it is the one
 * bearing the derived sky is judged on: #100's measurement is that the cluster's
 * light is *directional* rather than bright — 2.17× of integrated `1/d²` from
 * core to rim, against a cone density of ×1.8 to ×6.8–8.3 — so this direction is
 * most of what a sky in this game says about where the player is.
 *
 * `null` at the core itself, where every direction is away from it. No system the
 * generator ships sits there, so that is a boundary and not a live case.
 */
export function coreBearing(frame: SkyFrame, fromLy: Vec3): Vec3 | null {
	return skyBearing(frame, fromLy, GALACTIC_CORE);
}
