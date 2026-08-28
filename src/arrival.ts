/**
 * The successful entry's arrival, and its mirror the launch
 * (`docs/specs/docking.md` §12).
 *
 * **A sim position law, not an animation.** §12.1's decision E2 makes the
 * arrival scripted and unfailable, and the repo's standing rule decides where it
 * lives: the authoritative world is float64 kilometres outside the scene graph
 * and nothing reads a position back out of an `Object3D`. So this is the shape
 * `cruise.ts` already uses — pure, no memory, evaluated at a progress value the
 * caller holds the clock for — and therefore headless-testable rather than a
 * thing only a probe can see.
 *
 * **Everything here is in the station's *rotating* frame.** §12.3 names a
 * translating-frame law as the one way a scripted path can still end somewhere
 * it was not put: the throat turns with the station, so a law that fixes the
 * ship's lateral offset in world space walks it into a wall that moved. The
 * mechanism is that the lateral components are held in the aperture basis and
 * the **basis is re-evaluated at the phase passed in on every call** — so a
 * caller feeding the current `slotPhaseRad` gets the rotating frame for free,
 * and `tests/arrival.test.ts` holds a control asserting that freezing the phase
 * instead fails.
 *
 * No Three.js and no `sim.ts`, for the reason `docking.ts`'s header gives: the
 * arrow points one way, and `sim.ts` importing this would close a cycle.
 */

import {
	type ApertureFrame,
	ARRIVAL_SECONDS,
	frameAtPhase,
	slotBasis,
} from "./docking";
import type { StationAperture, StationGeometry } from "./station";
import { type Vec3, add, dot, scale, sub, v3 } from "./vec3";

/**
 * How far outside the aperture plane the launch releases the ship, km.
 *
 * §12.2: the exemption ends "when it clears the aperture plane outward", so the
 * law has to end somewhere strictly outside it — a release exactly *on* the
 * plane leaves the ship on the surface its own §3 checks are evaluated at,
 * which is the same objection §12.2 raises against parking a docked ship there.
 *
 * Twenty metres: outside the core sphere by more than any rounding in the
 * crossing arithmetic, and far under the 3 km the docking computer stands off
 * at, so it is a release rather than a manoeuvre.
 */
export const LAUNCH_RELEASE_KM = 0.02;

/**
 * How deep a slot's throat runs, as a multiple of the aperture's smaller
 * dimension.
 *
 * **E7: the throat extends the aperture recess rather than being authored per
 * form.** `station-mesh.ts`'s `buildAperture` already sinks a mouth of
 * `min(w, h) × 0.8` behind every aperture and is called by every form, so the
 * throat is the same recess taken deeper — which is why this is a factor on the
 * same quantity and not a length. A retune of the slot moves it, and *which*
 * forms get a throat is decided by `aperture.kind` below rather than by a list.
 *
 * Four: 280 m behind a 120 × 70 m slot on a 600 m core, so the ship is visibly
 * inside a tunnel and the docked position is still well clear of the station's
 * own centre — which `tests/arrival.test.ts` asserts for every type rather than
 * for the one this number was chosen against.
 */
export const THROAT_DEPTH_FACTOR = 4;

/**
 * How far a pad sinks the ship below its deck, as a multiple of the same
 * quantity.
 *
 * **E8: a pad is an exterior deck with no inside**, so this is not a shallow
 * throat — it is §12.2's "a hair inside the deck", and it exists for the reason
 * that section gives: the plane is §3's evaluation surface, and a ship parked
 * exactly on it rests on the boundary of the surface its own checks are
 * evaluated at. Three metres on a 150 m pad.
 */
export const PAD_SINK_FACTOR = 0.02;

/** How far behind the aperture plane the ship ends up, km — a throat for a
 *  slot, a hair for a pad, and in both cases a function of `STATION_GEOMETRY`
 *  rather than a new constant (§12.2). */
export function throatDepthKm(aperture: StationAperture): number {
	const smaller = Math.min(aperture.widthKm, aperture.heightKm);
	return (
		smaller * (aperture.kind === "slot" ? THROAT_DEPTH_FACTOR : PAD_SINK_FACTOR)
	);
}

/**
 * The docked position's axial distance from the station's centre, km.
 *
 * A quantity computed in sim, in the station's own frame, that the renderer
 * mirrors — §12.2's requirement, and the reason "inside the throat" is not
 * good enough: §12.6's obligation 1 cannot be written against a description.
 */
export function dockedAxialKm(geometry: StationGeometry): number {
	return geometry.coreRadiusKm - throatDepthKm(geometry.aperture);
}

/** The ship's offset from the station centre, in aperture-basis components.
 *  Lateral components are held here and the basis is rebuilt per call, which is
 *  what makes the law a rotating-frame one. */
interface LocalOffset {
	axial: number;
	across: number;
	up: number;
}

export interface ArrivalLaw {
	/** Which traversal. The two share every line of arithmetic below and differ
	 *  only in their endpoints and which way the nose points — which is what
	 *  §12.2 means by "the mirror", spelled as one law rather than as two. */
	kind: "arrival" | "launch";
	frame: ApertureFrame;
	startedAtS: number;
	durationS: number;
	from: LocalOffset;
	to: LocalOffset;
	/** The attitude the ship held at the crossing, blended out over the
	 *  traversal. Absent for a launch, which starts already aligned. */
	fromNose: Vec3 | null;
	fromUp: Vec3 | null;
}

/** Smoothstep. Zero derivative at both ends, so the ship eases off the crossing
 *  and parks rather than arriving at speed and stopping dead — and so the
 *  release velocity at the end of a launch is the station's, with no invented
 *  kick. */
const ease = (u: number): number => u * u * (3 - 2 * u);
const easeRate = (u: number): number => 6 * u * (1 - u);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Decompose a station-relative offset onto the aperture basis at one phase. */
function decompose(
	frame: ApertureFrame,
	phaseRad: number,
	rel: Vec3,
): LocalOffset {
	const { across, up } = slotBasis(frameAtPhase(frame, phaseRad));
	return {
		axial: dot(rel, frame.axis),
		across: dot(rel, across),
		up: dot(rel, up),
	};
}

/**
 * Begin the arrival, from the pose the crossing left the ship in.
 *
 * `entryRel` is the ship's position in the station's frame at the crossing —
 * `planeCrossing`'s interpolated `rel`, which check 5 has already placed inside
 * the aperture rectangle. That containment is what makes §12.6's obligation 7
 * assertable: the lateral components only ever shrink from here, so a law that
 * starts inside the section stays inside it.
 */
export function beginArrival(
	frame: ApertureFrame,
	entryRel: Vec3,
	startedAtS: number,
	entryAttitude?: { nose: Vec3; up: Vec3 },
): ArrivalLaw {
	const from = decompose(frame, frame.phaseRad, entryRel);
	return {
		kind: "arrival",
		frame,
		startedAtS,
		durationS: ARRIVAL_SECONDS,
		from,
		to: { axial: dockedAxialFor(frame), across: 0, up: 0 },
		fromNose: entryAttitude?.nose ?? null,
		fromUp: entryAttitude?.up ?? null,
	};
}

/**
 * Begin the launch: the same law, run the other way.
 *
 * **It takes the parked attitude, because "already aligned" was only half
 * true.** The arrival does leave the ship rolled to the slot, but it leaves the
 * nose pointing *inward* — and a launch aims outward, so with nothing to blend
 * from the ship reversed 180° on the traversal's first frame. The same easing
 * that settles the arrival now turns it round on the way out. Omit the argument
 * and it snaps, which is why the caller passes it rather than the law assuming.
 *
 * No flag, though: **a launch is unconditionally skippable** and reads none of
 * E4's state (§12.2).
 */
export function beginLaunch(
	frame: ApertureFrame,
	startedAtS: number,
	dockedAttitude?: { nose: Vec3; up: Vec3 },
): ArrivalLaw {
	return {
		kind: "launch",
		frame,
		startedAtS,
		durationS: ARRIVAL_SECONDS,
		from: { axial: dockedAxialFor(frame), across: 0, up: 0 },
		to: { axial: frame.planeKm + LAUNCH_RELEASE_KM, across: 0, up: 0 },
		fromNose: dockedAttitude?.nose ?? null,
		fromUp: dockedAttitude?.up ?? null,
	};
}

/**
 * The docked axial distance for a frame.
 *
 * The frame carries the aperture and `planeKm` — which `apertureFrame` sets to
 * the dockable core radius — so the law needs no second lookup into
 * `STATION_GEOMETRY` and cannot disagree with the frame the checks ran against.
 */
function dockedAxialFor(frame: ApertureFrame): number {
	// Through `dockedAxialKm`, not a second spelling of the same subtraction:
	// the frame's `planeKm` **is** the dockable core radius (`apertureFrame`
	// sets it from `STATION_GEOMETRY`), so this is the same rule read off the
	// frame the checks ran against rather than a parallel one that a retune
	// could leave behind.
	return dockedAxialKm({
		coreRadiusKm: frame.planeKm,
		aperture: frame.aperture,
		// Neither field is read by `dockedAxialKm`; they are here because
		// `StationGeometry` is a record of four and a partial would be a cast.
		axis: "parent",
		spins: frame.aperture.kind === "slot",
	});
}

/** Where the traversal is, 0 at its start and 1 from its end onward. Clamped
 *  rather than left to run: an arrival that kept integrating past 1 would drive
 *  the ship through the far wall of the throat it was placed in. */
export function arrivalProgress(law: ArrivalLaw, gameTime: number): number {
	return clamp01((gameTime - law.startedAtS) / law.durationS);
}

/** The ship's position in the station's frame at progress `u` and slot phase
 *  `phaseRad`. */
export function arrivalRel(law: ArrivalLaw, u: number, phaseRad: number): Vec3 {
	const e = ease(clamp01(u));
	const { across, up } = slotBasis(frameAtPhase(law.frame, phaseRad));
	const lerp = (a: number, b: number) => a + (b - a) * e;
	return add(
		scale(law.frame.axis, lerp(law.from.axial, law.to.axial)),
		add(
			scale(across, lerp(law.from.across, law.to.across)),
			scale(up, lerp(law.from.up, law.to.up)),
		),
	);
}

/**
 * The derivative of `arrivalRel` — the velocity the game hands the ship, in the
 * station's frame.
 *
 * Analytic rather than a finite difference of the position, so the ship is
 * carried and moves by the same rule; `tests/arrival.test.ts` checks the two
 * against each other. The rotation terms are the reason it cannot be a plain
 * interpolation: `d(across)/dφ` is `up` and `d(up)/dφ` is `−across`, so a
 * station turning at `spinRadPerS` contributes a velocity to any ship holding a
 * lateral offset — which is precisely the motion a translating-frame law omits.
 */
export function arrivalRelVelocity(
	law: ArrivalLaw,
	u: number,
	phaseRad: number,
	spinRadPerS: number,
): Vec3 {
	const c = clamp01(u);
	const e = ease(c);
	const de = easeRate(c) / law.durationS;
	const { across, up } = slotBasis(frameAtPhase(law.frame, phaseRad));
	const at = (a: number, b: number) => a + (b - a) * e;
	const rate = (a: number, b: number) => (b - a) * de;
	const acrossNow = at(law.from.across, law.to.across);
	const upNow = at(law.from.up, law.to.up);
	return add(
		scale(law.frame.axis, rate(law.from.axial, law.to.axial)),
		add(
			scale(across, rate(law.from.across, law.to.across) - upNow * spinRadPerS),
			scale(up, rate(law.from.up, law.to.up) + acrossNow * spinRadPerS),
		),
	);
}

/** Normalise. A zero vector has no direction, so it gets an arbitrary one
 *  rather than a `NaN`. */
function unit(a: Vec3): Vec3 {
	const n = Math.hypot(a.x, a.y, a.z);
	return n === 0 ? v3(0, 0, 1) : scale(a, 1 / n);
}

/**
 * Interpolate two directions along the great circle between them.
 *
 * **A real slerp, because the obvious `unit(lerp(a, b, t))` is degenerate
 * exactly where this is used.** A launch turns the nose from inward to outward
 * — two *antipodal* vectors — and their normalised lerp is the zero vector at
 * the half-way point and flips sign either side of it: the ship holds its
 * entry heading for half the traversal and then snaps. That shipped once, and
 * `tests/dock-session.test.ts` holds the row that fails on it.
 *
 * `via` is the plane to turn through when the two are antipodal, where no
 * great circle is preferred by the geometry and one has to be chosen. Callers
 * pass the slot's own `up`, so the ship pitches over rather than rolling round
 * some axis that depends on rounding.
 */
function slerp(a: Vec3, b: Vec3, t: number, via: Vec3): Vec3 {
	const d = Math.min(1, Math.max(-1, dot(a, b)));
	// Near-parallel: the great circle is shorter than float64 can resolve an
	// axis for, and the lerp is the same answer to well inside a pixel.
	if (d > 0.9995) return unit(add(scale(a, 1 - t), scale(b, t)));
	const perpendicular =
		d < -0.9995
			? unit(sub(via, scale(a, dot(via, a))))
			: unit(sub(b, scale(a, d)));
	const theta = Math.acos(d) * t;
	return add(scale(a, Math.cos(theta)), scale(perpendicular, Math.sin(theta)));
}

/**
 * The ship's attitude during the traversal.
 *
 * Aligned to the slot at the end — nose down the inward axis for an arrival and
 * out along it for a launch, up-vector along the slot's **`across`** at the
 * phase passed in, so the parked ship turns with the station rather than
 * holding a world-space roll the station has rotated away from.
 *
 * **`across`, not `up`, and that is check 4's convention rather than a
 * choice.** `evaluateEntry` measures the roll as `|dot(shipUp, basis.across)|`
 * and `signedRollDeg` reports zero when the two are parallel — so a ship rolled
 * "correctly" for this slot has its up-vector along the slot's long axis. The
 * first build aligned to `basis.up` instead, which is exactly 90° out: the
 * frames showed the docked ship lying crossways in its own slot with the name
 * shield running vertically up the canopy, and every headless row still passed,
 * because none of them compared the parked attitude with the one check 4
 * accepts.
 *
 * Blended from the entry attitude by the same easing the position uses, when
 * one was supplied. The ship crossed the plane within check 2's 35° and check
 * 4's 50°, so this is a few tens of degrees of settling and not a snap.
 */
export function arrivalAttitude(
	law: ArrivalLaw,
	u: number,
	phaseRad: number,
): { nose: Vec3; up: Vec3 } {
	const e = ease(clamp01(u));
	const basis = slotBasis(frameAtPhase(law.frame, phaseRad));
	const slotUp = basis.across;
	const aimed = scale(law.frame.axis, law.kind === "arrival" ? -1 : 1);
	if (!law.fromNose || !law.fromUp) return { nose: aimed, up: slotUp };
	// Turned through the slot's own `up` where the choice is free, so a launch
	// pitches the ship over the lip it is leaving through rather than round an
	// axis nothing chose.
	return {
		nose: slerp(law.fromNose, aimed, e, basis.up),
		up: slerp(law.fromUp, slotUp, e, law.frame.axis),
	};
}
