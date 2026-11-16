import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverProbeFiles } from "./lib/probe-inventory.mjs";
import {
	DURATIONS_FILE,
	PROBE_SECONDS,
	parseProbeLog,
} from "./lib/probe-schedule.mjs";

const [log, source] = process.argv.slice(2);
if (!log) {
	console.error(
		"usage: node scripts/record-probe-durations.mjs <full serial probe-all log> [source label]\n" +
			"greens replace the table's seconds; a red keeps its previous entry; a probe no longer in the suite is dropped",
	);
	process.exit(2);
}
const inventory = new Set(
	discoverProbeFiles(dirname(fileURLToPath(import.meta.url))),
);
const merged = new Map([
	...PROBE_SECONDS,
	...parseProbeLog(readFileSync(log, "utf8")),
]);
const seconds = Object.fromEntries(
	[...merged]
		.filter(([f]) => inventory.has(f))
		.sort(([a], [b]) => (a < b ? -1 : 1)),
);
writeFileSync(
	DURATIONS_FILE,
	`${JSON.stringify({ source: source ?? log, seconds }, null, "\t")}\n`,
);
console.log(`${Object.keys(seconds).length} probe durations written`);
