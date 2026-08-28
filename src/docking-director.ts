/**
 * `docs/specs/hud-and-scanner.md` §3 — the docking director's state.
 *
 * Cockpit is the default view and the hull is hidden (#5), so check 2's axis
 * alignment and check 4's roll match have **no visual referent at all** without
 * an instrument. `docking.md` §3.2 records that both tolerances were set wide
 * partly because these did not exist; this module is the half that makes them
 * legible. §3: it "makes #9's checks legible; it does not automate them".
 *
 * **Every angle here is `evaluateEntry`'s, not a second computation.** A cue
 * measuring its own version of check 2 would leave the tolerance wide for a
 * second reason — the pilot would be flying an instrument that disagreed with
 * the gate. `tests/docking-director.test.ts` sweeps both cues against the
 * shipped checks and requires agreement.
 *
 * **What this is not:** a prediction that entry will pass. `evaluateEntry`'s
 * containment and inbound rows are facts about the *crossing instant*, and this
 * runs on a live pose thousands of metres out, where the lateral offset is not
 * yet the crossing point. `aligned` therefore means the two attitude checks are
 * satisfied *now*, and the director deliberately shows no verdict.
 */

import {
	AXIS_TOLERANCE_DEG,
	ROLL_TOLERANCE_DEG,
	V_GATE_KMS,
	VICINITY_KM,
	type ApertureFrame,
	type DockingState,
	type EntryPose,
	evaluateEntry,
	grantLive,
	slotBasis,
} from "./docking";
import { type Vec3, dot, length, scale, sub, v3 } from "./vec3";

/** One measured angle against the tolerance the pilot is flying to. */
export interface DirectorCue {
	/** Degrees, straight off `evaluateEntry`. `NaN` where the pose has no angle
	 *  to report — an up-vector lying along the docking axis has no roll. */
	deg: number;
	toleranceDeg: number;
	within: boolean;
}

export type BlockingKind = "hostile" | "denied" | "no-clearance";

/**
 * §3: "Denial or hostility is blocking: the director says **do not enter** and
 * writes the reason, so a red mark alone never carries the consequence."
 */
export interface DirectorBlock {
	kind: BlockingKind;
	/** Player-facing, and it carries the reason rather than only the refusal. */
	text: string;
}

export interface DirectorState {
	stationId: string;
	rangeKm: number;
	/** Inside §6's clearance range, where a request can be made at all. */
	inVicinity: boolean;
	/** Seconds left on a live grant, or `null` when there is none — §3's
	 *  "positive state and the remaining window". */
	grantRemainingS: number | null;
	blocking: DirectorBlock | null;
	/** Check 2, both halves, so a failing cue says *which* half. */
	axis: { position: DirectorCue; nose: DirectorCue };
	/**
	 * The aperture axis, pointing **out** of the station — the direction an
	 * approaching ship comes from, and the frame's own vector rather than a copy.
	 * The director carries it because the on-glass funnel has to draw where the
	 * nose must end up, and a renderer deriving that itself would be a second
	 * spelling of `docking.ts`'s convention.
	 */
	axisOut: Vec3;
	/** Check 4, or `null` for a pad: a square aperture has no long axis to
	 *  match, and an empty ring would read as a failed one. */
	roll: DirectorCue | null;
	/**
	 * The **signed** roll error, degrees, folded to (−90, 90]: positive is a
	 * right-handed rotation of the ship's up about the outward axis away from
	 * the slot's `across`.
	 *
	 * Check 4 is unsigned — it compares against the axis *line*, so a ship
	 * rolled 180° is the identical entry — and that is right for a gate and
	 * useless for an instrument. A cue with a magnitude and no direction tells
	 * the pilot how wrong they are and not which way to correct, which is a
	 * guess-and-widen loop rather than a director. `|rollSignedDeg|` equals
	 * `roll.deg`, and the test asserts that rather than assuming it.
	 *
	 * `null` for a pad, and `NaN` where there is no roll to report.
	 */
	rollSignedDeg: number | null;
	closing: { kms: number; gateKms: number; within: boolean };
	/** Checks 2 and 4 as the evaluation reports them — the verdict is
	 *  `docking.ts`'s, and the per-half booleans above only say what to paint. */
	aligned: boolean;
}

export function dockingDirector(input: {
	stationId: string;
	frame: ApertureFrame;
	pose: EntryPose;
	state: DockingState;
	gameTime: number;
}): DirectorState {
	const { stationId, frame, pose, state, gameTime } = input;
	const evaluation = evaluateEntry(frame, pose, { hostile: state.hostile });
	const live = grantLive(state, gameTime);

	return {
		stationId,
		rangeKm: length(pose.rel),
		inVicinity: length(pose.rel) <= VICINITY_KM,
		grantRemainingS:
			live && state.clearance.kind === "granted"
				? state.clearance.expiresAtS - gameTime
				: null,
		blocking: blockingOf(state, live),
		axis: {
			position: cue(evaluation.positionAngleDeg, AXIS_TOLERANCE_DEG),
			nose: cue(evaluation.noseAngleDeg, AXIS_TOLERANCE_DEG),
		},
		// A copy, not the frame's own vector. A consumer that scaled this in place
		// would be editing the aperture frame every docking check reads.
		axisOut: v3(frame.axis.x, frame.axis.y, frame.axis.z),
		roll:
			frame.aperture.kind === "slot"
				? cue(evaluation.rollAngleDeg, ROLL_TOLERANCE_DEG)
				: null,
		rollSignedDeg:
			frame.aperture.kind === "slot" ? signedRollDeg(frame, pose) : null,
		closing: {
			kms: evaluation.speedKms,
			gateKms: V_GATE_KMS,
			within: evaluation.checks.closingSpeed,
		},
		aligned: evaluation.checks.axisAlignment && evaluation.checks.rollMatch,
	};
}

/**
 * The signed roll about the outward axis, folded to the same (−90, 90] the
 * unsigned check works in — so `Math.abs` of this is check 4's own angle.
 *
 * Folded rather than reported over the full turn, because a slot is
 * symmetric: a ship 170° out is 10° out the other way, and an instrument
 * telling it to roll 170° would be sending the pilot the long way round.
 */
function signedRollDeg(frame: ApertureFrame, pose: EntryPose): number {
	const axis = frame.axis;
	const projected = sub(pose.up, scale(axis, dot(pose.up, axis)));
	const norm = length(projected);
	if (norm === 0) return Number.NaN;
	const u = scale(projected, 1 / norm);
	const { across } = slotBasis(frame);
	const perpendicular = cross(axis, across);
	const deg =
		(Math.atan2(dot(u, perpendicular), dot(u, across)) * 180) / Math.PI;
	if (deg > 90) return deg - 180;
	if (deg <= -90) return deg + 180;
	return deg;
}

const cross = (a: Vec3, b: Vec3): Vec3 =>
	v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/** `NaN` is outside every tolerance: a pose with no angle to report is not a
 *  pose that satisfies the check, and `NaN <= x` is already false. */
const cue = (deg: number, toleranceDeg: number): DirectorCue => ({
	deg,
	toleranceDeg,
	within: deg <= toleranceDeg,
});

/**
 * The order is §4's attention order and it is not cosmetic: hostility is the
 * danger and a denial is paperwork, so a station shooting at the pilot must not
 * report why the forms were refused. It mirrors the map's `grantLive && !hostile`
 * constraint from the other side — the grant never suppresses the hostile mark.
 */
function blockingOf(state: DockingState, live: boolean): DirectorBlock | null {
	if (state.hostile)
		return {
			kind: "hostile",
			text: "DO NOT ENTER · station hostile · leave the approach",
		};
	if (state.clearance.kind === "denied")
		return {
			kind: "denied",
			text: `DO NOT ENTER · clearance denied · ${state.clearance.reason} scan`,
		};
	if (live) return null;
	if (state.clearance.kind === "queued")
		return {
			kind: "no-clearance",
			text: `DO NOT ENTER · in the queue, position ${state.clearance.position}`,
		};
	return {
		kind: "no-clearance",
		text: "DO NOT ENTER · no clearance · request before entry",
	};
}
