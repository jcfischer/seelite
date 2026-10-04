/**
 * The quaternion arithmetic two modules share, and one property each needs it
 * to hold.
 *
 * It exists because [#430](https://github.com/jcfischer/seelite/issues/430)
 * needed a **shortest arc from a constant axis onto a drawn direction** — the
 * same construction `light-rig.ts`'s `envRotation` had already grown, degenerate
 * case and all, for `BAKE_STAR_DIR`. A second copy of a 180°-safe shortest arc
 * is the failure this repo has repeatedly paid for: one copy fixes the
 * antiparallel case and the other does not, and nothing links the two. Node #433
 * retired the lighting wrapper; this file holds the useful properties directly on
 * `shortestArc`, which still carries the galactic frame.
 *
 * Two claims matter more than the algebra, because they are the ones a mistake
 * hides behind:
 *
 * - **Composition order.** `quatMul(a, b)` is `a` *after* `b`, asserted as a
 *   function composition rather than as a formula. The frame in `galaxy-frame.ts`
 *   is a shortest arc and then a roll about the arc's own endpoint, and a flipped
 *   `quatMul` there is a wrong sky that every round trip still passes.
 * - **Rotations, not reflections.** Handedness is checked by the cross product
 *   commuting with the rotation. A round trip is blind to this: a reflection
 *   round trips perfectly.
 */
import { describe, expect, test } from "bun:test";
import {
	type Quat4,
	quatAxisAngle,
	quatMul,
	rotateBy,
	shortestArc,
} from "../src/quat";
import { cross, dot, length, normalizeOr, type Vec3, v3 } from "../src/vec3";
import { expectVec, DIRECTIONS as SPREAD, UNIT } from "./lib/vec-assert";

/** `shortestArc` narrowed for the rows that are not about its refusal. A row
 *  that reads the result has already said the pair is a pair of directions; a
 *  `null` on that path is the instrument failing, so it throws rather than
 *  feeding a `Quat4 | null` to an assertion and reporting a type error as a
 *  finding. */
const arc = (from: Vec3, to: Vec3): Quat4 => {
	const q = shortestArc(from, to);
	if (q === null) throw new Error("shortestArc refused two directions");
	return q;
};

/**
 * The shared spread — every axis and its negative, which is what makes
 * `shortestArc` more than a one-line cross product — plus one direction it has
 * no reason to carry: `v3(0.001, −0.9999995, 0.001)` sits 1.4·10⁻³ behind −y,
 * close enough that only the antiparallel branch and not the arc beside it
 * answers it. A row over the shared nine would pass with that branch deleted.
 */
const DIRECTIONS: Vec3[] = [
	...SPREAD,
	normalizeOr(v3(0.001, -0.9999995, 0.001), UNIT),
];

describe("quatMul", () => {
	test("is composition: a after b, so it applies b first", () => {
		const a = quatAxisAngle(v3(0, 1, 0), 0.7);
		const b = quatAxisAngle(v3(1, 0, 0), -1.9);
		const v = normalizeOr(v3(0.2, -0.7, 0.66), UNIT);
		expectVec(rotateBy(quatMul(a, b), v), rotateBy(a, rotateBy(b, v)));
	});

	test("an identity operand changes nothing", () => {
		// The identity written out rather than imported: `quat.ts` ships no named
		// unit, because nothing in `src/` composes with one yet (#430 round 3). The
		// law still earns its row — a composition that drops a `w`, or applies its
		// operands in the other order, is caught here — and the change that first
		// needs a unit is the change that names one.
		const identity = [0, 0, 0, 1] as const;
		const a = quatAxisAngle(v3(1, 2, -1), 2.2);
		const v = normalizeOr(v3(-0.4, 0.5, 0.7), UNIT);
		expectVec(rotateBy(quatMul(a, identity), v), rotateBy(a, v));
		expectVec(rotateBy(quatMul(identity, a), v), rotateBy(a, v));
	});
});

describe("shortestArc", () => {
	test("maps a sphere spread with unit quaternions regardless of input scale", () => {
		// Preserve the useful properties from the retired lighting wrapper on
		// the primitive that the galactic frame still uses.
		const from = v3(1, 0, 0);
		const golden = Math.PI * (3 - Math.sqrt(5));
		const spread = [from, v3(-1, 0, 0)];
		for (let i = 0; i < 200; i++) {
			const y = 1 - (2 * (i + 0.5)) / 200;
			const ring = Math.sqrt(Math.max(0, 1 - y * y));
			spread.push(
				v3(Math.cos(golden * i) * ring, y, Math.sin(golden * i) * ring),
			);
		}
		for (const to of spread) {
			const q = arc(from, to);
			expectVec(rotateBy(q, from), to);
			expect(Math.hypot(...q)).toBeCloseTo(1, 12);
			const scaled = arc(from, v3(to.x * 1e6, to.y * 1e6, to.z * 1e6));
			for (let i = 0; i < 4; i++) expect(scaled[i]).toBeCloseTo(q[i], 9);
		}
	});

	test("the inverse fails to carry from onto to at an ordinary direction", () => {
		const from = v3(1, 0, 0);
		const to = v3(0.3, 0.5, Math.sqrt(1 - 0.09 - 0.25));
		const [x, y, z, w] = arc(from, to);
		const landed = rotateBy([-x, -y, -z, w], from);
		expect(
			Math.hypot(landed.x - to.x, landed.y - to.y, landed.z - to.z),
		).toBeGreaterThan(0.5);
	});

	test("carries `from` onto `to` for every direction, antiparallel included", () => {
		// The primitive carries the requested direction, including the half turn.
		const from = v3(0, 1, 0);
		for (const to of DIRECTIONS) expectVec(rotateBy(arc(from, to), from), to);
	});

	test("a coincident pair is the identity, not a NaN", () => {
		// Cross-of-equals is the zero vector. Normalising it without a fallback
		// yields a quaternion of NaNs, which propagates silently into a bake or a
		// point field — the frame that renders is the last one that was finite.
		const q = shortestArc(UNIT, UNIT)!;
		expectVec(rotateBy(q, UNIT), UNIT);
		expect(q.every(Number.isFinite)).toBe(true);
	});

	test("no snap at either end: an arc of 10⁻⁶ rad is 10⁻⁶ rad, not zero", () => {
		// Both degenerate ends of `shortestArc` are branches only where the arithmetic
		// has stopped carrying information. Near **coincident** it has not:
		// `(a×b, 1 + a·b)` is perfectly conditioned at `dot = 1`, so there is no
		// tolerance snapping a short arc to the identity here either. That is the same
		// argument the module makes at the antiparallel end, applied to this one — a
		// snap would leave a sky aimed 10⁻⁶ rad off its drawn pole for whichever
		// systems happen to draw near the reference, silently, and the reason for
		// refusing a wider fallback on the far side would have been a story about one
		// end of the range instead of about the arithmetic.
		for (const angle of [1e-6, 1e-4, 1e-2]) {
			const to = normalizeOr(v3(Math.sin(angle), 0, Math.cos(angle)), UNIT);
			const q = arc(UNIT, to);
			// Where the vector lands carries the angle exactly. `w` at 10⁻⁶ rad is
			// 1 − 1.25·10⁻¹³, and an angle read back off that difference has less
			// precision than the angle being checked. The arc from `+z` toward
			// `(sin, 0, cos)` is a turn about `+y`, so `x` is the component that moves
			// and `y` is the one that provably does not.
			expect(rotateBy(q, UNIT).x).toBeCloseTo(Math.sin(angle), 9);
			// Not the identity — which is exactly what a snap satisfies and an arc
			// fails. This is why the row is about 10⁻⁶ and not about 10⁻².
			expect(2 * Math.acos(Math.min(1, Math.abs(q[3])))).toBeGreaterThan(
				angle / 2,
			);
		}
	});

	test("it turns by exactly the angle between the two, and not one radian more", () => {
		// "Shortest" is the whole content of the name, and the angle is what it
		// means: an arc that carries `from` onto `to` *and* spins about `to` on the
		// way lands the same direction with a hidden roll in it. `galaxy-frame.ts`
		// adds a roll afterwards on purpose, and would be a wrong number twice over
		// if the arc it composes with already carried one.
		for (const to of DIRECTIONS) {
			for (const from of [v3(0, 1, 0), v3(0.2, -0.5, 0.84), v3(-1, 0.1, 0.3)]) {
				const f = normalizeOr(from, UNIT);
				const q = arc(f, to);
				const want = Math.acos(Math.max(-1, Math.min(1, dot(f, to))));
				// 2·acos|w| for a unit quaternion, and |w| because q and −q are the
				// same rotation — the sign is a parameterisation, not a state.
				const got = 2 * Math.acos(Math.min(1, Math.abs(q[3])));
				expect(Math.abs(got - want)).toBeLessThan(1e-9);
			}
		}
	});

	test("it refuses a zero vector rather than answering with the identity", () => {
		// A guard that does not recognise its input has to refuse (#206). A zero
		// direction carries no information about where the caller meant, and an
		// identity answer to that question is a frame aimed at nothing.
		expect(shortestArc(v3(0, 0, 0), UNIT)).toBeNull();
		expect(shortestArc(UNIT, v3(0, 0, 0))).toBeNull();
	});
});

describe("rotateBy", () => {
	// The inverse written here rather than imported. `quat.ts` ships the forward
	// direction only (#430 round 4), and the anti-inversion law #99 learned wants
	// the second route written *independently* of the first — a `rotateByInverse`
	// built out of the module's own conjugate shares its fate, and a route that
	// cannot be wrong in a way the forward path is not cannot hold that law.
	const invert = (q: Quat4): Quat4 => [-q[0], -q[1], -q[2], q[3]];
	const rotateInverse = (q: Quat4, v: Vec3): Vec3 => rotateBy(invert(q), v);

	test("the inverse undoes the rotation in both orders", () => {
		// Which is also the row that says the quaternion is unit: a scaled one
		// rotates and grows, and undoes itself only up to that scale.
		const q = arc(v3(0, 1, 0), normalizeOr(v3(0.4, 0.1, -0.9), UNIT));
		for (const v of DIRECTIONS) {
			expectVec(rotateInverse(q, rotateBy(q, v)), v, 1e-9);
			expectVec(rotateBy(q, rotateInverse(q, v)), v, 1e-9);
		}
	});

	test("lengths and angles survive: it is a rigid rotation", () => {
		const q = quatAxisAngle(normalizeOr(v3(1, -2, 0.5), UNIT), 1.1);
		const a = normalizeOr(v3(0.9, 0.1, 0.4), UNIT);
		const b = normalizeOr(v3(-0.2, 0.8, -0.5), UNIT);
		expect(length(rotateBy(q, a))).toBeCloseTo(1, 12);
		expect(dot(rotateBy(q, a), rotateBy(q, b))).toBeCloseTo(dot(a, b), 12);
	});

	test("handedness is kept: the cross product commutes with it", () => {
		// A reflection round trips, preserves lengths and preserves dot products.
		// This is the row that tells the two apart, and the one an axis-pair frame
		// construction can trip on: swap two basis vectors and every number above
		// still passes while the sky comes out mirrored.
		const q = arc(v3(0, 1, 0), normalizeOr(v3(-0.6, 0.5, 0.62), UNIT));
		const a = normalizeOr(v3(1, 2, 3), UNIT);
		const b = normalizeOr(v3(-4, 1, 2), UNIT);
		const direct = cross(rotateBy(q, a), rotateBy(q, b));
		const mapped = rotateBy(q, cross(a, b));
		expectVec(direct, mapped, 1e-9);
	});
});
