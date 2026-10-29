import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import * as planetCost from "../scripts/lib/planet-cost.mjs";

for (const anomaly of [true, false]) {
	test(`close-detail reporting persists the sweep with base-program anomaly=${anomaly}`, async () => {
		const source = await readFile(
			new URL("../scripts/measure-planet-cost.mjs", import.meta.url),
			"utf8",
		);
		const start = source.indexOf("const rows = runs.flatMap((r) => r.rows);");
		expect(start).toBeGreaterThan(0);
		const sweep = JSON.parse(
			await readFile(
				new URL(
					"../docs/receipts/node-758-runs/sweep1-ratio1.json",
					import.meta.url,
				),
				"utf8",
			),
		);
		const row = sweep.rows.find(
			(r: { arm: string; radii: number }) =>
				r.arm === "interim" && r.radii === 1.5,
		);
		row.footprintProgram = !anomaly;
		const control = { ms: 5, settled: true, staleSamples: 0 };
		const lines: string[] = [];
		const out = await mkdtemp(join(tmpdir(), "planet-cost-report-"));
		try {
			await runInNewContext(`(async () => {\n${source.slice(start)}\n})()`, {
				...planetCost,
				runs: [
					{
						renderer: sweep.renderer,
						rows: sweep.rows,
						controlBefore: control,
						controlAfter: control,
						armPrices: sweep.arms,
						unpinnedAtRadii: sweep.closeDetail.orders[0].unpinned,
						sweepSeq: sweep.closeDetail.orders[0].order,
					},
				],
				CLOSE_DETAIL: true,
				DECOMPOSE: false,
				PIXEL_RATIOS: [1],
				BUILD_SHA: sweep.closeDetail.buildSha,
				LANE: sweep.closeDetail.lane,
				RUN_LABEL: "regression",
				ORDER_SEED: sweep.closeDetail.orderSeed,
				HOST_LOAD: "fixture",
				VIEWPORT: sweep.viewport,
				SUBJECT: sweep.subject,
				SUN_ANGLE_DEG: sweep.sunAngleDeg,
				PRICED_SEED: sweep.seed,
				PRICED_VIEW: "planet-terminator",
				SEED: sweep.seed,
				READINGS: 5,
				ONLY_ARMS: null,
				ONLY_RADII: null,
				OUT: out,
				mkdir,
				writeFile,
				join,
				console: { log: (line: string) => lines.push(line) },
			});
			const written = JSON.parse(
				await readFile(
					join(out, "planet-close-detail-regression.json"),
					"utf8",
				),
			);
			expect(written.rows).toEqual(sweep.rows);
			expect(lines.join("\n")).toContain(
				anomaly
					? "cells drawn with the base program although their cap is not 0: interim@1.5r"
					: "every non-cap-0 cell inside the band drew the footprint program",
			);
			expect(lines.at(-1)).toContain("40 cells");
		} finally {
			await rm(out, { recursive: true, force: true });
		}
	});
}
