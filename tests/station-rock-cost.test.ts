import { expect, test } from "bun:test";
import { summarizeStationRockCost } from "../scripts/lib/station-rock-cost.mjs";

test("a measured low-side gap cannot be reported as within budget", () => {
	const times = { field: [3.2, 3.1, 3.3], none: [2.4, 2.3, 2.5] };
	const low = summarizeStationRockCost("low", times);
	expect(low.addedFrameMs).toBeCloseTo(0.8, 12);
	expect(low.budgetMs).toBe(0.4);
	expect(low.gapMs).toBeCloseTo(0.4, 12);
	expect(low.verdict).toBe("over budget; principal acceptance required");
	const high = summarizeStationRockCost("high", times);
	expect(high.gapMs).toBe(0);
	expect(high.verdict).toBe("within budget on this run");
});

test("the median comparison resists one stalled control block", () => {
	const result = summarizeStationRockCost("high", {
		field: [4.5, 4.6, 4.4],
		none: [3.6, 60, 3.7],
	});
	expect(result.addedFrameMs).toBeCloseTo(0.8, 12);
	expect(result.separation).toBe("6/9 (67%)");
});

test("missing, nonfinite and unmatched samples refuse a cost verdict", () => {
	for (const invalid of [undefined, NaN, Infinity, 0, -1])
		expect(() =>
			summarizeStationRockCost("low", {
				field: [invalid],
				none: [2],
			}),
		).toThrow("invalid timing blocks");
	expect(() =>
		summarizeStationRockCost("low", { field: [], none: [] }),
	).toThrow("invalid timing blocks");
	expect(() =>
		summarizeStationRockCost("low", { field: [3, 4], none: [2] }),
	).toThrow("unpaired timing blocks");
	expect(() =>
		summarizeStationRockCost("ultra", { field: [3], none: [2] }),
	).toThrow("unknown quality");
});
