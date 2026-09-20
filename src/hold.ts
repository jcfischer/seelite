/**
 * What is aboard, who owns it, and how much room is left — one projection.
 *
 * #443 opened on a till that sold 11 t of Food into a 20 t hull and said
 * nothing. Every figure was right: 8 t of the hold was a courier's consignment
 * and 1 t was Radioactives, so 11 t was exactly what fitted. A rule the player
 * cannot see is indistinguishable from one that is wrong, and the reason the
 * screen could not say it is that the hold was never projected anywhere — the
 * Market tab knows prices, the Requests tab knows commitments, and neither
 * knows what is in the ship.
 *
 * **The capacity is not re-derived here.** `usedT` and `capacityT` come from
 * `commanderHold`, which is what `transactAtStation` refuses against, so the
 * screen and the till cannot disagree about whether a Large Cargo Bay counts
 * (#181) or whether an entrusted lot occupies the hold (#411 §4). A second
 * count would be the #193 defect one module along: a figure the player reads
 * and a figure the till charges, drifting apart.
 *
 * **Nothing may import this.** It reads `station-commerce` and `requests`, and
 * both of those are read by the till; an import back the other way would make
 * the hold's *screen* a dependency of the hold's *rules*.
 * `tests/headless.test.ts` holds that direction.
 *
 * No DOM and no Three.js: what is aboard is arithmetic and text.
 */
import { type CommodityUnit, commodity } from "./market";
import { type RequestsState, entrustedTonnesAboard } from "./requests";
import type { RequestStation } from "./requests";
import { type CommanderState, commanderHold } from "./station-commerce";

/** Whose goods a line is. The requester's are excluded from sale (§4). */
export type HoldOwner = "pilot" | "requester";

export interface HoldLine {
	goodName: string;
	/**
	 * The amount aboard in the good's **native** unit — tonnes for fourteen of
	 * the seventeen, kilogrammes for Gold and Platinum, grammes for
	 * Gem-Stones. The field is named for the common case and `unit` is what a
	 * renderer prints beside it; the three exceptions take no room at all,
	 * which is why `usedT` does not move for them.
	 */
	tonnes: number;
	unit: CommodityUnit;
	owner: HoldOwner;
	/** Requester lines only: the job, and where the goods must reach or return. */
	offerId?: string;
	jobTitle?: string;
	returnTo?: RequestStation;
}

export interface HoldSummary {
	usedT: number;
	capacityT: number;
	/**
	 * `capacityT - usedT`, **unfloored**.
	 *
	 * A `Math.max(0, …)` here would print `0 t free` over a hold that is past
	 * its capacity, which is the one state a pilot most needs to be told about.
	 * #30 spent a review round on a penetration figure that floored at zero and
	 * so read identically for a ship stopped clear of a surface and one
	 * standing on it; this is that shape at the till.
	 */
	freeT: number;
	entrustedT: number;
	lines: readonly HoldLine[];
}

/** Pilot lines first, then alphabetical, then by job — a stable render order. */
const compareLines = (a: HoldLine, b: HoldLine): number => {
	if (a.owner !== b.owner) return a.owner === "pilot" ? -1 : 1;
	if (a.goodName !== b.goodName) return a.goodName < b.goodName ? -1 : 1;
	return (a.offerId ?? "") < (b.offerId ?? "") ? -1 : 1;
};

/**
 * The hold as one screen-ready projection, from the two states that own it.
 *
 * The commander owns ordinary cargo; the journal owns the entrusted lots. They
 * are never merged into one map — §4 is explicit that a display-only deduction
 * is insufficient — so this is where the two are read side by side and the
 * only place that knows they are two.
 */
export function holdSummary(
	commander: CommanderState,
	requests: RequestsState,
): HoldSummary {
	const entrustedT = entrustedTonnesAboard(requests);
	const { usedT, capacityT } = commanderHold(commander, entrustedT);
	const lines: HoldLine[] = [];
	for (const [goodName, amount] of Object.entries(commander.cargo)) {
		if (amount <= 0) continue;
		lines.push({
			goodName,
			tonnes: amount,
			unit: commodity(goodName).unit,
			owner: "pilot",
		});
	}
	for (const lot of Object.values(requests.entrustedByLotId)) {
		const request = requests.byId[lot.offerId];
		// A journal fault, not a drawable state: the lot map and `byId` are
		// written by one verb, so a lot without its request means one of the two
		// was restored without the other. Drawing a nameless line would put a
		// hold on the glass that no journal backs.
		if (!request)
			throw new Error(
				`hold: entrusted lot ${lot.lotId} has no request ${lot.offerId} (#443)`,
			);
		lines.push({
			goodName: lot.goodName,
			tonnes: lot.aboardT,
			unit: commodity(lot.goodName).unit,
			owner: "requester",
			offerId: lot.offerId,
			jobTitle: request.terms.title,
			returnTo: lot.returnTo,
		});
	}
	lines.sort(compareLines);
	return { usedT, capacityT, freeT: capacityT - usedT, entrustedT, lines };
}
