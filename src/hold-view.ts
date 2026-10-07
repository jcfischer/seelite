/**
 * The Hold page on the right-hand console (#445).
 *
 * The hold was the one thing a pilot has to reason about that no screen
 * showed: the Market tab lists prices and shelves, the Requests tab lists
 * commitments, and neither says what is aboard. #411 made that sharper by
 * putting an 8 t consignment in the hold that cannot be sold and could not be
 * seen.
 *
 * **It computes no tonnage.** #443 owns the hold's arithmetic and #446 owns
 * the per-job query; a second count here would be the third authority on what
 * is aboard.
 *
 * It does compute **one** figure, and is the sole authority for it: a line's
 * worth at the current bid, `bid × amount`. No other screen produces that —
 * the Market tab prices one unit — so `tests/hold-view.test.ts` pins it
 * against figures chosen so the bid, the amount and the product are three
 * different numbers, and a swapped basis cannot read as the right one.
 *
 * It is **not** a claim about what selling the lot would realise: §5.2's stock
 * response moves the price as the pilot sells. The column says `AT THIS BID`
 * for that reason. A string builder beside `requests-view.ts` for
 * that module's reason: `live-cockpit.ts` is long, and a projection with
 * branches deserves its own rows.
 *
 * **It shows no purchase price.** `CommanderState.cargo` is a quantity per
 * good and no more, so the page shows what a good *fetches here* and never
 * what it cost. Since #564 the save does carry a purchase basis — the trade
 * ladder's, in `LadderRecord.basis` — but it is partial by design: goods
 * carried from a v6 save have none, and pay no margin. Whether this page
 * should print it is a question for a later node, not a figure to borrow.
 *
 * No DOM and no Three.js: this is a string.
 */
import type { HoldBids, HoldLine, HoldSummary } from "./hold";
import { escapeHtml as esc } from "./escape-html";
import { isRunning } from "./requests";

export const HOLD_STYLE = `
.lc-hold { display: grid; align-content: start; gap: 14px; width: 100%; max-width: 780px; }
.lc-hold-capacity { margin: 0; color: #fff0c9; font-size: 17px; letter-spacing: .06em; }
.lc-hold-capacity small { display: block; margin-top: 5px; color: #cb8c51; font-size: 11px; letter-spacing: .04em; }
.lc-hold-empty { margin: 0; color: #cb8c51; font-size: 12px; }
.lc-hold-head, .lc-hold-row { display: grid; grid-template-columns: minmax(0, 1fr) 92px 150px; gap: 18px; align-items: start; }
.lc-hold-head { color: #cb8c51; font-size: 10px; letter-spacing: .08em; border-bottom: 1px solid #58381d; padding-bottom: 6px; }
.lc-hold-row { padding: 10px 0; border-bottom: 1px solid #38220f; color: #ffe1a9; font-size: 13px; }
.lc-hold-row strong { display: block; font-weight: 600; letter-spacing: .04em; }
.lc-hold-row small { display: block; margin-top: 4px; color: #cb8c51; font-size: 11px; line-height: 1.45; }
.lc-hold-row[data-live-hold-owner="requester"] strong { color: #d8c08f; }
.lc-hold-amount, .lc-hold-value { text-align: right; white-space: nowrap; }
.lc-hold-value small { color: #a9814f; }
`;

/** The value column, and the rule that only the pilot's goods carry one. */
const valueCells = (line: HoldLine, bids: HoldBids): string => {
	// An entrusted lot is not the pilot's to sell (§4), so a figure beside it
	// is an invitation rather than information — and it would be the one number
	// on the page that no action can realise.
	const bid =
		line.owner === "pilot" ? (bids?.get(line.goodName) ?? null) : null;
	if (bid === null)
		return '<span class="lc-hold-value" data-live-hold-value>—</span>';
	// **At this bid, which is not the same as what selling it all would
	// fetch.** §5.2's stock response moves the price as the pilot sells, and
	// the till buys a tonne per press, so the extension is the lot's worth at
	// the price on the glass *now* — the figure that decides whether to sell
	// here at all. The column is headed `AT THIS BID` for that reason, and the
	// per-unit figure is printed beside it so a pilot can see which is which.
	return `<span class="lc-hold-value" data-live-hold-value>${(bid * line.amount).toFixed(1)} Cr<small>${bid.toFixed(1)} Cr each</small></span>`;
};

/** Whose the goods are, and for a consignment, where they have to end up. */
const ownerCell = (line: HoldLine): string => {
	if (line.kind === "fitting")
		return "<small data-live-hold-owner-note>yours · fitting · Equipment tab</small>";
	if (line.owner === "pilot")
		return "<small data-live-hold-owner-note>yours · sellable</small>";
	const note =
		"<small data-live-hold-owner-note>the requester's · cannot be sold</small>";
	const job = line.job;
	if (!job) return note;
	// A running job must **reach** its report station; one that is off must go
	// **back** to the requester. `status` is what picks between them, and a
	// page carrying one of the two would be right for half the journal.
	const returning = !isRunning(job.status);
	const where = returning ? job.returnToName : job.reportName;
	const verb = returning ? "return to" : "to";
	// Joined from the non-empty parts: an untitled job left a dangling
	// separator (`· to Reraus Gate`) at the head of the line.
	const clause = [job.title, `${verb} ${where}`].filter(Boolean).join(" · ");
	return `${note}<small>${esc(clause)}</small>`;
};

const row = (line: HoldLine, bids: HoldBids): string =>
	// **The good's name is a block of its own.** It ran straight into the owner
	// note on the first sheet — `Foodyours · sellable` — which is the kind of
	// defect no row can see and a glance catches at once.
	// **The offer id is on the row.** `compareLines` sorts requester lines by
	// it precisely because two consignments of one good can be aboard at once;
	// without it both rows share an identity and a probe's locator resolves to
	// two nodes instead of measuring either.
	`<div class="lc-hold-row" data-live-hold-row="${esc(line.goodName)}" data-live-hold-owner="${line.owner}"${line.job ? ` data-live-hold-offer="${esc(line.job.offerId)}"` : ""}><span class="lc-hold-good"><strong>${esc(line.goodName)}</strong>${ownerCell(line)}</span><span class="lc-hold-amount" data-live-hold-amount>${line.amount} ${esc(line.unit)}</span>${valueCells(line, bids)}</div>`;

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
	// The values note is about a column, so it is absent when there is no
	// column: docked with an empty hold the page used to announce values for a
	// table it does not draw.
	const note =
		hold.lines.length === 0
			? ""
			: `<small>${bids ? "Values are this station's bid." : "Values need a station."}</small>`;
	const capacity = `<p class="lc-hold-capacity" data-live-hold-capacity>${hold.usedT} / ${hold.capacityT} t · ${hold.freeT} t free${entrusted}${note}</p>`;
	if (hold.lines.length === 0)
		// **A sentence, not a blank.** An empty page reads as a page that failed
		// to load; the capacity is exactly what a pilot wants at that moment.
		return `<div class="lc-hold" data-live-hold>${capacity}<p class="lc-hold-empty" data-live-hold-empty>Nothing aboard. The hold takes ${hold.capacityT} t.</p></div>`;
	const head = `<div class="lc-hold-head"><span>GOOD</span><span class="lc-hold-amount">ABOARD</span><span class="lc-hold-value">AT THIS BID</span></div>`;
	return `<div class="lc-hold" data-live-hold>${capacity}${head}${hold.lines.map((line) => row(line, bids)).join("")}</div>`;
}
