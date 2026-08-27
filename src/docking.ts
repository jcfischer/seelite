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
import { type Vec3, add, dot, length, scale, sub, v3 } from "./vec3";

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

const cross = (a: Vec3, b: Vec3): Vec3 =>
	v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

const unit = (a: Vec3): Vec3 => {
	const len = length(a);
	return len === 0 ? v3(1, 0, 0) : scale(a, 1 / len);
};

/** The acute angle between two directions, degrees. Clamped before `acos`
 *  because a dot product of two unit vectors reaches 1.0000000000000002. */
const angleDeg = (a: Vec3, b: Vec3): number =>
	Math.acos(Math.min(1, Math.max(-1, dot(unit(a), unit(b))))) / DEG;

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
	 * Axial distance from the station's centre to the aperture plane, km — the
	 * dockable core radius (§5).
	 *
	 * Named for what it is here rather than reused as `coreRadiusKm`, because
	 * what the checks do with it is decide where the plane is: a crossing is
	 * `dot(rel, axis)` passing down through this number, not through zero.
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
): ApertureFrame {
	const geometry = STATION_GEOMETRY[type];
	return {
		axis: unit(axis),
		// A pad does not rotate, so a caller that passed a phase for one is
		// describing something that cannot happen. Normalised here rather than
		// trusted, so check 4's "does not apply" is a property of the frame.
		phaseRad: geometry.spins ? phaseRad : 0,
		aperture: geometry.aperture,
		planeKm: geometry.coreRadiusKm,
	};
}

/**
 * An orthonormal pair spanning the aperture plane: `across` along the
 * rectangle's width at the current phase, `up` along its height.
 *
 * The phase-zero reference is derived from the axis by picking the world axis
 * least parallel to it. That is arbitrary and it has to be — a slot's phase is
 * only meaningful against *some* reference, and the only requirement is that
 * the renderer mirrors this one. The alternative, storing a reference vector on
 * the station, is a second place the convention would live.
 */
export function slotBasis(frame: ApertureFrame): { across: Vec3; up: Vec3 } {
	const a = frame.axis;
	const seed =
		Math.abs(a.x) < 0.9
			? v3(1, 0, 0)
			: Math.abs(a.y) < 0.9
				? v3(0, 1, 0)
				: v3(0, 0, 1);
	const u = unit(cross(a, seed));
	const v = cross(a, u);
	const c = Math.cos(frame.phaseRad);
	const s = Math.sin(frame.phaseRad);
	return {
		across: add(scale(u, c), scale(v, s)),
		up: add(scale(u, -s), scale(v, c)),
	};
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
	const positionAngleDeg = angleDeg(pose.rel, axis);
	const noseAngleDeg = angleDeg(pose.nose, scale(axis, -1));
	const axisAlignment =
		Math.cos(positionAngleDeg * DEG) >= AXIS_COS - 1e-12 &&
		Math.cos(noseAngleDeg * DEG) >= AXIS_COS - 1e-12;

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
			// the slot plane and no roll to compare. That is a ship pointing
			// sideways down the slot; check 2 has already refused it, and reporting
			// a match here rather than a `NaN` keeps the roll row from deciding a
			// case it cannot see.
			rollAngleDeg = Number.NaN;
			rollMatch = false;
		} else {
			const raw = angleDeg(projected, basis.across);
			rollAngleDeg = Math.min(raw, 180 - raw);
			rollMatch = Math.cos(rollAngleDeg * DEG) >= ROLL_COS - 1e-12;
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
		// Attitude is taken from the later frame rather than interpolated: a
		// slerp between two unit vectors is not a lerp, and the step is a frame
		// long. Taking the nearer end is the honest cheap answer.
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
}

export const newDockingState = (): DockingState => ({
	clearance: { kind: "none" },
	hostile: false,
	hostileUntilS: null,
});

export interface ClearanceRequest {
	gameTime: number;
	rangeKm: number;
	/**
	 * How many ships hold the slot (§6.1). Injected, and that is a build
	 * obligation rather than a placeholder: NPC traffic is #8's and unbuilt, so
	 * without an injected input the queued branch would be unexercised code from
	 * the day it was written.
	 */
	occupancy: number;
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
	if (req.occupancy > 0)
		return { ...state, clearance: { kind: "queued", position: req.occupancy } };
	return {
		...state,
		clearance: { kind: "granted", expiresAtS: req.gameTime + GRANT_WINDOW_S },
	};
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
	occupancy: number,
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
		next = { ...next, clearance: { kind: "none" } };
	if (next.clearance.kind === "queued" && occupancy === 0)
		next = {
			...next,
			clearance: { kind: "granted", expiresAtS: gameTime + GRANT_WINDOW_S },
		};
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
 * **It never bypasses a check.** It refuses at a hostile station, refuses
 * without clearance, and its speed law is capped below the gate on the run-in
 * so a crossing it commands cannot be above it. A computer that could dock
 * where a pilot could not would make §3 decoration.
 *
 * Two phases, and the split is what keeps check 5 satisfiable: lining up aims
 * at a point on the axis well outside the plane, so the turn happens in open
 * space; the run-in aims at the slot centre from inside the corridor. Flying
 * straight at the slot from wherever the ship happens to be is the hull-face
 * approach §9.2.4 exists to catch.
 */
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
	const lateral = sub(pose.rel, scale(frame.axis, axial));
	const offAxisKm = length(lateral);
	const corridorAxial = frame.planeKm + COMPUTER_STANDOFF_KM;

	// **The line-up target is a fixed point, not the axis abeam the ship.**
	// Aiming at `axis · currentAxial` gives a target that retreats as the ship
	// moves, and with a floor under the speed the result is a limit cycle: the
	// ship circles a few metres off the axis, closes nothing, and the grant
	// expires under it. Measured at 2 rpm it held 17 m of offset for the whole
	// 600 s window. The corridor entry is a place, so the leg to it terminates.
	const lined =
		axial >= frame.planeKm &&
		offAxisKm <=
			COMPUTER_CORRIDOR_KM + COMPUTER_CONE_TAN * (axial - frame.planeKm);
	const target = lined
		? scale(frame.axis, frame.planeKm)
		: scale(frame.axis, corridorAxial);

	const toTarget = sub(target, pose.rel);
	const distKm = length(toTarget);
	// #14's law on both legs, clamped differently. The line-up has no floor, so
	// it converges on the corridor entry instead of orbiting it; the run-in has
	// one, so the crossing happens in a frame rather than in the limit.
	const speedKms = lined
		? Math.min(
				COMPUTER_RUN_IN_MAX_KMS,
				Math.max(COMPUTER_RUN_IN_MIN_KMS, distKm / COMPUTER_LEAD_S),
			)
		: Math.min(input.maxSpeedKms, distKm / COMPUTER_LEAD_S);

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
	let perp = sub(b, scale(a, c));
	if (length(perp) === 0) {
		const seed = Math.abs(a.x) < 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
		perp = cross(a, seed);
	}
	const dir = unit(perp);
	return add(scale(a, Math.cos(maxRad)), scale(dir, Math.sin(maxRad)));
}
