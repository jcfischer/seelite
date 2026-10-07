import { escapeHtml as esc } from "./escape-html";
import { strengthBars } from "./relay-cue";

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
