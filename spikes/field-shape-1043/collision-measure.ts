import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { median } from "../../scripts/lib/measurement.mjs";

if (existsSync("/tmp/seelite-probe.lock"))
	throw new Error("browser measurement holds the machine lock");
const target = process.argv[2] ?? "/tmp/field1043-collision.json";
const orders = [
	["baseline", "expanded", "clusters", "broken"],
	["broken", "clusters", "expanded", "baseline"],
];
const reports = [];
for (const [pass, order] of orders.entries())
	for (const candidate of [...(pass === 0 ? ["native"] : []), ...order]) {
		const native = candidate === "native";
		const result = spawnSync(
			process.execPath,
			[
				"run",
				"spikes/field-shape-1043/collision-worker.ts",
				native ? "baseline" : candidate,
				native ? "native" : "adapted",
				"measure",
			],
			{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
		);
		if (result.status !== 0)
			throw new Error(result.stderr || `worker exit ${result.status}`);
		reports.push({ pass, ...JSON.parse(result.stdout) });
	}
const summary = reports.flatMap((report) =>
	report.measurements.map(
		(row: { coldFirstQueryMs: number[]; warmBatchMeanMs: number[] }) => ({
			...row,
			candidate: report.candidate,
			mode: report.mode,
			pass: report.pass,
			coldMedianMs: median(row.coldFirstQueryMs),
			coldMinMs: Math.min(...row.coldFirstQueryMs),
			coldMaxMs: Math.max(...row.coldFirstQueryMs),
			warmBatchMedianMs: median(row.warmBatchMeanMs),
			warmBatchMinMs: Math.min(...row.warmBatchMeanMs),
			warmBatchMaxMs: Math.max(...row.warmBatchMeanMs),
		}),
	),
);
const output = {
	head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	dirty: !!execFileSync("git", ["status", "--porcelain"], {
		encoding: "utf8",
	}).trim(),
	method:
		"Unchanged production fieldRockSolids; process-isolated candidate dependency inputs. Fresh-System cold queries include generation and lattice construction with code/archetype pieces warm; actual heightfield-piece prebuild is separate. Warm figures are eleven 64-query batch means, not individual-query percentiles. Returned owner counts are consumed and checked: the cheap warm counter is inside elapsed time; cold counting and all hashes are outside. Clock is held fixed at 1000 seconds; this does not measure advancing frames. Common, candidate-targeted and synthetic-stress menus are distinguished. Two serial candidate passes in reverse order; native baseline once. No frame, CCD or affordability claim.",
	reports,
	summary,
};
writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);
console.log(
	JSON.stringify({
		target,
		workers: reports.length,
		rows: summary.length,
		sourceHashes: [...new Set(reports.map((r) => r.querySource))],
	}),
);
