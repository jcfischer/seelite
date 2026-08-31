/**
 * The docking model: the six checks, the failure model, clearance, and the
 * docking computer (`docs/specs/docking.md`).
 *
 * **No Three.js, and no import of `sim.ts`.** Everything here is stated in the
 * station's own frame as float64 kilometres, which is the repo's rule and also
 * `docking.md` §1's binding constraint: sim space is star-centred, a station on
 * a 1 AU orbit is carried at ~30 km/s, and a tolerance written in star-centred
 * velocity describes a different game. Callers convert once, at the boundary —
 * `sim.ts`'s `bodyVelocity` and `stationPose` are what they convert with — and
 * everything below reads the result.
 *
 * The arrow points one way on purpose: this module imports `station.ts` for the
 * geometry table and `vec3.ts` for the arithmetic, and nothing imports it back.
 * `sim.ts` importing this would close a cycle the moment the game wires docking
 * into the flight loop.
 */

import {
	STATION_GEOMETRY,
	type StationAperture,
	type StationType,
} from "./station";
import {
	type Berth,
	type HullEnvelope,
	type StationInterior,
	chooseBerth,
} from "./station-interior";
import { type Vec3, add, cross, dot, length, scale, sub, v3 } from "./vec3";

// ---------------------------------------------------------------------------
// Tolerances (§3), all of them data rather than literals repeated per call site
// ---------------------------------------------------------------------------

/**
 * §3's closing-speed gate, km/s — the one dimension 1984 never tested.
 *
 * Chosen, not derived (§3.1): it rhymes with #14's approach clamp
 * (`targetKm / approachLeadS` at 300 m) so a player who flies the final
 * approach under the law cruise used to deliver them passes without being told
 * the number. §11.4 records it as the figure in the spec most likely to move.
 */
export const V_GATE_KMS = 0.1;

/** §3's check 2, degrees. Both the station→ship vector and the nose, each
 *  against the docking axis — two angles at one shared tolerance, because a
 *  cone that constrains only position says nothing about where the ship points. */
export const AXIS_TOLERANCE_DEG = 35;

/** §3's check 4, degrees, against the slot's long **axis-line** and not an
 *  oriented vector: a ship rolled 180° is a geometrically identical entry. */
export const ROLL_TOLERANCE_DEG = 50;

/**
 * §2.1's damage floor, as a fraction of the gate-speed damage.
 *
 * Without it a 90°-mis-rolled entry at 0.01 km/s costs 1% of the gate-speed
 * damage, so a patient pilot fails the alignment checks indefinitely for free
 * and §2's claim that the tolerances carry the skill tax is false for anyone
 * who crawls.
 */
export const DAMAGE_FLOOR = 0.25;

/**
 * §6's clearance range, km — and deliberately **not** `HANDOFF_KM`.
 *
 * Numerically the same value today. `HANDOFF_KM` is the *render* handoff
 * distance; binding a gameplay range to it would mean retuning the layer split
 * for a visual reason silently retunes clearance too. Same value, two reasons,
 * two constants.
 */
export const VICINITY_KM = 1e4;

/**
 * §6's grant window, seconds.
 *
 * 600 because a shorter one expires before the approach can be flown: cruise
 * hands the player control at a pass inside ~600 km and normal flight is capped
 * at 2 km/s, so closing that gap is 300 s at best before any braking or missed
 * pass. The first figure written into the spec was 180 s, which would have
 * expired on every grant taken where the player is actually flying.
 */
export const GRANT_WINDOW_S = 600;

/**
 * §6's **interim** hostility cooldown, seconds — #8's to replace.
 *
 * The flip ships here; the decay that clears it is legal-status decay and #8 is
 * unbuilt. Without a cooldown a player who lets a window lapse and crosses the
 * plane anyway is locked out of that station permanently, on a map where a
 * system may have only one. #8 may make it longer, conditional or
 * bounty-bearing; what it may not do is remove it without supplying another
 * exit.
 */
export const HOSTILE_COOLDOWN_S = 600;

/**
 * How far outside the aperture plane §2.0's repel places the ship, km.
 *
 * Small and non-zero: the requirement is that the ship "is never left inside
 * the station", and a zero offset leaves it exactly on the plane where the next
 * frame's crossing test has no defined side.
 */
export const REPEL_OFFSET_KM = 0.01;

/**
 * **E3, as §13.3 re-fixed it**: a traversal is about six seconds to a near
 * berth and about nine to a deep one.
 *
 * The old figures — a 4–6 s band resolved to 5 — priced one straight run down a
 * throat. §13.3's route is three legs to a berth that is off the axis, and its
 * length is what the duration is interpolated on (`traversalSeconds`), so these
 * are the endpoints of a measurement rather than a lookup keyed on the band.
 *
 * Here rather than in `arrival.ts`, beside the tolerances the rest of the
 * docking interaction is stated in: `state-gallery.ts` reads them too, and one
 * tuning decision with two import paths is one a retune can miss.
 */
export const TRAVERSAL_SECONDS_NEAR = 6;
export const TRAVERSAL_SECONDS_DEEP = 9;

/**
 * **#8's constant, standing in.** The absolute damage scale is
 * `docs/specs/docking.md` §10's hand-off to the combat node, because it is
 * denominated in #8's shield and energy pools — which do not exist yet.
 *
 * Named `INTERIM_` rather than `DAMAGE_SCALE` so that the day #8 exports the
 * real one, the two do not silently coexist under names that read as
 * equivalent. §2.1's bound is what constrains it: at `V_GATE` a failed entry
 * from full health costs at most a quarter of the combined pool. 40 against a
 * 200-point pool is 20%, which is that bound met with the margin §2.1 asks for.
 */
export const INTERIM_DAMAGE_SCALE = 40;

/** #8's pools, standing in for the same reason (§10). Fore/aft shields are the
 *  combat spec's shape; a head-on entry reads one pool, so one is what the
 *  failure model needs and all it declares. */
export const INTERIM_SHIELD_POOL = 100;
export const INTERIM_HULL_POOL = 100;

const DEG = Math.PI / 180;
const AXIS_COS = Math.cos(AXIS_TOLERANCE_DEG * DEG);
const ROLL_COS = Math.cos(ROLL_TOLERANCE_DEG * DEG);

// ---------------------------------------------------------------------------
// Local vector helpers
// ---------------------------------------------------------------------------
//
// `cross` and `unit` stay here rather than going into `vec3.ts`. That module is
// a leaf whose whole job is to import nothing and stay small; widening it for
// one consumer trades that for convenience. If a second module wants them, that
// is the moment to move them.

/**
 * Some direction perpendicular to `a`, chosen deterministically.
 *
 * One spelling of "a direction not parallel to this axis", because there were
 * three: `slotBasis`, `slewToward`'s antiparallel case and the browser probe
 * each carried the same `< 0.9` seed test, and a threshold is not a thing to
 * keep in step across two languages and a page boundary.
 *
 * Which perpendicular is arbitrary and allowed to be — the only requirement is
 * that everything reading it reads *this* one, which is why the probe takes the
 * basis off the page rather than seeding its own.
 */
const anyPerpendicular = (a: Vec3): Vec3 => {
	const seed =
		Math.abs(a.x) < 0.9
			? v3(1, 0, 0)
			: Math.abs(a.y) < 0.9
				? v3(0, 1, 0)
				: v3(0, 0, 1);
	return unit(cross(a, seed));
};

const unit = (a: Vec3): Vec3 => {
	const len = length(a);
	return len === 0 ? v3(1, 0, 0) : scale(a, 1 / len);
};

/**
 * A cosine as an angle in degrees — a **diagnostic**, never a comparison.
 *
 * Clamped before `acos` because a dot product of two unit vectors reaches
 * 1.0000000000000002. Every check below compares cosines directly and reports
 * the degrees, rather than comparing the degrees: the round trip through
 * `acos`/`cos` costs precision exactly where §9.1.1's boundary rows sit.
 */
const cosToDeg = (c: number): number =>
	Math.acos(Math.min(1, Math.max(-1, c))) / DEG;

// ---------------------------------------------------------------------------
// The aperture frame
// ---------------------------------------------------------------------------

/**
 * Everything the checks need to know about the hole, in the station's frame.
 *
 * Built from `STATION_GEOMETRY` and the pose `sim.ts` computes, rather than
 * carrying its own copy of either: the aperture dimensions are read from the
 * geometry constant so a retune moves one table (`station.ts`'s docstring is
 * the other half of that claim), and the phase comes from `slotPhaseRad` in sim
 * and is never read back off an `Object3D` (§4.1).
 */
export interface ApertureFrame {
	/** Unit vector along the aperture axis, pointing **out** of the station —
	 *  the direction an approaching ship comes from. */
	axis: Vec3;
	/** The slot's roll about that axis, radians. Always 0 for a pad (§4). */
	phaseRad: number;
	aperture: StationAperture;
	/**
	 * The slot's phase-zero direction: where `across` points when `phaseRad` is
	 * zero, and the reference the renderer aims the drawn station with.
	 *
	 * **Supplied, not derived** (#126). Perpendicular to `axis` by construction
	 * and re-orthogonalised in `slotBasis` anyway; `sim.ts`'s `stationPose`
	 * builds it from the station's own orbital velocity, which is the one
	 * direction available here that turns smoothly as the axis swings.
	 */
	reference: Vec3;
	/**
	 * Axial distance from the station's centre to the aperture plane, km.
	 *
	 * Named for what it is here rather than reused as a radius, because what the
	 * checks do with it is decide where the plane is: a crossing is
	 * `dot(rel, axis)` passing down through this number, not through zero.
	 *
	 * **`STATION_GEOMETRY.aperturePlaneKm`, not `coreRadiusKm`** (#128). It was
	 * the core radius until a ship was watched crossing the plane 173 m before
	 * it reached the slot it could see; the geometry table now declares where
	 * the aperture is, and the form cuts it there.
	 */
	planeKm: number;
}

/**
 * The frame for one station type at one slot phase.
 *
 * `phaseRad` is passed in rather than computed, because the clock lives on the
 * world and this module holds no state. Callers get it from `sim.ts`'s
 * `stationPose`, which is where §4.1 puts it.
 */
export function apertureFrame(
	type: StationType,
	axis: Vec3,
	phaseRad: number,
	reference: Vec3,
): ApertureFrame {
	const geometry = STATION_GEOMETRY[type];
	return {
		axis: unit(axis),
		reference,
		// A pad does not rotate, so a caller that passed a phase for one is
		// describing something that cannot happen. Normalised here rather than
		// trusted, so check 4's "does not apply" is a property of the frame.
		phaseRad: geometry.spins ? phaseRad : 0,
		aperture: geometry.aperture,
		planeKm: geometry.aperturePlaneKm,
	};
}

/**
 * The same frame at a different slot phase.
 *
 * `CONTEXT.md` §Language says of the aperture frame: *"`src/docking.ts` is the
 * one place it is built."* A law that re-evaluates the basis every frame — the
 * arrival, which must run in the station's *rotating* frame — needs the frame
 * at the current phase on every call, and spelling that as `{ ...frame,
 * phaseRad }` at each site makes a second module a builder of the frame the
 * checks are stated in. One verb instead, so the rule stays a fact about
 * imports.
 *
 * The phase is normalised the way `apertureFrame` normalises it: a pad does not
 * rotate, so a caller passing a phase for one is describing something that
 * cannot happen.
 */
export function frameAtPhase(
	frame: ApertureFrame,
	phaseRad: number,
): ApertureFrame {
	return {
		...frame,
		phaseRad: frame.aperture.kind === "slot" ? phaseRad : 0,
	};
}

/**
 * An orthonormal pair spanning the aperture plane: `across` along the
 * rectangle's width at the current phase, `up` along its height.
 *
 * **The phase-zero reference comes in on the frame** (`reference`), and that is
 * the whole of #126. It used to be `anyPerpendicular(axis)` — "arbitrary, and it
 * has to be", with the only requirement that the renderer mirror it. The
 * renderer did not: it aimed a station by the shortest turn onto its axis, which
 * fixes the axis and leaves the roll wherever the arithmetic lands, and the
 * drawn slot sat **64.6° from this basis on the trade station and 78.2° on the
 * refinery**. A ship parked the way check 4 accepts was two thirds of a right
 * angle out of the slot it was in.
 *
 * Making the renderer read this one was built and withdrawn first, because
 * `anyPerpendicular` picks its seed on a `< 0.9` branch: the reference **jumps**
 * as a station's axis swings round its orbit, and the drawn hull snapped with
 * it. A reference the renderer can share has to be continuous, so it is no
 * longer derived from the axis at all — `sim.ts` supplies the station's own
 * along-track direction, which turns smoothly and is perpendicular to the axis
 * by construction on a circular orbit.
 */
export function slotBasis(frame: ApertureFrame): { across: Vec3; up: Vec3 } {
	const a = frame.axis;
	// Re-orthogonalised rather than trusted: the caller's reference is
	// perpendicular to the axis by construction, and "by construction" is a
	// claim about a circular orbit rather than about float64.
	const u = unit(sub(frame.reference, scale(a, dot(frame.reference, a))));
	const v = cross(a, u);
	const c = Math.cos(frame.phaseRad);
	const s = Math.sin(frame.phaseRad);
	return {
		across: add(scale(u, c), scale(v, s)),
		up: add(scale(u, -s), scale(v, c)),
	};
}

/** Below this, the up-vector's component in the slot plane is rounding error
 *  rather than a direction. Dimensionless: `pose.up` is a unit vector. */
export const ROLL_PROJECTION_FLOOR = 1e-9;

/**
 * The signed roll about the outward axis, folded to the same (−90, 90] the
 * unsigned check works in — so `Math.abs` of this is `evaluateEntry`'s
 * `rollAngleDeg` wherever the projection below is well conditioned, and `NaN`
 * where it is not.
 *
 * **Display only.** No check reads it: `hud-and-scanner.md` §3's roll ring
 * needs a direction to send the pilot in, and check 4 deliberately has none
 * because it compares against the axis *line*. It lives here rather than in the
 * HUD because aperture-frame trigonometry has one home (`CONTEXT.md`), and the
 * one place it had been re-spelled was the cue whose job is which way to roll.
 *
 * Folded rather than reported over the full turn, because a slot is
 * symmetric: a ship 170° out is 10° out the other way, and an instrument
 * telling it to roll 170° would be sending the pilot the long way round.
 */
export function signedRollDeg(frame: ApertureFrame, pose: EntryPose): number {
	const axis = frame.axis;
	const projected = sub(pose.up, scale(axis, dot(pose.up, axis)));
	const norm = length(projected);
	// **A relative guard, where `evaluateEntry`'s is an exact zero.** An
	// up-vector *set* to the docking axis does not project to exactly nothing:
	// `dot(up, axis)` is 1 to within a rounding error, so a residue of order
	// 1e-17 survives and any angle taken from it is float noise — the check and
	// this function each read a real angle off it, and they are tens of degrees
	// apart, because they are reading different rounding errors rather than
	// disagreeing. `tests/docking-director.test.ts` holds the pose. This returns
	// no angle
	// rather than one taken from rounding error, so the ring draws no tick;
	// `evaluateEntry` keeps its own exact-zero guard, because retuning a docking
	// check is #9's and it refuses the pose on check 2 anyway.
	if (norm <= ROLL_PROJECTION_FLOOR) return Number.NaN;
	const u = scale(projected, 1 / norm);
	const { across } = slotBasis(frame);
	const perpendicular = cross(axis, across);
	const deg =
		(Math.atan2(dot(u, perpendicular), dot(u, across)) * 180) / Math.PI;
	if (deg > 90) return deg - 180;
	if (deg <= -90) return deg + 180;
	return deg;
}

// ---------------------------------------------------------------------------
// §3 — the six checks
// ---------------------------------------------------------------------------

/**
 * The ship, in the station's frame, at the instant it crosses the plane.
 *
 * `vRel` is the relative velocity **vector** (§3): `|vRel|` is what the gate and
 * the damage formula both read, and the axial component is what check 3 reads.
 * An entry at 0.05 km/s axial and 1 km/s lateral passes one reading and fails
 * the other, and takes 0.25× or 100× the damage depending on which an
 * implementer picks — which is why the two are named apart and tested apart.
 */
export interface EntryPose {
	/** Ship position minus station position, km. */
	rel: Vec3;
	/** Ship velocity minus station velocity, km/s. */
	vRel: Vec3;
	/** Unit vector along the ship's nose. */
	nose: Vec3;
	/** Unit vector along the ship's up. Check 4 reads this. */
	up: Vec3;
}

export interface EntryChecks {
	/** 1 — the station is not hostile. */
	notHostile: boolean;
	/** 2 — both the station→ship vector and the nose, each within 35°. */
	axisAlignment: boolean;
	/** 3 — the axial component of `vRel` points into the slot. */
	inbound: boolean;
	/** 4 — roll match. Always `true` for a pad, which is the whole of what makes
	 *  the refinery interaction genuinely easier rather than merely different. */
	rollMatch: boolean;
	/** 5 — the crossing point is inside the aperture rectangle. */
	containment: boolean;
	/** 6 — `|vRel|` is at or under the gate. */
	closingSpeed: boolean;
}

export interface EntryEvaluation {
	checks: EntryChecks;
	passed: boolean;
	/** `|vRel|`, the single scalar the gate and the damage formula both read. */
	speedKms: number;
	/** Diagnostics, so a red test and a probe both name the row that failed
	 *  rather than reporting a boolean. */
	positionAngleDeg: number;
	noseAngleDeg: number;
	/** `Number.NaN` for a pad: a square aperture has no long axis to match. */
	rollAngleDeg: number;
	/** Where the crossing point sits in the rolled aperture frame, km. */
	offsetAcrossKm: number;
	offsetUpKm: number;
}

/**
 * §3's table, evaluated at the instant of crossing.
 *
 * All six rows are computed even once one has failed. A short-circuit would
 * make the diagnostics above depend on evaluation order, and §9.1's table-driven
 * rows assert on individual checks rather than only on the verdict.
 */
export function evaluateEntry(
	frame: ApertureFrame,
	pose: EntryPose,
	opts: { hostile: boolean },
): EntryEvaluation {
	const { axis, aperture } = frame;
	const speedKms = length(pose.vRel);

	// Check 2, both halves. The station→ship vector is compared against the
	// outward axis; the nose against the *inward* one, because a docking ship
	// points at the station rather than away from it.
	//
	// **The comparison is on the cosines, and the degrees are diagnostics.**
	// Taking `acos` and then `cos` of the result round-trips through a
	// transcendental pair for no gain, and near the tolerance it loses the last
	// bits of the very quantity the boundary rows in §9.1.1 assert on.
	const positionCos = dot(unit(pose.rel), axis);
	const noseCos = -dot(unit(pose.nose), axis);
	const positionAngleDeg = cosToDeg(positionCos);
	const noseAngleDeg = cosToDeg(noseCos);
	const axisAlignment =
		positionCos >= AXIS_COS - 1e-12 && noseCos >= AXIS_COS - 1e-12;

	// Check 3 reads a *velocity* sign, not a position sign: at the crossing
	// instant the axial position is on the plane by construction, so a
	// side-of-plane test has no defined answer there.
	const vAxial = dot(pose.vRel, axis);
	const inbound = vAxial < 0;

	// Check 5. The crossing point is the lateral part of `rel`, resolved in the
	// rolled aperture frame.
	const axial = dot(pose.rel, axis);
	const lateral = sub(pose.rel, scale(axis, axial));
	const basis = slotBasis(frame);
	const offsetAcrossKm = dot(lateral, basis.across);
	const offsetUpKm = dot(lateral, basis.up);
	const containment =
		Math.abs(offsetAcrossKm) <= aperture.widthKm / 2 + 1e-12 &&
		Math.abs(offsetUpKm) <= aperture.heightKm / 2 + 1e-12;

	// Check 4. Against the axis-*line*: the acute angle mod 180°, so a ship
	// rolled exactly 180° is the identical entry it geometrically is.
	let rollAngleDeg = Number.NaN;
	let rollMatch = true;
	if (aperture.kind === "slot") {
		const projected = sub(pose.up, scale(axis, dot(pose.up, axis)));
		if (length(projected) === 0) {
			// The up-vector lies along the docking axis, so it has no projection in
			// the slot plane and there is no roll to compare. **The row reports a
			// failure**, and the angle stays `NaN` because there is genuinely no
			// angle to report — the two together say "this pose has no roll", which
			// a `true` would not. The verdict is unchanged either way: the ship is
			// pointing sideways down the slot, so check 2 has already refused it.
			rollAngleDeg = Number.NaN;
			rollMatch = false;
		} else {
			// The axis-*line*, so the acute angle mod 180°: the absolute cosine is
			// that comparison without the round trip through degrees.
			const rollCos = Math.abs(dot(unit(projected), basis.across));
			rollAngleDeg = cosToDeg(rollCos);
			rollMatch = rollCos >= ROLL_COS - 1e-12;
		}
	}

	const checks: EntryChecks = {
		notHostile: !opts.hostile,
		axisAlignment,
		inbound,
		rollMatch,
		containment,
		closingSpeed: speedKms <= V_GATE_KMS + 1e-12,
	};

	return {
		checks,
		passed: Object.values(checks).every(Boolean),
		speedKms,
		positionAngleDeg,
		noseAngleDeg,
		rollAngleDeg,
		offsetAcrossKm,
		offsetUpKm,
	};
}

/**
 * The pose at the moment the ship crosses the aperture plane, or `null`.
 *
 * Linear interpolation between two frames. The alternative — testing the checks
 * on whichever frame happens to land nearest the plane — makes every tolerance
 * a function of the frame rate, which is the class of error §4.1 already
 * refuses for the slot phase.
 *
 * **One aperture frame is used for both endpoints, and that is an
 * approximation.** The docking axis swings as the station orbits (§7's cone is
 * the same fact), so strictly the plane at the earlier endpoint is not the plane
 * at the later one. The error is bounded by how far the axis turns in one step:
 * a station on a 400–2,000 km orbit turns it by microradians over the 0.1 s
 * `MAX_DT` allows, against a slot 120 m across at a 600 m standoff. Interpolating
 * the axis as well would be a slerp inside a root-find for a correction three
 * orders of magnitude under the aperture. If the frame budget ever grows, this
 * is the line to revisit; today it is a rounding term, stated rather than
 * assumed.
 *
 * Only an inward crossing counts: a ship leaving through the plane has already
 * docked or been repelled.
 */
export function planeCrossing(
	frame: ApertureFrame,
	before: EntryPose,
	after: EntryPose,
): EntryPose | null {
	const a0 = dot(before.rel, frame.axis) - frame.planeKm;
	const a1 = dot(after.rel, frame.axis) - frame.planeKm;
	if (!(a0 > 0 && a1 <= 0)) return null;
	const t = a0 === a1 ? 0 : a0 / (a0 - a1);
	const lerp = (p: Vec3, q: Vec3) => add(p, scale(sub(q, p), t));
	return {
		rel: lerp(before.rel, after.rel),
		vRel: lerp(before.vRel, after.vRel),
		// **Attitude is taken from the later frame rather than interpolated**, so
		// the pose below mixes an interpolated position and velocity with an
		// end-of-step attitude. A slerp between two unit vectors is not a lerp,
		// and the step is a frame long; the error is bounded by how far the ship
		// can turn in one — at `ANGULAR_MAX.roll` and `MAX_DT` that is 8°, and
		// against check 2's 35° and check 4's 50° it moves a verdict only for a
		// pose already within a frame's turn of the boundary. Slerping both by
		// the same `t` is the exact answer if that ever matters.
		nose: after.nose,
		up: after.up,
	};
}

// ---------------------------------------------------------------------------
// §2 — the failure model
// ---------------------------------------------------------------------------

/**
 * §2.1's damage shape. The scale is a parameter because it is #8's (§10).
 *
 * Quadratic above the floor, so recklessness still kills: the 2 km/s assist cap
 * is 20× the gate and therefore 400× the damage. Death returns as the outcome
 * of flying *at* a station rather than as the default outcome of a missed roll,
 * which is the distinction D1 was drawing.
 */
export function entryDamage(
	speedKms: number,
	damageScale: number = INTERIM_DAMAGE_SCALE,
): number {
	const ratio = speedKms / V_GATE_KMS;
	return damageScale * Math.max(DAMAGE_FLOOR, ratio * ratio);
}

/** #8's pools, standing in (§10). Shields first, hull after. */
export interface ShipCondition {
	shield: number;
	hull: number;
}

export const fullCondition = (): ShipCondition => ({
	shield: INTERIM_SHIELD_POOL,
	hull: INTERIM_HULL_POOL,
});

export const poolOf = (c: ShipCondition): number => c.shield + c.hull;
export const isAlive = (c: ShipCondition): boolean => c.hull > 0;

export function applyDamage(c: ShipCondition, damage: number): ShipCondition {
	const toShield = Math.min(c.shield, damage);
	return {
		shield: c.shield - toShield,
		hull: Math.max(0, c.hull - (damage - toShield)),
	};
}

/**
 * §2.0's repel: just outside the plane, with `v_axial` reversed and halved.
 *
 * In the station's frame, and the lateral components of both position and
 * velocity are untouched — a bounce, not a reset. The ship is never left inside
 * the station, which is the property the offset above exists for.
 */
export function repel(frame: ApertureFrame, pose: EntryPose): EntryPose {
	const { axis } = frame;
	const lateral = sub(pose.rel, scale(axis, dot(pose.rel, axis)));
	const vAxial = dot(pose.vRel, axis);
	const vLateral = sub(pose.vRel, scale(axis, vAxial));
	return {
		rel: add(lateral, scale(axis, frame.planeKm + REPEL_OFFSET_KM)),
		vRel: add(vLateral, scale(axis, -vAxial / 2)),
		nose: pose.nose,
		up: pose.up,
	};
}

// ---------------------------------------------------------------------------
// §6 — clearance
// ---------------------------------------------------------------------------

export type Clearance =
	| { kind: "none" }
	| { kind: "granted"; expiresAtS: number }
	| { kind: "queued"; position: number }
	| { kind: "denied"; reason: "hostile" | "contraband" };

export interface DockingState {
	clearance: Clearance;
	hostile: boolean;
	/** `gameTime` at which §6's interim cooldown clears the flip. `null` when
	 *  the station is not hostile. #8 replaces the timer, not the field. */
	hostileUntilS: number | null;
	/**
	 * The berth this ship holds (§13.2), or `null` when it holds none.
	 *
	 * **Separate from the grant rather than carried on it.** §13.2 makes the
	 * reservation survive a failed entry *while the grant remains live*, and
	 * makes it outlive the grant through arrival, docking and launch — so it is
	 * neither a field of `granted` nor a field of the dock session. It is
	 * released by `releaseBerth`, which the outward aperture crossing calls.
	 */
	berthId: string | null;
}

export const newDockingState = (): DockingState => ({
	clearance: { kind: "none" },
	hostile: false,
	hostileUntilS: null,
	berthId: null,
});

/**
 * Give the berth back (§13.2): on the outward crossing that ends a launch, and
 * on a grant that expired or was cancelled without being used.
 *
 * A verb rather than a field write at each site, because the two sites are in
 * two modules and a reservation released in one of them is a station that
 * slowly fills up with ships that left.
 *
 * **It spends a live grant along with the berth, and that is a correctness
 * rule rather than a courtesy.** §13.2 makes the grant *be* the reservation, so
 * a grant that outlived its berth is a clearance no berth answers for — and
 * `attemptEntry` would dock on it and hand `enterArrival` a null berth. It was
 * caught exactly that way: a capture launched and then flew a second entry
 * inside the same 600 s window, and the crossing threw. Re-requesting is free
 * (§6), so what the player loses is a keystroke.
 */
export const releaseBerth = (state: DockingState): DockingState =>
	state.berthId === null && state.clearance.kind !== "granted"
		? state
		: {
				...state,
				berthId: null,
				clearance:
					state.clearance.kind === "granted"
						? { kind: "none" }
						: state.clearance,
			};

export interface ClearanceRequest {
	gameTime: number;
	rangeKm: number;
	/** The station's berth catalogue (§13.2) — what a grant reserves out of. */
	interior: StationInterior;
	/** The requesting ship's envelope. Fit is geometric, so the protocol needs
	 *  the box rather than a size class. */
	hull: HullEnvelope;
	/**
	 * Which berths other ships hold (§6.1, §13.2). Injected, and that is a build
	 * obligation rather than a placeholder: NPC traffic is #8's and unbuilt, so
	 * without an injected input the queued branch would be unexercised code from
	 * the day it was written.
	 */
	occupied: ReadonlySet<string>;
	/** #13 §5.1.1's shipyard contraband scan. The predicate behind it is #8's;
	 *  requesting clearance is the moment it lands (§6). */
	scanFails?: boolean;
}

/**
 * §6's protocol: granted, queued, or denied.
 *
 * Out of range is not one of the three replies — it is not a reply at all. A
 * request from outside `VICINITY_KM` leaves the state untouched, so a caller
 * that spams the key at 50,000 km neither queues nor is denied.
 */
export function requestClearance(
	state: DockingState,
	req: ClearanceRequest,
): DockingState {
	if (req.rangeKm > VICINITY_KM) return state;
	if (state.hostile)
		return { ...state, clearance: { kind: "denied", reason: "hostile" } };
	if (req.scanFails)
		return {
			...state,
			clearance: { kind: "denied", reason: "contraband" },
			// A failed scan is what makes the arrival hostile, and the interim
			// cooldown applies to it exactly as it does to a barge — otherwise a
			// scan failure is the permanent lock-out §6 refuses.
			hostile: true,
			hostileUntilS: req.gameTime + HOSTILE_COOLDOWN_S,
		};
	// **The grant *is* the reservation** (§13.2). A protocol that granted first
	// and assigned a berth on arrival could grant to a ship nothing fits, which
	// is the one case §13.2 answers with a queue rather than a denial.
	const berth = berthFor(req);
	if (!berth)
		return {
			...state,
			clearance: { kind: "queued", position: req.occupied.size },
		};
	return {
		...state,
		clearance: { kind: "granted", expiresAtS: req.gameTime + GRANT_WINDOW_S },
		berthId: berth.id,
	};
}

/** The berth a request would be given, or `null` when none is free that fits.
 *  One spelling, read by the request and by the promotion in `tickDocking`. */
function berthFor(req: {
	interior: StationInterior;
	hull: HullEnvelope;
	occupied: ReadonlySet<string>;
	gameTime: number;
}): Berth | null {
	return chooseBerth(req.interior, req.hull, req.occupied, req.gameTime);
}

/** Whether a grant is live at `gameTime` — the first half of §6's entry
 *  condition, and the half that is read *before* `hostile`. */
export function grantLive(state: DockingState, gameTime: number): boolean {
	return (
		state.clearance.kind === "granted" && gameTime < state.clearance.expiresAtS
	);
}

/**
 * The clock's effect on the protocol: grants expire, hostility decays, and a
 * queued ship is promoted when the slot frees.
 *
 * Pure and idempotent per clock value, so a caller may run it every frame.
 */
export function tickDocking(
	state: DockingState,
	gameTime: number,
	traffic: {
		interior: StationInterior;
		hull: HullEnvelope;
		occupied: ReadonlySet<string>;
	},
): DockingState {
	let next = state;
	if (
		next.hostile &&
		next.hostileUntilS !== null &&
		gameTime >= next.hostileUntilS
	)
		next = { ...next, hostile: false, hostileUntilS: null };
	if (
		next.clearance.kind === "granted" &&
		gameTime >= next.clearance.expiresAtS
	)
		// Expiry returns to `none` rather than to `denied`: re-request is free
		// (§6), and a denial the player did not earn would read as one they did.
		// **The reservation goes with it** (§13.2): an unused grant that lapses
		// must not leave a berth held by a ship that never arrived.
		next = releaseBerth({ ...next, clearance: { kind: "none" } });
	if (next.clearance.kind === "queued") {
		const berth = berthFor({ ...traffic, gameTime });
		if (berth)
			next = {
				...next,
				clearance: { kind: "granted", expiresAtS: gameTime + GRANT_WINDOW_S },
				berthId: berth.id,
			};
	}
	return next;
}

// ---------------------------------------------------------------------------
// The entry, composed
// ---------------------------------------------------------------------------

export interface EntryOutcome {
	docked: boolean;
	evaluation: EntryEvaluation;
	state: DockingState;
	/** Zero on a successful dock. */
	damage: number;
	/** Where the bounce leaves the ship, or `null` on a dock. */
	repelled: EntryPose | null;
	/** Whether this crossing was the missing-grant case — the only one that
	 *  turns the station hostile. */
	barged: boolean;
}

/**
 * One crossing of the aperture plane, start to finish.
 *
 * **Clearance is a precondition, evaluated before §3's checks — not check 1.**
 * The ordering has to be explicit because the flip and check 1 would otherwise
 * resolve at the same instant: an implementation that read `state.hostile`
 * before applying the flip lets barging dock cleanly, and clearance stops being
 * mandatory through a read ordering nobody chose. So the entry condition is
 * `grantLive && !hostile`, in that order, and the flip lands *before*
 * `evaluateEntry` sees the state.
 */
export function attemptEntry(input: {
	frame: ApertureFrame;
	pose: EntryPose;
	state: DockingState;
	gameTime: number;
	damageScale?: number;
}): EntryOutcome {
	const { frame, pose, gameTime } = input;
	const barged = !grantLive(input.state, gameTime);
	const state: DockingState = barged
		? {
				...input.state,
				hostile: true,
				hostileUntilS: gameTime + HOSTILE_COOLDOWN_S,
			}
		: input.state;

	const evaluation = evaluateEntry(frame, pose, { hostile: state.hostile });
	// A barge is a failed entry whatever the geometry says: the checks are
	// evaluated so the diagnostics are complete, and the verdict is not theirs.
	const docked = !barged && evaluation.passed;
	if (docked)
		return {
			docked: true,
			evaluation,
			state,
			damage: 0,
			repelled: null,
			barged,
		};
	return {
		docked: false,
		evaluation,
		// §2.0: a failed entry keeps its clearance grant. Failing the geometry is
		// a piloting error, not a protocol violation, and making the player
		// re-request after every bounce would turn §6 into paperwork.
		state,
		damage: entryDamage(evaluation.speedKms, input.damageScale),
		repelled: repel(frame, pose),
		barged,
	};
}

// ---------------------------------------------------------------------------
// §7 — the docking computer
// ---------------------------------------------------------------------------

/** The name the equipment table files it under (`economy-trade.md` §7, 1,000 Cr).
 *  A string rather than an import: `market.ts` owns the price and this module
 *  owns the behaviour, and neither should have to load the other. */
export const DOCKING_COMPUTER = "Docking Computer";

/** How far outside the aperture plane the computer lines up before running in,
 *  km. Far enough that the line-up turn happens off the axis rather than in the
 *  last few metres of it. */
export const COMPUTER_STANDOFF_KM = 3;

/**
 * How far the run-in aim point sits *inside* the aperture plane, km (node #32's
 * orbit floor exposed this: at the higher orbital speeds the approach converges
 * a little tighter, and an aim point exactly on the plane degenerates exactly
 * where the ship crosses it — the target and the position coincide, the
 * commanded nose swings sideways in the last seconds, and check 2's 35° nose
 * row fails a profile whose position is clean. Aiming a hair inside keeps
 * `toTarget` non-zero through the crossing, so the nose holds the axis instead
 * of being yanked off it. The ship never reaches the point — `resolveCrossing`
 * disengages the computer at the plane — so this is a direction reference, not a
 * course change. Small beside the 0.12 km slot, so it does not move the
 * approach; large compared with the ~2 m lateral error the run-in actually
 * carries, so the commanded direction stays stable in the gap between.
 */
export const COMPUTER_AIM_INSIDE_KM = 0.05;

/**
 * The corridor the computer runs in through: a **cone**, not a cylinder.
 *
 * `COMPUTER_CORRIDOR_KM` is its half-width at the aperture plane — a fifth of
 * the slot's half-height, so the run-in ends well inside check 5 — and
 * `COMPUTER_CONE_TAN` is how much it opens per kilometre of standoff.
 *
 * A cylinder was the first version and it did not fly. The docking axis points
 * at the parent body, so it **swings as the station goes round its orbit**, and
 * the corridor entry point swings with it; the ship chases that point with a
 * lag of a few metres and a fixed 7 m tolerance is never met. Measured in the
 * browser it held 12–33 m off-axis and dithered at the standoff for the whole
 * 600 s grant. A cone is met at range and tightens as the ship closes, which is
 * the shape the approach actually has — and the run-in aims at the slot centre,
 * so the lateral error shrinks in proportion to the distance rather than
 * needing to be flown out first.
 */
export const COMPUTER_CORRIDOR_KM = 0.007;
export const COMPUTER_CONE_TAN = Math.tan((3 * Math.PI) / 180);

/** The lead time the computer's speed law divides by, seconds — #14's
 *  `approachLeadS`, which is the law §3.1 says the gate rhymes with. */
export const COMPUTER_LEAD_S = 3;

/**
 * The floor under the run-in speed, km/s.
 *
 * `distance / lead` alone goes to zero as the slot is reached, so the ship
 * converges on the plane asymptotically and never crosses it — the approach
 * completes in the limit and never in a frame. A floor well under the gate is
 * what turns the arrival into an event. A floor on the *line-up* leg would be
 * the opposite mistake: it makes the ship orbit the point it is trying to reach,
 * which is what the first version of this function did.
 */
export const COMPUTER_RUN_IN_MIN_KMS = V_GATE_KMS * 0.2;

/** The run-in cap, km/s: under the gate rather than at it, so a crossing this
 *  function commands cannot fail check 6 on a rounding. */
export const COMPUTER_RUN_IN_MAX_KMS = V_GATE_KMS * 0.6;

export interface ComputerInput {
	frame: ApertureFrame;
	pose: EntryPose;
	state: DockingState;
	gameTime: number;
	/** #5's assist cap, passed in rather than imported: `sim.ts` owns the flight
	 *  model, and a copy of its cap here would be a second place to retune. */
	maxSpeedKms: number;
}

export interface ComputerCommand {
	engaged: boolean;
	/** Why it will not fly, or `null`. It never bypasses a check (§7), so every
	 *  refusal here is a condition a pilot would also have failed. */
	refused: "no-clearance" | "hostile" | "out-of-range" | null;
	/** Where to point, and which way up. Meaningless when not engaged. */
	nose: Vec3;
	up: Vec3;
	/** Commanded speed in the station's frame, km/s. */
	speedKms: number;
	phase: "line-up" | "run-in" | "idle";
}

/**
 * One frame of §7's autopilot: roughly the profile a competent pilot flies.
 *
 * **It is not given any authority §3 does not give a pilot**, which is a weaker
 * and truer statement than "it never bypasses a check". Two halves, and they
 * are enforced in different places:
 *
 * - **Clearance and hostility it enforces itself**, here, by refusing to fly.
 *   That half is a property of this function and nothing downstream can undo it.
 * - **The gate it can only ever *ask* for.** This returns a commanded speed;
 *   `main.ts` turns it into a throttle and #5's assist integrates it, so what
 *   crosses the plane is the assist's tracking of the command, not the command.
 *   A run commanded at exactly `V_GATE` arrives at about 1.005× it once the
 *   lateral remainder is counted — which is why the run-in cap is well *under*
 *   the gate rather than at it, and why the checks still run on the crossing
 *   this produces like any other. The computer is not trusted; it is aimed.
 *
 * A computer that could dock where a pilot could not would make §3 decoration,
 * and the reason it cannot is that it goes through the same `attemptEntry`.
 *
 * Two phases, and the split is what keeps check 5 satisfiable: lining up aims
 * at a point on the axis well outside the plane, so the turn happens in open
 * space; the run-in aims at the slot centre from inside the corridor. Flying
 * straight at the slot from wherever the ship happens to be is the hull-face
 * approach §9.2.4 exists to catch.
 */
/**
 * Is the ship lined up enough to run in? §7's corridor, as its own predicate.
 *
 * A **cone**: `COMPUTER_CORRIDOR_KM` at the aperture plane, opening by
 * `COMPUTER_CONE_TAN` per kilometre of standoff. Extracted from the step
 * function because it is the piece of §7 most likely to be retuned and the one
 * a test can pin without flying anything — the first version was a cylinder and
 * the autopilot never met it.
 */
export function insideCorridor(frame: ApertureFrame, pose: EntryPose): boolean {
	const axial = dot(pose.rel, frame.axis);
	if (axial < frame.planeKm) return false;
	const offAxisKm = length(sub(pose.rel, scale(frame.axis, axial)));
	return (
		offAxisKm <=
		COMPUTER_CORRIDOR_KM + COMPUTER_CONE_TAN * (axial - frame.planeKm)
	);
}

/**
 * §7's speed law: #14's `distance / lead` on both legs, clamped differently.
 *
 * The line-up has **no floor**, so it converges on the corridor entry instead of
 * orbiting it; the run-in has one, so the crossing happens in a frame rather
 * than in the limit. Getting that pair the wrong way round is what produced the
 * 600 s dither §7 records, so the two clamps are named here rather than inlined.
 */
export function approachSpeed(
	distKm: number,
	lined: boolean,
	maxSpeedKms: number,
): number {
	return lined
		? Math.min(
				COMPUTER_RUN_IN_MAX_KMS,
				Math.max(COMPUTER_RUN_IN_MIN_KMS, distKm / COMPUTER_LEAD_S),
			)
		: Math.min(maxSpeedKms, distKm / COMPUTER_LEAD_S);
}

export function dockingComputerStep(input: ComputerInput): ComputerCommand {
	const { frame, pose, state, gameTime } = input;
	const idle = (refused: ComputerCommand["refused"]): ComputerCommand => ({
		engaged: false,
		refused,
		nose: pose.nose,
		up: pose.up,
		speedKms: 0,
		phase: "idle",
	});

	// Same order as §6's entry condition, for the same reason.
	if (!grantLive(state, gameTime)) return idle("no-clearance");
	if (state.hostile) return idle("hostile");
	if (length(pose.rel) > VICINITY_KM) return idle("out-of-range");

	const axial = dot(pose.rel, frame.axis);
	const corridorAxial = frame.planeKm + COMPUTER_STANDOFF_KM;

	// **The line-up target is a fixed point, not the axis abeam the ship.**
	// Aiming at `axis · currentAxial` gives a target that retreats as the ship
	// moves, and with a floor under the speed the result is a limit cycle: the
	// ship circles a few metres off the axis, closes nothing, and the grant
	// expires under it. Measured at 2 rpm it held 17 m of offset for the whole
	// 600 s window. The corridor entry is a place, so the leg to it terminates.
	const lined = insideCorridor(frame, pose);
	// The run-in aim sits a hair *inside* the plane (COMPUTER_AIM_INSIDE_KM):
	// an aim exactly on the plane degenerates as the ship closes — target and
	// position coincide at the crossing, the commanded nose swings, and the
	// nose row of check 2 fails a clean position. The slot is a volume, so the
	// aim is still "the slot", and the lateral error still closes in proportion
	// to the distance.
	// The aim never crosses to the far side of the plane, however thin the
	// aperture is: clamped to stay inside (never below half the plane).
	const aimKm = Math.max(
		frame.planeKm - COMPUTER_AIM_INSIDE_KM,
		frame.planeKm / 2,
	);
	const target = lined
		? scale(frame.axis, aimKm)
		: scale(frame.axis, corridorAxial);

	const toTarget = sub(target, pose.rel);
	const distKm = length(toTarget);
	const speedKms = approachSpeed(distKm, lined, input.maxSpeedKms);

	return {
		engaged: true,
		refused: null,
		nose: distKm === 0 ? pose.nose : unit(toTarget),
		// Track the slot's roll throughout, not only on the run-in: §4's spin
		// makes the roll match a tracking problem, and starting to track only at
		// the corridor leaves the fastest spinner a turn to make in the last
		// three kilometres.
		up: frame.aperture.kind === "slot" ? slotBasis(frame).across : pose.up,
		speedKms,
		phase: lined ? "run-in" : "line-up",
	};
}

/**
 * An attitude from two independently slewed directions.
 *
 * `up` is re-orthogonalised against `nose`, because two directions turned
 * separately stop being perpendicular after the first step and are then not an
 * attitude at all. Returns the nose unchanged and a corrected up; `null` when
 * the two are parallel and there is no attitude to build.
 *
 * Here rather than in each caller because there were two partial copies — the
 * renderer's `setAttitude` and `tests/docking.test.ts`'s flight harness — and
 * the tier that verifies the autopilot should not carry its own version of the
 * law the autopilot is flown by.
 */
export function orthonormalise(
	nose: Vec3,
	up: Vec3,
): { nose: Vec3; up: Vec3 } | null {
	const f = unit(nose);
	const corrected = sub(up, scale(f, dot(up, f)));
	if (length(corrected) < 1e-12) return null;
	return { nose: f, up: unit(corrected) };
}

/**
 * Rotate `from` toward `to` by at most `maxRad`, staying on the unit sphere.
 *
 * Here rather than in the caller because both the computer's harness and the
 * renderer need the same law, and two spellings of a slerp step is how the
 * autopilot and the drawn ship come to disagree about where the nose is.
 */
export function slewToward(from: Vec3, to: Vec3, maxRad: number): Vec3 {
	const a = unit(from);
	const b = unit(to);
	const c = Math.min(1, Math.max(-1, dot(a, b)));
	const angle = Math.acos(c);
	if (angle <= maxRad || angle === 0) return b;
	// The component of `b` perpendicular to `a`, normalised: the direction to
	// turn in. Antiparallel is the one case with no such direction, and any
	// perpendicular will do — the caller is turning through 180° either way.
	// **A tolerance, not `=== 0`.** For a nearly-antiparallel pair the
	// perpendicular component is tiny but non-zero, and normalising it amplifies
	// float noise into an essentially random turn direction — the case the
	// fallback exists for, taken by the branch that assumes a good one.
	const perp = sub(b, scale(a, c));
	const dir = length(perp) < 1e-9 ? anyPerpendicular(a) : unit(perp);
	return add(scale(a, Math.cos(maxRad)), scale(dir, Math.sin(maxRad)));
}
