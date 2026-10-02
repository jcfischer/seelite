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
 * the ship leaves the approach it is about, which `stepDockingNotice` defines
 * for a notice posted inside the director's range and for one posted beyond it.
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
	/** How far from the station it was posted, km: `stepDockingNotice` reads
	 *  it to decide when the ship has left the approach it is about. */
	postedRangeKm: number;
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
		postedRangeKm: at.rangeKm,
	};
}

/**
 * Rounded up, so a failed value never reads as equal to its tolerance — and
 * `null` for a value that is not over it at all: a check failed at its own
 * boundary names the row without a figure that would read as a pass.
 */
function degOver(deg: number, toleranceDeg: number): string | null {
	return deg > toleranceDeg ? `${Math.ceil(deg)}° of ${toleranceDeg}°` : null;
}

/** A row's name, with its figure when it has one. */
function named(row: string, figure: string | null): string {
	return figure ? `${row} ${figure}` : row;
}

/** The failed checks in §3's order, each against its own tolerance. */
function failedReasons(outcome: EntryOutcome): string[] {
	const { checks, ...ev } = outcome.evaluation;
	const reasons: string[] = [];
	if (!checks.axisAlignment) {
		const position = degOver(ev.positionAngleDeg, AXIS_TOLERANCE_DEG);
		const nose = degOver(ev.noseAngleDeg, AXIS_TOLERANCE_DEG);
		if (position) reasons.push(named("off axis", position));
		if (nose) reasons.push(named("nose", nose));
		// The check failed and neither half reads over its tolerance — at the
		// boundary itself. The row is still named rather than dropped.
		if (!position && !nose) reasons.push("off axis");
	}
	if (!checks.inbound) reasons.push("not inbound");
	if (!checks.rollMatch)
		reasons.push(named("roll", degOver(ev.rollAngleDeg, ROLL_TOLERANCE_DEG)));
	if (!checks.containment) reasons.push("missed the slot");
	if (!checks.closingSpeed)
		// Less a hair before rounding up: `0.14 * 100` is 14.000000000000002,
		// and a bare ceil printed 0.15 for a 0.14 km/s crossing.
		reasons.push(
			`speed ${(Math.ceil(ev.speedKms * 100 - 1e-9) / 100).toFixed(2)} of ${V_GATE_KMS.toFixed(2)} km/s`,
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
		return notice(
			outcome.damage === 0
				? "TURNED BACK · lane busy · no damage"
				: "TURNED BACK · lane busy",
			"action",
			at,
		);
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

/**
 * One frame: the notice, or `null` once the ship has left the approach it is
 * about.
 *
 * Posted inside the director's range, it clears on leaving that range. Posted
 * beyond it — an out-of-range let-go, or §11.7's grant expiring at the far edge
 * of `VICINITY_KM` — a range rule would clear it on the frame it was written,
 * so it clears once the ship has moved a director's range from where it was
 * posted, either way: further out, or in to where the director takes over.
 * Sage round 1 found the first build gave such a notice no exit at all.
 */
export function stepDockingNotice(
	current: DockingNotice | null,
	rangeKm: number,
): DockingNotice | null {
	if (!current) return null;
	const posted = current.postedRangeKm;
	const left =
		posted <= DIRECTOR_RANGE_KM
			? rangeKm > DIRECTOR_RANGE_KM
			: rangeKm <= DIRECTOR_RANGE_KM ||
				Math.abs(rangeKm - posted) > DIRECTOR_RANGE_KM;
	return left ? null : current;
}
