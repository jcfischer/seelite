import { expect, spyOn, test } from "bun:test";
import { tally } from "../scripts/probe-guard.mjs";
import { createStationRows } from "../scripts/lib/station-rows.mjs";

async function replay({
	drift = 0,
	pair = 0.493,
	rangeKm = 5,
	missingControl = false,
	pairs = false,
} = {}) {
	const lines: string[] = [];
	const log = spyOn(console, "log").mockImplementation((line) =>
		lines.push(line),
	);
	const result = tally();
	const shape = (type: string) => ({
		cells: [type],
		pixels: 100,
		box: { w: 10, h: 10 },
		coverage: 1,
	});
	const silhouettesAt = createStationRows({
		check: result.check,
		grid: 24,
		stations: ["trade", "refinery", "shipyard"].map((type) => ({
			id: type,
			type,
		})),
		viewAlongAxis: async () => ({}),
		framedWhereItAsked: () => {},
		isAuthored: async () => false,
		silhouette: async (type: string) => {
			if (type !== "trade") return shape(type);
			return {
				shape: shape(type),
				again: missingControl ? { empty: true } : shape("control"),
				measuredClocks: [0, 0, 0, 0],
			};
		},
		iou: ([a]: string[], [b]: string[]) => {
			if (b === "control") return 1 - drift;
			if (a === "trade" && b === "refinery") return 1 - pair;
			return b === "shipyard" && a === "trade" ? 1 - 0.565 : 1 - 0.412;
		},
	});
	try {
		await silhouettesAt(rangeKm, 0.25, { pairs });
		return { lines, failures: result.failures };
	} finally {
		log.mockRestore();
	}
}

test("recorded main pair readings still pass with a report-only control", async () => {
	const result = await replay({ pairs: true });
	expect(result.failures).toBe(0);
	expect(result.lines.join("\n")).toContain("1 − IoU = 0.493");
	expect(result.lines.join("\n")).toContain("1 − IoU = 0.565");
	expect(result.lines.join("\n")).toContain("1 − IoU = 0.412");
});

for (const rangeKm of [5, 60]) {
	for (const drift of [0, 0.05, 0.064, 0.2, 1]) {
		test(`${rangeKm} km control at ${drift} reports its ceiling without failing`, async () => {
			const result = await replay({ rangeKm, drift });
			expect(result.failures).toBe(0);
			const reports = result.lines.filter((line) =>
				line.includes("report-only"),
			);
			expect(reports).toHaveLength(1);
			expect(reports[0]).toContain(`1 − IoU = ${drift.toFixed(3)}`);
			expect(reports[0]).toContain("ceiling 0.05");
		});
	}
}

test("a missing repeat is reported without gating", async () => {
	const result = await replay({ missingControl: true });
	expect(result.failures).toBe(0);
	expect(result.lines.join("\n")).toContain("report-only");
	expect(result.lines.join("\n")).toContain("no second silhouette to compare");
});

for (const pair of [0.1, 0.25]) {
	test(`an enabled pair at ${pair} still fails its 0.25 floor`, async () => {
		const result = await replay({ pair, drift: 0.2, pairs: true });
		expect(result.failures).toBe(1);
		expect(
			result.lines.some(
				(line) => line.includes("FAIL") && line.includes("trade and refinery"),
			),
		).toBe(true);
	});
}
