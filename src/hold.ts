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
 * **Nothing it reads may import it back.** It reads `station-commerce`,
 * `requests` and `market`, and the first two are read by the till; an import
 * the other way would make the hold's *screen* a dependency of the hold's
 * *rules*. `tests/headless.test.ts` names those three and scans them. Modules
 * *above* it read it freely — `main.ts` calls `holdSummary` and
 * `live-cockpit.ts` names `HoldSummary` as a type — which is the direction the
 * projection exists for.
 *
 * No DOM and no Three.js: what is aboard is arithmetic and text.
 */
import { type CommodityUnit, commodity } from "./market";
import { type RequestsState, entrustedTonnesAboard } from "./requests";
import type { RequestStation, RequestStatus } from "./requests";
import { type CommanderState, commanderHold } from "./station-commerce";

/** Whose goods a line is. The requester's are excluded from sale (§4). */
export type HoldOwner = "pilot" | "requester";

export interface HoldLine {
	goodName: string;
	/**
	 * The amount aboard in the good's **native** unit — tonnes for fourteen of
	 * the seventeen, kilogrammes for Gold and Platinum, grammes for
	 * Gem-Stones.
	 *
	 * **`amount`, not `tonnes`.** Three of the seventeen goods are not tonnes
	 * and take no room at all, so a field with a `t` in its name invites a
	 * consumer to sum the column for a hold figure and be silently wrong by
	 * however much Gold is aboard. The tonne figures carry the suffix —
	 * `usedT`, `capacityT`, `freeT`, `entrustedT` — and this one travels with
	 * its `unit`.
	 */
	amount: number;
	unit: CommodityUnit;
	owner: HoldOwner;
	/**
	 * The job this lot belongs to — **present exactly on a requester line**.
	 *
	 * One field rather than six optionals. They were six, and they are
	 * all-present-or-all-absent together, so every consumer coalesced each one
	 * against a fallback that could not fire for a well-formed line and the
	 * next field on a consignment would have added a seventh.
	 */
	job?: HoldJob;
	kind?: "fitting" | "ore";
}

/** Where a consignment has to end up, and which end applies. */
export interface HoldJob {
	offerId: string;
	title: string;
	status: RequestStatus;
	/** Where the goods go back to if the job is off. */
	returnTo: RequestStation;
	returnToName: string;
	/** Where they must reach while the job is running. */
	reportName: string;
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

/**
 * Pilot lines first, then alphabetical, then by job — a stable render order.
 *
 * **Three-way at every step, including the last.** The offer arm returned `1`
 * for both `(a, b)` and `(b, a)` when the ids matched, which is an inconsistent
 * comparator: unreachable today, because a pilot's goods are unique keys and
 * one job issues one lot, and wrong the moment a requester carries two lots of
 * one good.
 */
const compareLines = (a: HoldLine, b: HoldLine): number => {
	if (a.owner !== b.owner) return a.owner === "pilot" ? -1 : 1;
	if (a.goodName !== b.goodName) return a.goodName < b.goodName ? -1 : 1;
	const left = a.job?.offerId ?? "";
	const right = b.job?.offerId ?? "";
	if (left === right) return 0;
	return left < right ? -1 : 1;
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
	// A cargo key is a commodity name by the time it reaches here: #443 added
	// the check to `save-envelope.ts` beside the hull's, because the quantity
	// was validated at the boundary and the name was not — so an unrecognised
	// good used to survive the load and throw on the first console update.
	for (const [goodName, amount] of Object.entries(commander.cargo)) {
		if (amount <= 0) continue;
		lines.push({
			goodName,
			amount,
			unit: commodity(goodName).unit,
			owner: "pilot",
		});
	}
	for (const item of commander.recoveredFittings ?? [])
		lines.push({
			goodName: item.id,
			amount: item.tonnes,
			unit: "t",
			owner: "pilot",
			kind: "fitting",
		});
	for (const lot of Object.values(requests.entrustedByLotId)) {
		const request = requests.byId[lot.offerId];
		// A journal fault, not a drawable state: the lot map and `byId` are
		// written by one verb, so a lot without its request means one of the two
		// was restored without the other. Drawing a nameless line would put a
		// hold on the glass that no journal backs.
		//
		// **And this runs on every console update, so the throw takes the docked
		// screen with it rather than degrading one line.** That is the intended
		// severity, and the reason it is reachable at all only through a bug:
		// `parseRequests` refuses a lot whose `offerId` is not a key of `byId`
		// (`requests.ts`, the `for (const lotId of Object.keys(lots)...)` loop),
		// so a restored journal cannot arrive in this state. A cockpit drawing a
		// hold nobody can account for is worse than one that stops.
		if (!request)
			throw new Error(
				`hold: entrusted lot ${lot.lotId} has no request ${lot.offerId} (#443)`,
			);
		// **The lot's amount is `aboardT` and the unit must agree with its
		// name.** `bindCourier` picks a tonne good and `entrustedTonnesAboard`
		// sums these into the capacity figure, so a kilogramme lot would be
		// counted as tonnes by the till while the line printed kg beside it —
		// which is the mismatch `amount`'s own doc argues the field exists to
		// prevent. It is an invariant of the binder rather than of the type, so
		// it is checked where the two meet.
		const unit =
			lot.itemKind === "fitting" ? "t" : commodity(lot.goodName).unit;
		if (unit !== "t")
			throw new Error(
				`hold: entrusted lot ${lot.lotId} is ${lot.goodName}, which is ${unit} and not tonnes (#443)`,
			);
		lines.push({
			goodName: lot.goodName,
			amount: lot.aboardT,
			unit,
			owner: "requester",
			...(lot.itemKind === "fitting" ? { kind: "fitting" as const } : {}),
			job: {
				offerId: lot.offerId,
				title: request.terms.title,
				status: request.status,
				returnTo: lot.returnTo,
				returnToName: request.terms.requesterName,
				reportName: request.terms.reportName,
			},
		});
	}
	lines.sort(compareLines);
	return { usedT, capacityT, freeT: capacityT - usedT, entrustedT, lines };
}

/**
 * How much of a job's good is aboard **for that job** (#446).
 *
 * Here rather than in the view, because deciding what a line means for a job
 * is a fact about the projection: a requester's line belongs to the offer it
 * names, and a pilot's line to nobody. A second reading of that in a screen is
 * a second authority, and the till and the button could then drift apart on
 * line ownership with neither file noticing.
 *
 * Takes the three fields it reads rather than a `JobOffer`, so this module
 * stays below `jobs.ts` as well as below the screens.
 *
 * **Tonne lines only.** The total is compared against a job's tonnage, and
 * Gold is kilogrammes — a non-tonne line of the same name added in would be
 * counted as tonnes and could enable a control the till then refuses.
 */
export const aboardForOffer = (
	hold: HoldSummary | null,
	offer: { id: string; goodName: string; entrusted: boolean },
): number =>
	(hold?.lines ?? [])
		.filter(
			(line) =>
				line.unit === "t" &&
				(offer.entrusted
					? line.owner === "requester" && line.job?.offerId === offer.id
					: line.owner === "pilot" &&
						line.kind !== "fitting" &&
						line.goodName === offer.goodName),
		)
		.reduce((sum, line) => sum + line.amount, 0);

/**
 * The pilot's own goods, by name, in each good's native unit — the Market
 * tab's HELD column (#473 D10).
 *
 * Off the projection rather than off `commander.cargo`, so this module stays
 * the one place that decides which lines are the pilot's: a requester's lot
 * is not per good on the market screen, and the hold line carries its share.
 */
export const pilotGoods = (
	hold: HoldSummary,
): Readonly<Record<string, number>> =>
	Object.fromEntries(
		hold.lines
			.filter((line) => line.owner === "pilot" && line.kind !== "fitting")
			.map((line) => [line.goodName, line.amount]),
	);

/**
 * What the docked station pays for one unit of each good it trades (#445).
 *
 * The **bid**, which is what a sale is paid — not the ask a BUY column shows.
 * A map rather than a screen, so a renderer does not import the market: the
 * caller already has the priced rows and hands over the column it drew.
 * `null` means no station, which reads as a dash rather than as a figure from
 * wherever the ship last was.
 *
 * Here beside `HoldSummary` rather than in `hold-view.ts`: it is the shape
 * `main.ts` produces, and a producer that had to import the presentation
 * module for it would have the dependency backwards.
 */
export type HoldBids = ReadonlyMap<string, number> | null;
