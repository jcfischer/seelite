/**
 * Cockpit projection for the live request board (#411).
 *
 * It was the fixture experiment's screen; what changed is that every field it
 * prints is now a bound operand — the good, the tonnage, the delivery station
 * and the distance — and the simulate-a-stage controls are gone, because the
 * stage is satisfied by flying there.
 */
import { escapeHtml as esc } from "./escape-html";
import { aboardForOffer, type HoldSummary } from "./hold";
import { cargoOf, missingRequirements, offerRequirements } from "./jobs";
import {
	isAcceptedRequest,
	nextAction,
	statusLabel,
	type AcceptedRequest,
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
	const operand = cargoOf(offer);
	// The screen offers Deliver only on a cargo job; a caller that reached this
	// with a Bounty has drawn a control the request refuses.
	if (!operand) throw new Error(`deliverAction: ${offer.id} carries no cargo`);
	const short = aboardT < operand.tonnes;
	// Only the words differ by family; the enablement is one rule, and it was
	// written twice.
	const entrustedHint = (): string => {
		if (!short)
			return "Aboard since you accepted. It belongs to the requester.";
		if (aboardT > 0)
			return `Only ${aboardT} t of the ${operand.tonnes} t is aboard.`;
		return "The goods are not aboard.";
	};
	const words = operand.entrusted
		? {
				// **Never "Deliver" for a consignment.** In this game that word
				// is an instruction to supply something, and supplying is
				// exactly what a consignment does not need (CONTEXT.md
				// §Language, **Entrusted cargo**).
				label: `Hand over ${operand.tonnes} t of ${operand.goodName}`,
				hint: entrustedHint(),
			}
		: {
				label: `Deliver ${operand.tonnes} t of ${operand.goodName} from your hold`,
				// `aboardT` on both arms: a pilot carrying 10 t for an 8 t job
				// was told "8 t aboard", which is the job's figure and not
				// theirs.
				hint: short
					? `You have ${aboardT} t of the ${operand.tonnes} t.`
					: `You have ${aboardT} t of your own aboard.`,
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
	 * The whole summary rather than a tonnage per offer, because
	 * `aboardForOffer` reads the **lines** and a per-offer number computed
	 * outside would be that reading done twice. The scalar fields —
	 * `usedT`, `capacityT`, `freeT`, `entrustedT` — arrive unused here and are
	 * the same object the trade screen draws, which is the point: one
	 * projection, not a per-consumer slice of it. No credits, no prices, no
	 * market: those stay out.
	 *
	 * `null` where no hold was supplied, which reads as nothing aboard.
	 */
	hold: HoldSummary | null;
	/**
	 * The commander's fitted equipment, read against an offer's requirement
	 * (#489's ruling, built in #508): an offer whose requirement is missing
	 * lists **locked**, names the module on its row and draws no Accept.
	 */
	equipment: readonly string[];
	/**
	 * Which half of the journal the list shows (node #690): **Current** for
	 * work still going, **Past** for outcomes. Transient UI state on `Game`,
	 * never saved, and `"current"` whenever Requests is opened.
	 */
	tab: RequestsTab;
}

/** The two halves of the Requests list (node #690). */
export type RequestsTab = "current" | "past";
export const REQUESTS_TABS: readonly RequestsTab[] = ["current", "past"];
export const isRequestsTab = (value: string): value is RequestsTab =>
	(REQUESTS_TABS as readonly string[]).includes(value);

/**
 * Which tab a journal row lives under.
 *
 * **`isAcceptedRequest` is the whole rule**, read rather than restated: it is
 * the allow-list on the status union, so a status added later lands in Past
 * rather than posing as work in progress — the reason #445 made it an
 * allow-list in the first place.
 */
export const tabOfRequest = (r: AcceptedRequest): RequestsTab =>
	isAcceptedRequest(r) ? "current" : "past";

/**
 * The board, partitioned. Four sections, **disjoint and together exactly the
 * rows the single list used to show**: a journal row is classified by its
 * status first, so a cancelled job still posted at its requester is an
 * outcome and not an offer, and a kept lead the pilot later accepted is a job
 * and not a lead. Only then is a lead *kept*, and only then is an offer
 * *posted*.
 *
 * Offers are the docked board's alone, as they always were; in flight the
 * list is the journal and the kept leads.
 */
export interface RequestsSections {
	/** Accepted and ready-to-report: Current's first section. */
	ongoing: RequestOffer[];
	/** Posted at this station and not taken: Current, docked only. */
	posted: RequestOffer[];
	/** Kept for later and not taken: Current. */
	kept: RequestOffer[];
	/** Completed, cancelled and failed: the Past tab. */
	past: RequestOffer[];
}

export function requestSections(
	view: Pick<RequestsView, "state" | "offers">,
	flight: boolean,
): RequestsSections {
	const { state } = view;
	const out: RequestsSections = { ongoing: [], posted: [], kept: [], past: [] };
	const seen = new Set<string>();
	for (const r of Object.values(state.byId)) {
		seen.add(r.offerId);
		(tabOfRequest(r) === "current" ? out.ongoing : out.past).push(r.terms);
	}
	for (const lead of Object.values(state.leadsById))
		if (!seen.has(lead.id)) {
			seen.add(lead.id);
			out.kept.push(lead);
		}
	if (!flight)
		for (const offer of view.offers)
			if (!seen.has(offer.id)) {
				seen.add(offer.id);
				out.posted.push(offer);
			}
	return out;
}

/**
 * Which tab shows an entry, or `null` when no row on this surface carries it.
 *
 * The selection is kept across a tab switch; this is what decides whether it
 * is drawn. A details pane is drawn **only for a row the list is showing**, so
 * a job that moved to the other tab — or a selection on a surface that does
 * not list it — leaves no actionable pane behind.
 */
export function requestsTabOf(
	view: Pick<RequestsView, "state" | "offers">,
	id: string,
	flight: boolean,
): RequestsTab | null {
	const sections = requestSections(view, flight);
	if (sections.past.some((o) => o.id === id)) return "past";
	return [...sections.ongoing, ...sections.posted, ...sections.kept].some(
		(o) => o.id === id,
	)
		? "current"
		: null;
}

/**
 * Entrusted goods aboard for a job that is no longer running (node #690).
 *
 * Cancelling moves the job to Past, and the goods it issued stay aboard until
 * they are returned. Current names them, so moving a row into history does not
 * hide what the pilot still owes.
 */
export function outstandingReturns(
	state: RequestsView["state"],
): { offer: RequestOffer; goodName: string; aboardT: number }[] {
	const out: { offer: RequestOffer; goodName: string; aboardT: number }[] = [];
	for (const lot of Object.values(state.entrustedByLotId)) {
		const r = state.byId[lot.offerId];
		if (r && lot.aboardT > 0 && tabOfRequest(r) === "past")
			out.push({
				offer: r.terms,
				goodName: lot.goodName,
				aboardT: lot.aboardT,
			});
	}
	return out;
}

/** What an offer requires that the pilot has not fitted. */
export const missingEquipment = (
	view: Pick<RequestsView, "equipment">,
	offer: RequestOffer,
): readonly string[] => missingRequirements(offer, view.equipment);

/** The one line a board row says about what the job is about. */
const operandLine = (o: RequestOffer): string => {
	const { operand } = o;
	switch (operand.kind) {
		case "cargo":
			return `${operand.tonnes} t of ${operand.goodName}`;
		case "target":
			return `bounty: ${operand.targetName}`;
		default: {
			// A third kind stops this compiling rather than drawing a blank.
			const unreachable: never = operand;
			return unreachable;
		}
	}
};
const button = (
	action: string,
	id: string,
	label: string,
	extra: { hint?: string; enabled?: boolean; surface?: string } = {},
) => {
	// `action` is escaped too. Every caller passes a literal today, so nothing
	// is reachable; an unescaped attribute position beside the other escaped
	// ones is a footgun for the next caller, and `esc` covers `"` and `'`.
	const disabled = extra.enabled === false ? " disabled" : "";
	// **Namespaced by surface.** `requestsBody` renders on the station console
	// and again on the flight console, so an offer-derived id alone would be a
	// duplicate `id` in one document and an ambiguous `aria-describedby`.
	const hintId = extra.hint
		? `${extra.surface ?? "console"}-${action}-${id}-hint`
		: "";
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
 * How much of this job's good is aboard — `hold.ts`'s query, re-exported.
 *
 * The view does not interpret the projection's lines; it asks it. A per-job
 * reading here would be the second authority the whole #443/#446 pair exists
 * to avoid.
 */
export const aboardFor = (
	view: Pick<RequestsView, "hold">,
	offer: RequestOffer,
): number => {
	// **The pick is built here rather than `hold.ts` taking the offer.** That
	// module stays below `jobs.ts` (its own header's rule), so the operand is
	// unwrapped on this side of the boundary and the three fields it reads
	// stay its signature. A job with no cargo has none aboard.
	const cargo = cargoOf(offer);
	return cargo
		? aboardForOffer(view.hold, {
				id: offer.id,
				goodName: cargo.goodName,
				entrusted: cargo.entrusted,
			})
		: 0;
};
export const REQUESTS_STYLE = `
.lc-requests { flex: 1; min-height: 0; overflow: auto; }
.lc-request-intro { color: #cb8c51; margin: 4px 0 18px; }
.lc-request-layout { display: grid; grid-template-columns: minmax(230px, .7fr) minmax(0, 1.5fr); gap: 28px; }
.lc-request-tabs { display: flex; gap: 6px; margin: 0 0 16px; border-bottom: 1px solid #8a5831; }
.lc-request-tab { padding: 8px 16px; margin-bottom: -1px; border: 1px solid transparent; border-bottom-color: #8a5831; background: transparent; color: #cb8c51; font: inherit; letter-spacing: .06em; text-transform: uppercase; cursor: pointer; }
.lc-request-tab[aria-selected="true"] { border-color: #ffe0a2 #ffe0a2 #452607; background: #452607; color: #fff0c9; }
.lc-request-tab-count { margin-left: 6px; color: #cb8c51; }
.lc-request-list { display: grid; align-content: start; gap: 10px; }
.lc-request-section { display: grid; gap: 10px; }
.lc-request-section + .lc-request-section { margin-top: 12px; }
.lc-request-section h4 { margin: 0; color: #cb8c51; font-size: 11px; font-weight: normal; letter-spacing: .06em; text-transform: uppercase; }
.lc-request-empty { margin: 0; color: #c7a882; }
.lc-request-owed { margin: 0; padding: 10px 12px; border-left: 2px solid #e5aa52; color: #ffe1a9; background: #2c1808; }
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
	const { state, tab } = view;
	const sections = requestSections(view, flight);
	const visible =
		tab === "past"
			? sections.past
			: [...sections.ongoing, ...sections.posted, ...sections.kept];
	// **Only a row the list is showing has details** (node #690). The
	// selection survives a tab switch so switching back restores it, but a
	// pane with Cancel or Report on it for a row that is not on the glass is a
	// control for something the pilot cannot see.
	const selected = view.selectedId
		? (visible.find((o) => o.id === view.selectedId) ?? null)
		: null;
	const count = sections.ongoing.length;
	const row = (o: RequestOffer): string => {
		const r = state.byId[o.id];
		// **Locked on the row, not only in the details** (#489): a pilot
		// scanning the list learns the requirement without opening it.
		const missing = r ? [] : missingEquipment(view, o);
		const label = r
			? statusLabel(r.status)
			: missing.length > 0
				? `locked: needs ${missing.join(", ")}`
				: state.leadsById[o.id]
					? "kept, not accepted"
					: "not accepted";
		return `<button type="button" class="lc-request-row" data-live-request-action="details" data-live-request-id="${esc(o.id)}" aria-selected="${selected?.id === o.id}"${missing.length > 0 ? " data-live-request-locked" : ""}><strong>${esc(o.title)}</strong><small>${esc(label)}${state.trackedRequestId === o.id ? " · TRACKED" : ""}</small><small>${o.rewardCr} Cr · ${esc(operandLine(o))} · report at ${esc(o.reportName)}</small></button>`;
	};
	// **Namespaced by surface**, for `button()`'s reason: the station console
	// and the flight console can both be in one document.
	const surface = flight ? "flight" : "console";
	const panelId = `${surface}-requests-panel`;
	const tabId = (t: RequestsTab) => `${surface}-requests-tab-${t}`;
	// The tabs are request actions, so the click path, native Enter and Space,
	// and the pad's walk and A reach them with nothing added. They are **not**
	// `.lc-tab`: the shoulders step the console's own tabs, and these are
	// inside one of them.
	const tabButton = (t: RequestsTab, label: string, n: number) =>
		`<button type="button" role="tab" class="lc-request-tab" id="${tabId(t)}" aria-controls="${panelId}" aria-selected="${tab === t}" data-live-request-action="tab" data-live-request-id="${t}">${label} <span class="lc-request-tab-count">${n}</span></button>`;
	const tabs = `<div class="lc-request-tabs" role="tablist" aria-label="Requests">${tabButton("current", "Current", sections.ongoing.length)}${tabButton("past", "Past", sections.past.length)}</div>`;
	const section = (
		key: keyof RequestsSections,
		heading: string,
		items: readonly RequestOffer[],
		empty: string,
	) =>
		`<section class="lc-request-section" data-live-request-section="${key}"><h4>${esc(heading)}</h4>${items.length > 0 ? items.map(row).join("") : `<p class="lc-request-empty" data-live-request-empty="${key}">${esc(empty)}</p>`}</section>`;
	// What a cancelled job still has aboard, said on Current: the job is
	// history, the goods are not (`missions-and-requests.md` §4).
	const owed = outstandingReturns(state)
		.map(
			({ offer, goodName, aboardT }) =>
				`<p class="lc-request-owed" data-live-request-owed="${esc(offer.id)}">You still carry ${aboardT} t of ${esc(goodName)} for a cancelled job. Return it at ${esc(offer.requesterName)}. The job is under Past.</p>`,
		)
		.join("");
	const list =
		tab === "past"
			? section(
					"past",
					"Reported, cancelled and failed",
					sections.past,
					"No finished jobs yet. A job you report or cancel moves here, with how it ended.",
				)
			: `${owed}${section(
					"ongoing",
					"In progress",
					sections.ongoing,
					flight
						? "No jobs in progress. Take one on a station's Requests tab."
						: "No jobs in progress. Take one from the jobs posted here.",
				)}${flight ? "" : section("posted", "Posted here", sections.posted, "No jobs posted here.")}${sections.kept.length > 0 ? section("kept", "Kept for later", sections.kept, "") : ""}`;
	let details =
		tab === "past"
			? `<div class="lc-request-details" data-live-request-details><h3>Past jobs</h3><p>Select a job to read how it ended.</p><p>A cancelled job can be accepted again at the station that posted it.</p></div>`
			: `<div class="lc-request-details" data-live-request-details><h3>Jobs</h3><p>Select a job to read its terms. Reading it or keeping it for later does not commit you.</p><p>You can take several jobs at once. Track one to see its next step while you fly.</p></div>`;
	if (selected) {
		const o = selected;
		const r = state.byId[o.id];
		const atRequester =
			view.docked?.galaxyIndex === o.requester.galaxyIndex &&
			view.docked?.carrierKey === o.requester.carrierKey;
		const cargo = cargoOf(o);
		const required = offerRequirements(o);
		const missing = missingEquipment(view, o);
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
				!cargo
					? "None"
					: cargo.entrusted
						? `${cargo.tonnes} t of ${cargo.goodName}. The requester owns it, so you cannot sell it.`
						: `${cargo.tonnes} t of ${cargo.goodName}. You buy it yourself and carry any loss.`,
			],
			[
				"Equipment",
				required.length === 0
					? "None"
					: required
							.map((item) =>
								missing.includes(item)
									? `${item}, not fitted. Shipyards sell it.`
									: `${item}, fitted`,
							)
							.join("; "),
			],
			[
				"Payment",
				`${o.rewardCr} Cr, paid once when you report at ${o.reportName}`,
			],
			["Consequence", o.consequence],
			["Terms", "No deadline. You can cancel for free."],
		];
		let actions = button("retain", o.id, "Keep for later");
		// **No Accept while a requirement is missing** (#489's ruling): not
		// hidden, and not refused on press — the row says why it is locked.
		if ((!r || r.status === "cancelled") && atRequester && missing.length === 0)
			actions += button("accept", o.id, r ? "Accept again" : "Accept");
		const atReport =
			view.docked?.galaxyIndex === o.reportAt.galaxyIndex &&
			view.docked?.carrierKey === o.reportAt.carrierKey;
		if (r && isAcceptedRequest(r)) {
			actions += button(
				state.trackedRequestId === o.id ? "untrack" : "track",
				o.id,
				state.trackedRequestId === o.id ? "Stop tracking" : "Track",
			);
			if (r.status === "accepted" && atReport && cargo) {
				// **The control says whose goods it moves** (#446). One label
				// served both families, so a consignment already aboard read as
				// a shopping list — and `esc` was applied to the good's name
				// here and again by `button`, which double-escaped it.
				const deliver = deliverAction(o, aboardFor(view, o));
				actions += button("deliver", o.id, deliver.label, {
					hint: deliver.hint,
					enabled: deliver.enabled,
					surface: flight ? "flight" : "console",
				});
			}
			if (r.status === "ready-to-report" && atReport)
				actions += button(
					"report",
					o.id,
					`Report and collect ${o.rewardCr} Cr`,
				);
			actions += button("cancel", o.id, "Cancel (no fee)");
		}
		if (
			r?.status === "cancelled" &&
			cargo?.entrusted &&
			atRequester &&
			Object.values(state.entrustedByLotId).some((lot) => lot.offerId === o.id)
		)
			actions += button(
				"return-entrusted",
				o.id,
				`Return ${cargo.tonnes} t of ${esc(cargo.goodName)}`,
			);
		details = `<div class="lc-request-details" data-live-request-details><h3>${esc(o.title)}</h3><p>${r ? esc(nextAction(r)) : "Read the terms before you accept."}</p><dl>${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === "Intelligence" ? `${esc(o.region)}. ${esc(o.source)} · <span data-live-request-age="${o.observedAt}">${Math.max(0, Math.floor(view.now - o.observedAt))}s old</span>` : esc(v)}</dd>`).join("")}</dl><div class="lc-request-actions">${actions}</div>${r?.status === "ready-to-report" && !atReport ? `<p>Dock at ${esc(o.reportName)} to report. You can only be paid there.</p>` : ""}</div>`;
	}
	return `<div class="lc-requests" data-live-requests><p class="lc-request-intro">${count} accepted · ${flight ? "your jobs and the ones you kept" : "jobs posted here and jobs you have taken"}</p><p class="lc-request-message" role="status">${esc(view.message)}</p>${tabs}<div class="lc-request-layout" role="tabpanel" id="${panelId}" aria-labelledby="${tabId(tab)}" data-live-request-tab-panel="${tab}"><div class="lc-request-list">${list}</div>${details}</div></div>`;
}
