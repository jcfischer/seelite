/**
 * Which way the galaxy lies from inside a system.
 *
 * [#430](https://github.com/jcfischer/seelite/issues/430) is the node that makes
 * the question answerable. Before it, `galaxy.ts` placed every system in a
 * galaxy space whose reference plane is `y = 0`, a system's own world frame has
 * its reference plane on `z = 0`, and **nothing in `src/` related the two** — so
 * the derived sky #100 ruled in, which is nothing but bearings from here to the
 * other 255 systems, could not be drawn at all.
 *
 * The rows are ordered by how much it costs to lose one.
 *
 * **The anti-inversion rows come first, and they are the reason this is a module
 * at all.** #99 learned it one scale down: `setFromUnitVectors(BAKE_STAR_UNIT,
 * STAR_DIR)` written in `main.ts` was correct and *indistinguishable from its own
 * inverse* by anything the repo could run, because the inverse lands the lobe 2θ
 * from the star and θ was small for the seed the probe flies. A round trip is no
 * defence either — a rotation and its inverse round trip identically. What breaks
 * a swap is an anchor, and there are two here: the frame reports the parameters it
 * was drawn from (`pole`, `rollRad`), and these rows measure them back off the
 * rotation by a second route; and the shipped frames for two real systems are
 * pinned as literals, validated against an independent quaternion library.
 *
 * **The spread rows are the aligned-frames guard.** #100 rejected the option that
 * makes every system's orbital plane the galactic plane, because it gives every
 * sky the same tilt and throws away the per-system variety the decision was bought
 * for. Nothing downstream is red when a sky stops varying — it is merely the same
 * sky everywhere — so the only thing that notices is a row that sweeps the drawn
 * frames and requires them to cover the sphere.
 *
 * **What no row here can check**, in the tradition of `tests/light-rig.test.ts`
 * saying the same about its bake: that the derived sky, once something draws it,
 * is oriented the way a person reads it. That is #433's sheet and the principal's
 * yes, not a headless claim.
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	GALAXY_FLATTENING_Q,
	generateGalaxy,
	profileRadiusLy,
	systemSeedFor,
} from "../src/galaxy";
import {
	coreBearing,
	GALACTIC_EAST,
	GALACTIC_NORMAL,
	galaxyToSystem,
	type SkyFrame,
	SYSTEM_PLANE_NORMAL,
	skyBearing,
	skyFrame,
} from "../src/galaxy-frame";
import { rotateByInverse } from "../src/quat";
import {
	add,
	cross,
	dot,
	length,
	normalizeOr,
	scale,
	sub,
	type Vec3,
	v3,
} from "../src/vec3";
import { codeOf, srcFiles } from "./lib/source-scan";
import { DIRECTIONS, expectVec, toVector3, UNIT } from "./lib/vec-assert";

const TAU = Math.PI * 2;

/** Seeds spread over the range a real `systemSeed` occupies, not 1…128. */
const SEEDS = Array.from(
	{ length: 128 },
	(_, i) => Math.imul(i + 1, 0x9e3779b9) >>> 0,
);

const WORLD = 47;
const galaxy = generateGalaxy(WORLD, 0);

/** Rodrigues' rotation of `v` about a unit `axis` through `angle`.
 *  Written out in the test rather than borrowed from `src/quat.ts`, because a
 *  second measurement that reuses the first one's arithmetic measures nothing. */
const rodrigues = (axis: Vec3, angle: number, v: Vec3): Vec3 => {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const kv = dot(axis, v);
	const kxv = cross(axis, v);
	return {
		x: v.x * c + kxv.x * s + axis.x * kv * (1 - c),
		y: v.y * c + kxv.y * s + axis.y * kv * (1 - c),
		z: v.z * c + kxv.z * s + axis.z * kv * (1 - c),
	};
};

/** Where the **shortest arc** alone would have put `GALACTIC_EAST`, rebuilt from
 *  the extracted pole without reference to the module: the arc's axis is
 *  `GALACTIC_NORMAL × pole` and its angle is the angle between them. This is the
 *  zero-roll reference the frame's roll is measured against.
 *
 *  The antiparallel case is excluded rather than handled: a half turn is a
 *  convention about which perpendicular axis to spin about, so a roll extracted
 *  through it is not a measurement. `noSeedIsAntiparallel` below is what keeps
 *  that exclusion honest. */
function shortestArcEast(pole: Vec3): Vec3 {
	const n = GALACTIC_NORMAL;
	const c = Math.max(-1, Math.min(1, dot(n, pole)));
	const axis = normalizeOr(cross(n, pole), v3(1, 0, 0));
	return rodrigues(axis, Math.acos(c), GALACTIC_EAST);
}

/** The signed angle from `a` to `b`, right-handed about a unit `axis`. */
function signedAngleAbout(axis: Vec3, a: Vec3, b: Vec3): number {
	const perp = (v: Vec3): Vec3 => {
		const dropped = sub(v, scale(axis, dot(axis, v)));
		return normalizeOr(dropped, v);
	};
	const pa = perp(a);
	const pb = perp(b);
	return Math.atan2(dot(cross(pa, pb), axis), dot(pa, pb));
}

/** What the rotation *does*, measured off it: the pole it carries the galactic
 *  normal onto, and the right-handed roll about that pole past the shortest arc. */
function extract(frame: SkyFrame): { pole: Vec3; rollRad: number } {
	const pole = galaxyToSystem(frame, GALACTIC_NORMAL);
	return {
		pole,
		rollRad: signedAngleAbout(
			pole,
			shortestArcEast(pole),
			galaxyToSystem(frame, GALACTIC_EAST),
		),
	};
}

describe("skyFrame", () => {
	test("is a function of the system seed alone, and two seeds differ", () => {
		expect(skyFrame(1234)).toEqual(skyFrame(1234));
		const seen = new Set<string>();
		for (const seed of SEEDS)
			seen.add(
				skyFrame(seed)
					.q.map((n) => n.toFixed(9))
					.join(","),
			);
		expect(seen.size).toBe(SEEDS.length);
	});

	test("no drawn pole is antiparallel to the galactic normal", () => {
		// The precondition `shortestArcEast` refuses to guess about, checked rather
		// than assumed: one seed in 128 landing within a hair of the pole's own
		// negative would make every extraction row below measure a convention
		// instead of a rotation.
		for (const seed of SEEDS)
			expect(dot(skyFrame(seed).pole, GALACTIC_NORMAL)).toBeGreaterThan(-0.999);
	});

	test("round trips, every direction, in both orders", () => {
		// Back through `rotateByInverse`, not through a `systemToGalaxy` wrapper: the
		// inverse is the thing that has to be right, and a wrapper that merely
		// reverses the same quaternion is a place for a wrong inverse to hide. #430
		// ships no reverse-direction helper for the same reason — a direction a pilot
		// is looking along, stated in the galaxy's terms, is a feature nobody has
		// charted yet, and surface with no caller is surface kept alive by its test.
		for (const seed of SEEDS.slice(0, 16)) {
			const f = skyFrame(seed);
			for (const d of DIRECTIONS) {
				expectVec(rotateByInverse(f.q, galaxyToSystem(f, d)), d, 1e-9);
				expectVec(galaxyToSystem(f, rotateByInverse(f.q, d)), d, 1e-9);
			}
		}
	});

	test("is a rotation and not a reflection", () => {
		// A reflection round trips, preserves lengths and preserves angles. This is
		// the row that tells the two apart, and a frame assembled from an axis pair
		// can come out mirrored with every other number in this file intact.
		for (const seed of SEEDS.slice(0, 16)) {
			const f = skyFrame(seed);
			const a = normalizeOr(v3(1, 2, 3), UNIT);
			const b = normalizeOr(v3(-4, 1, 2), UNIT);
			expectVec(
				cross(galaxyToSystem(f, a), galaxyToSystem(f, b)),
				galaxyToSystem(f, cross(a, b)),
				1e-9,
			);
			expect(length(galaxyToSystem(f, a))).toBeCloseTo(1, 12);
		}
	});

	test("the rotation and the parameters it reports are the same frame", () => {
		// **The anti-inversion row.** A shipped frame whose composition is flipped
		// carries a pole the rotation never lands the galactic normal on, and a
		// roll of the other sign. Both halves are measured off the rotation above,
		// by an arithmetic this module does not share.
		for (const seed of SEEDS.slice(0, 32)) {
			const f = skyFrame(seed);
			const got = extract(f);
			expectVec(got.pole, f.pole, 1e-9);
			// `rollRad` is reported in [−π, π), so the extracted value is compared
			// as an angle rather than as a number: 3.13 and −3.13 are the same roll.
			const delta = Math.abs(got.rollRad - f.rollRad);
			expect(Math.min(delta, TAU - delta)).toBeLessThanOrEqual(1e-9);
		}
	});

	test("lands where the frame is recorded as landing", () => {
		// **The recorded fact**, which is what #431 and #433 asked for: a bearing
		// stated without recomputing one. Two systems of world seed 47, galaxy 0 —
		// the view set's own seed — because one value could be a coincidence of
		// where that system happens to sit.
		//
		// **These were derived twice before being pinned.** Once by this module, and
		// once through `three`'s own quaternion arithmetic — a second implementation,
		// from a different codebase, with its own conventions about product order and
		// handedness. That second derivation was a scratch script for a round, which
		// made "the two agree to 2.3e-16" a claim about a run nobody could repeat; it
		// is the row below this one now, over every seed rather than two.
		//
		// That is the whole point of the pin. A literal copied out of this module's
		// own first run would pin a wrong handedness and read green forever, which is
		// precisely the failure #99 describes.
		//
		// The seed is asserted before the frame so the two ways this can go red say
		// different things: a seed that moved means a generator change moved the
		// layout attempt and these are now different systems; a frame that moved
		// means the transform changed for every seed in the game, and #431's bright
		// layer moves with it.
		const PINS: Record<number, { seed: number; q: number[]; core: number[] }> =
			{
				0: {
					seed: 317_796_971,
					q: [-0.57696703, 0.460530844, 0.674539631, 0.004083449],
					core: [-0.835039436, -0.348737792, -0.425547991],
				},
				91: {
					seed: 2_358_711_787,
					q: [0.487206205, 0.647631637, 0.211604732, 0.546284554],
					core: [0.30358665, 0.743151257, 0.596289656],
				},
			};
		for (const index of [0, 91]) {
			const pin = PINS[index];
			const record = galaxy.systems[index];
			expect(systemSeedFor(WORLD, 0, galaxy.attempt, index)).toBe(pin.seed);
			const f = skyFrame(pin.seed);
			expect(f.q.map((n) => Number(n.toFixed(9)))).toEqual(pin.q);
			const core = coreBearing(f, record.pos);
			expect(core).not.toBeNull();
			expect(
				[core!.x, core!.y, core!.z].map((n) => Number(n.toFixed(9))),
			).toEqual(pin.core);
		}
	});

	test("three's own arithmetic builds the same frame from the same pole and roll", () => {
		// The second derivation behind the pins above, shipped as a row.
		//
		// `three` composes the same two pieces — its `setFromUnitVectors` is the
		// shortest arc arrived at another way, `setFromAxisAngle` the same roll — and
		// shares no line with `src/quat.ts`. Comparing against it checks the
		// composition, the **order** of the two factors, and the sign of the roll
		// against the library the renderer itself uses, which is the authority on what
		// a quaternion means on screen. Agreement with a transcription written by the
		// same hand as the original is worth considerably less.
		//
		// Compared up to sign: `q` and `−q` are the same rotation, and the two
		// libraries are free to report either. The rotation is what is being pinned,
		// not the octant of the 4-sphere it is quoted from.
		//
		// Measured over all 128 seeds: the largest component difference between the
		// two quaternions is 8.5·10⁻¹⁶ — four steps of the ladder at 1 — and the
		// largest difference between where they carry the roll reference is
		// 1.8·10⁻¹⁵, eight steps, the extra four being the roundings of applying a
		// rotation rather than building one. Both are rounding and nothing else. The
		// bound below is 5.6 times the worse of them — room for a rounding to move,
		// and none for a wrong frame, which disagrees by order 1. A bound tighter than
		// a rounding is a row that goes red on a compiler, which teaches nobody
		// anything; a bound two orders looser would teach the same lesson in reverse.
		const normal = toVector3(GALACTIC_NORMAL);
		const east = toVector3(GALACTIC_EAST);
		let worstQuaternion = 0;
		let worstEast = 0;
		for (const seed of SEEDS) {
			const f = skyFrame(seed);
			const pole = toVector3(f.pole);
			const theirs = new THREE.Quaternion()
				.setFromAxisAngle(pole, f.rollRad)
				.multiply(new THREE.Quaternion().setFromUnitVectors(normal, pole));
			const mine = new THREE.Quaternion(f.q[0], f.q[1], f.q[2], f.q[3]);
			// `q` and `−q` are the same rotation, so the comparison is up to sign.
			// `set` rather than a scalar multiply: this repo's `@types/three` does not
			// declare `multiplyScalar`, and reaching for it through a cast would be a
			// row that depends on a typing gap.
			if (theirs.dot(mine) < 0)
				theirs.set(-theirs.x, -theirs.y, -theirs.z, -theirs.w);
			worstQuaternion = Math.max(
				worstQuaternion,
				Math.abs(theirs.x - mine.x),
				Math.abs(theirs.y - mine.y),
				Math.abs(theirs.z - mine.z),
				Math.abs(theirs.w - mine.w),
			);
			// And where each carries the roll reference. This is the load-bearing
			// half: a mirrored or inverted frame still lands the *pole* correctly, and
			// only a direction that depends on the roll can show the mirror.
			const landedTheirs = east.clone().applyQuaternion(theirs);
			const landedMine = galaxyToSystem(f, GALACTIC_EAST);
			worstEast = Math.max(
				worstEast,
				Math.abs(landedTheirs.x - landedMine.x),
				Math.abs(landedTheirs.y - landedMine.y),
				Math.abs(landedTheirs.z - landedMine.z),
			);
		}
		expect(worstQuaternion).toBeLessThanOrEqual(1e-14);
		expect(worstEast).toBeLessThanOrEqual(1e-14);
	});

	test("the drawn poles cover the sphere, and the rolls cover the circle", () => {
		// #100's rejected option — aligned frames — is what this row reddens.
		//
		// The bounds are loose on purpose. For a uniform pole each coordinate has a
		// marginal density of 1/2 on [−1, 1], so P(|cos| > 0.85) is 0.15 per tail
		// and P(a tail is never reached in 128 draws) is 0.85¹²⁸ ≈ 3·10⁻¹⁰. A
		// tighter bound would be asserting on the sample rather than on the
		// distribution; a narrowed family fails these by miles, not by a hair.
		const poles = SEEDS.map((seed) => skyFrame(seed).pole);
		const cos = poles.map((p) => dot(p, SYSTEM_PLANE_NORMAL));
		expect(Math.max(...cos)).toBeGreaterThan(0.85);
		expect(Math.min(...cos)).toBeLessThan(-0.85);
		for (const axis of ["x", "y", "z"] as const) {
			const reach = Math.max(...poles.map((p) => Math.abs(p[axis])));
			expect(reach).toBeGreaterThan(0.8);
		}
		// No side of the plane is favoured, and the rolls are drawn at all: a frame
		// built as tilt-only ships a roll of exactly zero every time, which is the
		// same sky rotated into the same azimuth in every system.
		expect(Math.abs(cos.reduce((a, b) => a + b, 0) / cos.length)).toBeLessThan(
			0.15,
		);
		// **And the pole is uniform on the sphere rather than uniform in the
		// angle.** The extremes above cannot tell the two apart — drawing θ uniformly
		// instead of `cos θ` *over*-reaches the tails, so a row that only asks
		// whether the ends are reached passes on the classic mistake. The mean of
		// |cos| separates them cleanly: exactly 0.5 for a sphere, and 2/π ≈ 0.637
		// when θ is drawn uniformly, and 1.0 for aligned frames.
		//
		// The seeds are a fixed list, so this row cannot flake — it is a statement
		// about this sample, whose observed mean is 0.4735. The standard error of a
		// mean of 128 uniform |cos| draws is 0.0255, so the bounds sit ±0.06 from the
		// expectation: **±2.35 standard errors**, which is what this comment once
		// called "four sigma on either side" and is not. The width is not what makes
		// the row a detector, though. Every arm it exists to catch is far outside it —
		// the angle-uniform draw lands at 0.637, 5.4 standard errors out, and aligned
		// frames at 1.0, 19.6 out — while a correct draw sits 1.0 out on the near
		// side. That separation is the margin, not the width of the band.
		const meanAbsCos = cos.reduce((a, b) => a + Math.abs(b), 0) / cos.length;
		expect(meanAbsCos).toBeGreaterThan(0.44);
		expect(meanAbsCos).toBeLessThan(0.56);
		const rolls = SEEDS.map((seed) => skyFrame(seed).rollRad);
		expect(Math.max(...rolls) - Math.min(...rolls)).toBeGreaterThan(TAU * 0.9);
	});

	test("is drawn from its own domain tag, and from no other", () => {
		// The map's per-system RNG constraint in the form this node was written
		// against: reusing `STREAMS.backdrop` correlates which way the sky is drawn with
		// the point field's scatter, and #100 named that in its own constraints.
		// `tests/market-state.test.ts` pins the tag's *value*, so this row is about
		// what the frame reads rather than what the integer is.
		const code = codeOf("src/galaxy-frame.ts");
		expect(code).toContain("DOMAIN.SKY_FRAME");
		expect(code).not.toContain("STREAMS");
		expect(code).not.toContain('"backdrop"');
	});

	test("is uncorrelated with the system's own position", () => {
		// The trap `DOMAIN.ARRIVAL` documents: drawing a per-system direction from
		// `POS` replays the stream the position already consumed, so the new
		// direction becomes a function of where the system sits. Deterministic, and
		// invisible to every check that only asks whether the result is legal.
		//
		// For two independent uniform directions the mean of |dot| is exactly 0.5,
		// with a standard error near 0.018 over 256 records; 0.6 is five of them.
		let sum = 0;
		for (const record of galaxy.systems)
			sum += Math.abs(
				dot(normalizeOr(record.pos, UNIT), skyFrame(record.seed).pole),
			);
		expect(sum / galaxy.systems.length).toBeLessThan(0.6);
	});

	test("every system in a galaxy gets its own frame", () => {
		// The cheapest wrong answer — one frame for the whole galaxy, or one frame
		// per galaxy keyed off something shared — makes every pilot's cluster sit in
		// the same part of their own sky. Distinct frames is the minimum the
		// decision bought.
		const frames = new Set(
			galaxy.systems.map((r) =>
				skyFrame(r.seed)
					.q.map((n) => n.toFixed(9))
					.join(","),
			),
		);
		expect(frames.size).toBe(galaxy.systems.length);
	});
});

describe("galaxyToSystem", () => {
	test("carry the basis the module claims, and no more", () => {
		// A rotation is fully determined by where it sends two perpendicular
		// directions plus its handedness, and those two directions are this
		// module's whole public claim about the galactic frame: the plane's normal,
		// and the roll reference that lives in the plane.
		const f = skyFrame(4242);
		expectVec(galaxyToSystem(f, GALACTIC_NORMAL), f.pole, 1e-9);
		expect(length(galaxyToSystem(f, GALACTIC_EAST))).toBeCloseTo(1, 12);
		expect(dot(galaxyToSystem(f, GALACTIC_EAST), f.pole)).toBeCloseTo(0, 12);
	});

	test("a direction lying in the cluster's reference plane lands perpendicular to the pole", () => {
		// Synthetic positions, because this is the exact statement rather than a
		// statistical one: the transform carries the galactic plane onto a great
		// circle whose pole is `SkyFrame.pole`. It is also the row that answers the
		// flattening trap — `systemFromPosition` divides `y` by
		// `GALAXY_FLATTENING_Q` because the stored position *is* the fiction's oblate
		// shape, and a reader who takes that quotient for a distortion to undo has to
		// put the correction somewhere; this statement holds only for the stored
		// positions as drawn.
		for (const seed of SEEDS.slice(0, 8)) {
			const f = skyFrame(seed);
			for (const azimuth of [0, 1.1, 2.7, 4.4]) {
				const inPlane = normalizeOr(
					{
						x: Math.cos(azimuth),
						y: 0,
						z: Math.sin(azimuth),
					},
					UNIT,
				);
				expect(dot(galaxyToSystem(f, inPlane), f.pole)).toBeCloseTo(0, 9);
			}
		}
	});
});

describe("skyBearing", () => {
	test("is a unit direction in the observer's own frame", () => {
		const from = galaxy.systems[0];
		for (const to of galaxy.systems.slice(1, 20)) {
			const b = skyBearing(skyFrame(from.seed), from.pos, to.pos);
			expect(b).not.toBeNull();
			expect(length(b!)).toBeCloseTo(1, 12);
		}
	});

	test("is the galaxy-space difference taken first and carried second", () => {
		// The order is the whole content of the function, and #99's flipped
		// `setFromUnitVectors` is the cautionary tale: carrying each position into
		// the world frame with *different* frames and then differencing is the same
		// shape of mistake and returns a plausible unit vector.
		const a = galaxy.systems[3];
		const b = galaxy.systems[77];
		const f = skyFrame(a.seed);
		expectVec(
			galaxyToSystem(f, normalizeOr(sub(b.pos, a.pos), UNIT)),
			skyBearing(f, a.pos, b.pos)!,
			1e-9,
		);
	});

	test("refuses two systems in the same place rather than aiming at nothing", () => {
		// A zero difference carries no bearing. A guard that does not recognise its
		// input refuses (#206); a zero vector or the identity would be a direction a
		// caller cannot tell from a real one.
		const a = galaxy.systems[5];
		expect(skyBearing(skyFrame(a.seed), a.pos, a.pos)).toBeNull();
	});
});

describe("coreBearing", () => {
	test("is the image of the way back to the centre, and refuses at the centre", () => {
		const rim = galaxy.systems.reduce((best, r) =>
			length(r.pos) > length(best.pos) ? r : best,
		);
		// One frame throughout: a bearing is only ever meaningful in the frame of
		// the system it is observed *from*, and reading it through another system's
		// frame is the mistake this module exists to make impossible.
		const rimFrame = skyFrame(rim.seed);
		const b = coreBearing(rimFrame, rim.pos);
		expect(b).not.toBeNull();
		expect(length(b!)).toBeCloseTo(1, 12);
		expectVec(
			b!,
			galaxyToSystem(rimFrame, normalizeOr(scale(rim.pos, -1), UNIT)),
			1e-9,
		);
		expect(coreBearing(rimFrame, v3(0, 0, 0))).toBeNull();
	});

	test("is defined for every system the generator ships", () => {
		// So the refusal above is a boundary and not a live case. This walks the
		// shipped cluster — world seed 47, galaxy 0, the view set's own seed — and
		// goes red the day the generator places a system on the centre, which is the
		// only way that refusal becomes a runtime answer.
		//
		// A second assertion used to sit here, `GALAXY_RADIUS_LY > 0`, offered as
		// proof that the row is about real geometry. It was decoration: no mutation
		// of this module can turn a positive radius negative, so it could not go red,
		// and a row that cannot fail is not evidence that the row beside it means
		// what it says. That the sample is the shipped cluster is stated above, where
		// a reader can weigh it; the generator's own suite is what holds it.
		expect(
			galaxy.systems.every(
				(r) => coreBearing(skyFrame(r.seed), r.pos) !== null,
			),
		).toBe(true);
	});

	test("the core is overhead in some systems and underfoot in others", () => {
		// The measurement #100 closed on: the cluster's light is directional rather
		// than bright, so the *bearing* is the picture and the brightness is
		// nearly nothing. Bearings are read in each observer's own frame, which is
		// the only sense in which a bearing means anything from a cockpit.
		const bearings = galaxy.systems
			.map((r) => coreBearing(skyFrame(r.seed), r.pos)!)
			.filter(Boolean);
		const againstPlane = bearings.map((b) =>
			Math.abs(dot(b, SYSTEM_PLANE_NORMAL)),
		);
		const mean = againstPlane.reduce((a, b) => a + b, 0) / againstPlane.length;
		// Not a band: the core is overhead in some systems and underfoot in others.
		expect(Math.max(...againstPlane)).toBeGreaterThan(0.6);
		expect(Math.min(...againstPlane)).toBeLessThan(0.4);
		expect(mean).toBeGreaterThan(0.2);
	});
});

describe("one galactic frame, read by everything that points at it", () => {
	test("the chart's UP is the module's normal, not the chart's own", () => {
		// `galaxy-map.ts` had `const UP = new THREE.Vector3(0, 1, 0)`: the cluster's
		// reference-plane normal, authored a second time in a renderer. That is the
		// drift this node exists to end, and no row above can see it because none of
		// them reads the chart.
		//
		// Asserted **positively** — the declaration has to read the constant, and the
		// import has to be the one carrying it — rather than by forbidding the literal
		// `new THREE.Vector3(0, 1, 0)` anywhere in the file. What is held here is one
		// declaration's provenance. A spelling ban would redden this row over a chart
		// lamp or a camera up-vector with nothing to do with the galaxy, and the first
		// author to trip it would be right to widen it.
		const chart = codeOf("src/galaxy-map.ts");
		expect(chart).toMatch(
			/import \{ GALACTIC_NORMAL \} from "\.\/galaxy-frame"/,
		);
		expect(chart).toMatch(
			/const UP = new THREE\.Vector3\(\s*GALACTIC_NORMAL\.x,\s*GALACTIC_NORMAL\.y,\s*GALACTIC_NORMAL\.z,?\s*\)/,
		);
	});

	test("nothing but this module declares the galactic frame's directions", () => {
		// The other half of one copy. The chart reading the constant is worth little
		// if any other file is free to author a second normal, so the guard sits at
		// the level the claim is at — a **declaration** — and runs over every module in
		// `src/` rather than over the one file this node happened to edit. The
		// expected list is a literal, so a fourth direction added here is a row that
		// has to be read and not just re-pinned.
		//
		// What it cannot see, said plainly: a copy under another name — `GALAXY_UP`, or
		// a bare `v3(0, 1, 0)` in a module nobody has thought of yet — is beyond any
		// spelling check, and `(0, 1, 0)` is already a legitimate vector in unrelated
		// places besides this one. Banning those would make the row about coincidental
		// coordinates, which is how a guard gets widened into nothing.
		//
		// Direction-**shaped** names only, for the same reason. The repository already
		// ships a Galactic Hyperdrive, and a `GALACTIC_HYPERDRIVE_SCAN_MS` reddening a
		// row about frame directions is a false alarm that trains the next author to
		// widen the row. So the check is on a name that reads as an axis.
		const axisName =
			/^(?:[A-Z_]+_)?(?:NORMAL|EAST|WEST|NORTH|SOUTH|UP|DOWN|POLE|AXIS|CORE|DIRECTION)$/;
		const declared = /(?:export )?const (GALACTIC_[A-Z_]+)\b/g;
		const authors: string[] = [];
		for (const file of srcFiles())
			for (const found of codeOf(file).matchAll(declared))
				if (axisName.test(found[1].slice("GALACTIC_".length)))
					authors.push(`${file}: ${found[1]}`);
		expect(authors.sort()).toEqual([
			"src/galaxy-frame.ts: GALACTIC_CORE",
			"src/galaxy-frame.ts: GALACTIC_EAST",
			"src/galaxy-frame.ts: GALACTIC_NORMAL",
		]);
	});

	test("the flattening comes off the component this normal is the normal of", () => {
		// The exception the declaration guard cannot see. `galaxy.ts` holds this same
		// axis as a **choice of component**: `profileRadiusLy` — and the identical
		// quotient `systemFromPosition` inlines — divides the term along `y` by
		// `GALAXY_FLATTENING_Q`. Being the module this one imports, it can never
		// import the constant back without a cycle, so the axis is authored twice in
		// two different forms and a spelling check sees one of them.
		//
		// So this row asks the flattening *where it acts*, and asks it of the
		// constant: the squashed component has to be the one along
		// `GALACTIC_NORMAL`, in plane directions nothing changes, and the mixed case
		// is what fails if the quotient is taken off a magnitude rather than off a
		// component. Re-axis the cluster and this goes red — which is the drift the
		// module's own doc names and the guard was never going to catch.
		const probes: [Vec3, number][] = [
			// Along the normal: the whole quotient, and the radius comes out *larger*
			// than the stored distance, because the fiction squashes this axis.
			[scale(GALACTIC_NORMAL, 4), 4 / GALAXY_FLATTENING_Q],
			[scale(GALACTIC_EAST, 4), 4],
			[scale(cross(GALACTIC_NORMAL, GALACTIC_EAST), 4), 4],
			[
				add(scale(GALACTIC_EAST, 3), scale(GALACTIC_NORMAL, 4)),
				Math.hypot(3, 4 / GALAXY_FLATTENING_Q),
			],
		];
		for (const [position, expected] of probes)
			expect(profileRadiusLy(position)).toBeCloseTo(expected, 12);
		// The *shipped* copy of this quotient is inlined in `systemFromPosition` — one
		// square root and one domain guard avoided on 2,048 records per world, for a
		// `q` that is a compile-time constant there — and no call reaches an
		// expression: the probe above cannot see a defect that lives only in the
		// inlined form. So that copy is tied the way this file ties the chart's `UP`,
		// to the declaration itself. It is a text check and it knows it; what it buys
		// is that re-axing the flattening somewhere no row can evaluate reddens
		// something, here, rather than nothing.
		expect(codeOf("src/galaxy.ts")).toMatch(
			/const flattenedY = pos\.y \/ GALAXY_FLATTENING_Q;/,
		);
	});

	test("the world frame it aims into is still the one the game rolls against", () => {
		// The codomain half of the same claim. `SYSTEM_PLANE_NORMAL` says a system's
		// reference plane is `z = 0`; `hud.ts`'s attitude reference and `main.ts`'s
		// roll are what make that true in the shipped game, and a change there
		// silently re-aims every bearing this module returns.
		expect(codeOf("src/main.ts")).toMatch(
			/horizonRoll\(\s*this\.orientation,\s*v3\(\s*0,\s*0,\s*1\s*\)\s*\)/,
		);
	});

	test("the galactic basis is orthonormal as declared", () => {
		expect(length(GALACTIC_NORMAL)).toBeCloseTo(1, 12);
		expect(length(GALACTIC_EAST)).toBeCloseTo(1, 12);
		expect(length(SYSTEM_PLANE_NORMAL)).toBeCloseTo(1, 12);
		expect(dot(GALACTIC_NORMAL, GALACTIC_EAST)).toBeCloseTo(0, 12);
	});
});
