/**
 * The live request runtime: what a pilot accepts, flies, delivers and reports
 * (`missions-and-requests.md` §3–§4, `ordinary-requests.md` §4, node #411).
 *
 * It was `requests-prototype.ts`, a fixture-backed experiment whose offers
 * were two authored strings and whose stages were named `fixture-*`. #437
 * promoted its **persistence** — one schema, one Commander catalog — and left
 * the content flagged; this node replaces the content with `jobs.ts`'s bound
 * offers and retires the flag, so the name no longer says prototype.
 *
 * **Terms are pinned, and load validation may not re-derive them.** The
 * validator this replaced rebuilt every saved offer from `fixtureOffers` and
 * compared it field by field, which works only while an offer is a pure
 * function of its identity. A bound offer's operands come from world state
 * that moves — a deficit decays, a market epoch turns — so re-deriving at load
 * would either refuse a legitimate save or silently rewrite what the pilot
 * accepted. §1 pins the terms at acceptance; this validates their **shape**
 * and their internal consistency instead.
 *
 * No Three.js: a journal is arithmetic and text.
 */
import { type CarrierKey, isCarrierKey } from "./carrier-key";
import type { JobFamily, JobMark, JobOffer } from "./jobs";
import { jobMark } from "./jobs";

export interface RequestStation {
	galaxyIndex: number;
	carrierKey: CarrierKey;
}

/** A bound offer as the journal carries it. */
export type RequestOffer = JobOffer;

export type RequestStatus =
	| "accepted"
	| "ready-to-report"
	| "completed"
	| "cancelled"
	| "failed";

/**
 * The authored objectives of a job, **read off the offer rather than derived**.
 *
 * Both shipped families have one: carry the goods to the report station. The
 * request contract's stage machinery is kept whole rather than collapsed,
 * because the relay's `search → identify → disable` is the same list with
 * three entries and joins it without a second mechanism — and when it does,
 * an older save's evidence must still be checked against the list it was
 * earned under, not against whatever the family means today.
 */
export const stagesFor = (offer: RequestOffer): readonly string[] =>
	offer.stages;

export interface RequestEvidence {
	stageId: string;
	occurredAt: number;
	/** What established the stage. `delivery` is the only live source; the
	 *  retired fixtures wrote `ui-fixture` and no longer load. */
	source: "delivery";
}

export interface AcceptedRequest {
	offerId: string;
	terms: RequestOffer;
	acceptedAt: number;
	lastAcceptedAt: number;
	acceptanceOrdinal: number;
	status: RequestStatus;
	stageId: string;
	evidence: RequestEvidence[];
	settledAt: number | null;
	outcomeReason: string | null;
}

/**
 * A request-owned cargo lot (`missions-and-requests.md` §4).
 *
 * It occupies the hold beside ordinary cargo and is excluded from sale; it is
 * never merged into `CommanderState.cargo`, which is why every capacity
 * consumer takes an explicit `entrustedT`.
 */
export interface EntrustedLot {
	lotId: string;
	offerId: string;
	/** Where the goods go back to if the job is cancelled. */
	returnTo: RequestStation;
	goodName: string;
	aboardT: number;
	/** The acceptance ordinal this issuance belongs to (§4). */
	issuedOrdinal: number;
}

export interface RequestsState {
	byId: Record<string, AcceptedRequest>;
	leadsById: Record<string, RequestOffer>;
	entrustedByLotId: Record<string, EntrustedLot>;
	trackedRequestId: string | null;
}

export const emptyRequests = (): RequestsState => ({
	byId: {},
	leadsById: {},
	entrustedByLotId: {},
	trackedRequestId: null,
});

/**
 * Entrusted tonnes aboard — what the hold boundary has to be told about.
 *
 * One number rather than a second cargo map: the lots are the authority and
 * this is the projection every capacity consumer reads
 * (`station-commerce.ts`'s `entrustedT`).
 */
export const entrustedTonnesAboard = (state: RequestsState): number =>
	Object.values(state.entrustedByLotId).reduce(
		(sum, lot) => sum + lot.aboardT,
		0,
	);

export const isAcceptedRequest = (r: AcceptedRequest): boolean =>
	r.status === "accepted" || r.status === "ready-to-report";

/**
 * How many jobs of each family this requester has settled — the binder's
 * episode counter (`jobs.ts`'s `BindContext.settled`).
 *
 * Derived from the journal rather than stored beside it: a second counter is a
 * second authority on whether a job was completed, and §4 says the completed
 * status is the durable receipt.
 */
export function settledAt(
	state: RequestsState,
	requester: RequestStation,
): Record<JobFamily, number> {
	const out = { courier: 0, procurement: 0 };
	for (const request of Object.values(state.byId))
		if (
			request.status === "completed" &&
			request.terms.requester.galaxyIndex === requester.galaxyIndex &&
			request.terms.requester.carrierKey === requester.carrierKey
		)
			out[request.terms.family]++;
	return out;
}

export function nextAction(r: AcceptedRequest): string {
	if (r.status === "ready-to-report")
		return `Dock at ${r.terms.reportName} and Report`;
	if (!isAcceptedRequest(r)) return r.outcomeReason ?? r.status;
	// **Carried, or sourced — and the first says the goods are already
	// aboard** (#446). "Carry 8 t Food to ARLAON" and "Source 8 t Food" read
	// as the same errand at a glance, and a pilot who read the first as the
	// second bought eight tonnes they were already carrying.
	return r.terms.entrusted
		? `Carry the ${r.terms.tonnes} t ${r.terms.goodName} aboard to ${r.terms.reportName}, ${r.terms.reportSystemName}`
		: `Source ${r.terms.tonnes} t ${r.terms.goodName} yourself and return to ${r.terms.reportName}`;
}

export interface RequestContext {
	now: number;
	docked: RequestStation | null;
	/** The ordinary cargo aboard, which is what a procurement job delivers. */
	cargo: Readonly<Record<string, number>>;
	/** Tonnes the hold still has free, entrusted cargo already deducted. */
	holdRoomT: number;
}

export interface RequestResult {
	state: RequestsState;
	ok: boolean;
	message: string;
	rewardCr: number;
	/** §4's world mark, for the caller to apply with the flown hull's hold. */
	mark: JobMark | null;
	/** Ordinary cargo the action consumes, as a signed delta per good. */
	cargoDelta: Readonly<Record<string, number>>;
}

const lotIdFor = (offerId: string, ordinal: number): string =>
	`${offerId}#lot-${ordinal}`;

const sameStation = (a: RequestStation | null, b: RequestStation): boolean =>
	a !== null &&
	a.galaxyIndex === b.galaxyIndex &&
	a.carrierKey === b.carrierKey;

/**
 * One request action, applied atomically.
 *
 * Every refusal returns the state it was given, so a caller cannot half-apply
 * one — the same rule `transactAtStation` follows and for the same reason.
 */
export function requestAction(
	state: RequestsState,
	offers: readonly RequestOffer[],
	action: string,
	id: string,
	ctx: RequestContext,
): RequestResult {
	const refuse = (message: string): RequestResult => ({
		state,
		ok: false,
		message,
		rewardCr: 0,
		mark: null,
		cargoDelta: {},
	});
	/** The success sibling of `refuse`, so a field added to `RequestResult`
	 *  is one edit rather than eight identical literals. */
	const done = (
		next: RequestsState,
		message: string,
		extra: Partial<RequestResult> = {},
	): RequestResult => ({
		state: next,
		ok: true,
		message,
		rewardCr: 0,
		mark: null,
		cargoDelta: {},
		...extra,
	});
	const existing = state.byId[id];
	const offer =
		existing?.terms ?? offers.find((o) => o.id === id) ?? state.leadsById[id];
	if (!offer || !Number.isFinite(ctx.now) || ctx.now < offer.observedAt)
		return refuse("Offer unavailable or invalid observation time.");

	if (action === "retain")
		return done(
			{
				...state,
				leadsById: { ...state.leadsById, [id]: structuredClone(offer) },
			},
			"Lead retained. No commitment accepted.",
		);

	if (action === "accept") {
		if (!sameStation(ctx.docked, offer.requester))
			return refuse("Dock at the requester to accept or reaccept.");
		if (existing && existing.status !== "cancelled")
			return refuse(
				"Already accepted or terminal; this offer cannot pay again.",
			);
		// **A consignment still aboard is returned, not duplicated.** `deliver`
		// removes only the lot of the current acceptance ordinal, so issuing a
		// second one would strand the first in the hold with no action that
		// reaches it — and a lot surviving against a completed request is a
		// journal `parseRequests` refuses, which makes the pilot's own save
		// unloadable.
		if (
			existing &&
			Object.values(state.entrustedByLotId).some((lot) => lot.offerId === id)
		)
			return refuse(
				"Return the consignment to the requester before reaccepting.",
			);
		// §4: a hull/equipment state that would leave insufficient capacity is
		// refused atomically rather than silently discarding goods.
		if (offer.entrusted && ctx.holdRoomT < offer.tonnes)
			return refuse(
				`Needs ${offer.tonnes} t of free hold; ${Math.max(0, Math.floor(ctx.holdRoomT))} t free.`,
			);
		const ordinal = (existing?.acceptanceOrdinal ?? 0) + 1;
		const evidence: RequestEvidence[] = [];
		const stages = stagesFor(offer);
		const request: AcceptedRequest = {
			offerId: id,
			terms: structuredClone(offer),
			acceptedAt: existing?.acceptedAt ?? ctx.now,
			lastAcceptedAt: ctx.now,
			acceptanceOrdinal: ordinal,
			evidence,
			stageId: stages[Math.min(evidence.length, stages.length - 1)],
			status:
				evidence.length === stages.length ? "ready-to-report" : "accepted",
			settledAt: null,
			outcomeReason: null,
		};
		const entrustedByLotId = { ...state.entrustedByLotId };
		if (offer.entrusted) {
			const lotId = lotIdFor(id, ordinal);
			entrustedByLotId[lotId] = {
				lotId,
				offerId: id,
				returnTo: offer.requester,
				goodName: offer.goodName,
				aboardT: offer.tonnes,
				issuedOrdinal: ordinal,
			};
		}
		return done(
			{ ...state, byId: { ...state.byId, [id]: request }, entrustedByLotId },
			offer.entrusted
				? `Accepted. ${offer.tonnes} t ${offer.goodName} loaded, and they stay the requester's.`
				: "Accepted. Source the goods and return with them aboard.",
		);
	}

	if (action === "return-entrusted") {
		const lot = Object.values(state.entrustedByLotId).find(
			(l) => l.offerId === id,
		);
		if (!lot) return refuse("Nothing entrusted to return for this job.");
		// **Only once the job is off.** §3 lists the return against a cancelled
		// or failed commitment; handing the goods back while the job is still
		// running would leave a live obligation with nothing aboard to meet it.
		if (existing && isAcceptedRequest(existing))
			return refuse("Cancel the job before returning its consignment.");
		if (!sameStation(ctx.docked, lot.returnTo))
			return refuse("Dock at the requester to return entrusted cargo.");
		const entrustedByLotId = { ...state.entrustedByLotId };
		delete entrustedByLotId[lot.lotId];
		return done(
			{ ...state, entrustedByLotId },
			`${lot.aboardT} t ${lot.goodName} returned. The obligation is settled.`,
		);
	}

	if (!existing || !isAcceptedRequest(existing))
		return refuse("Choose an accepted request first.");
	if (ctx.now < existing.lastAcceptedAt)
		return refuse("Action predates acceptance.");

	if (action === "track" || action === "untrack")
		return done(
			{ ...state, trackedRequestId: action === "track" ? id : null },
			action === "track"
				? "Tracking this request; flight target unchanged."
				: "Cue cleared; commitments remain.",
		);

	const request = { ...existing };
	const terms = request.terms;

	if (action === "cancel") {
		request.status = "cancelled";
		return done(
			{
				...state,
				byId: { ...state.byId, [id]: request },
				trackedRequestId:
					state.trackedRequestId === id ? null : state.trackedRequestId,
			},
			terms.entrusted
				? "Cancelled. The consignment is still the requester's — return it to them."
				: "Cancelled without fee. Unfinished work may be reaccepted at the requester.",
		);
	}

	if (action === "deliver") {
		if (request.status !== "accepted")
			return refuse("This job's objective is already satisfied.");
		if (!sameStation(ctx.docked, terms.reportAt))
			return refuse(`Dock at ${terms.reportName} to deliver.`);
		const entrustedByLotId = { ...state.entrustedByLotId };
		let cargoDelta: Record<string, number> = {};
		if (terms.entrusted) {
			const lot = Object.values(state.entrustedByLotId).find(
				(l) =>
					l.offerId === id && l.issuedOrdinal === request.acceptanceOrdinal,
			);
			if (!lot || lot.aboardT < terms.tonnes)
				return refuse("The consignment is not aboard.");
			delete entrustedByLotId[lot.lotId];
		} else {
			if ((ctx.cargo[terms.goodName] ?? 0) < terms.tonnes)
				return refuse(
					`Needs ${terms.tonnes} t ${terms.goodName} aboard to deliver.`,
				);
			cargoDelta = { [terms.goodName]: -terms.tonnes };
		}
		request.evidence = [
			...request.evidence,
			{ stageId: request.stageId, occurredAt: ctx.now, source: "delivery" },
		];
		const stages = stagesFor(terms);
		request.stageId =
			stages[Math.min(request.evidence.length, stages.length - 1)];
		if (request.evidence.length === stages.length)
			request.status = "ready-to-report";
		return done(
			{ ...state, byId: { ...state.byId, [id]: request }, entrustedByLotId },
			// The two families move different cargo and the message said the
			// same thing for both (#446).
			terms.entrusted
				? `${terms.tonnes} t ${terms.goodName} handed over — the requester's, and out of your hold. Report to settle.`
				: `${terms.tonnes} t ${terms.goodName} delivered from your hold. Report to settle.`,
			{ cargoDelta },
		);
	}

	if (action === "report") {
		if (request.status !== "ready-to-report")
			return refuse("Finish the objective before reporting.");
		if (!sameStation(ctx.docked, terms.reportAt))
			return refuse(`Dock at ${terms.reportName} to report.`);
		request.status = "completed";
		request.settledAt = ctx.now;
		return done(
			{
				...state,
				byId: { ...state.byId, [id]: request },
				trackedRequestId:
					state.trackedRequestId === id ? null : state.trackedRequestId,
			},
			`Report accepted · ${terms.rewardCr} Cr paid.`,
			{
				rewardCr: terms.rewardCr,
				// §4's mark lands exactly here, with the settlement, so a repeated
				// Report — refused above as terminal — cannot write it twice.
				mark: jobMark(terms),
			},
		);
	}

	return refuse("Unknown request action.");
}

/** Reject an inconsistent journal; never silently discard settlement. */
export function parseRequests(raw: unknown, now: number): RequestsState {
	const bad = (): never => {
		throw new Error(
			"save: invalid Requests journal (identity, terms, time or stage)",
		);
	};
	const obj = (x: unknown): Record<string, any> =>
		x && typeof x === "object" && !Array.isArray(x)
			? (x as Record<string, any>)
			: bad();
	const s = obj(raw);
	const byId = obj(s.byId);
	const leads = obj(s.leadsById);
	const lots = obj(s.entrustedByLotId ?? {});
	const time = (x: unknown): boolean =>
		typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= now;
	const text = (x: unknown): boolean => typeof x === "string" && x.length > 0;
	const ref = (x: unknown): RequestStation => {
		const r = obj(x);
		if (
			!Number.isInteger(r.galaxyIndex) ||
			r.galaxyIndex < 0 ||
			r.galaxyIndex >= 8 ||
			typeof r.carrierKey !== "string" ||
			!isCarrierKey(r.carrierKey)
		)
			bad();
		return {
			galaxyIndex: r.galaxyIndex,
			carrierKey: r.carrierKey as CarrierKey,
		};
	};

	/**
	 * **Shape, not re-derivation.** See the module header: an offer bound from
	 * live world state cannot be rebuilt at load, so what is checked is that
	 * every field is present and well formed, that the identity matches its key
	 * and that the numbers are finite and non-negative.
	 */
	const offerOf = (rawOffer: unknown, id: string): RequestOffer => {
		const o = obj(rawOffer);
		const requester = ref(o.requester);
		const reportAt = ref(o.reportAt);
		if (
			o.id !== id ||
			(o.family !== "courier" && o.family !== "procurement") ||
			!text(o.rowId) ||
			!Array.isArray(o.stages) ||
			o.stages.length === 0 ||
			!o.stages.every((stage: unknown) => text(stage)) ||
			!Number.isInteger(o.revision) ||
			o.revision < 1 ||
			!Number.isInteger(o.episode) ||
			o.episode < 1 ||
			!text(o.requesterName) ||
			!text(o.reportName) ||
			!text(o.reportSystemName) ||
			!Number.isFinite(o.distanceLy) ||
			o.distanceLy < 0 ||
			!text(o.goodName) ||
			!Number.isInteger(o.tonnes) ||
			o.tonnes <= 0 ||
			!Number.isFinite(o.rewardCr) ||
			o.rewardCr < 0 ||
			typeof o.entrusted !== "boolean" ||
			!text(o.title) ||
			!text(o.purpose) ||
			!text(o.danger) ||
			!text(o.action) ||
			!text(o.consequence) ||
			!text(o.region) ||
			!text(o.source) ||
			!time(o.observedAt)
		)
			bad();
		// **Copied by spread, not re-enumerated.** The check above lists every
		// field once; a return literal listing them a second time is a field
		// that can be validated and then silently dropped on load, which is
		// exactly how `entrustedByLotId` went missing from the serializer.
		return {
			...(o as JobOffer),
			id,
			requester,
			reportAt,
			stages: [...o.stages],
		};
	};

	// **The retired fixture trial, named before anything else is validated.**
	// #437's promotion let a flagged DEV session write `ui-fixture` stages into
	// an ordinary Commander; #411 replaced that content, so such a record
	// cannot load. The scan is here rather than inside the evidence loop
	// because `offerOf` runs first and would refuse the same save with the
	// generic message — a refusal by the wrong name is what this avoids.
	for (const row of Object.values(byId)) {
		const evidence = (row as { evidence?: unknown })?.evidence;
		if (
			Array.isArray(evidence) &&
			evidence.some((e) => (e as { source?: unknown })?.source === "ui-fixture")
		)
			throw new Error(
				'save: this journal holds retired fixture requests (source "ui-fixture") and cannot load; that content was replaced by live jobs in #411',
			);
	}

	const out = emptyRequests();
	for (const id of Object.keys(leads).sort())
		out.leadsById[id] = offerOf(leads[id], id);

	for (const id of Object.keys(byId).sort()) {
		const r = obj(byId[id]);
		const terms = offerOf(r.terms, id);
		const stages = stagesFor(terms);
		if (
			r.offerId !== id ||
			!time(r.acceptedAt) ||
			!time(r.lastAcceptedAt) ||
			r.lastAcceptedAt < r.acceptedAt ||
			!Number.isInteger(r.acceptanceOrdinal) ||
			r.acceptanceOrdinal < 1 ||
			![
				"accepted",
				"ready-to-report",
				"completed",
				"cancelled",
				"failed",
			].includes(r.status)
		)
			bad();
		if (!Array.isArray(r.evidence) || r.evidence.length > stages.length) bad();
		let previous = r.acceptedAt;
		for (let i = 0; i < r.evidence.length; i++) {
			const e = obj(r.evidence[i]);
			if (
				e.stageId !== stages[i] ||
				e.source !== "delivery" ||
				!time(e.occurredAt) ||
				e.occurredAt < previous
			)
				bad();
			previous = e.occurredAt;
		}
		const ready = r.evidence.length === stages.length;
		if (
			r.stageId !== stages[Math.min(r.evidence.length, stages.length - 1)] ||
			(r.status === "accepted" && ready) ||
			(["ready-to-report", "completed"].includes(r.status) && !ready)
		)
			bad();
		// §7: `settledAt` is non-null exactly when the status is completed.
		if (
			(r.status === "completed") !== (r.settledAt !== null) ||
			(r.settledAt !== null &&
				(!time(r.settledAt) ||
					r.settledAt < previous ||
					r.settledAt < r.lastAcceptedAt))
		)
			bad();
		if (r.outcomeReason !== null && !text(r.outcomeReason)) bad();
		out.byId[id] = {
			offerId: id,
			terms,
			acceptedAt: r.acceptedAt,
			lastAcceptedAt: r.lastAcceptedAt,
			acceptanceOrdinal: r.acceptanceOrdinal,
			status: r.status,
			stageId: r.stageId,
			evidence: r.evidence.map((e: any) => ({
				stageId: e.stageId,
				occurredAt: e.occurredAt,
				source: "delivery" as const,
			})),
			settledAt: r.settledAt,
			outcomeReason: r.outcomeReason ?? null,
		};
	}

	for (const lotId of Object.keys(lots).sort()) {
		const l = obj(lots[lotId]);
		if (typeof l.offerId !== "string" || !Object.hasOwn(out.byId, l.offerId))
			bad();
		const request = out.byId[l.offerId];
		if (
			l.lotId !== lotId ||
			!request ||
			!request.terms.entrusted ||
			!text(l.goodName) ||
			l.goodName !== request.terms.goodName ||
			!Number.isInteger(l.aboardT) ||
			l.aboardT <= 0 ||
			l.aboardT > request.terms.tonnes ||
			!Number.isInteger(l.issuedOrdinal) ||
			l.issuedOrdinal < 1 ||
			l.issuedOrdinal > request.acceptanceOrdinal ||
			// A settled job owes nothing: its goods were delivered or returned.
			request.status === "completed"
		)
			bad();
		const returnTo = ref(l.returnTo);
		// The lot goes back to its requester, so the reference has to be that
		// one rather than any valid-looking key.
		if (
			returnTo.galaxyIndex !== request.terms.requester.galaxyIndex ||
			returnTo.carrierKey !== request.terms.requester.carrierKey
		)
			bad();
		out.entrustedByLotId[lotId] = {
			lotId,
			offerId: l.offerId,
			returnTo,
			goodName: l.goodName,
			aboardT: l.aboardT,
			issuedOrdinal: l.issuedOrdinal,
		};
	}

	if (
		s.trackedRequestId !== null &&
		(typeof s.trackedRequestId !== "string" ||
			!out.byId[s.trackedRequestId] ||
			!isAcceptedRequest(out.byId[s.trackedRequestId]))
	)
		bad();
	out.trackedRequestId = s.trackedRequestId;
	return out;
}
