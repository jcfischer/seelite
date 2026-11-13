import { describe, expect, test } from "bun:test";
import {
	NAV_ARMS,
	NAV_CONTROL,
	NAV_FRAME_BUDGET_MS,
	LATE_FRAME_MS,
	LATE_SHARE_TOLERANCE,
	assertControlHeld,
	summarizeMiningNavBudget,
} from "../scripts/lib/mining-nav-budget.mjs";

type ArmReadings = Record<
	"period" | "task" | "script" | "style" | "layout" | "late",
	number[]
>;

type Row = {
	arm: string;
	blocks: number;
	lateShare: number;
	period: number;
	task: number;
	script: number;
	style: number;
	layout: number;
};

type Summary = {
	budgetMs: number;
	lateFrameMs: number;
	lateShareTolerance: number;
	rows: Row[];
	control: { arm: string; lateShare: number };
	added: Record<
		"overOff" | "overControl",
		Record<string, { addedMs: number; separation: string }>
	>;
	verdict: {
		wholeFrameMs: number;
		lateShare: number;
		withinBudget: boolean;
		headroomMs: number;
		overMs: number;
		line: string;
	};
};

const summarize = (raw: unknown): Summary =>
	summarizeMiningNavBudget(raw as never) as unknown as Summary;

const blocks = (
	ms: number,
	{ count = 3, late = [0] }: { count?: number; late?: number[] } = {},
): ArmReadings => ({
	period: Array.from({ length: count }, () => ms),
	task: Array.from({ length: count }, () => ms * 0.8),
	script: Array.from({ length: count }, () => ms * 0.7),
	style: Array.from({ length: count }, () => ms * 0.02),
	layout: Array.from({ length: count }, () => ms * 0.05),
	late: Array.from({ length: count }, (_, i) => late[i % late.length]),
});

const arms = (
	nav: number,
	off = 4,
	control = 3,
	late = [0],
): Record<string, ArmReadings> => ({
	"nav-mining": blocks(nav, { late }),
	"nav-off": blocks(off),
	"forward-mining": blocks(control),
});

describe("the Navigation frame budget is the principal's ruling", () => {
	test("the budget is 16.7 ms of whole frame", () => {
		expect(NAV_FRAME_BUDGET_MS).toBe(16.7);
		expect(summarize(arms(12.4)).budgetMs).toBe(16.7);
	});

	test("exactly at the budget passes and 0.01 ms over does not", () => {
		const level = summarize(arms(16.7));
		expect(level.verdict.withinBudget).toBe(true);
		expect(level.verdict.overMs).toBe(0);
		expect(level.verdict.headroomMs).toBe(0);
		expect(level.verdict.line).toBe(
			"within the 16.7 ms budget by 0.00 ms, 0.0% of frames late",
		);

		const over = summarize(arms(16.71));
		expect(over.verdict.withinBudget).toBe(false);
		expect(over.verdict.overMs).toBeCloseTo(0.01, 5);
		expect(over.verdict.headroomMs).toBe(0);
		expect(over.verdict.line).toBe(
			"over the 16.7 ms budget by 0.01 ms, 0.0% of frames late",
		);
	});

	test("headroom is the distance under the budget, and the verdict says it", () => {
		const under = summarize(arms(14));
		expect(under.verdict.withinBudget).toBe(true);
		expect(under.verdict.headroomMs).toBeCloseTo(2.7, 5);
		expect(under.verdict.overMs).toBe(0);
		expect(under.verdict.line).toBe(
			"within the 16.7 ms budget by 2.70 ms, 0.0% of frames late",
		);
	});
});

describe("a median inside the budget is not the whole answer", () => {
	test("a late frame is one past one and a half budgets", () => {
		expect(LATE_FRAME_MS).toBe(25);
		expect(LATE_FRAME_MS).toBeGreaterThan(NAV_FRAME_BUDGET_MS);
	});

	test("an arm on the budget that drops frames is not within it", () => {
		const dropping = summarize(arms(16, 4, 3, [0.09, 0.1, 0.08]));
		expect(dropping.verdict.withinBudget).toBe(false);
		expect(dropping.verdict.overMs).toBe(0);
		expect(dropping.verdict.lateShare).toBeCloseTo(0.09, 5);
		expect(dropping.verdict.line).toBe(
			"at the 16.7 ms budget, but 9.0% of frames late",
		);
	});

	test("the tolerance is a share of frames, and it is small", () => {
		expect(LATE_SHARE_TOLERANCE).toBe(0.01);
		const atTolerance = summarize(arms(12, 4, 3, [0.01]));
		expect(atTolerance.verdict.withinBudget).toBe(true);
		const overTolerance = summarize(arms(12, 4, 3, [0.02]));
		expect(overTolerance.verdict.withinBudget).toBe(false);
	});
});

describe("the control has to hold, or the run attributes nothing", () => {
	test("a control that drops frames refuses the run", () => {
		const summary = summarize(arms(12));
		summary.control.lateShare = 0.2;
		expect(() => assertControlHeld(summary)).toThrow(
			"the forward-mining control dropped 20.0% of its frames",
		);
	});

	test("the control is the arm with no list on screen", () => {
		expect(NAV_CONTROL).toBe("forward-mining");
		const summary = assertControlHeld(summarize(arms(12, 4, 3, [0])));
		expect(summary.control).toEqual({ arm: "forward-mining", lateShare: 0 });
	});
});

describe("the paired deltas", () => {
	test("the added cost is the difference of arm medians on every meter", () => {
		const summary = summarize(arms(12, 4, 5));
		for (const meter of [
			"period",
			"task",
			"script",
			"style",
			"layout",
		] as const)
			expect(summary.added.overOff[meter].addedMs).toBeCloseTo(
				summary.rows[0][meter] - summary.rows[1][meter],
				6,
			);
		expect(summary.added.overOff.period.addedMs).toBe(8);
		expect(summary.added.overControl.period.addedMs).toBe(7);
	});

	test("the rows are the three arms, in order, with their block count", () => {
		const summary = summarize(arms(12));
		expect(summary.rows.map((row) => row.arm)).toEqual([...NAV_ARMS]);
		expect(summary.rows.every((row) => row.blocks === 3)).toBe(true);
		expect(summary.rows[0].period).toBe(12);
	});

	test("a separation that is 100% is reported as every pair", () => {
		const summary = summarize(arms(12, 4));
		expect(summary.added.overOff.period.separation).toBe("9/9 (100%)");
	});
});

describe("the refusals", () => {
	test("a missing arm is refused by name", () => {
		const { "nav-off": gone, ...raw } = arms(12) as Record<string, ArmReadings>;
		expect(gone).toBeDefined();
		expect(() => summarize(raw)).toThrow("missing arm: nav-off");
	});

	test("an arm with no readings is refused by arm and meter", () => {
		const raw = arms(12);
		raw["nav-mining"].task = [];
		expect(() => summarize(raw)).toThrow("no task readings in arm nav-mining");
	});

	test("a reading that is not a cost is refused rather than averaged", () => {
		for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => {
				const raw = arms(12);
				raw["forward-mining"].layout = [1, bad, 1];
				summarize(raw);
			}).toThrow("invalid layout reading in arm forward-mining");
	});

	test("a frame that took no time is refused, a block that restyled nothing is not", () => {
		const raw = arms(12);
		raw["nav-off"].style = [0, 0, 0];
		raw["nav-off"].layout = [0, 0.1, 0];
		expect(summarize(raw).rows[1].style).toBe(0);
		const still = arms(12);
		still["nav-mining"].period = [12, 0, 12];
		expect(() => summarize(still)).toThrow(
			"invalid period reading in arm nav-mining: 0",
		);
	});

	test("a late share that is not a share is refused", () => {
		for (const bad of [-0.1, 1.2, Number.NaN])
			expect(() => {
				const raw = arms(12);
				raw["nav-mining"].late = [0, bad, 0];
				summarize(raw);
			}).toThrow("invalid late-frame share in arm nav-mining");
	});

	test("an arm with no late share per block is refused", () => {
		const raw = arms(12);
		raw["nav-off"].late = [0];
		expect(() => summarize(raw)).toThrow(
			"no late-frame share per block in arm nav-off",
		);
	});

	test("unequal block counts are refused, because the pairing is the point", () => {
		const raw = arms(12);
		raw["nav-off"] = blocks(4, { count: 4 });
		expect(() => summarize(raw)).toThrow("arms have unequal block counts");
	});

	test("nothing at all is refused", () => {
		expect(() => summarize(undefined)).toThrow("missing arm: nav-mining");
	});
});
