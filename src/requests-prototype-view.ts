/** Cockpit projection for the fixture-backed node 343 experiment. */
import {
	activeRequest,
	nextAction,
	type PrototypeOffer,
	type RequestsPrototypeState,
	type RequestStation,
} from "./requests-prototype";

export interface RequestsView {
	state: RequestsPrototypeState;
	offers: PrototypeOffer[];
	selectedId: string | null;
	message: string;
	revision: number;
	now: number;
	docked: RequestStation | null;
	fixtures: boolean;
}
const esc = (x: string) =>
	x.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] as string,
	);
const button = (action: string, id: string, label: string) =>
	`<button type="button" class="lc-request-action" data-live-request-action="${action}" data-live-request-id="${esc(id)}">${esc(label)}</button>`;
export const REQUESTS_STYLE = `
.lc-requests { flex: 1; min-height: 0; overflow: auto; }
.lc-request-intro { color: #cb8c51; margin: 4px 0 18px; }
.lc-request-layout { display: grid; grid-template-columns: minmax(230px, .7fr) minmax(0, 1.5fr); gap: 28px; }
.lc-request-list { display: grid; align-content: start; gap: 10px; }
.lc-request-row { display: block; width: 100%; text-align: left; padding: 16px; color: #ffe1a9; border: 1px solid #8a5831; background: #271407; font: inherit; cursor: pointer; }
.lc-request-row[aria-selected="true"] { border-color: #ffe0a2; background: #452607; }
.lc-request-row strong, .lc-request-row small { display: block; }
.lc-request-row small { margin-top: 8px; color: #cb8c51; font-size: 11px; }
.lc-request-details { border-left: 1px solid #8a5831; padding-left: 28px; }
.lc-request-details h3 { margin-top: 0; color: #fff0c9; font-size: 21px; }
.lc-request-details dl { display: grid; grid-template-columns: 115px 1fr; gap: 11px 18px; margin: 20px 0; }
.lc-request-details dt { color: #cb8c51; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
.lc-request-details dd { margin: 0; color: #ffe1a9; }
.lc-request-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0; }
.lc-request-action { padding: 9px 13px; border: 1px solid #bb7e36; background: #422607; color: #fff0c9; font: inherit; cursor: pointer; }
.lc-request-message { color: #b8dfa9; min-height: 18px; }
.lc-request-fixtures { margin-top: 24px; padding-top: 12px; border-top: 1px dashed #735432; color: #c7a882; font-size: 11px; }
.lc-request-fixtures .lc-request-action { font-size: 11px; background: #21190f; }
.lc-request-cue { position: absolute; top: 13%; left: 3%; width: 285px; padding: 10px 12px; border-left: 2px solid #e5aa52; color: #ffe1a9; background: rgba(20,11,4,.83); font-size: 11px; }
.lc-request-cue small { display: block; color: #cb8c51; margin-bottom: 5px; }
.lc-request-cue strong { display: block; margin-bottom: 7px; }
#live-cockpit:not([data-live-head-look="forward"]) .lc-request-cue { display: none; }
@media(max-width:750px) { .lc-request-layout { grid-template-columns: 1fr; gap: 18px; } .lc-request-details { border: 0; padding: 0; } }
`;
export function requestCue(view?: RequestsView): string {
	const r = view?.state.trackedRequestId
		? view.state.byId[view.state.trackedRequestId]
		: null;
	return r && !view?.docked
		? `<aside class="lc-request-cue" data-live-request-cue><small>TRACKED REQUEST · UI EXPERIMENT</small><strong>${esc(r.terms.title)}</strong>${esc(nextAction(r))}</aside>`
		: "";
}
export function requestsBody(view?: RequestsView, flight = false): string {
	if (!view)
		return `<div class="lc-requests"><p>No Requests experiment loaded.</p></div>`;
	const { state } = view;
	const entries = new Map<string, PrototypeOffer>();
	if (!flight) for (const offer of view.offers) entries.set(offer.id, offer);
	for (const r of Object.values(state.byId)) entries.set(r.offerId, r.terms);
	for (const lead of Object.values(state.leadsById))
		if (!flight || !state.byId[lead.id]) entries.set(lead.id, lead);
	const selected = view.selectedId ? entries.get(view.selectedId) : null;
	const count = Object.values(state.byId).filter(activeRequest).length;
	const rows = [...entries.values()]
		.map((o) => {
			const r = state.byId[o.id];
			const label =
				r?.status ??
				(state.leadsById[o.id]
					? "retained lead · not accepted"
					: "offer · not accepted");
			return `<button type="button" class="lc-request-row" data-live-request-action="details" data-live-request-id="${esc(o.id)}" aria-selected="${selected?.id === o.id}"><strong>${esc(o.title)}</strong><small>${esc(label)}${state.trackedRequestId === o.id ? " · TRACKED" : ""}</small><small>${o.rewardCr} Cr · report at ${esc(o.requesterName)}</small></button>`;
		})
		.join("");
	let details = `<div class="lc-request-details" data-live-request-details><h3>Choose work at your own pace</h3><p>Open an offer to read its terms. Reading or retaining a lead makes no commitment.</p><p>Accept multiple requests. Manually Track one to show its next action in flight.</p></div>`;
	if (selected) {
		const o = selected;
		const r = state.byId[o.id];
		const atRequester =
			view.docked?.galaxyIndex === o.requester.galaxyIndex &&
			view.docked?.carrierKey === o.requester.carrierKey;
		const fields: [string, string][] = [
			["Requester", `${o.requesterName} · return and dock here to report`],
			["Purpose", o.purpose],
			["Action", o.action],
			[
				"Intelligence",
				`${o.region}. ${o.source} · ${Math.max(0, Math.floor(view.now - o.observedAt))}s old · unconfirmed fixture report`,
			],
			["Danger", o.danger],
			["Cargo", "None · no hold commitment or entrusted cargo"],
			["Equipment", o.requiresWeapon ? "Operational weapon required" : "None"],
			[
				"Payment",
				`${o.rewardCr} Cr · once, on explicit return/report · prototype tuning`,
			],
			["Consequence", o.consequence],
			[
				"Terms",
				"No deadline, exclusivity, cancellation fee or reputation penalty",
			],
		];
		let actions = button("retain", o.id, "Retain lead");
		if ((!r || r.status === "cancelled") && atRequester)
			actions += button(
				"accept",
				o.id,
				r ? "Reaccept request" : "Accept request",
			);
		if (r && activeRequest(r)) {
			actions += button(
				state.trackedRequestId === o.id ? "untrack" : "track",
				o.id,
				state.trackedRequestId === o.id ? "Untrack" : "Track request",
			);
			if (r.status === "ready-to-report" && atRequester)
				actions += button("report", o.id, `Report · receive ${o.rewardCr} Cr`);
			if (r.status === "accepted" && r.unavailableAt !== null && atRequester)
				actions += button(
					"report-unavailable",
					o.id,
					"Report unavailable · no payment",
				);
			actions += button("cancel", o.id, "Cancel request · no fee");
		}
		let fixtures = "";
		if (view.fixtures && r && activeRequest(r)) {
			const stage =
				r.status === "accepted" && r.unavailableAt === null
					? button(
							`fixture-${r.stageId}`,
							o.id,
							`Simulate ${r.stageId} evidence`,
						)
					: "";
			fixtures = `<aside class="lc-request-fixtures"><b>PROTOTYPE CONTROLS · world facts are fixtures</b><p>The relay is unbuilt. These controls exercise UI transitions; they do not discover, disable or change anything in the live world.</p><div class="lc-request-actions">${stage}${button("fixture-unavailable", o.id, "Simulate observed target unavailable")}</div></aside>`;
		}
		details = `<div class="lc-request-details" data-live-request-details><h3>${esc(o.title)}</h3><p>${r ? esc(nextAction(r)) : "Read the terms before you accept."}</p><dl>${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === "Intelligence" ? `${esc(o.region)}. ${esc(o.source)} · <span data-live-request-age="${o.observedAt}">${Math.max(0, Math.floor(view.now - o.observedAt))}s old</span> · unconfirmed fixture report` : esc(v)}</dd>`).join("")}</dl><div class="lc-request-actions">${actions}</div>${r?.status === "ready-to-report" && !atRequester ? `<p>Report after docking at ${esc(o.requesterName)}. Remote payment is unavailable.</p>` : ""}${fixtures}</div>`;
	}
	return `<div class="lc-requests" data-live-requests><p class="lc-request-intro">${count} accepted · one manual cue · ${flight ? "accepted work and retained leads" : "available offers and your work"}</p><p class="lc-request-message" role="status">${esc(view.message)}</p><div class="lc-request-layout"><div class="lc-request-list">${rows || `<p>${flight ? "No accepted work. Browse Requests at a station." : "No authored offers here. Use ?requests-prototype=1 to load the UI experiment."}</p>`}</div>${details}</div></div>`;
}
