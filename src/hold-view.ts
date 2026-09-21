/**
 * The Hold page on the right-hand console (#445).
 *
 * The hold was the one thing a pilot has to reason about that no screen
 * showed: the Market tab lists prices and shelves, the Requests tab lists
 * commitments, and neither says what is aboard. #411 made that sharper by
 * putting an 8 t consignment in the hold that cannot be sold and could not be
 * seen.
 *
 * **It renders `HoldSummary` and computes nothing.** #443 owns the arithmetic
 * and #446 owns the per-job query; a second count here would be the third
 * authority on what is aboard. A string builder beside `requests-view.ts` for
 * that module's reason: `live-cockpit.ts` is long, and a projection with
 * branches deserves its own rows.
 *
 * **There is no purchase price.** Nothing in the game records what a tonne
 * cost — `CommanderState.cargo` is a quantity per good and no more — so the
 * page shows what a good *fetches here* and never what it cost. Inventing a
 * cost basis is a save-shape decision and therefore a `SAVE_SCHEMA_VERSION`
 * question; it is not made here.
 *
 * No DOM and no Three.js: this is a string.
 */
import type { HoldLine, HoldSummary } from "./hold";

const esc = (x: string) =>
	x.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] as string,
	);

export const HOLD_STYLE = `
.lc-hold { display: grid; align-content: start; gap: 10px; }
.lc-hold-capacity { margin: 0; color: #ffe1a9; font-size: 13px; letter-spacing: .06em; }
.lc-hold-capacity small { display: block; margin-top: 4px; color: #cb8c51; font-size: 11px; letter-spacing: .04em; }
.lc-hold-empty { margin: 0; color: #cb8c51; font-size: 12px; }
.lc-hold-head, .lc-hold-row { display: grid; grid-template-columns: minmax(0, 1.4fr) 62px minmax(0, 1fr); gap: 10px; align-items: baseline; }
.lc-hold-head { color: #cb8c51; font-size: 10px; letter-spacing: .08em; border-bottom: 1px solid #58381d; padding-bottom: 5px; }
.lc-hold-row { padding: 6px 0; border-bottom: 1px solid #38220f; color: #ffe1a9; font-size: 12px; }
.lc-hold-row small { display: block; margin-top: 4px; color: #cb8c51; font-size: 11px; }
.lc-hold-row[data-live-hold-owner="requester"] { color: #d8c08f; }
.lc-hold-amount { text-align: right; white-space: nowrap; }
.lc-hold-value { text-align: right; white-space: nowrap; }
`;

/**
 * What one unit of a good fetches at the docked station — the **bid**, which
 * is what a sale is paid, not the ask.
 *
 * A map rather than a screen, so this module does not import the market: the
 * caller already has the priced rows and hands over the column it drew.
 * `null` means no station, which reads as a dash rather than as a stale
 * figure from wherever the ship last was.
 */
export type HoldBids = ReadonlyMap<string, number> | null;

/** The value column, and the rule that only the pilot's goods carry one. */
const valueCells = (line: HoldLine, bids: HoldBids): string => {
	// An entrusted lot is not the pilot's to sell (§4), so a figure beside it
	// is an invitation rather than information — and it would be the one number
	// on the page that no action can realise.
	const bid =
		line.owner === "pilot" ? (bids?.get(line.goodName) ?? null) : null;
	if (bid === null)
		return '<span class="lc-hold-value" data-live-hold-value>—</span>';
	return `<span class="lc-hold-value" data-live-hold-value>${(bid * line.amount).toFixed(1)} Cr<small>${bid.toFixed(1)} Cr each</small></span>`;
};

/** Whose the goods are, and for a consignment, where they have to end up. */
const ownerCell = (line: HoldLine): string => {
	if (line.owner === "pilot")
		return '<span class="lc-hold-owner" data-live-hold-owner-note>yours · sellable</span>';
	// A running job must **reach** its report station; a cancelled one must go
	// **back** to the requester. `jobStatus` is what picks between them, and a
	// page carrying one of the two would be right for half the journal.
	const returning =
		line.jobStatus === "cancelled" || line.jobStatus === "failed";
	const where = returning ? line.returnToName : line.reportName;
	const verb = returning ? "return to" : "to";
	return `<span class="lc-hold-owner" data-live-hold-owner-note>the requester's · cannot be sold</span><small>${esc(line.jobTitle ?? "")} · ${verb} ${esc(where ?? "—")}</small>`;
};

const row = (line: HoldLine, bids: HoldBids): string =>
	`<div class="lc-hold-row" data-live-hold-row="${esc(line.goodName)}" data-live-hold-owner="${line.owner}"><span>${esc(line.goodName)}${ownerCell(line)}</span><span class="lc-hold-amount" data-live-hold-amount>${line.amount} ${esc(line.unit)}</span>${valueCells(line, bids)}</div>`;

/**
 * The page.
 *
 * Capacity first, because it is the figure that decides a purchase and the one
 * #443 found a pilot could not see. Then one line per good, pilot-first in the
 * projection's own order.
 */
export function holdBody(hold: HoldSummary, bids: HoldBids): string {
	// Dropped rather than zeroed when no job's cargo is aboard, which is
	// `entrustedClause`'s rule one screen along (#443).
	const entrusted =
		hold.entrustedT > 0 ? ` · ${hold.entrustedT} t entrusted` : "";
	const capacity = `<p class="lc-hold-capacity" data-live-hold-capacity>${hold.usedT} / ${hold.capacityT} t · ${hold.freeT} t free${entrusted}<small>${bids ? "Values are this station's bid." : "Values need a station."}</small></p>`;
	if (hold.lines.length === 0)
		// **A sentence, not a blank.** An empty page reads as a page that failed
		// to load; the capacity is exactly what a pilot wants at that moment.
		return `<div class="lc-hold" data-live-hold>${capacity}<p class="lc-hold-empty" data-live-hold-empty>Nothing aboard. The hold takes ${hold.capacityT} t.</p></div>`;
	const head = `<div class="lc-hold-head"><span>GOOD</span><span class="lc-hold-amount">ABOARD</span><span class="lc-hold-value">FETCHES HERE</span></div>`;
	return `<div class="lc-hold" data-live-hold>${capacity}${head}${hold.lines.map((line) => row(line, bids)).join("")}</div>`;
}
