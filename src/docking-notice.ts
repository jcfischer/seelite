/**
 * #597 — the line a pilot reads when an entry fails or the docking computer
 * lets go.
 *
 * Both outcomes were recorded and nothing on the glass read them: a bounce cost
 * shields and said nothing, and the computer let go with the throttle at zero
 * and said nothing. `docking.md` §8's cues are the director's (#69); these two
 * are `hud-and-scanner.md` §3/§4's, on the principal's ruling on #597.
 *
 * **Every figure is `evaluateEntry`'s**, the director's rule: a line that
 * measured its own angle could disagree with the gate it is explaining.
 *
 * **How long it stays up is the approach's clock, not a key's.** #187's jump
 * notice is dismissed by the next command key, and a pilot flying an approach
 * by hand is pressing keys the whole time, so that rule would clear a bounce on
 * the frame it was written. A notice clears on the next approach event — a
 * crossing replaces it, an engage or a clearance request clears it — or once
 * the ship leaves the director's range of the station it is about.
 */

import {
	AXIS_TOLERANCE_DEG,
	ROLL_TOLERANCE_DEG,
	V_GATE_KMS,
	type EntryOutcome,
} from "./docking";
import type { ComputerRefusal } from "./docking-computer";
import { DIRECTOR_RANGE_KM } from "./docking-director";
import type { FloorTone } from "./cockpit";

export interface DockingNotice {
	text: string;
	/** §4: amber for something to act on, red only for a refusal. */
	tone: Extract<FloorTone, "action" | "refused">;
	stationId: string;
	/**
	 * Whether leaving the director's range clears it. Only a notice posted
	 * inside that range: an out-of-range let-go is written beyond it, and a
	 * range rule would clear it on the frame it was written.
	 */
	clearsOnLeaving: boolean;
}

/** Where the notice was posted, and how far from the station it is about. */
export interface NoticeAt {
	stationId: string;
	rangeKm: number;
}

/** At most this many failed checks on one line; the glass has one line. */
const MAX_REASONS = 2;

function notice(
	text: string,
	tone: DockingNotice["tone"],
	at: NoticeAt,
): DockingNotice {
	return {
		text,
		tone,
		stationId: at.stationId,
		clearsOnLeaving: at.rangeKm <= DIRECTOR_RANGE_KM,
	};
}

/** Rounded up, so a failed value never reads as equal to its tolerance. */
function degOver(deg: number, toleranceDeg: number): string {
	return `${Math.ceil(deg)}° of ${toleranceDeg}°`;
}

/** The failed checks in §3's order, each against its own tolerance. */
function failedReasons(outcome: EntryOutcome): string[] {
	const { checks, ...ev } = outcome.evaluation;
	const reasons: string[] = [];
	if (!checks.axisAlignment) {
		if (ev.positionAngleDeg > AXIS_TOLERANCE_DEG)
			reasons.push(
				`off axis ${degOver(ev.positionAngleDeg, AXIS_TOLERANCE_DEG)}`,
			);
		if (ev.noseAngleDeg > AXIS_TOLERANCE_DEG)
			reasons.push(`nose ${degOver(ev.noseAngleDeg, AXIS_TOLERANCE_DEG)}`);
	}
	if (!checks.inbound) reasons.push("not inbound");
	if (!checks.rollMatch)
		reasons.push(`roll ${degOver(ev.rollAngleDeg, ROLL_TOLERANCE_DEG)}`);
	if (!checks.containment) reasons.push("missed the slot");
	if (!checks.closingSpeed)
		reasons.push(
			`speed ${(Math.ceil(ev.speedKms * 100) / 100).toFixed(2)} of ${V_GATE_KMS.toFixed(2)} km/s`,
		);
	return reasons.slice(0, MAX_REASONS);
}

/** What one aperture crossing tells the pilot, or `null` for a dock. */
export function entryNotice(
	outcome: EntryOutcome,
	at: NoticeAt,
): DockingNotice | null {
	if (outcome.docked) return null;
	if (outcome.barged)
		return notice(
			"ENTRY REFUSED · no clearance · station hostile",
			"refused",
			at,
		);
	if (!outcome.evaluation.checks.notHostile)
		return notice("ENTRY REFUSED · station hostile", "refused", at);
	// A busy lane refuses a clean entry without damage; a bad entry into a busy
	// lane is still a bad entry, and that is what the pilot can fix.
	if (outcome.laneBlocked && outcome.evaluation.passed)
		return notice("TURNED BACK · lane busy · no damage", "action", at);
	return notice(
		["ENTRY FAILED", ...failedReasons(outcome)].join(" · "),
		"action",
		at,
	);
}

const COMPUTER_TEXT: Record<
	NonNullable<ComputerRefusal>,
	[string, DockingNotice["tone"]]
> = {
	"no-clearance": ["AUTOPILOT OFF · no live clearance", "refused"],
	hostile: ["AUTOPILOT OFF · station hostile", "refused"],
	"out-of-range": ["AUTOPILOT OFF · out of range", "action"],
};

/** Why the docking computer let go, or `null` when it was not refused. */
export function computerNotice(
	refusal: ComputerRefusal,
	at: NoticeAt,
): DockingNotice | null {
	if (refusal === null) return null;
	const [text, tone] = COMPUTER_TEXT[refusal];
	return notice(text, tone, at);
}

/** One frame: the notice, or `null` once the ship has left its station. */
export function stepDockingNotice(
	current: DockingNotice | null,
	rangeKm: number,
): DockingNotice | null {
	if (current?.clearsOnLeaving && rangeKm > DIRECTOR_RANGE_KM) return null;
	return current;
}
