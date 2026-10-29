import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reportPlanetCost } from "../scripts/lib/planet-cost-report.mjs";

for (const pixelRatio of [1, 2]) {
	for (const anomaly of [true, false]) {
		test(`close-detail reporting persists the sweep at pixel ratio ${pixelRatio} with base-program anomaly=${anomaly}`, async () => {
			const sweep = JSON.parse(
				await readFile(
					new URL(
						`../docs/receipts/node-758-runs/sweep1-ratio${pixelRatio}.json`,
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
				await reportPlanetCost(
					[
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
					{
						mode: "close-detail",
						pixelRatios: [pixelRatio],
						buildSha: sweep.closeDetail.buildSha,
						lane: sweep.closeDetail.lane,
						runLabel: "regression",
						orderSeed: sweep.closeDetail.orderSeed,
						hostLoad: "fixture",
						viewport: sweep.viewport,
						subject: sweep.subject,
						sunAngleDeg: sweep.sunAngleDeg,
						pricedSeed: sweep.seed,
						pricedView: "planet-terminator",
						seed: sweep.seed,
						readings: 5,
						out: out,
					},
					{ log: (line: string) => lines.push(line) },
				);
				const written = JSON.parse(
					await readFile(
						join(out, "planet-close-detail-regression.json"),
						"utf8",
					),
				);
				expect(written.rows).toEqual(sweep.rows);
				expect(written.mode).toBe("close-detail");
				expect(written.renderer).toBe(sweep.renderer);
				expect(written.closeDetail).toEqual({
					buildSha: sweep.closeDetail.buildSha,
					lane: sweep.closeDetail.lane,
					label: "regression",
					orderSeed: sweep.closeDetail.orderSeed,
					hostLoadAtStart: "fixture",
					narrowed: false,
					orders: sweep.closeDetail.orders,
				});
				expect(lines.join("\n")).toContain(
					`figure: ${sweep.renderer} | pixel ratio ${pixelRatio} | build ${sweep.closeDetail.buildSha} | ${sweep.closeDetail.lane}`,
				);
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
}
