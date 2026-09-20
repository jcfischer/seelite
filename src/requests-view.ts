/**
 * Cockpit projection for the live request board (#411).
 *
 * It was the fixture experiment's screen; what changed is that every field it
 * prints is now a bound operand — the good, the tonnage, the delivery station
 * and the distance — and the simulate-a-stage controls are gone, because the
 * stage is satisfied by flying there.
 */
import type { HoldSummary } from "./hold";
import {
	type AcceptedRequest,
	isAcceptedRequest,
	nextAction,
	type RequestOffer,
	type RequestsState,
	type RequestStation,
} from "./requests";

/**
 * What the Deliver control says, and whether it is live (#446).
 *
 * **A string builder with a branch deserves its own rows**, and the branch is
 * the node: one label served both families, so a consignment already aboard
 * read as a shopping list and the pilot bought eight tonnes of Food they were
 * already carrying. The details pane said *entrusted* the whole time; a screen
 * that is merely accurate somewhere is not the test. The test is whether the
 * control a pilot presses says what it does.
 */
export interface DeliverAction {
	label: string;
	hint: string;
	enabled: boolean;
}

/**
 * `aboardT` is what is aboard **for this job** — the requester's lot for an
 * entrusted consignment, the pilot's own tonnage of the good for a
 * procurement job. The caller reads it off `holdSummary` rather than scanning
 * the cargo again, so the button, the hold line and the till all answer from
 * one projection (#443).
 */
export function deliverAction(
	offer: RequestOffer,
	aboardT: number,
): DeliverAction {
	const short = aboardT < offer.tonnes;
	if (offer.entrusted)
		return {
			// **Never "Deliver".** In this game that word is an instruction to
			// supply something, and supplying is exactly what a consignment does
			// not need.
			label: `Hand over ${offer.tonnes} t ${offer.goodName}`,
			hint: short
				? `${aboardT} t of ${offer.tonnes} aboard — the consignment is not aboard`
				: "aboard since you accepted — the requester's",
			enabled: !short,
		};
	return {
		label: `Deliver ${offer.tonnes} t ${offer.goodName} from your hold`,
		hint: short
			? `${aboardT} t of ${offer.tonnes} aboard`
			: `${offer.tonnes} t aboard, yours to hand over`,
		enabled: !short,
	};
}

/**
 * What a settled job reports (#446).
 *
 * The report paid and the manifest never appeared, so **a delivery and a sale
 * looked identical from the cockpit**. Three facts a pilot cannot otherwise
 * see: what left the hold, what it paid, and what of theirs is still aboard.
 *
 * Composed here rather than in `main.ts` so the words have rows, and fed from
 * `main.ts` rather than read from the view — #411's round 2 stripped this
 * projection of commerce inputs deliberately, and `remainingT` arrives as a
 * number rather than as a commander.
 */
export function settlementMessage(settled: {
	tonnes: number;
	goodName: string;
	entrusted: boolean;
	rewardCr: number;
	/** The pilot's **own** tonnage of that good after the job settled. */
	remainingT: number;
}): string {
	const moved = settled.entrusted
		? `${settled.tonnes} t ${settled.goodName} handed over`
		: `${settled.tonnes} t ${settled.goodName} delivered from your hold`;
	// A remainder of zero is a sentence, not a figure: `0 t Food still aboard`
	// is a line about cargo that is not there, which is #443's zeroed
	// entrusted clause one screen along.
	const left =
		settled.remainingT > 0
			? `${settled.remainingT} t ${settled.goodName} still aboard, yours`
			: `no ${settled.goodName} left aboard`;
	return `Reported · ${moved}, ${settled.rewardCr} Cr paid · ${left}.`;
}

export interface RequestsView {
	state: RequestsState;
	offers: RequestOffer[];
	selectedId: string | null;
	message: string;
	revision: number;
	now: number;
	docked: RequestStation | null;
	/**
	 * What is aboard (#443's projection), for the one thing this screen cannot
	 * answer on its own: how much of a **procurement** job's good the pilot
	 * already has.
	 *
	 * #411's round 2 stripped this view of commerce inputs on purpose, and this
	 * is not one of them — it is the same summary the trade screen's hold line
	 * and the till's `cargo-full` sentence read, so the Deliver control cannot
	 * disagree with either. `null` where no hold has been supplied.
	 */
	hold: HoldSummary | null;
}
const esc = (x: string) =>
	x.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] as string,
	);
const button = (
	action: string,
	id: string,
	label: string,
	extra: { hint?: string; enabled?: boolean } = {},
) =>
	`<button type="button" class="lc-request-action" data-live-request-action="${action}" data-live-request-id="${esc(id)}"${extra.enabled === false ? " disabled" : ""}${extra.hint ? ` title="${esc(extra.hint)}"` : ""}>${esc(label)}${extra.hint ? `<small class="lc-request-hint" data-live-request-hint>${esc(extra.hint)}</small>` : ""}</button>`;

/**
 * How much of this job's good is aboard, for the job's own sense of aboard.
 *
 * An entrusted consignment's tonnage is the requester's lot of the current
 * acceptance; a procurement job's is the pilot's own cargo of that good, off
 * #443's projection rather than a second scan.
 */
const aboardFor = (
	view: RequestsView,
	offer: RequestOffer,
	request?: AcceptedRequest,
): number =>
	offer.entrusted
		? Object.values(view.state.entrustedByLotId)
				.filter(
					(lot) =>
						lot.offerId === offer.id &&
						(!request || lot.issuedOrdinal === request.acceptanceOrdinal),
				)
				.reduce((sum, lot) => sum + lot.aboardT, 0)
		: (view.hold?.lines.find(
				(line) => line.owner === "pilot" && line.goodName === offer.goodName,
			)?.amount ?? 0);
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
.lc-request-action:disabled { cursor: not-allowed; opacity: .55; }
.lc-request-hint { display: block; margin-top: 4px; color: #cb8c51; font-size: 11px; }
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
		? `<aside class="lc-request-cue" data-live-request-cue><small>TRACKED REQUEST</small><strong>${esc(r.terms.title)}</strong>${esc(nextAction(r))}</aside>`
		: "";
}
export function requestsBody(view?: RequestsView, flight = false): string {
	if (!view)
		return `<div class="lc-requests"><p>No request board loaded.</p></div>`;
	const { state } = view;
	const entries = new Map<string, RequestOffer>();
	if (!flight) for (const offer of view.offers) entries.set(offer.id, offer);
	for (const r of Object.values(state.byId)) entries.set(r.offerId, r.terms);
	for (const lead of Object.values(state.leadsById))
		if (!flight || !state.byId[lead.id]) entries.set(lead.id, lead);
	const selected = view.selectedId ? entries.get(view.selectedId) : null;
	const count = Object.values(state.byId).filter(isAcceptedRequest).length;
	const rows = [...entries.values()]
		.map((o) => {
			const r = state.byId[o.id];
			const label =
				r?.status ??
				(state.leadsById[o.id]
					? "retained lead · not accepted"
					: "offer · not accepted");
			return `<button type="button" class="lc-request-row" data-live-request-action="details" data-live-request-id="${esc(o.id)}" aria-selected="${selected?.id === o.id}"><strong>${esc(o.title)}</strong><small>${esc(label)}${state.trackedRequestId === o.id ? " · TRACKED" : ""}</small><small>${o.rewardCr} Cr · ${o.tonnes} t ${esc(o.goodName)} · report at ${esc(o.reportName)}</small></button>`;
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
			["Requester", `${o.requesterName} · posted here`],
			[
				"Report at",
				`${o.reportName}, ${o.reportSystemName}${o.distanceLy > 0 ? ` · ${o.distanceLy.toFixed(1)} LY, one jump` : " · this system"}`,
			],
			["Purpose", o.purpose],
			["Action", o.action],
			[
				"Intelligence",
				`${o.region}. ${o.source} · ${Math.max(0, Math.floor(view.now - o.observedAt))}s old`,
			],
			["Danger", o.danger],
			[
				"Cargo",
				o.entrusted
					? `${o.tonnes} t ${o.goodName}, entrusted · the requester's throughout, and it cannot be sold`
					: `${o.tonnes} t ${o.goodName}, your own · buy it where you like and carry the loss`,
			],
			["Equipment", "None"],
			["Payment", `${o.rewardCr} Cr · once, on report at ${o.reportName}`],
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
		const atReport =
			view.docked?.galaxyIndex === o.reportAt.galaxyIndex &&
			view.docked?.carrierKey === o.reportAt.carrierKey;
		if (r && isAcceptedRequest(r)) {
			actions += button(
				state.trackedRequestId === o.id ? "untrack" : "track",
				o.id,
				state.trackedRequestId === o.id ? "Untrack" : "Track request",
			);
			if (r.status === "accepted" && atReport) {
				// **The control says whose goods it moves** (#446). One label
				// served both families, so a consignment already aboard read as
				// a shopping list — and `esc` was applied to the good's name
				// here and again by `button`, which double-escaped it.
				const deliver = deliverAction(o, aboardFor(view, o, r));
				actions += button("deliver", o.id, deliver.label, {
					hint: deliver.hint,
					enabled: deliver.enabled,
				});
			}
			if (r.status === "ready-to-report" && atReport)
				actions += button("report", o.id, `Report · receive ${o.rewardCr} Cr`);
			actions += button("cancel", o.id, "Cancel request · no fee");
		}
		if (
			r?.status === "cancelled" &&
			o.entrusted &&
			atRequester &&
			Object.values(state.entrustedByLotId).some((lot) => lot.offerId === o.id)
		)
			actions += button(
				"return-entrusted",
				o.id,
				`Return ${o.tonnes} t ${esc(o.goodName)}`,
			);
		details = `<div class="lc-request-details" data-live-request-details><h3>${esc(o.title)}</h3><p>${r ? esc(nextAction(r)) : "Read the terms before you accept."}</p><dl>${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === "Intelligence" ? `${esc(o.region)}. ${esc(o.source)} · <span data-live-request-age="${o.observedAt}">${Math.max(0, Math.floor(view.now - o.observedAt))}s old</span>` : esc(v)}</dd>`).join("")}</dl><div class="lc-request-actions">${actions}</div>${r?.status === "ready-to-report" && !atReport ? `<p>Report after docking at ${esc(o.reportName)}. Remote payment is unavailable.</p>` : ""}</div>`;
	}
	return `<div class="lc-requests" data-live-requests><p class="lc-request-intro">${count} accepted · one manual cue · ${flight ? "accepted work and retained leads" : "available offers and your work"}</p><p class="lc-request-message" role="status">${esc(view.message)}</p><div class="lc-request-layout"><div class="lc-request-list">${rows || `<p>${flight ? "No accepted work. Browse Requests at a station." : "No work posted here."}</p>`}</div>${details}</div></div>`;
}
