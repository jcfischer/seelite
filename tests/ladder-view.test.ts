/**
 * #564: the Commander page on the right console — the three ladders (#183 D9).
 *
 * Rows on the string builder, for `hold-view.ts`'s reason: a probe reads one
 * rendered case and a branch needs rows.
 */
import { describe, expect, test } from "bun:test";
import {
	LADDER_TOP,
	type LadderRecord,
	RUNG_NAMES,
	emptyLadderRecord,
	emptyPending,
	threshold,
} from "../src/ladder";
import {
	RATE_MIN_PLAYED_H,
	commanderBody,
	ladderView,
} from "../src/ladder-view";

const record = (over: Partial<LadderRecord> = {}): LadderRecord => ({
	...emptyLadderRecord(),
	...over,
});

describe("the view", () => {
	test("a new pilot stands on rung 0 of all three, with the next rung named", () => {
		const view = ladderView(record(), emptyPending());
		expect(view.rows.map((r) => r.ladder)).toEqual([
			"combat",
			"trade",
			"exploration",
		]);
		for (const row of view.rows) {
			expect(row.rung).toBe(0);
			expect(row.name).toBe(RUNG_NAMES[row.ladder][0]);
			expect(row.next).toEqual({
				rung: 1,
				name: RUNG_NAMES[row.ladder][1],
				at: threshold(row.ladder, 1),
			});
		}
	});

	test("pending credit is shown beside the banked figure, and not banked", () => {
		const view = ladderView(record(), {
			combat: 0.75,
			systems: [{ galaxyIndex: 0, systemIndex: 4 }],
		});
		const combat = view.rows.find((r) => r.ladder === "combat");
		const exploration = view.rows.find((r) => r.ladder === "exploration");
		expect(combat?.banked).toBe(0);
		expect(combat?.pending).toBe(0.75);
		expect(exploration?.pending).toBe(1);
		// Trade is banked at the console, so it never has a pending figure.
		expect(view.rows.find((r) => r.ladder === "trade")?.pending).toBe(0);
	});

	test("the top rung has no next", () => {
		const view = ladderView(
			record({
				banked: { combat: LADDER_TOP.combat, trade: 0, exploration: 0 },
			}),
			emptyPending(),
		);
		expect(view.rows[0].rung).toBe(8);
		expect(view.rows[0].next).toBeNull();
	});

	test("the play log turns banked credit into a rate per hour", () => {
		const view = ladderView(
			record({
				banked: { combat: 3, trade: 20_000, exploration: 40 },
				playedS: 7200,
			}),
			emptyPending(),
		);
		expect(view.playedH).toBe(2);
		expect(view.rows.map((r) => r.perHour)).toEqual([1.5, 10_000, 20]);
	});

	test("no rate under an hour of play", () => {
		for (const playedS of [0, 60, RATE_MIN_PLAYED_H * 3600 - 1]) {
			const view = ladderView(
				record({ banked: { combat: 1, trade: 1, exploration: 1 }, playedS }),
				emptyPending(),
			);
			expect(view.rows.every((r) => r.perHour === null)).toBe(true);
		}
	});
});

describe("the body", () => {
	test("names every ladder, its rung and the next rung", () => {
		const html = commanderBody(ladderView(record(), emptyPending()));
		for (const ladder of ["COMBAT", "TRADE", "EXPLORATION"])
			expect(html).toContain(ladder);
		expect(html).toContain(RUNG_NAMES.trade[0].toUpperCase());
		expect(html).toContain(RUNG_NAMES.trade[1].toUpperCase());
		expect(html).toContain('data-live-ladder="trade"');
	});

	test("shows this flight's pending credit as unbanked", () => {
		const html = commanderBody(
			ladderView(record(), { combat: 1.25, systems: [] }),
		);
		expect(html).toContain("+1.3 UNBANKED");
	});

	test("says the capstone is reached, and nothing more", () => {
		const html = commanderBody(
			ladderView(record({ capstoneAt: 1000 }), emptyPending()),
		);
		expect(html).toContain("data-live-capstone");
	});
});
