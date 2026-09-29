/**
 * The Commander page on the right-hand console (#564, #183 D9): the three
 * ladders, the rung each stands on, what the next one costs, and this flight's
 * credit that the next dock will bank.
 *
 * **A console tab, not the Commander overlay.** The overlay is out of fiction —
 * saves and slots (#304) — and play stays cockpit-only (map #460), so what the
 * pilot *is* lives on a wall of the cockpit beside Hold.
 *
 * **It computes no rung.** `ladder.ts` owns thresholds and rungs; this reads
 * them. The one figure it derives is the rate per hour, banked over
 * `playedS` — #562 D2's play log, which is what replaces the declared human
 * factor once a person has flown enough.
 *
 * No DOM and no Three.js: this is a string, on `hold-view.ts`'s pattern.
 */
import { escapeHtml as esc } from "./escape-html";
import {
	LADDERS,
	type Ladder,
	type LadderRecord,
	type PendingCredit,
	RUNG_NAMES,
	TOP_RUNG,
	rungOf,
	threshold,
} from "./ladder";

export const LADDER_STYLE = `
.lc-ladders { display: grid; align-content: start; gap: 12px; width: 100%; max-width: 780px; }
.lc-ladder-row { display: grid; grid-template-columns: 120px minmax(0, 1fr) 170px; gap: 16px; align-items: start; padding: 10px 0; border-bottom: 1px solid #38220f; color: #ffe1a9; font-size: 13px; }
.lc-ladder-row b { color: #cb8c51; font-size: 10px; letter-spacing: .08em; font-weight: 600; }
.lc-ladder-row strong { display: block; font-weight: 600; letter-spacing: .06em; color: #fff0c9; }
.lc-ladder-row small { display: block; margin-top: 4px; color: #cb8c51; font-size: 11px; line-height: 1.45; }
.lc-ladder-figure { text-align: right; white-space: nowrap; }
.lc-ladder-pending { color: #f5bd78; }
.lc-ladder-log, .lc-ladder-capstone { margin: 0; color: #cb8c51; font-size: 11px; letter-spacing: .04em; }
.lc-ladder-capstone { color: #fff0c9; }
`;

/**
 * Play below which no rate is shown. A rate over a few minutes is a figure
 * about the minutes — the first capture read 4,397 kill credit an hour off
 * one kill — and the log exists to be read against #562's 40 h, not against a
 * sortie.
 */
export const RATE_MIN_PLAYED_H = 1;

export interface LadderRow {
	ladder: Ladder;
	rung: number;
	name: string;
	banked: number;
	/** Earned since the last dock; the next dock banks it. Trade's is always 0,
	 *  because a sale and a settlement happen docked. */
	pending: number;
	next: { rung: number; name: string; at: number } | null;
	/** Banked credit per hour of play, or `null` under `RATE_MIN_PLAYED_H`. */
	perHour: number | null;
}

export interface LadderView {
	rows: readonly LadderRow[];
	playedH: number;
	capstone: boolean;
}

export function ladderView(
	record: LadderRecord,
	pending: PendingCredit,
): LadderView {
	const playedH = record.playedS / 3600;
	const pendingOf: Record<Ladder, number> = {
		combat: pending.combat,
		trade: 0,
		exploration: pending.systems.length,
	};
	return {
		rows: LADDERS.map((ladder) => {
			const banked = record.banked[ladder];
			const rung = rungOf(ladder, banked);
			return {
				ladder,
				rung,
				name: RUNG_NAMES[ladder][rung],
				banked,
				pending: pendingOf[ladder],
				next:
					rung >= TOP_RUNG
						? null
						: {
								rung: rung + 1,
								name: RUNG_NAMES[ladder][rung + 1],
								at: threshold(ladder, rung + 1),
							},
				perHour: playedH >= RATE_MIN_PLAYED_H ? banked / playedH : null,
			};
		}),
		playedH,
		capstone: record.capstoneAt !== null,
	};
}

/** Each ladder's figure in its own unit: margin in credits, kills to one
 *  decimal, kinds whole. */
const FIGURE: Record<Ladder, (n: number) => string> = {
	combat: (n) => n.toFixed(1),
	trade: (n) => `${Math.floor(n).toLocaleString("en-US")} Cr`,
	exploration: (n) => String(Math.floor(n)),
};

/** A threshold in the same units, **rounded up**: a rung is reached at or
 *  above it, so a figure rounded down names a total that does not reach it —
 *  exploration's rung 1 is 8.24 kinds, and "AT 8" would be a lie at 8. */
const THRESHOLD: Record<Ladder, (n: number) => string> = {
	combat: (n) => (Math.ceil(n * 10 - 1e-9) / 10).toFixed(1),
	trade: (n) => `${Math.ceil(n - 1e-9).toLocaleString("en-US")} Cr`,
	exploration: (n) => String(Math.ceil(n - 1e-9)),
};

const UNIT: Record<Ladder, string> = {
	combat: "KILL CREDIT",
	trade: "REALISED MARGIN",
	exploration: "FIRST VISITS AND DOCKS",
};

/**
 * A stable string of what the page shows, for the cockpit's markup key: the
 * page re-renders when a figure it prints changes and not on every frame's
 * `playedS`.
 */
export const ladderViewKey = (view: LadderView): string =>
	`${view.rows.map((r) => `${r.rung}:${FIGURE[r.ladder](r.banked)}:${r.pending.toFixed(1)}`).join(",")}|${view.playedH.toFixed(1)}|${view.capstone}`;

/**
 * The inputs `ladderView` reads, as a string: a caller memoises the view on
 * it, since the cockpit state is built every frame and the page is one tab of
 * six. `playedS` enters in six-minute steps, the resolution the page prints.
 */
export const ladderInputKey = (
	record: LadderRecord,
	pending: PendingCredit,
): string =>
	`${LADDERS.map((l) => record.banked[l]).join(",")}|${pending.combat}|${pending.systems.length}|${Math.floor(record.playedS / 360)}|${record.capstoneAt}`;

export function commanderBody(view: LadderView): string {
	const rows = view.rows
		.map((row) => {
			const figure = FIGURE[row.ladder];
			const pending =
				row.pending > 0
					? `<small class="lc-ladder-pending" data-live-ladder-pending>+${figure(row.pending)} UNBANKED</small>`
					: "";
			const next = row.next
				? `<small>NEXT ${esc(row.next.name.toUpperCase())} AT ${THRESHOLD[row.ladder](row.next.at)}</small>`
				: "<small>TOP RUNG</small>";
			const rate =
				row.perHour === null
					? ""
					: `<small>${figure(row.perHour)} PER HOUR</small>`;
			return `<div class="lc-ladder-row" data-live-ladder="${row.ladder}" data-live-ladder-rung="${row.rung}"><span><b>${row.ladder.toUpperCase()}</b><small>${UNIT[row.ladder]}</small></span><span><strong>RUNG ${row.rung} · ${esc(row.name.toUpperCase())}</strong>${next}</span><span class="lc-ladder-figure"><strong>${figure(row.banked)}</strong>${pending}${rate}</span></div>`;
		})
		.join("");
	const capstone = view.capstone
		? '<p class="lc-ladder-capstone" data-live-capstone>ALL THREE LADDERS AT THE TOP</p>'
		: "";
	return `<div class="lc-ladders" data-live-ladders>${rows}${capstone}<p class="lc-ladder-log">BANKED ON DOCK · ${view.playedH.toFixed(1)} H PLAYED</p></div>`;
}
