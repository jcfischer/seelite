/**
 * Node 445: the Hold page on the right-hand console.
 *
 * The hold is the one thing a pilot has to reason about that no screen showed.
 * #443 put a line on the trade screen and #446 put ownership into the words on
 * a control; this is the whole of what is aboard, and it renders from the **same**
 * projection so the three cannot disagree.
 *
 * Rows on the string builder rather than the DOM, for `requests-view.ts`'s
 * reason: a probe reads one rendered case and a branch needs rows.
 */
import { describe, expect, test } from "bun:test";
import type { CarrierKey } from "../src/carrier-key";
import type { HoldJob, HoldSummary } from "../src/hold";
import type { RequestStatus } from "../src/requests";
import { holdBody } from "../src/hold-view";
import { codeOf } from "./lib/source-scan";

const KEY = "0:3:station-trade" as CarrierKey;

const summary = (over: Partial<HoldSummary> = {}): HoldSummary => ({
	usedT: 0,
	capacityT: 20,
	freeT: 20,
	entrustedT: 0,
	lines: [],
	...over,
});

/** A hold carrying one 8 t consignment and nothing of the pilot's. */
const entrustedHold = (jobOver: Partial<HoldJob> = {}) =>
	summary({
		usedT: 8,
		freeT: 12,
		entrustedT: 8,
		lines: [requesterLine(jobOver)],
	});

const pilotLine = (goodName: string, amount: number) => ({
	goodName,
	amount,
	unit: "t" as const,
	owner: "pilot" as const,
});

const requesterLine = (jobOver: Partial<HoldJob> = {}) => ({
	goodName: "Food",
	amount: 8,
	unit: "t" as const,
	owner: "requester" as const,
	job: {
		offerId: "job-1",
		title: "Grain for the yards",
		status: "accepted" as RequestStatus,
		returnTo: { galaxyIndex: 0, carrierKey: KEY },
		returnToName: "Lave Ring",
		reportName: "Reraus Gate",
		...jobOver,
	},
});

describe("capacity comes first, because it is what decides a purchase", () => {
	test("the line reads used, capacity and free", () => {
		const html = holdBody(
			summary({
				usedT: 16,
				capacityT: 20,
				freeT: 4,
				lines: [pilotLine("Food", 16)],
			}),
			null,
		);
		expect(html).toContain("16 / 20 t");
		expect(html).toContain("4 t free");
	});

	test("an entrusted share is named, and absent when there is none", () => {
		expect(holdBody(entrustedHold(), null)).toContain("8 t entrusted");
		expect(
			holdBody(summary({ lines: [pilotLine("Food", 0)] }), null),
		).not.toContain("entrusted");
	});

	test("an over-capacity hold is shown, not floored", () => {
		// `HoldSummary.freeT` is unfloored on purpose (#443), and the page is
		// where a pilot would find out.
		expect(
			holdBody(summary({ usedT: 30, capacityT: 20, freeT: -10 }), null),
		).toContain("-10 t free");
	});
});

describe("an empty hold is a sentence, not a blank", () => {
	test("docked with nothing aboard it promises no values", () => {
		// The values note is about a column, and there is no column.
		const html = holdBody(summary(), new Map([["Food", 5.2]]));
		expect(html).not.toMatch(/Values/);
		expect(html).toMatch(/nothing aboard/i);
	});

	test("it says so, and still says the capacity", () => {
		const html = holdBody(summary(), null);
		expect(html).toMatch(/nothing aboard/i);
		expect(html).toContain("20 t");
		// And no table of nothing.
		expect(html).not.toContain("data-live-hold-row");
	});
});

describe("ownership is the fact the page exists for", () => {
	test("a pilot's line says the goods are theirs and can be sold", () => {
		const html = holdBody(
			summary({ usedT: 6, freeT: 14, lines: [pilotLine("Textiles", 6)] }),
			null,
		);
		expect(html).toContain('data-live-hold-row="Textiles"');
		expect(html).toContain("6 t");
		expect(html).toMatch(/yours/i);
	});

	test("a requester's line names the job and where the goods must reach", () => {
		const html = holdBody(
			summary({ usedT: 8, freeT: 12, entrustedT: 8, lines: [requesterLine()] }),
			null,
		);
		expect(html).toContain("Grain for the yards");
		expect(html).toContain("Reraus Gate");
		expect(html).toMatch(/requester/i);
		// Not sellable, and the page says so rather than leaving a blank.
		expect(html).toMatch(/cannot be sold/i);
	});

	test("a cancelled job's consignment says where it must go back", () => {
		const html = holdBody(entrustedHold({ status: "cancelled" }), null);
		expect(html).toContain("Lave Ring");
		expect(html).toMatch(/return/i);
	});

	test("a non-tonne good keeps its own unit", () => {
		const html = holdBody(
			summary({
				lines: [{ goodName: "Gold", amount: 40, unit: "kg", owner: "pilot" }],
			}),
			null,
		);
		expect(html).toContain("40 kg");
	});
});

describe("what it fetches here is a docked fact", () => {
	test("docked, the station's bid stands against each good", () => {
		// **Three different numbers on purpose.** The bid is 12.4, the amount is
		// 6 and the extension is 74.4, so a build that printed the bid twice,
		// the amount twice, or divided instead of multiplying cannot read as
		// this one. This module is the sole authority for the extension — the
		// Market tab prices a unit and nothing else produces `bid × amount`.
		const html = holdBody(
			summary({ usedT: 6, freeT: 14, lines: [pilotLine("Textiles", 6)] }),
			new Map([["Textiles", 12.4]]),
		);
		expect(html).toContain("12.4 Cr each");
		expect(html).toContain("74.4 Cr");
	});

	test("the extension is the bid times the amount, at a second pair", () => {
		// A single pair can be satisfied by a coincidence of one arithmetic;
		// a second pair with a different ratio cannot.
		const html = holdBody(
			summary({ usedT: 3, freeT: 17, lines: [pilotLine("Alloys", 3)] }),
			new Map([["Alloys", 20.5]]),
		);
		expect(html).toContain("61.5 Cr");
		expect(html).toContain("20.5 Cr each");
	});

	test("away from a station the column is a dash, never a stale number", () => {
		const html = holdBody(
			summary({ usedT: 6, freeT: 14, lines: [pilotLine("Textiles", 6)] }),
			null,
		);
		expect(html).toContain("—");
		expect(html).not.toContain("Cr");
	});

	test("a good this station does not trade reads as a dash while docked", () => {
		const html = holdBody(
			summary({ usedT: 1, freeT: 19, lines: [pilotLine("Narcotics", 1)] }),
			new Map([["Textiles", 12.4]]),
		);
		expect(html).toContain("—");
	});

	test("an entrusted line is never priced, even docked", () => {
		// It is not the pilot's to sell, so a figure beside it is an invitation.
		const html = holdBody(
			summary({ usedT: 8, freeT: 12, entrustedT: 8, lines: [requesterLine()] }),
			new Map([["Food", 5.2]]),
		);
		expect(html).not.toContain("5.2 Cr");
	});
});

describe("a consignment with no title still reads", () => {
	test("an untitled job leaves no dangling separator", () => {
		const html = holdBody(entrustedHold({ title: "" }), null);
		expect(html).not.toContain(" · to Reraus Gate");
		expect(html).toContain("to Reraus Gate");
	});

	test("a completed job's consignment reads as a job that is off", () => {
		// `isRunning` is an allow-list on `RequestStatus`, so every terminal
		// state — and any state added later — reads as *return* rather than as
		// *carry these somewhere for a job that has ended*.
		for (const status of ["completed", "cancelled", "failed"] as const) {
			const html = holdBody(entrustedHold({ status }), null);
			expect(html, status).toContain("return to Lave Ring");
		}
	});
});

describe("the markup is escaped where it interpolates", () => {
	test("a job title with markup in it is escaped", () => {
		const html = holdBody(entrustedHold({ title: "<b>boom</b>" }), null);
		expect(html).not.toContain("<b>boom</b>");
		expect(html).toContain("&lt;b&gt;boom&lt;/b&gt;");
	});
});

describe("the right console's tab order", () => {
	// **A headless row, because the probe that pinned this is red.**
	// `probe-controls-reference` asserts the rendered order and is red on both
	// trees for an unrelated reason (#441) — so when #445's new tab broke that
	// row, the failure was indistinguishable from the standing one. A standing
	// red is exactly where a real regression hides.
	test("Hold sits with the readouts and Controls stays immediately before Tuning", () => {
		const source = codeOf("src/live-cockpit.ts");
		const listed = /const RIGHT_TABS: readonly RightTab\[\] = \[([\s\S]*?)\];/
			.exec(source)?.[1]
			.match(/"([A-Za-z]+)"/g)
			?.map((q) => q.slice(1, -1));
		expect(listed).toEqual(["Flight", "Drive", "Hold", "Controls", "Tuning"]);
		// #370 D1's rule, stated as the rule rather than as the whole list, so
		// a later tab that keeps it does not have to edit this line too.
		const i = listed?.indexOf("Controls") ?? -1;
		expect(listed?.[i + 1]).toBe("Tuning");
	});
});

describe("the page's own markup carries what the first sheet lacked", () => {
	// The hold's table shipped once inside `.lc-panel-body`'s 135 px rail
	// column, which a glance caught and no row expressed. **These rows guard
	// the wiring, not the layout** — that the Hold branch carries the class and
	// that the class has a rule — and a rewrite that keeps both and still
	// renders badly passes them. Whether the page *reads* well is the node's
	// third tier and belongs to a person; what these stop is the class or the
	// rule being deleted by accident.
	//
	// **On the source, not on the rendered panel.** `rightBody` is private and
	// `STYLE` is module-local; exporting either so a test can reach it would be
	// production surface existing for one caller. `tests/headless.test.ts` reads
	// this repo's own source for the same reason: the failure is a line someone
	// writes, and the line is what this can see.
	const source = codeOf("src/live-cockpit.ts");

	test("the Hold tab's body collapses the rail-and-copy grid", () => {
		expect(source).toContain('"lc-panel-body lc-hold-body"');
		// And it is the Hold branch that carries it.
		expect(source).toMatch(
			/state\.rightTab === "Hold"[\s\S]{0,600}lc-panel-body lc-hold-body/,
		);
	});

	test("the stylesheet gives that class a single column", () => {
		expect(source).toContain(
			".lc-panel-body.lc-hold-body { grid-template-columns: 1fr; }",
		);
	});

	test("the class appears once, so no other tab quietly takes it", () => {
		expect(source.match(/lc-hold-body/g)).toHaveLength(2);
	});
});
