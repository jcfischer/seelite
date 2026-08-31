/**
 * `docs/specs/hud-and-scanner.md` §3 — the docking director's state.
 *
 * Cockpit is the default view and the hull is hidden (#5), so check 2's axis
 * alignment and check 4's roll match have **no visual referent at all** without
 * an instrument. `docking.md` §3.2 records that both tolerances were set wide
 * partly because these did not exist; this module is the half that makes them
 * legible. §3: it "makes #9's checks legible; it does not automate them".
 *
 * **Every angle the cues are judged on is `evaluateEntry`'s, not a second
 * computation.** A cue measuring its own version of check 2 would leave the
 * tolerance wide for a second reason — the pilot would be flying an instrument
 * that disagreed with the gate. `tests/docking-director.test.ts` sweeps both
 * halves of check 2 and check 4 against the shipped checks and requires
 * agreement.
 *
 * **`rollSignedDeg` is the one exception, and it is deliberate.** Check 4 is
 * unsigned by design — it compares against the axis *line* — and a cue with a
 * magnitude and no direction is a guess-and-widen loop rather than a director,
 * so the signed roll is computed here. It is display only: no verdict reads it,
 * `roll.within` remains the check's, and the same sweep asserts
 * `|rollSignedDeg|` equals `roll.deg` at every angle rather than at a handful.
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
	type Clearance,
	type DockingState,
	type EntryPose,
	evaluateEntry,
	grantLive,
	signedRollDeg,
} from "./docking";
import {
	TUNNEL_MOUTH_FRACTION,
	type TunnelGeometry,
	dockingTunnel,
} from "./docking-tunnel";
import { type Vec3, dot, length, v3 } from "./vec3";

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
	/**
	 * Inside §6's clearance range, where a *request* can be made at all.
	 *
	 * **Not a director gate.** `directorEngaged` is, and it uses
	 * `DIRECTOR_RANGE_KM` — two hundred times smaller. This field is kept because
	 * the two ranges answer different questions and a reader needs to see both to
	 * know which is which; gating the glass on this one is the defect #94 exists
	 * to fix, and the name it had made that easy to do by accident.
	 */
	inVicinity: boolean;
	/** §6's clearance state, so `directorEngaged` can read it without a second
	 *  copy of the union reaching the renderer. */
	clearanceKind: Clearance["kind"];
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
	/**
	 * The station's own position, km — carried so the corridor below can be
	 * placed in the world. The tunnel is anchored to the station rather than to
	 * the glass, which is the whole of what lets it say *which side to approach
	 * from*; a glass-only cue cannot, because turning the ship takes it with you.
	 */
	stationPos: Vec3;
	/**
	 * `docking-tunnel.ts`'s corridor, reaching from the aperture back to the
	 * ship. Station-relative kilometres, so the renderer adds `stationPos` and
	 * projects — nothing here is in scene-graph units.
	 */
	tunnel: TunnelGeometry;
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

/**
 * How close the ship must be for the director to be on the glass, km.
 *
 * **Not `VICINITY_KM`.** That is §6's *clearance-request* range — ten thousand
 * kilometres — and gating the director on it put a funnel on screen through
 * most of ordinary in-system flight, which is the wall of labels
 * `hud-and-scanner.md` §1 refuses. This is an approach range: it is a director,
 * and there is nothing to direct from a tenth of an AU out.
 *
 * Fifty kilometres is where the worst correction the corridor permits is cheap.
 * A ship at that range sitting on check 2's 35° rim is 28.7 km off the axis,
 * which is about fifteen seconds of lateral flight at #5's 2 km/s assist cap —
 * so the cue appears with the error still trivially fixable, and about sixteen
 * times further out than the docking computer's 3 km standoff, so a hand-flown
 * approach sees it well before the autopilot would have taken over. It is a
 * tuning value and the first flight is what confirms it.
 */
export const DIRECTOR_RANGE_KM = 50;

/**
 * Whether the director belongs on the glass at all.
 *
 * Range **and** the protocol, not either: the range makes it an approach
 * instrument, and requiring the pilot to have engaged §6's protocol makes
 * *requesting clearance* the act that turns it on. A station that has refused —
 * or turned hostile without being asked — keeps the director, because §3's
 * blocking state is the one thing a pilot must not lose by looking away.
 */
export function directorEngaged(state: DirectorState): boolean {
	if (state.rangeKm > DIRECTOR_RANGE_KM) return false;
	return state.clearanceKind !== "none" || state.blocking?.kind === "hostile";
}

export function dockingDirector(input: {
	stationId: string;
	stationPos: Vec3;
	frame: ApertureFrame;
	pose: EntryPose;
	state: DockingState;
	gameTime: number;
}): DirectorState {
	const { stationId, stationPos, frame, pose, state, gameTime } = input;
	const evaluation = evaluateEntry(frame, pose, { hostile: state.hostile });
	const live = grantLive(state, gameTime);
	const rangeKm = length(pose.rel);

	return {
		stationId,
		rangeKm,
		inVicinity: rangeKm <= VICINITY_KM,
		clearanceKind: state.clearance.kind,
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
		stationPos,
		// The mouth follows the ship's own axial distance, so the corridor reaches
		// back toward the pilot and shortens as they fly it — but stops short of
		// them, because a rectangle at the eye draws rails off the edges of the
		// frame rather than a tunnel. Clamped inside `dockingTunnel`, which is
		// where a mouth behind the throat has to be answered rather than assumed
		// away.
		tunnel: dockingTunnel(frame, {
			mouthKm: dot(pose.rel, frame.axis) * TUNNEL_MOUTH_FRACTION,
		}),
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
			// **"scan" only where a scan is what refused.** #13 §5.1.1's contraband
			// scan and §6's hostility both read as one; a hull too big for every
			// berth in the catalogue (§13.2) is not a scan result, and calling it
			// one would tell the pilot to dump cargo they are not carrying.
			text:
				state.clearance.reason === "no berth that fits"
					? "DO NOT ENTER · clearance denied · no berth that fits this hull"
					: `DO NOT ENTER · clearance denied · ${state.clearance.reason} scan`,
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
