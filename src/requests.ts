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
import type { JobFamily, JobMark, JobOffer, JobOperand } from "./jobs";
import {
	FAMILY_OPERAND_KIND,
	cargoOf,
	jobMark,
	missingRequirements,
} from "./jobs";
import type { Standing } from "./legal";

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
	/**
	 * What established the stage: `delivery` for a cargo family, `kill` for a
	 * Bounty (#508). The retired fixtures wrote `ui-fixture` and no longer
	 * load. Which source a family's stage takes is `EVIDENCE_SOURCE`'s.
	 */
	source: EvidenceSource;
}

export type EvidenceSource = "delivery" | "kill";

/**
 * The one source each family's evidence may come from, as a total record.
 *
 * Read by the validator, so a journal pairing a courier with a kill — a record
 * no action writes — is refused rather than admitted by a list of sources that
 * knows nothing of families.
 */
export const EVIDENCE_SOURCE: Readonly<Record<JobFamily, EvidenceSource>> = {
	courier: "delivery",
	procurement: "delivery",
	bounty: "kill",
};

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
	isRunning(r.status);

/**
 * Whether a job is still **going** somewhere (#445).
 *
 * An allow-list on the union rather than a deny-list of the terminal states: a
 * status added later would otherwise default to "running", and a screen would
 * tell a pilot to carry goods to a station for a job that has ended.
 *
 * Here rather than in the screen that needed it first: classifying a journal
 * state is this module's concern, and a second surface asking the same
 * question would either duplicate the list or import a view.
 */
export const isRunning = (status: RequestStatus): boolean =>
	status === "accepted" || status === "ready-to-report";

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
	const out = { courier: 0, procurement: 0, bounty: 0 };
	for (const request of Object.values(state.byId))
		if (
			request.status === "completed" &&
			request.terms.requester.galaxyIndex === requester.galaxyIndex &&
			request.terms.requester.carrierKey === requester.carrierKey
		)
			out[request.terms.family]++;
	return out;
}

/**
 * What a settled job reports (#446).
 *
 * Three facts a pilot cannot otherwise see: what left the hold, what it paid,
 * and what of theirs is still aboard. **Here rather than in the view**, and
 * that is a correction rather than a preference — the first pass composed it
 * in `main.ts` on top of the message this module already returned, which left
 * `requestAction`'s own report string reaching no screen at all. One module
 * owns the sentence, and it is the one that knows the job settled.
 */
export function settlementMessage(settled: {
	tonnes: number;
	goodName: string;
	entrusted: boolean;
	rewardCr: number;
	/** The pilot's **own** tonnage of that good at the moment of the report. */
	remainingT: number;
}): string {
	const moved = settled.entrusted
		? `${settled.tonnes} t ${settled.goodName} handed over`
		: `${settled.tonnes} t ${settled.goodName} delivered from your hold`;
	// **The remainder is the pilot's own, and it is dropped rather than
	// zeroed.** `0 t Food still aboard` is a line about cargo that is not
	// there; `no Food left aboard` is worse after a hand-over, because it
	// reads as the pilot's Food having gone — the ownership confusion this
	// node exists to remove. So a pilot who was carrying none of the good is
	// told about the job and nothing else. #443 dropped a zeroed entrusted
	// clause for the first half of this reason.
	const left =
		settled.remainingT > 0
			? ` · ${settled.remainingT} t ${settled.goodName} still aboard, yours`
			: settled.entrusted
				? ""
				: ` · no ${settled.goodName} left aboard`;
	return `Reported · ${moved}, ${settled.rewardCr} Cr paid${left}.`;
}

export function nextAction(r: AcceptedRequest): string {
	if (r.status === "ready-to-report")
		return `Dock at ${r.terms.reportName} and Report`;
	if (!isAcceptedRequest(r)) return r.outcomeReason ?? r.status;
	const { operand } = r.terms;
	if (operand.kind === "target")
		// The region is a label ("The approach to X, Y"), so it stands as its own
		// clause; spliced into the sentence it read "in The approach to" (#508).
		return `Destroy the ${operand.targetName}. Search area: ${r.terms.region}. Collect at ${r.terms.reportName}.`;
	// **Carried, or sourced — and the first says the goods are already
	// aboard** (#446). "Carry 8 t Food to ARLAON" and "Source 8 t Food" read
	// as the same errand at a glance, and a pilot who read the first as the
	// second bought eight tonnes they were already carrying.
	return operand.entrusted
		? `Carry the ${operand.tonnes} t ${operand.goodName} aboard to ${r.terms.reportName}, ${r.terms.reportSystemName}`
		: `Source ${operand.tonnes} t ${operand.goodName} yourself and return to ${r.terms.reportName}`;
}

export interface RequestContext {
	now: number;
	docked: RequestStation | null;
	/** The ordinary cargo aboard, which is what a procurement job delivers. */
	cargo: Readonly<Record<string, number>>;
	/** Tonnes the hold still has free, entrusted cargo already deducted. */
	holdRoomT: number;
	/**
	 * The pilot's standing now (`legal.ts`). A Bounty refuses anything but
	 * Clean at accept and at report (#495 D2). Required, for `holdT`'s reason:
	 * a caller that forgot it would pay a Wanted pilot, and the two are
	 * indistinguishable in a diff.
	 */
	standing: Standing;
	/** The commander's fitted equipment, read against `offerRequirements`
	 *  at acceptance (request contract §2). */
	equipment: readonly string[];
}

/** The name a non-cargo job's target was posted under. The union has two
 *  members, so a job with no cargo has a target; the throw is for a third. */
const targetNameOf = (terms: RequestOffer): string => {
	if (terms.operand.kind !== "target")
		throw new Error(`${terms.id}: no cargo and no target`);
	return terms.operand.targetName;
};

/** #495 D2's refusal, one sentence for both of the actions that owe it. */
const BOUNTY_NEEDS_CLEAN =
	"Security pays Clean pilots only. Come back when your standing is Clean.";

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
			"Kept for later. You have accepted nothing.",
		);

	if (action === "accept") {
		if (!sameStation(ctx.docked, offer.requester))
			return refuse("Dock at the requester to accept or reaccept.");
		if (existing && existing.status !== "cancelled")
			return refuse(
				"Already accepted or terminal; this offer cannot pay again.",
			);
		// Request contract §2's eligibility, read before anything is issued.
		const missing = missingRequirements(offer, ctx.equipment);
		if (missing.length > 0)
			return refuse(`Needs a ${missing.join(" and a ")} fitted to accept.`);
		if (offer.family === "bounty" && ctx.standing !== "clean")
			return refuse(BOUNTY_NEEDS_CLEAN);
		const cargo = cargoOf(offer);
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
		if (cargo?.entrusted && ctx.holdRoomT < cargo.tonnes)
			return refuse(
				`Needs ${cargo.tonnes} t of free hold; ${Math.max(0, Math.floor(ctx.holdRoomT))} t free.`,
			);
		const ordinal = (existing?.acceptanceOrdinal ?? 0) + 1;
		// **§3's reaccept keeps valid non-cargo evidence.** A cargo stage is
		// re-evaluated for the new issuance, so it starts empty; a Bounty's kill
		// was recorded while the job was accepted and stays earned — "cancelling
		// a ready-to-report relay request does not require inventing a
		// replacement relay to resume it". Nothing recorded while cancelled
		// exists to keep, because `recordKill` listens only to accepted rows.
		const evidence: RequestEvidence[] =
			existing && !cargo ? [...existing.evidence] : [];
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
		if (cargo?.entrusted) {
			const lotId = lotIdFor(id, ordinal);
			entrustedByLotId[lotId] = {
				lotId,
				offerId: id,
				returnTo: offer.requester,
				goodName: cargo.goodName,
				aboardT: cargo.tonnes,
				issuedOrdinal: ordinal,
			};
		}
		return done(
			{ ...state, byId: { ...state.byId, [id]: request }, entrustedByLotId },
			!cargo
				? request.status === "ready-to-report"
					? "Reaccepted. The kill already stands; report to settle."
					: "Accepted. Only a kill made after this counts."
				: cargo.entrusted
					? `Accepted. ${cargo.tonnes} t ${cargo.goodName} loaded, and they stay the requester's.`
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
			cargoOf(terms)?.entrusted
				? "Cancelled. The consignment is still the requester's — return it to them."
				: "Cancelled without fee. Unfinished work may be reaccepted at the requester.",
		);
	}

	if (action === "deliver") {
		const cargo = cargoOf(terms);
		if (!cargo) return refuse("This job has nothing to deliver.");
		if (request.status !== "accepted")
			return refuse("This job's objective is already satisfied.");
		if (!sameStation(ctx.docked, terms.reportAt))
			return refuse(`Dock at ${terms.reportName} to deliver.`);
		// Unwrapped once per branch. The operand is one level deeper than the
		// three fields it replaced, and spelling the path at every use put
		// every sentence in this branch over the line width for no reader's
		// benefit.
		const { goodName, tonnes, entrusted } = cargo;
		const entrustedByLotId = { ...state.entrustedByLotId };
		let cargoDelta: Record<string, number> = {};
		if (entrusted) {
			const lot = Object.values(state.entrustedByLotId).find(
				(l) =>
					l.offerId === id && l.issuedOrdinal === request.acceptanceOrdinal,
			);
			if (!lot || lot.aboardT < tonnes)
				return refuse("The consignment is not aboard.");
			delete entrustedByLotId[lot.lotId];
		} else {
			if ((ctx.cargo[goodName] ?? 0) < tonnes)
				return refuse(`Needs ${tonnes} t ${goodName} aboard to deliver.`);
			cargoDelta = { [goodName]: -tonnes };
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
			entrusted
				? `${tonnes} t ${goodName} handed over — the requester's, and out of your hold. Report to settle.`
				: `${tonnes} t ${goodName} delivered from your hold. Report to settle.`,
			{ cargoDelta },
		);
	}

	if (action === "report") {
		if (request.status !== "ready-to-report")
			return refuse("Finish the objective before reporting.");
		if (!sameStation(ctx.docked, terms.reportAt))
			return refuse(`Dock at ${terms.reportName} to report.`);
		// #495 D2: the fork. A pilot who turned Wanted after the kill waits for
		// the heat to decay; the earned evidence waits with them.
		if (terms.family === "bounty" && ctx.standing !== "clean")
			return refuse(BOUNTY_NEEDS_CLEAN);
		request.status = "completed";
		request.settledAt = ctx.now;
		const cargo = cargoOf(terms);
		return done(
			{
				...state,
				byId: { ...state.byId, [id]: request },
				trackedRequestId:
					state.trackedRequestId === id ? null : state.trackedRequestId,
			},
			// **What the settlement moved** (#446). The report paid `N Cr` and
			// the manifest never appeared, so a delivery and a sale looked
			// identical from the cockpit. The remainder is read off `ctx.cargo`,
			// which is the pilot's own hold at the moment of the report — the
			// delivery's delta has already been applied by then.
			cargo
				? settlementMessage({
						// Named rather than spread from the operand. A spread would
						// carry `kind` in too, and the leak this whole change pins
						// at the save boundary is the same mistake one call deeper.
						tonnes: cargo.tonnes,
						goodName: cargo.goodName,
						entrusted: cargo.entrusted,
						rewardCr: terms.rewardCr,
						remainingT: ctx.cargo[cargo.goodName] ?? 0,
					})
				: `Bounty paid for the ${targetNameOf(terms)}: ${terms.rewardCr} Cr.`,
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

/**
 * A carrier the player destroyed, recorded as evidence on every accepted
 * Bounty that names it (#508 D1).
 *
 * **Recorded when it happens, not read at report.** The kill is already in the
 * world as the target's `destroy` with the player's provenance, and that is the
 * mark (`ordinary-requests.md` §4) — but a causal episode is replaced by the
 * next one, and the request contract (§7) says payment may not depend on a
 * world episode summary surviving. §3: every accepted request listens for
 * qualifying progress whether or not it is tracked, and one act may satisfy
 * several distinct requests, so one kill readies each station's Bounty.
 *
 * H8 (`civilian-combat.md`): a kill before acceptance pays nothing, which is
 * why only an **accepted** row at or after its last acceptance listens. The
 * caller calls this only for a kill with the player's provenance; the journal
 * does not see world state.
 *
 * **The galaxy is part of the target** (sage round 2). A `CarrierKey` is a
 * system index and a local id with no galaxy in it, so matching the key alone
 * readied a Bounty accepted in one galaxy for a kill at the same system index
 * in another. The reference carries the galaxy the way a station's does, and
 * a caller cannot pass the key without it.
 *
 * Returns the same object when nothing listened, so a caller can tell a kill
 * that moved no request from one that did without diffing.
 */
export function recordKill(
	state: RequestsState,
	target: { galaxyIndex: number; carrierKey: CarrierKey },
	occurredAt: number,
): RequestsState {
	let byId: Record<string, AcceptedRequest> | null = null;
	for (const request of Object.values(state.byId)) {
		const { operand } = request.terms;
		if (
			request.status !== "accepted" ||
			operand.kind !== "target" ||
			operand.carrierKey !== target.carrierKey ||
			// A Bounty's target is in its requester's own system (#495 D4), so
			// the requester's galaxy is the target's.
			request.terms.requester.galaxyIndex !== target.galaxyIndex ||
			occurredAt < request.lastAcceptedAt
		)
			continue;
		const evidence: RequestEvidence[] = [
			...request.evidence,
			{ stageId: request.stageId, occurredAt, source: "kill" },
		];
		const stages = stagesFor(request.terms);
		byId ??= { ...state.byId };
		byId[request.offerId] = {
			...request,
			evidence,
			stageId: stages[Math.min(evidence.length, stages.length - 1)],
			status:
				evidence.length === stages.length ? "ready-to-report" : "accepted",
		};
	}
	return byId ? { ...state, byId } : state;
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
	/** A family this build knows, read off the pairing table rather than
	 *  listed again — `jobs.ts`'s `FAMILY_OPERAND_KIND` is total over
	 *  `JobFamily`, so adding one there is what admits it here. */
	const knownFamily = (x: unknown): x is JobFamily =>
		typeof x === "string" && Object.hasOwn(FAMILY_OPERAND_KIND, x);
	/**
	 * §4's operand, checked by its own tag and against the family that owns it.
	 *
	 * **Two different guards, and it is worth saying which covers what.** The
	 * `switch`'s `never` default covers the **kind**: the day Bounty's target
	 * carrier or Salvage's wreck is written, this stops compiling rather than
	 * admitting a record it cannot read. `FAMILY_OPERAND_KIND` covers the
	 * **family**, and covers it at the same strength — it is a
	 * `Record<JobFamily, …>`, so a family added to that union stops the table
	 * compiling until it declares its operand.
	 *
	 * What neither covers is a new family whose operand is *also* cargo: that
	 * is a value in the table, not a type, and it is admitted the moment it is
	 * written there. An earlier version of this comment read as though the
	 * exhaustiveness reached that case too.
	 *
	 * The pairing is checked **against** the kind rather than beside it: a v5
	 * record pairing a cargo operand with a family that does not carry one is
	 * a record no binder wrote.
	 */
	const operandOk = (
		family: unknown,
		raw: unknown,
		requester: RequestStation,
	): boolean => {
		if (!raw || typeof raw !== "object") return false;
		// Read as an open record: the tag is not trusted until it is checked,
		// so no member of the union describes this object yet.
		const operand = raw as Record<string, unknown>;
		if (!knownFamily(family)) return false;
		const kind = operand.kind as JobOperand["kind"];
		if (FAMILY_OPERAND_KIND[family] !== kind) return false;
		switch (kind) {
			case "cargo":
				return (
					text(operand.goodName) &&
					Number.isInteger(operand.tonnes) &&
					(operand.tonnes as number) > 0 &&
					typeof operand.entrusted === "boolean"
				);
			case "target": {
				const key = operand.carrierKey;
				// #495 D4: a Bounty binder reads only its own system, so a target
				// in another one is a record no binder wrote.
				const system = (k: string) => k.slice(0, k.indexOf(":"));
				return (
					typeof key === "string" &&
					isCarrierKey(key) &&
					system(key) === system(requester.carrierKey) &&
					text(operand.targetName)
				);
			}
			default: {
				const unreachable: never = kind;
				void unreachable;
				return false;
			}
		}
	};
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
			// The second copy of the family list, retired: `operandOk` reads
			// the same table and this read it again, so a family added to one
			// and not the other would have been accepted by exactly one of
			// them. One owner, and it is `jobs.ts`.
			!knownFamily(o.family) ||
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
			!operandOk(o.family, o.operand, requester) ||
			!Number.isFinite(o.rewardCr) ||
			o.rewardCr < 0 ||
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
				// The source the family's stage takes, and only that one: a
				// courier settled by a kill is a record no action writes.
				e.source !== EVIDENCE_SOURCE[terms.family] ||
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
				source: e.source as EvidenceSource,
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
		const cargo = request ? cargoOf(request.terms) : null;
		if (
			l.lotId !== lotId ||
			!request ||
			!cargo?.entrusted ||
			!text(l.goodName) ||
			l.goodName !== cargo.goodName ||
			!Number.isInteger(l.aboardT) ||
			l.aboardT <= 0 ||
			l.aboardT > cargo.tonnes ||
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
