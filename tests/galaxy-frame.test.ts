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
import { DOMAIN } from "../src/domains";
import { GALAXY_RADIUS_LY, generateGalaxy, systemSeedFor } from "../src/galaxy";
import {
	GALACTIC_EAST,
	GALACTIC_NORMAL,
	SYSTEM_PLANE_NORMAL,
	type SkyFrame,
	coreBearing,
	galaxyToSystem,
	skyBearing,
	skyFrame,
	systemToGalaxy,
} from "../src/galaxy-frame";
import {
	type Vec3,
	cross,
	dot,
	length,
	normalizeOr,
	scale,
	sub,
	v3,
} from "../src/vec3";
import { codeOf } from "./lib/source-scan";

const UNIT: Vec3 = v3(0, 0, 1);
const TAU = Math.PI * 2;

const expectVec = (got: Vec3, want: Vec3, tol = 1e-9) => {
	expect(Math.abs(got.x - want.x)).toBeLessThanOrEqual(tol);
	expect(Math.abs(got.y - want.y)).toBeLessThanOrEqual(tol);
	expect(Math.abs(got.z - want.z)).toBeLessThanOrEqual(tol);
};

/** Directions all over the sphere, axes and their negatives included — a claim
 *  checked on four pleasant directions is a claim about those four. */
const DIRECTIONS: Vec3[] = [
	v3(1, 0, 0),
	v3(0, 1, 0),
	v3(0, 0, 1),
	v3(-1, 0, 0),
	v3(0, -1, 0),
	v3(0, 0, -1),
	v3(1, 1, 0),
	v3(1, 1, 1),
	v3(-0.3, 0.6, -0.74),
].map((v) => normalizeOr(v, UNIT));

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
		for (const seed of SEEDS.slice(0, 16)) {
			const f = skyFrame(seed);
			for (const d of DIRECTIONS) {
				expectVec(systemToGalaxy(f, galaxyToSystem(f, d)), d, 1e-9);
				expectVec(galaxyToSystem(f, systemToGalaxy(f, d)), d, 1e-9);
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
			// `rollRad` is reported in (−π, π], so the extracted value is compared
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
		// **These were derived twice before being pinned.** Once by this module,
		// and once by a scratch script that composed the same pole and roll through
		// `three`'s own `Quaternion.setFromUnitVectors` and `setFromAxisAngle` — a
		// second implementation, from a different codebase, with its own conventions
		// about product order and handedness. The two agree to **2.3e-16** on the
		// quaternion, on the pole it lands the galactic normal on, on where it
		// carries the roll reference `GALACTIC_EAST`, and on the resulting core
		// bearing. The `GALACTIC_EAST` one is the load-bearing of the four: a
		// mirrored or inverted frame still lands the pole correctly, and only a
		// direction-dependent direction shows it.
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
		// when θ is drawn uniformly. Over 128 draws the standard error is 0.026, so
		// this band is four sigma wide on either side.
		const meanAbsCos = cos.reduce((a, b) => a + Math.abs(b), 0) / cos.length;
		expect(meanAbsCos).toBeGreaterThan(0.44);
		expect(meanAbsCos).toBeLessThan(0.56);
		const rolls = SEEDS.map((seed) => skyFrame(seed).rollRad);
		expect(Math.max(...rolls) - Math.min(...rolls)).toBeGreaterThan(TAU * 0.9);
	});

	test("is drawn from its own domain tag, and from no other", () => {
		// The map's per-system RNG constraint in the form this node was written
		// against: reusing `STREAMS.backdrop` correlates the sky's orientation with
		// the point field's scatter, and #100 named that in its own constraints.
		// `tests/market-state.test.ts` pins the tag's *value*, so this row is about
		// what the frame reads rather than what the integer is.
		const code = codeOf("src/galaxy-frame.ts");
		expect(code).toContain("DOMAIN.SKY_FRAME");
		expect(code).not.toContain("STREAMS");
		expect(code).not.toContain('"backdrop"');
		expect(DOMAIN.SKY_FRAME).toBeGreaterThan(0);
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

describe("galaxyToSystem / systemToGalaxy", () => {
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
		// `GALAXY_FLATTENING_Q` for a *profile coordinate*, and a reader who takes
		// that quotient as a distortion to undo has to put it somewhere; this one
		// holds only for the stored positions as drawn.
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
		// So the refusal above is a boundary and not a live case: no generated
		// system sits at the centre. `GALAXY_RADIUS_LY` is here to say the row is
		// about the shipped cluster's geometry rather than a synthetic one.
		expect(
			galaxy.systems.every(
				(r) => coreBearing(skyFrame(r.seed), r.pos) !== null,
			),
		).toBe(true);
		expect(GALAXY_RADIUS_LY).toBeGreaterThan(0);
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
	test("the chart reads the module instead of restating the plane", () => {
		// `galaxy-map.ts` had `const UP = new THREE.Vector3(0, 1, 0)`: the cluster's
		// reference-plane normal, authored a second time in a renderer. That is the
		// drift this node exists to end, and no row above can see it because none of
		// them reads the chart.
		const chart = codeOf("src/galaxy-map.ts");
		expect(chart).toContain("GALACTIC_NORMAL");
		expect(chart).not.toMatch(/new THREE\.Vector3\(\s*0,\s*1,\s*0\s*\)/);
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
