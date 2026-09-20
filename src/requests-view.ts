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
	// Only the words differ by family; the enablement is one rule, and it was
	// written twice.
	const entrustedHint = (): string => {
		if (!short) return "aboard since you accepted — the requester's";
		if (aboardT > 0)
			return `only ${aboardT} t of the ${offer.tonnes} t consignment aboard`;
		return "the consignment is not aboard";
	};
	const words = offer.entrusted
		? {
				// **Never "Deliver" for a consignment.** In this game that word
				// is an instruction to supply something, and supplying is
				// exactly what a consignment does not need (CONTEXT.md
				// §Language, **Entrusted cargo**).
				label: `Hand over ${offer.tonnes} t ${offer.goodName}`,
				hint: entrustedHint(),
			}
		: {
				label: `Deliver ${offer.tonnes} t ${offer.goodName} from your hold`,
				hint: short
					? `${aboardT} t of ${offer.tonnes} aboard`
					: `${offer.tonnes} t aboard, yours to hand over`,
			};
	return { ...words, enabled: !short };
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
	 * What is aboard — #443's projection, and the only input this screen takes
	 * about the commander.
	 *
	 * The whole summary rather than a tonnage per offer, because both arms of
	 * `aboardFor` need one — the requester's lot for a consignment, the pilot's
	 * own tonnage for a procurement job — and threading two numbers per
	 * rendered offer through the descriptor is the second authority this is
	 * here to avoid. No credits, no prices, no market: those stay out.
	 *
	 * `null` where no hold was supplied, which reads as nothing aboard.
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
) => {
	// `action` is escaped too. Every caller passes a literal today, so nothing
	// is reachable; an unescaped attribute position beside the other escaped
	// ones is a footgun for the next caller, and `esc` covers `"` and `'`.
	const disabled = extra.enabled === false ? " disabled" : "";
	const hintId = extra.hint ? `${action}-${id}-hint` : "";
	// **The hint is a sibling, not a child.** It was inside the button, which
	// is where it is least reachable: a disabled button is not focusable and
	// browsers suppress its `title`, and the hint is most needed exactly when
	// the control is dead. `aria-describedby` ties the two without nesting.
	const describedBy = hintId ? ` aria-describedby="${esc(hintId)}"` : "";
	const control = `<button type="button" class="lc-request-action" data-live-request-action="${esc(action)}" data-live-request-id="${esc(id)}"${disabled}${describedBy}>${esc(label)}</button>`;
	if (!extra.hint) return control;
	return `<span class="lc-request-control">${control}<small class="lc-request-hint" id="${esc(hintId)}" data-live-request-hint data-live-request-id="${esc(id)}">${esc(extra.hint)}</small></span>`;
};

/**
 * How much of this job's good is aboard, for the job's own sense of aboard.
 *
 * **Both arms read `hold` and neither re-sums the journal.** `hold.ts` owns
 * the entrusted share (CONTEXT.md §Language, **Hold**); a second sum here
 * would be a second authority on what is aboard, and the button would be able
 * to disagree with the till about it.
 *
 * `null` reads as nothing aboard, which leaves the control disabled with a
 * hint that says how short — the safe direction, and the reason
 * `tests/requests-view.test.ts` flies it.
 */
export const aboardFor = (
	view: Pick<RequestsView, "hold">,
	offer: RequestOffer,
): number =>
	(view.hold?.lines ?? [])
		.filter((line) =>
			offer.entrusted
				? line.owner === "requester" && line.offerId === offer.id
				: line.owner === "pilot" && line.goodName === offer.goodName,
		)
		.reduce((sum, line) => sum + line.amount, 0);
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
.lc-request-control { display: inline-flex; flex-direction: column; gap: 4px; }
.lc-request-hint { display: block; color: #cb8c51; font-size: 11px; pointer-events: none; }
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
				const deliver = deliverAction(o, aboardFor(view, o));
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
