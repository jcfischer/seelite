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
import { type Vec3, add, cross, dot, scale, sub, v3 } from "./vec3";

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
	/** The parked nose, in aperture-basis components: the berth's own
	 *  `parkedNose`. Carried rather than assumed, because a pad's berth normal
	 *  *is* the aperture axis and a nose along it too is not an attitude. */
	berthNose: LocalOffset;
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
 * measurement rather than a lookup keyed on the band.
 *
 * **The zero-spread case is "every route is the same length", not "one depth
 * band".** They coincide today — the outpost has one band *and* a square bay,
 * so its two berths are equidistant — but a non-square aperture would separate
 * a deck berth from a wall berth on the same band, and the sentence would then
 * name a condition the guard does not test.
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
		berthNose: berth.parkedNose,
		fromNose: entryAttitude?.nose ?? null,
		fromUp: entryAttitude?.up ?? null,
	};
}

/**
 * Begin the launch: the same route, run the other way (§13.3).
 *
 * The parked ship already points outward, so unlike the old law this one does
 * not turn the nose round — what it settles is the **roll**, from the berth's
 * own normal back onto the slot's `up`, which is check 4's reference since #158
 * and the attitude a ship outside the plane is measured in. It settled onto
 * `across` before that, which is the same right angle the check itself was
 * out by.
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
	// **The arrival's own route, reversed.** Written out again inline, a fourth
	// leg or a moved staging point had to land in two places or the two
	// traversals stopped being the mirror §12.2 calls them.
	// **Outside the plane *and* outside the staging point** (#165). A bay's
	// staging point is inward of the plane, so the two agree and this is
	// §12.2's release unchanged. A pad's is one clear height *outward* of it —
	// the hover the launch's second leg runs along — and a release taken from
	// the plane alone would sit below that leg, so the ship rose off its pad,
	// crossed to the axis and then dropped 10 m to be let go.
	const release = offset(
		Math.max(frame.planeKm, interior.stagingAxialKm) + LAUNCH_RELEASE_KM,
		0,
		0,
	);
	const path = [...arrivalPath(interior, berth, release)].reverse();
	const arc = arcOf(path);
	return {
		kind: "launch",
		frame,
		startedAtS,
		// **Priced against the same entry the spread is computed from.** The
		// route is measured from `release`, twenty metres outside the plane, and
		// the spread from `planeKm` — so every deep berth's launch came out past
		// `longest`, `t` clamped to 1, and two routes that arrive 0.44 s apart
		// left in the same nine seconds.
		durationS: traversalSeconds(interior, arc[arc.length - 1], release),
		path,
		arc,
		berthId: berth.id,
		berthNormal: berth.normal,
		berthNose: berth.parkedNose,
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

/**
 * Rebuild an offset held in aperture-basis components as a station-relative
 * vector, at one phase.
 *
 * **Exported, because `dock-session.ts` places the parked ship with it.** It
 * was a private helper and the docked tick wrote the same three lines out
 * inline — two spellings of the rule this module exists to own, in two files
 * that both insist elsewhere on one.
 */
export function recomposeOffset(
	frame: ApertureFrame,
	local: LocalOffset,
	phaseRad: number,
): Vec3 {
	const { across, up } = slotBasis(frameAtPhase(frame, phaseRad));
	return add(
		scale(frame.axis, local.axial),
		add(scale(across, local.across), scale(up, local.up)),
	);
}

/** The ship's position in the station's frame at progress `u` and slot phase
 *  `phaseRad`. */
export function arrivalRel(law: ArrivalLaw, u: number, phaseRad: number): Vec3 {
	const { leg, t } = locate(law, ease(clamp01(u)));
	const a = law.path[leg - 1];
	const b = law.path[leg];
	return recomposeOffset(
		law.frame,
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
 * A ship's attitude as a unit quaternion, `[x, y, z, w]`.
 *
 * **Two directions are not an orientation, and interpolating them separately is
 * what went wrong.** The nose and the up-vector each took their own great
 * circle, and at a wall berth the two circles crossed: an entry rolled to the
 * opposite `across` — accepted by check 4 before #158, refused now — is
 * antipodal to the parked
 * up-vector, so the roll turned through the slot's `up`; the nose turned from
 * inward to outward through the same plane; and at the half-way point both
 * landed on it. `|dot(nose, up)| = 1` — the ship's basis collapsed, mid-arrival,
 * on four of a trade station's eight berths.
 *
 * Slerping the *orientation* cannot do that: a unit quaternion is a rotation,
 * every point on the great circle between two of them is a rotation, and a
 * rotation has an orthonormal basis by construction. There is no plane to
 * choose and no degenerate pair to special-case.
 *
 * Hand-rolled rather than borrowed from Three.js, for this module's own reason:
 * the authoritative world is float64 kilometres outside the scene graph and
 * `arrival.ts` imports no renderer.
 */
type Quat = [number, number, number, number];

/**
 * The rotation that takes the ship's reference basis onto `(nose, up)`.
 *
 * The convention is `main.ts`'s `setAttitude`: columns are `(right, up, back)`
 * with `back = −nose`, so the mesh's nose is local `−Z`. Shepperd's method
 * picks the largest diagonal term, which is what keeps it conditioned when the
 * trace is near `−1`.
 */
function quatFromAttitude(nose: Vec3, up: Vec3): Quat {
	const f = unit(nose);
	// Re-orthogonalised rather than trusted: the two come from a crossing pose
	// and from a berth normal, and "perpendicular" is a claim about the
	// geometry rather than about float64.
	const u = unit(sub(up, scale(f, dot(up, f))));
	const r = cross(f, u);
	const b = scale(f, -1);
	// Columns (r, u, b), read as m[row][col].
	const m = [
		[r.x, u.x, b.x],
		[r.y, u.y, b.y],
		[r.z, u.z, b.z],
	];
	const trace = m[0][0] + m[1][1] + m[2][2];
	if (trace > 0) {
		const w = Math.sqrt(1 + trace) / 2;
		const k = 1 / (4 * w);
		return [
			(m[2][1] - m[1][2]) * k,
			(m[0][2] - m[2][0]) * k,
			(m[1][0] - m[0][1]) * k,
			w,
		];
	}
	if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
		const x = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) / 2;
		const k = 1 / (4 * x);
		return [
			x,
			(m[0][1] + m[1][0]) * k,
			(m[0][2] + m[2][0]) * k,
			(m[2][1] - m[1][2]) * k,
		];
	}
	if (m[1][1] > m[2][2]) {
		const y = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) / 2;
		const k = 1 / (4 * y);
		return [
			(m[0][1] + m[1][0]) * k,
			y,
			(m[1][2] + m[2][1]) * k,
			(m[0][2] - m[2][0]) * k,
		];
	}
	const z = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) / 2;
	const k = 1 / (4 * z);
	return [
		(m[0][2] + m[2][0]) * k,
		(m[1][2] + m[2][1]) * k,
		z,
		(m[1][0] - m[0][1]) * k,
	];
}

/** The `(nose, up)` pair a rotation produces — the inverse of the above, by
 *  rotating the two reference directions it was built from. */
function attitudeFromQuat(q: Quat): { nose: Vec3; up: Vec3 } {
	const [x, y, z, w] = q;
	const rotate = (v: Vec3): Vec3 => {
		// v + 2·q_vec × (q_vec × v + w·v), the standard expansion.
		const t = v3(
			2 * (y * v.z - z * v.y),
			2 * (z * v.x - x * v.z),
			2 * (x * v.y - y * v.x),
		);
		return v3(
			v.x + w * t.x + (y * t.z - z * t.y),
			v.y + w * t.y + (z * t.x - x * t.z),
			v.z + w * t.z + (x * t.y - y * t.x),
		);
	};
	// The mesh's nose is local −Z and its up is local +Y (`setAttitude`).
	return { nose: rotate(v3(0, 0, -1)), up: rotate(v3(0, 1, 0)) };
}

/**
 * The shorter great-circle arc between two rotations.
 *
 * `q` and `−q` are the same rotation, so the sign is flipped when the dot is
 * negative — otherwise the ship takes the long way round, which for a 180°
 * nose turn is the difference between pitching over the lip and rolling
 * backwards through the bay.
 */
function quatSlerp(a: Quat, b: Quat, t: number): Quat {
	let [bx, by, bz, bw] = b;
	let d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
	if (d < 0) {
		bx = -bx;
		by = -by;
		bz = -bz;
		bw = -bw;
		d = -d;
	}
	// Near-parallel: the arc is shorter than float64 can resolve an axis for,
	// and the normalised lerp is the same answer to well inside a pixel.
	if (d > 0.9995) {
		const q: Quat = [
			a[0] + (bx - a[0]) * t,
			a[1] + (by - a[1]) * t,
			a[2] + (bz - a[2]) * t,
			a[3] + (bw - a[3]) * t,
		];
		const n = Math.hypot(q[0], q[1], q[2], q[3]);
		return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
	}
	const theta = Math.acos(d);
	const s = Math.sin(theta);
	const ka = Math.sin((1 - t) * theta) / s;
	const kb = Math.sin(t * theta) / s;
	return [
		a[0] * ka + bx * kb,
		a[1] * ka + by * kb,
		a[2] * ka + bz * kb,
		a[3] * ka + bw * kb,
	];
}

/**
 * The pose a parked ship holds (§13.3): up-vector away from the berth surface,
 * nose along the berth's own `parkedNose`.
 *
 * One spelling, read by the docked tick, by the end of the arrival and by the
 * launch that starts from it. In a bay the nose is the aperture axis on every
 * berth — the receipt's own wording, *"the exit remains straight ahead"* — and
 * it is why a launch no longer has to turn the ship round inside the bay.
 *
 * **It reads the berth rather than restating the axis** (#165). On a pad the
 * up-vector *is* the axis, so a nose along it as well would leave
 * `quatFromAttitude` re-orthogonalising a direction against itself: a zero
 * vector, an arbitrary basis, and a parked ship rolled to whatever `unit`
 * returns for nothing. A ship on a landing pad lies in the deck.
 */
export function parkedAttitude(
	law: Pick<ArrivalLaw, "frame" | "berthNormal" | "berthNose">,
	phaseRad: number,
): { nose: Vec3; up: Vec3 } {
	// **One basis for both directions, and no closure.** `stepDockedWorld` calls
	// this every docked frame; a `recomposeDirection` each would build the phase
	// frame and the slot basis twice for one pose, and a local arrow would
	// allocate once per tick to save two lines.
	const { across, up } = slotBasis(frameAtPhase(law.frame, phaseRad));
	const nose = law.berthNose;
	const normal = law.berthNormal;
	return {
		nose: unit(
			add(
				scale(law.frame.axis, nose.axial),
				add(scale(across, nose.across), scale(up, nose.up)),
			),
		),
		up: unit(
			add(
				scale(law.frame.axis, normal.axial),
				add(scale(across, normal.across), scale(up, normal.up)),
			),
		),
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
 * it starts parked and settles onto the slot's own `up`, which is check 4's
 * roll reference and the attitude a ship outside the plane is measured in.
 *
 * **`up`, not `across`, and that is check 4's convention rather than a
 * choice** (#158). `evaluateEntry` measures the roll as `|dot(shipUp,
 * basis.up)|`, so a ship rolled "correctly" for a slot has its *beam* along
 * the slot's long axis — which is the pose `tests/aperture-fit.test.ts` sizes
 * the opening from.
 *
 * It was `across` until #158. Why it was, and why one frame appeared to support
 * it, is recorded once in `docking.md` §3 rather than restated here.
 */
export function arrivalAttitude(
	law: ArrivalLaw,
	u: number,
	phaseRad: number,
): { nose: Vec3; up: Vec3 } {
	const e = ease(clamp01(u));
	const basis = slotBasis(frameAtPhase(law.frame, phaseRad));
	const parked = parkedAttitude(law, phaseRad);
	if (law.kind === "launch")
		// A launch starts parked and ends square with the slot: the nose is
		// already outward at both ends, so what this settles is the roll.
		return attitudeFromQuat(
			quatSlerp(
				quatFromAttitude(parked.nose, parked.up),
				quatFromAttitude(law.frame.axis, basis.up),
				e,
			),
		);
	if (!law.fromNose || !law.fromUp) return parked;
	return attitudeFromQuat(
		quatSlerp(
			quatFromAttitude(law.fromNose, law.fromUp),
			quatFromAttitude(parked.nose, parked.up),
			e,
		),
	);
}
