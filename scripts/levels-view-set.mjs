#!/usr/bin/env node
/**
 * node scripts/levels-view-set.mjs <label> [other-label] [--out view-set]
 * One table per canonical run, saved beside its frames. Paired deltas are
 * second minus first; percentages differ in percentage points. No thresholds:
 * node #98's principal approval remains the visual gate.
 */
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
	comparison,
	labelOk,
	levelsFile,
	writeRunLevels,
} from "./lib/levels-report.mjs";

async function main(argv) {
	let out = "view-set";
	const labels = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--out") {
			out = argv[++i];
			if (!out || out.startsWith("-"))
				throw new Error("--out requires a directory");
		} else if (labelOk(argv[i]) && !argv[i].startsWith("-"))
			labels.push(argv[i]);
		else throw new Error(`levels: invalid argument ${argv[i]}`);
	}
	if (labels.length < 1 || labels.length > 2)
		throw new Error(
			"usage: node scripts/levels-view-set.mjs <label> [other-label] [--out view-set]",
		);
	const reports = [];
	for (const label of labels) {
		// Invalidate even when the manifest itself is unreadable.
		await rm(join(out, levelsFile(label)), { force: true });
		const run = JSON.parse(
			await readFile(join(out, label, "manifest.json"), "utf8"),
		);
		if (run.label !== label)
			throw new Error(`levels: manifest label disagrees with ${label}`);
		reports.push(await writeRunLevels(run, out));
	}
	for (const report of reports) console.log(report.table);
	if (reports.length === 2) console.log(comparison(reports[0], reports[1]));
}

main(process.argv.slice(2)).catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
