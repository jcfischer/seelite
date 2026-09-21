/**
 * Quaternion arithmetic over plain arrays, with no Three.js in it.
 *
 * A leaf by the same argument that makes `vec3.ts` one: the rotations this
 * game depends on have to be checkable without a browser, and `tests/units`
 * —` tests/headless.test.ts` — is the tier that checks them.
 *
 * **Why this is a module and not arithmetic inside the module that wanted it.**
 * [#430](https://github.com/jcfischer/seelite/issues/430) needed a shortest arc
 * from a fixed axis onto a drawn direction, which is exactly what
 * `light-rig.ts`'s `envRotation` had already grown for `BAKE_STAR_DIR` —
 * degenerate case, perpendicular-axis fallback and all. A second copy of a
 * 180°-safe shortest arc is how two files end up disagreeing about whether the
 * antiparallel case is handled, with nothing linking them: #99's own lesson was
 * that a rotation stated twice is a claim nothing can break. So `envRotation`
 * builds through {@link shortestArc} here, and
 * `tests/quat.test.ts` holds the primitive while `tests/light-rig.test.ts`
 * keeps holding the bake's own property through it.
 *
 * ## Two conventions, stated because both are easy to get backwards
 *
 * - **`[x, y, z, w]` order**, last element scalar. The one `three` uses, and the
 *   one `envRotation` already returned, so `main.ts`'s `fromArray` keeps working.
 * - **`quatMul(a, b)` is `a` *after* `b`** — Hamilton's product, applied
 *   right-to-left, asserted as a function composition in the test rather than as
 *   a formula. A frame built as an arc and then a roll is one flipped `quatMul`
 *   away from a wrong sky that every round trip in the repo still passes.
 *
 * ## Rotations, not reflections
 *
 * Every rotation here is proper by construction, and `tests/quat.test.ts`
 * checks it by asking that the cross product commute with the rotation. That is
 * the only row which tells the two apart: a reflection round trips, preserves
 * lengths and preserves angles, so a frame assembled from a basis pair can come
 * out mirrored through everything else the suite asks.
 */

import { cross, dot, lengthSq, normalizeOr, type Vec3, v3 } from "./vec3";

/** A unit quaternion as `[x, y, z, w]` — see the file's convention note. */
export type Quat4 = readonly [number, number, number, number];

/** The fallback axis for a half turn, chosen as the world axis `from` is
 *  *least* parallel to — so the perpendicular it produces is the best-conditioned
 *  one available, and the choice is a rule rather than a magic vector. */
const leastParallelAxis = (v: Vec3): Vec3 =>
	Math.abs(v.x) <= Math.abs(v.y) && Math.abs(v.x) <= Math.abs(v.z)
		? v3(1, 0, 0)
		: Math.abs(v.y) <= Math.abs(v.z)
			? v3(0, 1, 0)
			: v3(0, 0, 1);

/** A rotation through `angle` radians, right-handed about `axis`, which need not
 *  be normalised.
 *
 *  A zero axis **throws**. That is a caller bug rather than bad data, and the
 *  alternative — a `null` every caller then threads through its own arithmetic —
 *  is how a rotation ends up quietly skipped: an axis with no direction in it
 *  has no rotation to give, and answering with the identity would be a frame
 *  aimed at nothing (#206). {@link shortestArc} returns `null` instead, because
 *  there the bad direction is the world's, not the caller's. */
export function quatAxisAngle(axis: Vec3, angle: number): Quat4 {
	const unit = normalizeOr(axis, v3(0, 0, 0));
	if (lengthSq(unit) < 1 - 1e-9)
		throw new Error("quatAxisAngle: an axis with no direction in it");
	const half = angle / 2;
	const s = Math.sin(half);
	return [unit.x * s, unit.y * s, unit.z * s, Math.cos(half)];
}

/**
 * The shortest rotation carrying `from` onto `to`.
 *
 * Both are taken as directions and normalised here, because every caller has a
 * direction and none should have to normalise before asking.
 *
 * **Returns `null` when either argument has no direction in it.** A zero vector
 * is not a direction, and an identity answer to "which way is this" is a frame
 * aimed at nothing — a guard that does not recognise its input refuses (#206).
 *
 * The two degenerate cases are handled rather than assumed away, because both
 * are reachable in this game:
 *
 * - **Coincident** — the cross product is zero, and the general form below
 *   answers that exactly: `(0, 0, 0, 1 + 1)` normalises to the identity. There is
 *   deliberately **no snap at a tolerance** on this end either. Two directions
 *   whose `dot` differs from 1 by 10⁻¹² describe an arc of 1.4·10⁻⁶ rad, and
 *   answering that with no rotation at all is the same class of aim error the last
 *   bullet refuses on the other end of the range — the branch there is forced by a
 *   cross product that has stopped carrying information, not by a preference.
 * - **Antiparallel** — the cross product is zero *and* the angle is π, so the
 *   axis is undefined; it is taken as the perpendicular to `from` through
 *   {@link leastParallelAxis}. Any perpendicular is a correct half turn, and the
 *   point of picking one by rule is that the choice is deterministic: a
 *   different one is a different frame, and a frame that depends on which way
 *   the compiler rounded is not a fact anyone can state.
 * - **How close counts as antiparallel** — `1e-12`, where the copy of this
 *   arithmetic in `light-rig.ts` used `1e-9` before #430 folded the two together.
 *   A wider threshold is not a safety margin, because the fallback is not a better
 *   answer, it is a different one: a half turn about a fixed world axis is not a
 *   shortest arc to a direction that is merely nearly antiparallel, and it is
 *   discontinuous as an input sweeps through antiparallel. What the old threshold
 *   cost, in radians of aim and units of radiance, is measured by the row named
 *   `near exact antiparallel the old arm misses the star and the new one does not`
 *   in `tests/light-rig.test.ts`, which is where those figures live and the only
 *   place they are written down.
 */
export function shortestArc(from: Vec3, to: Vec3): Quat4 | null {
	const a = normalizeOr(from, v3(0, 0, 0));
	const b = normalizeOr(to, v3(0, 0, 0));
	if (lengthSq(a) < 1 - 1e-9 || lengthSq(b) < 1 - 1e-9) return null;

	const c = dot(a, b);
	if (c < -1 + 1e-12) {
		const axis = normalizeOr(cross(a, leastParallelAxis(a)), v3(0, 0, 0));
		if (lengthSq(axis) < 1 - 1e-9) return null;
		// A half turn: `w = cos(π/2) = 0`, so the quaternion is the axis itself.
		return [axis.x, axis.y, axis.z, 0];
	}
	// The unnormalised half-turn-free form: (a×b, 1 + a·b). Dividing by
	// `1 + a·b` would blow up at the antiparallel case, which is handled above,
	// and the normalisation below is what makes the result unit either way.
	const k = cross(a, b);
	const w = 1 + c;
	const n = Math.sqrt(k.x * k.x + k.y * k.y + k.z * k.z + w * w);
	if (!(n > 0)) return null;
	return [k.x / n, k.y / n, k.z / n, w / n];
}

/** `a` applied after `b`. Hamilton's product; see the file's convention note. */
export function quatMul(a: Quat4, b: Quat4): Quat4 {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}

/** The inverse of a unit quaternion, which is its conjugate. */
export function quatConjugate(q: Quat4): Quat4 {
	return [-q[0], -q[1], -q[2], q[3]];
}

/** Rotate a direction by `q`. Assumes a unit `q`, which is what everything
 *  above returns; a non-unit one would scale as well as rotate. */
export function rotateBy(q: Quat4, v: Vec3): Vec3 {
	// v' = v + w·t + q̂ × t, with t = 2 q̂ × v. Written over locals rather than
	// through `cross`, because this runs over every point of a sky and an
	// allocation per cross product is four allocations per direction.
	const qx = q[0];
	const qy = q[1];
	const qz = q[2];
	const qw = q[3];
	const tx = 2 * (qy * v.z - qz * v.y);
	const ty = 2 * (qz * v.x - qx * v.z);
	const tz = 2 * (qx * v.y - qy * v.x);
	return {
		x: v.x + qw * tx + (qy * tz - qz * ty),
		y: v.y + qw * ty + (qz * tx - qx * tz),
		z: v.z + qw * tz + (qx * ty - qy * tx),
	};
}

/** Undo {@link rotateBy}. Written as its own function rather than as a call with
 *  {@link quatConjugate} applied, because the two are the *direction* of a
 *  transform, and the whole reason a transform is a function is that the
 *  direction is something a test can hold (#99). */
export function rotateByInverse(q: Quat4, v: Vec3): Vec3 {
	return rotateBy(quatConjugate(q), v);
}
