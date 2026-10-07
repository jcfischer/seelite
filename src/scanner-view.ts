import { SWEEP_CHARGE_S } from "./long-range-scanner";
import { escapeHtml as esc } from "./escape-html";
import { targetAgeLabel } from "./display-contact";
import { strengthBars } from "./relay-cue";
import type { SweepReading } from "./world-state";

export interface SweepView {
	fitted: boolean;
	progress: number | null;
	sweepReadings: readonly SweepReading[];
	now: number;
}

/** Sweep readings have no target action: a region cannot be selected as a contact. */
export function sweepMarkup(view: SweepView): string {
	if (!view.fitted)
		return `<h3>LONG-RANGE SCANNER</h3><p>Fit a Long-Range Scanner at a shipyard to sweep this system.</p>`;
	const rows = view.sweepReadings
		.map(
			(lead) =>
				`<li data-live-sweep-lead><strong>${lead.kind === "derelict" ? "Derelict return" : "Relay signal"}</strong><br>${esc(lead.region)}<br><small>${esc(lead.source)} · ${targetAgeLabel(view.now - lead.observedAt)} ago</small></li>`,
		)
		.join("");
	return `<h3>SYSTEM SWEEP</h3><button class="lc-chip" type="button" data-live-sweep ${view.progress === null ? "" : "disabled"}>${view.progress === null ? `SWEEP · ${SWEEP_CHARGE_S} s` : `SWEEPING ${Math.floor(view.progress * 100)}%`}</button><p>A past reading of a region. Approach to identify a contact.</p><ul class="lc-nav-list">${rows || "<li>No recorded returns</li>"}</ul>`;
}

export interface WreckCue {
	identified: boolean;
	strength: number;
	offNoseDeg: number;
	arrowDeg: number | null;
	region: string;
	km: number | null;
}

export const WRECK_CUE_STYLE = `
.lc-wreck-cue { position: absolute; top: 32%; right: 3%; width: 285px; padding: 10px 12px; border-right: 2px solid #e5aa52; text-align: right; color: #ffdcb0; background: rgba(20,12,4,.83); font-size: 11px; }
.lc-wreck-cue small, .lc-wreck-cue strong { display: block; margin-bottom: 6px; }
.lc-wreck-cue i { display: inline-block; margin-left: 6px; }
#live-cockpit:not([data-live-head-look="forward"]) .lc-wreck-cue { display: none; }
`;

export function wreckCueMarkup(cue: WreckCue): string {
	const arrow =
		cue.arrowDeg === null
			? ""
			: `<i style="transform: rotate(${Math.round(cue.arrowDeg)}deg)">➤</i>`;
	return `<small>DERELICT · ${cue.identified ? "IDENTIFIED" : "SCANNER RETURN"}</small><strong>${cue.identified ? `${Math.round(cue.km ?? 0).toLocaleString("en-US")} km` : strengthBars(cue.strength)}</strong>${Math.round(cue.offNoseDeg)}° off nose${arrow}<br>${esc(cue.region)}`;
}
