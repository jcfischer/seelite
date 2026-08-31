/**
 * The successful entry's arrival, and its mirror the launch
 * (`docs/specs/docking.md` §12 and §13).
 *
 * **A sim position law, not an animation.** §12.1's decision E2 makes the
 * arrival scripted and unfailable, and the repo's standing rule decides where it
 * lives: the authoritative world is float64 kilometres outside the scene graph
 * and nothing reads a position back out of an `Object3D`. So this is the shape
 * `cruise.ts` already uses — pure, no memory, evaluated at a progress value the
 * caller holds the clock for — and therefore headless-testable rather than a
 * thing only a probe can see.
 *
 * **The route is a polyline now, and that is §13.3.** The old law ran one
 * straight line from the crossing to a point on the axis, which is the whole of
 * what a throat could offer. A berth is off the axis, so the traversal is three
 * legs — axial run to the staging point, transfer toward the reserved face and
 * band, settle along the berth's normal — and the ship is placed by arc length
 * along that polyline. One global easing over the whole route rather than one
 * per leg: three eased legs stop dead twice on the way in, which reads as a
 * stutter rather than as a manoeuvre.
 *
 * **Everything here is in the station's *rotating* frame.** §12.3 names a
 * translating-frame law as the one way a scripted path can still end somewhere
 * it was not put: the bay turns with the station, so a law that fixes the
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
	TRAVERSAL_SECONDS_DEEP,
	TRAVERSAL_SECONDS_NEAR,
	frameAtPhase,
	slotBasis,
} from "./docking";
import type {
	Berth,
	InteriorOffset,
	StationInterior,
} from "./station-interior";
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
 * How far off its berth surface the transfer leg leaves the ship, as a multiple
 * of the berth's clear height.
 *
 * The settle is a real leg rather than a rounding — §13.3's third step is *"a
 * normal settle onto the assigned berth"*, and a transfer that ended on the
 * surface would make it one. Half a clear height: the ship arrives over its
 * berth and comes down onto it.
 */
export const SETTLE_STANDOFF_FACTOR = 0.5;

/** The ship's offset from the station centre, in aperture-basis components.
 *  Lateral components are held here and the basis is rebuilt per call, which is
 *  what makes the law a rotating-frame one. */
type LocalOffset = InteriorOffset;

export interface ArrivalLaw {
	/** Which traversal. The two share every line of arithmetic below and differ
	 *  only in the order of the waypoints and which way the up-vector settles —
	 *  which is what §12.2 means by "the mirror", spelled as one law rather than
	 *  as two. */
	kind: "arrival" | "launch";
	frame: ApertureFrame;
	startedAtS: number;
	durationS: number;
	/** The route, first waypoint to last, in aperture-basis components. Three
	 *  legs in, three out. */
	path: LocalOffset[];
	/** Cumulative arc length at each waypoint, km. Precomputed because the
	 *  position, the velocity and the duration all read it. */
	arc: number[];
	/** The berth this traversal serves. Held on the law so the parked pose and
	 *  the launch that starts from it read one reservation. */
	berthId: string;
	/** The parked up-vector, in aperture-basis components: the berth's own
	 *  normal (§13.3). */
	berthNormal: LocalOffset;
	/** The attitude the ship held at the crossing, blended out over the
	 *  traversal. Absent for a launch, which starts parked. */
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

const offset = (axial: number, across: number, up: number): LocalOffset => ({
	axial,
	across,
	up,
});
const offsetSub = (a: LocalOffset, b: LocalOffset): LocalOffset =>
	offset(a.axial - b.axial, a.across - b.across, a.up - b.up);
const offsetAdd = (a: LocalOffset, b: LocalOffset): LocalOffset =>
	offset(a.axial + b.axial, a.across + b.across, a.up + b.up);
const offsetScale = (a: LocalOffset, k: number): LocalOffset =>
	offset(a.axial * k, a.across * k, a.up * k);
const offsetLength = (a: LocalOffset): number =>
	Math.hypot(a.axial, a.across, a.up);

/** Cumulative arc length along a polyline. */
function arcOf(path: LocalOffset[]): number[] {
	const arc = [0];
	for (let i = 1; i < path.length; i++)
		arc.push(arc[i - 1] + offsetLength(offsetSub(path[i], path[i - 1])));
	return arc;
}

/**
 * Where a parked ship's origin sits, and where the settle leg starts from.
 *
 * Exported because `dock-session.ts` places the docked ship from the berth
 * rather than from a law — a docked ship is *placed*, not interpolated, which
 * is what makes §12.6's obligation 9 hold over an arbitrarily long interval.
 */
export const berthCentre = (berth: Berth): LocalOffset =>
	offset(berth.centre.axial, berth.centre.across, berth.centre.up);

/** The hover point over a berth: one standoff out along its normal. */
export const berthStandoff = (berth: Berth): LocalOffset =>
	offsetAdd(
		berthCentre(berth),
		offsetScale(berth.normal, berth.clearHeightKm * SETTLE_STANDOFF_FACTOR),
	);

/**
 * How long a route takes, seconds — §13.3's *"about six seconds for a near
 * berth to nine seconds for a deep berth"*.
 *
 * Interpolated on the route's own length between the shortest and longest the
 * station's catalogue can produce, so the two figures are endpoints of a real
 * measurement rather than a lookup keyed on the band. A station with one band
 * has no spread and every route takes the near figure.
 */
export function traversalSeconds(
	interior: StationInterior,
	routeKm: number,
	entry: LocalOffset,
): number {
	let shortest = Number.POSITIVE_INFINITY;
	let longest = 0;
	for (const berth of interior.berths) {
		const length = routeLengthOf(interior, berth, entry);
		if (length < shortest) shortest = length;
		if (length > longest) longest = length;
	}
	if (!(longest > shortest)) return TRAVERSAL_SECONDS_NEAR;
	const t = clamp01((routeKm - shortest) / (longest - shortest));
	return (
		TRAVERSAL_SECONDS_NEAR +
		(TRAVERSAL_SECONDS_DEEP - TRAVERSAL_SECONDS_NEAR) * t
	);
}

/** The three legs, entry first. */
function arrivalPath(
	interior: StationInterior,
	berth: Berth,
	entry: LocalOffset,
): LocalOffset[] {
	return [
		entry,
		offset(interior.stagingAxialKm, 0, 0),
		berthStandoff(berth),
		berthCentre(berth),
	];
}

const routeLengthOf = (
	interior: StationInterior,
	berth: Berth,
	entry: LocalOffset,
): number => {
	const arc = arcOf(arrivalPath(interior, berth, entry));
	return arc[arc.length - 1];
};

/**
 * Decompose a station-relative offset onto the aperture basis at one phase.
 */
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
 * Begin the arrival, from the pose the crossing left the ship in, to the berth
 * clearance reserved for it.
 *
 * `entryRel` is the ship's position in the station's frame at the crossing —
 * `planeCrossing`'s interpolated `rel`, which check 5 has already placed inside
 * the aperture rectangle. That containment is what makes §12.6's obligation 7
 * assertable: the first leg runs down the lane, and the lane *is* the aperture
 * rectangle carried inward (§13.1), so a law that starts inside the section
 * stays inside it until it reaches the staging point.
 */
export function beginArrival(
	frame: ApertureFrame,
	interior: StationInterior,
	berth: Berth,
	entryRel: Vec3,
	startedAtS: number,
	entryAttitude?: { nose: Vec3; up: Vec3 },
): ArrivalLaw {
	const entry = decompose(frame, frame.phaseRad, entryRel);
	const path = arrivalPath(interior, berth, entry);
	const arc = arcOf(path);
	return {
		kind: "arrival",
		frame,
		startedAtS,
		durationS: traversalSeconds(interior, arc[arc.length - 1], entry),
		path,
		arc,
		berthId: berth.id,
		berthNormal: berth.normal,
		fromNose: entryAttitude?.nose ?? null,
		fromUp: entryAttitude?.up ?? null,
	};
}

/**
 * Begin the launch: the same route, run the other way (§13.3).
 *
 * The parked ship already points outward, so unlike the old law this one does
 * not turn the nose round — what it settles is the **roll**, from the berth's
 * own normal back onto the slot's `across`, which is check 4's reference and
 * the attitude a ship outside the plane is measured in.
 *
 * It reads no flag: **a launch is unconditionally skippable** and so, since
 * #147, is an arrival (§13.3).
 */
export function beginLaunch(
	frame: ApertureFrame,
	interior: StationInterior,
	berth: Berth,
	startedAtS: number,
): ArrivalLaw {
	const release = offset(frame.planeKm + LAUNCH_RELEASE_KM, 0, 0);
	const path = [
		berthCentre(berth),
		berthStandoff(berth),
		offset(interior.stagingAxialKm, 0, 0),
		release,
	];
	const arc = arcOf(path);
	return {
		kind: "launch",
		frame,
		startedAtS,
		durationS: traversalSeconds(
			interior,
			arc[arc.length - 1],
			offset(frame.planeKm, 0, 0),
		),
		path,
		arc,
		berthId: berth.id,
		berthNormal: berth.normal,
		fromNose: null,
		fromUp: null,
	};
}

/** Where the traversal is, 0 at its start and 1 from its end onward. Clamped
 *  rather than left to run: an arrival that kept integrating past 1 would drive
 *  the ship through the back of the berth it was placed in. */
export function arrivalProgress(law: ArrivalLaw, gameTime: number): number {
	return clamp01((gameTime - law.startedAtS) / law.durationS);
}

/** Which leg an eased progress lands on, and how far along it. */
function locate(law: ArrivalLaw, e: number): { leg: number; t: number } {
	const total = law.arc[law.arc.length - 1];
	const s = e * total;
	for (let i = 1; i < law.arc.length; i++) {
		if (s <= law.arc[i] || i === law.arc.length - 1) {
			const span = law.arc[i] - law.arc[i - 1];
			return { leg: i, t: span > 0 ? (s - law.arc[i - 1]) / span : 1 };
		}
	}
	return { leg: law.arc.length - 1, t: 1 };
}

/** Rebuild a local offset as a station-relative vector at one phase. */
function recompose(
	law: ArrivalLaw,
	local: LocalOffset,
	phaseRad: number,
): Vec3 {
	const { across, up } = slotBasis(frameAtPhase(law.frame, phaseRad));
	return add(
		scale(law.frame.axis, local.axial),
		add(scale(across, local.across), scale(up, local.up)),
	);
}

/** The ship's position in the station's frame at progress `u` and slot phase
 *  `phaseRad`. */
export function arrivalRel(law: ArrivalLaw, u: number, phaseRad: number): Vec3 {
	const { leg, t } = locate(law, ease(clamp01(u)));
	const a = law.path[leg - 1];
	const b = law.path[leg];
	return recompose(
		law,
		offsetAdd(a, offsetScale(offsetSub(b, a), t)),
		phaseRad,
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
 *
 * **It is discontinuous at a waypoint, and that is the polyline rather than a
 * defect.** The speed is continuous — one easing over the whole arc — and the
 * direction turns a corner, which is what a three-leg route is.
 */
export function arrivalRelVelocity(
	law: ArrivalLaw,
	u: number,
	phaseRad: number,
	spinRadPerS: number,
): Vec3 {
	const c = clamp01(u);
	const e = ease(c);
	const total = law.arc[law.arc.length - 1];
	const dsdt = (easeRate(c) / law.durationS) * total;
	const { leg, t } = locate(law, e);
	const a = law.path[leg - 1];
	const b = law.path[leg];
	const span = offsetLength(offsetSub(b, a));
	const dir =
		span > 0 ? offsetScale(offsetSub(b, a), 1 / span) : offset(0, 0, 0);
	const here = offsetAdd(a, offsetScale(offsetSub(b, a), t));
	const { across, up } = slotBasis(frameAtPhase(law.frame, phaseRad));
	return add(
		scale(law.frame.axis, dir.axial * dsdt),
		add(
			scale(across, dir.across * dsdt - here.up * spinRadPerS),
			scale(up, dir.up * dsdt + here.across * spinRadPerS),
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
 * exactly where this is used.** An arrival turns the nose from inward to
 * outward — two *antipodal* vectors — and their normalised lerp is the zero
 * vector at the half-way point and flips sign either side of it: the ship holds
 * its entry heading for half the traversal and then snaps. That shipped once,
 * and `tests/dock-session.test.ts` holds the row that fails on it.
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
 * The pose a parked ship holds (§13.3): **nose outward** along the aperture
 * axis, up-vector away from the berth surface.
 *
 * One spelling, read by the docked tick, by the end of the arrival and by the
 * launch that starts from it. The outward nose is the receipt's own wording —
 * *"the exit remains straight ahead"* — and it is why a launch no longer has to
 * turn the ship round inside the bay.
 */
export function parkedAttitude(
	law: Pick<ArrivalLaw, "frame" | "berthNormal">,
	phaseRad: number,
): { nose: Vec3; up: Vec3 } {
	return {
		nose: law.frame.axis,
		up: recomposeDirection(law.frame, law.berthNormal, phaseRad),
	};
}

/** A direction held in aperture-basis components, at one phase. Separate from
 *  `recompose` because a direction has no axial *position* to add. */
export function recomposeDirection(
	frame: ApertureFrame,
	local: LocalOffset,
	phaseRad: number,
): Vec3 {
	const { across, up } = slotBasis(frameAtPhase(frame, phaseRad));
	return unit(
		add(
			scale(frame.axis, local.axial),
			add(scale(across, local.across), scale(up, local.up)),
		),
	);
}

/**
 * The ship's attitude during the traversal.
 *
 * An arrival settles onto the parked pose — nose outward, up along the berth's
 * normal — from whatever the crossing left it in. A launch runs the other way:
 * it starts parked and settles onto the slot's own `across`, which is check 4's
 * roll reference and the attitude a ship outside the plane is measured in.
 *
 * **`across`, not `up`, and that is check 4's convention rather than a
 * choice.** `evaluateEntry` measures the roll as `|dot(shipUp, basis.across)|`
 * and `signedRollDeg` reports zero when the two are parallel — so a ship rolled
 * "correctly" for a slot has its up-vector along the slot's long axis. The
 * first build aligned to `basis.up` instead, which is exactly 90° out.
 */
export function arrivalAttitude(
	law: ArrivalLaw,
	u: number,
	phaseRad: number,
): { nose: Vec3; up: Vec3 } {
	const e = ease(clamp01(u));
	const basis = slotBasis(frameAtPhase(law.frame, phaseRad));
	const parked = parkedAttitude(law, phaseRad);
	if (law.kind === "launch") {
		// **Each turn through a plane perpendicular to what it is turning.** The
		// roll sweeps through the slot's `up` and **not** through the axis: check
		// 4 compares against the axis *line*, so a ship parked on an overhead
		// berth holds an up-vector antipodal to a deck berth's, and turned
		// through the axis the half-way point would put the up-vector *on* the
		// axis, collinear with the nose — the ship's basis collapsing mid-launch
		// instead of rolling about its own nose.
		return {
			nose: law.frame.axis,
			up: slerp(parked.up, basis.across, e, basis.up),
		};
	}
	if (!law.fromNose || !law.fromUp) return parked;
	return {
		nose: slerp(law.fromNose, parked.nose, e, basis.up),
		up: slerp(law.fromUp, parked.up, e, basis.up),
	};
}
