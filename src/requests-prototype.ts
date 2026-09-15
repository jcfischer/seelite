/** Node 343: bounded, fixture-backed request experiment. No relay/world model. */
import { type CarrierKey, carrierKey, isCarrierKey } from "./carrier-key";

export interface RequestStation {
	galaxyIndex: number;
	carrierKey: CarrierKey;
}
export interface PrototypeOffer {
	id: string;
	slot: "relay" | "survey";
	revision: 1;
	requester: RequestStation;
	requesterName: string;
	title: string;
	purpose: string;
	region: string;
	source: string;
	observedAt: number;
	danger: string;
	action: string;
	consequence: string;
	rewardCr: number;
	requiresWeapon: boolean;
	stages: string[];
}
export type PrototypeStatus =
	| "accepted"
	| "ready-to-report"
	| "completed"
	| "cancelled"
	| "failed";
export interface PrototypeRequest {
	offerId: string;
	terms: PrototypeOffer;
	acceptedAt: number;
	lastAcceptedAt: number;
	acceptanceOrdinal: number;
	status: PrototypeStatus;
	stageId: string;
	evidence: { stageId: string; occurredAt: number; source: "ui-fixture" }[];
	unavailableAt: number | null;
	settledAt: number | null;
	outcomeReason: string | null;
}
export interface RequestsPrototypeState {
	byId: Record<string, PrototypeRequest>;
	leadsById: Record<string, PrototypeOffer>;
	trackedRequestId: string | null;
}
export const emptyRequests = (): RequestsPrototypeState => ({
	byId: {},
	leadsById: {},
	trackedRequestId: null,
});
export function fixtureOffers(
	galaxyIndex: number,
	key: CarrierKey,
	name: string,
	observedAt: number,
): PrototypeOffer[] {
	const [system, ...local] = key.split(":");
	return (["relay", "survey"] as const).map((slot) => ({
		id: `request-v1/${galaxyIndex}/${system}/${encodeURIComponent(local.join(":"))}/${slot}`,
		slot,
		revision: 1,
		requester: { galaxyIndex, carrierKey: key },
		requesterName: name,
		title:
			slot === "relay" ? "Clear the survey route" : "Check the survey signal",
		purpose:
			slot === "relay"
				? "Stop hostile surveillance of local survey shipments."
				: "Corroborate the broker’s dated survey report.",
		region: `Outer approach region of ${name} in system ${system}; search region only`,
		source: `Survey broker at ${name}`,
		observedAt,
		danger: "Unconfirmed report. Pirates may intercept traffic.",
		action:
			slot === "relay"
				? "Search → identify pirate relay → disable → return and report"
				: "Search → identify survey signal → return and report",
		consequence:
			slot === "relay"
				? "Intended: deny relay surveillance on this survey route. Live effect awaits the relay experiment."
				: "Intended: corroborate the survey lead. This experiment issues no live world report.",
		rewardCr: slot === "relay" ? 250 : 75,
		requiresWeapon: slot === "relay",
		stages:
			slot === "relay"
				? ["search", "identify", "disable"]
				: ["search", "identify"],
	}));
}
export const activeRequest = (r: PrototypeRequest) =>
	r.status === "accepted" || r.status === "ready-to-report";
export function nextAction(r: PrototypeRequest): string {
	if (r.status === "ready-to-report")
		return `Return to ${r.terms.requesterName} · dock and Report`;
	if (!activeRequest(r)) return r.outcomeReason ?? r.status;
	if (r.unavailableAt !== null)
		return `Observed target unavailable · return to report information, or cancel`;
	if (r.stageId === "search") return `Search · ${r.terms.region}`;
	if (r.stageId === "identify")
		return "Identify the signal · exact target is not learned";
	return "Disable identified relay · UI fixture; live relay integration pending";
}
export function requestAction(
	state: RequestsPrototypeState,
	offers: PrototypeOffer[],
	action: string,
	id: string,
	ctx: { now: number; docked: RequestStation | null; armed: boolean },
) {
	const refuse = (message: string) => ({
		state,
		ok: false,
		message,
		rewardCr: 0,
	});
	const existing = state.byId[id];
	const offer =
		existing?.terms ?? offers.find((o) => o.id === id) ?? state.leadsById[id];
	if (!offer || !Number.isFinite(ctx.now) || ctx.now < offer.observedAt)
		return refuse("Offer unavailable or invalid observation time.");
	const atRequester =
		ctx.docked?.galaxyIndex === offer.requester.galaxyIndex &&
		ctx.docked?.carrierKey === offer.requester.carrierKey;
	if (action === "retain")
		return {
			state: {
				...state,
				leadsById: { ...state.leadsById, [id]: structuredClone(offer) },
			},
			ok: true,
			message: "Lead retained. No commitment accepted.",
			rewardCr: 0,
		};
	if (action === "accept") {
		if (!atRequester)
			return refuse("Dock at the requester to accept or reaccept.");
		if (existing && existing.status !== "cancelled")
			return refuse(
				"Already accepted or terminal; this offer cannot pay again.",
			);
		if (offer.requiresWeapon && !ctx.armed)
			return refuse("Requires an operational weapon. No cargo is required.");
		const evidence = existing?.evidence ?? [];
		const r: PrototypeRequest = {
			offerId: id,
			terms: structuredClone(offer),
			acceptedAt: existing?.acceptedAt ?? ctx.now,
			lastAcceptedAt: ctx.now,
			acceptanceOrdinal: (existing?.acceptanceOrdinal ?? 0) + 1,
			evidence,
			stageId: offer.stages[Math.min(evidence.length, offer.stages.length - 1)],
			status:
				evidence.length === offer.stages.length
					? "ready-to-report"
					: "accepted",
			unavailableAt: existing?.unavailableAt ?? null,
			settledAt: null,
			outcomeReason: null,
		};
		return {
			state: { ...state, byId: { ...state.byId, [id]: r } },
			ok: true,
			message: "Accepted. Choose Track to show its next action.",
			rewardCr: 0,
		};
	}
	if (!existing || !activeRequest(existing))
		return refuse("Choose an active request first.");
	if (ctx.now < existing.lastAcceptedAt)
		return refuse("Action predates acceptance.");
	if (action === "track" || action === "untrack")
		return {
			state: { ...state, trackedRequestId: action === "track" ? id : null },
			ok: true,
			message:
				action === "track"
					? "Tracking this request; flight target unchanged."
					: "Cue cleared; commitments remain.",
			rewardCr: 0,
		};
	let r = { ...existing };
	let rewardCr = 0;
	let message = "Request updated.";
	if (action === "cancel") {
		r.status = "cancelled";
		message =
			"Cancelled without fee. Unfinished work may be reaccepted at the requester.";
	} else if (action === "report") {
		if (r.status !== "ready-to-report" || !atRequester)
			return refuse(
				"Return, dock at the requester, and finish the objective before reporting.",
			);
		r.status = "completed";
		r.settledAt = ctx.now;
		rewardCr = r.terms.rewardCr;
		message = `Report accepted · ${rewardCr} Cr paid once (prototype tuning).`;
	} else if (action === "report-unavailable") {
		if (!atRequester || r.unavailableAt === null || r.status !== "accepted")
			return refuse(
				"Return to the requester to report the unavailable target.",
			);
		r.status = "failed";
		r.outcomeReason = "Reported unavailable target. No reward or penalty.";
		message = r.outcomeReason;
	} else if (action === "fixture-unavailable") {
		r.unavailableAt = ctx.now;
		message =
			"UI fixture: unavailable-target observation recorded; no world condition changed.";
	} else if (action.startsWith("fixture-")) {
		const stage = action.slice(8);
		if (
			r.status !== "accepted" ||
			r.unavailableAt !== null ||
			r.stageId !== stage
		)
			return refuse(
				"Complete the next valid stage; unavailable target needs report or cancellation.",
			);
		r.evidence = [
			...r.evidence,
			{ stageId: stage, occurredAt: ctx.now, source: "ui-fixture" },
		];
		r.stageId =
			r.terms.stages[Math.min(r.evidence.length, r.terms.stages.length - 1)];
		if (r.evidence.length === r.terms.stages.length)
			r.status = "ready-to-report";
		message = `UI fixture: ${stage} recorded. No live discovery, combat or route consequence claimed.`;
	} else return refuse("Unknown request action.");
	return {
		state: {
			...state,
			byId: { ...state.byId, [id]: r },
			trackedRequestId:
				state.trackedRequestId === id && !activeRequest(r)
					? null
					: state.trackedRequestId,
		},
		ok: true,
		message,
		rewardCr,
	};
}

/** Reject inconsistent experiment journals; never silently discard settlement. */
export function parseRequests(
	raw: unknown,
	now: number,
): RequestsPrototypeState {
	const bad = (): never => {
		throw new Error(
			"save: invalid Requests prototype journal (identity, terms, time or stage)",
		);
	};
	const obj = (x: unknown): Record<string, any> =>
		x && typeof x === "object" && !Array.isArray(x)
			? (x as Record<string, any>)
			: bad();
	const s = obj(raw);
	const byId = obj(s.byId);
	const leads = obj(s.leadsById);
	const time = (x: unknown) =>
		typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= now;
	const validateOffer = (raw: unknown, id: string): PrototypeOffer => {
		const o = obj(raw);
		const ref = obj(o.requester);
		if (
			!Number.isInteger(ref.galaxyIndex) ||
			ref.galaxyIndex < 0 ||
			ref.galaxyIndex >= 8 ||
			typeof ref.carrierKey !== "string" ||
			!isCarrierKey(ref.carrierKey)
		)
			bad();
		const [si, ...lc] = ref.carrierKey.split(":");
		if (
			!/^(0|[1-9]\d*)$/.test(si) ||
			+si > 255 ||
			!lc.join(":").startsWith("station-")
		)
			bad();
		if (o.slot !== "relay" && o.slot !== "survey") bad();
		const template = fixtureOffers(
			ref.galaxyIndex,
			carrierKey(+si, lc.join(":")),
			o.requesterName,
			o.observedAt,
		).find((o) => o.slot === rawSlot(raw));
		if (!template) return bad();
		if (
			id !== template.id ||
			o.id !== id ||
			o.revision !== 1 ||
			!time(o.observedAt) ||
			typeof o.requesterName !== "string"
		)
			bad();
		for (const key of Object.keys(template) as (keyof PrototypeOffer)[])
			if (JSON.stringify(o[key]) !== JSON.stringify(template[key])) bad();
		return template;
	};
	const out = emptyRequests();
	for (const id of Object.keys(leads).sort())
		out.leadsById[id] = validateOffer(leads[id], id);
	for (const id of Object.keys(byId).sort()) {
		const r = obj(byId[id]);
		const terms = validateOffer(r.terms, id);
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
		if (!Array.isArray(r.evidence) || r.evidence.length > terms.stages.length)
			bad();
		let previous = r.acceptedAt;
		for (let i = 0; i < r.evidence.length; i++) {
			const e = obj(r.evidence[i]);
			if (
				e.stageId !== terms.stages[i] ||
				e.source !== "ui-fixture" ||
				!time(e.occurredAt) ||
				e.occurredAt < previous
			)
				bad();
			previous = e.occurredAt;
		}
		const ready = r.evidence.length === terms.stages.length;
		if (
			r.stageId !==
				terms.stages[Math.min(r.evidence.length, terms.stages.length - 1)] ||
			(r.status === "accepted" && ready) ||
			(["ready-to-report", "completed"].includes(r.status) && !ready)
		)
			bad();
		if (
			(r.status === "completed") !== (r.settledAt !== null) ||
			(r.settledAt !== null &&
				(!time(r.settledAt) ||
					r.settledAt < previous ||
					r.settledAt < r.lastAcceptedAt))
		)
			bad();
		if (
			r.unavailableAt !== null &&
			(!time(r.unavailableAt) || r.unavailableAt < r.acceptedAt)
		)
			bad();
		if (
			r.status === "failed"
				? r.outcomeReason !==
						"Reported unavailable target. No reward or penalty." ||
					r.unavailableAt === null ||
					ready
				: r.outcomeReason !== null
		)
			bad();
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
				source: "ui-fixture",
			})),
			unavailableAt: r.unavailableAt,
			settledAt: r.settledAt,
			outcomeReason: r.outcomeReason,
		};
	}
	if (
		s.trackedRequestId !== null &&
		(typeof s.trackedRequestId !== "string" ||
			!out.byId[s.trackedRequestId] ||
			!activeRequest(out.byId[s.trackedRequestId]))
	)
		bad();
	out.trackedRequestId = s.trackedRequestId;
	return out;
}
const rawSlot = (raw: unknown) => (raw as PrototypeOffer).slot;
