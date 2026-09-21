/**
 * The cockpit's reading of the pirate relay's signal (node #43): a small
 * glass cue, like #343's tracked-request cue, that says how strong the signal
 * is and which way it lies — never where. The exact position stays hidden
 * until identification, which is the principal's requirement recorded on
 * #343's close: a bounded region, useful guidance, a discoverable signal.
 *
 * Headless: strings and numbers in, markup out. `live-cockpit.ts` patches it
 * into the glass on its own key, because the bearing moves every frame.
 */
import { escapeHtml as esc } from "./escape-html";
import type { OperationalCondition } from "./world-state";

export type RelayCuePhase =
	/** Inside signal range, not yet identified: strength and bearing. */
	| "signal"
	/** Identified and operational: it is a target now; the cue says so. */
	| "identified"
	/** Identified and destroyed or repairing. */
	| "down";

export interface RelayCue {
	phase: RelayCuePhase;
	/** 0 at the edge of the signal's range, 1 at identification. */
	strength: number;
	/** Degrees off the nose, 0 dead ahead. */
	offNoseDeg: number;
	/** Screen-edge bearing for the arrow, CSS degrees, or null when the
	 *  relay is inside the glass (ahead). */
	arrowDeg: number | null;
	/** The station the relay watches, for the search line. */
	watched: string;
	/** Range in km once identified; null while only the signal is read. */
	km: number | null;
	condition: OperationalCondition;
}

export const RELAY_CUE_STYLE = `
.lc-relay-cue { position: absolute; top: 13%; right: 3%; width: 285px; padding: 10px 12px; border-right: 2px solid #ff6a4a; text-align: right; color: #ffd9cf; background: rgba(20,6,4,.83); font-size: 11px; }
.lc-relay-cue small { display: block; color: #d0776a; margin-bottom: 5px; }
.lc-relay-cue strong { display: block; margin-bottom: 7px; }
.lc-relay-cue .lc-relay-bars { letter-spacing: 2px; }
.lc-relay-cue .lc-relay-arrow { display: inline-block; margin-left: 6px; }
#live-cockpit:not([data-live-head-look="forward"]) .lc-relay-cue { display: none; }
`;

const BARS = 5;

/** `▮▮▮▯▯`: strength in fifths. */
export const strengthBars = (strength: number): string => {
	const lit = Math.round(Math.max(0, Math.min(1, strength)) * BARS);
	return "▮".repeat(lit) + "▯".repeat(BARS - lit);
};

/** What changes the markup: everything the eye can see, rounded so a bearing
 *  drifting a hundredth of a degree does not repaint. */
export const relayCueKey = (cue: RelayCue | null | undefined): string =>
	cue
		? `${cue.phase}|${strengthBars(cue.strength)}|${Math.round(cue.offNoseDeg)}|${cue.arrowDeg === null ? "-" : Math.round(cue.arrowDeg)}|${cue.watched}|${cue.km === null ? "-" : Math.round(cue.km)}|${cue.condition}`
		: "";

export function relayCueMarkup(cue: RelayCue): string {
	const arrow =
		cue.arrowDeg === null
			? ""
			: `<i class="lc-relay-arrow" style="transform: rotate(${Math.round(cue.arrowDeg)}deg)">➤</i>`;
	const bearing = `${Math.round(cue.offNoseDeg)}° off nose${arrow}`;
	if (cue.phase === "signal")
		return `<small>PIRATE RELAY SIGNAL · PROTOTYPE</small><strong><span class="lc-relay-bars">${strengthBars(cue.strength)}</span></strong>${bearing}<br>Search the approach of ${esc(cue.watched)}`;
	if (cue.phase === "identified")
		return `<small>PIRATE RELAY · IDENTIFIED</small><strong>${esc(cue.condition.toUpperCase())} · ${Math.round(cue.km ?? 0).toLocaleString("en-US")} km</strong>${bearing}<br>Watches the route to ${esc(cue.watched)}`;
	return `<small>PIRATE RELAY · ${esc(cue.condition.toUpperCase())}</small><strong>${Math.round(cue.km ?? 0).toLocaleString("en-US")} km</strong>${bearing}<br>Route to ${esc(cue.watched)} unwatched`;
}
