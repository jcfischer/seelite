#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { createTypeSafeProbeJudge } from "./lib/typesafe-probe-judge.mjs";
import { selectProbes } from "./lib/probe-selection.mjs";

const receiptFlag = process.argv.indexOf("--receipt");
const receiptPath =
	receiptFlag === -1 ? undefined : process.argv[receiptFlag + 1];
if (receiptFlag !== -1 && !receiptPath)
	throw new Error("--receipt requires an output path");

const cases = [
	{
		name: "Moving-body cruise route",
		input: {
			changedFiles: ["src/cruise.ts"],
			intent:
				"Keep a cruise route clear of a moving host planet through arrival handoff.",
		},
		expected: [
			"measure-cruise-detour.mjs",
			"probe-approach-handoff.mjs",
			"probe-arrival.mjs",
			"probe-cruise-detour.mjs",
			"probe-cruise.mjs",
			"probe-handoff.mjs",
			"probe-moving-guard.mjs",
		],
	},
	{
		name: "Controls tab and gamepad folding",
		input: {
			changedFiles: ["src/controls-reference.ts", "src/controls-catalogue.ts"],
			intent: "Fold Controls groups for keyboard and gamepad users.",
		},
		expected: [
			"probe-controls-reference.mjs",
			"probe-key-dispatch.mjs",
			"probe-pad-panels.mjs",
		],
	},
	{
		name: "Final output-stage dithering",
		input: {
			changedFiles: ["src/output-stage.ts", "src/planet-surfaces.ts"],
			intent: "Retune final output-stage encoding, vignette, and dithering.",
		},
		expected: [
			"probe-output-stage.mjs",
			"probe-frame-attribution.mjs",
			"probe-planet-surfaces.mjs",
			"probe-planets.mjs",
			"probe-station-visuals.mjs",
			"probe-traffic-mouth.mjs",
		],
	},
	{
		name: "Carrier-knowledge save migration",
		input: {
			changedFiles: ["src/save-store.ts", "src/persistent-world.ts"],
			intent:
				"Migrate carrier knowledge and recovery state in Commander saves.",
		},
		expected: [
			"probe-save.mjs",
			"probe-carrier-scan.mjs",
			"probe-commander.mjs",
			"probe-death.mjs",
			"probe-relay.mjs",
		],
	},
];

const judge = createTypeSafeProbeJudge({
	apiKey: process.env.TYPESAFE_API_KEY,
});
const rows = await Promise.all(
	cases.map(async (item) => {
		const started = performance.now();
		const result = await selectProbes(item.input, judge);
		const conclusive =
			result.mode === "semantic" &&
			!result.fallback &&
			Array.isArray(result.decisions);
		const missing = conclusive
			? item.expected.filter((file) => !result.probes.includes(file))
			: null;
		return {
			name: item.name,
			status: !conclusive
				? "inconclusive"
				: missing.length
					? "failed"
					: "passed",
			mode: result.mode,
			fallback: result.fallback,
			reason: result.reason,
			model: result.model ?? null,
			selected: result.probes.length,
			total: result.decisions?.length ?? null,
			latencyMs: Math.round(performance.now() - started),
			expected: item.expected.length,
			present: missing ? item.expected.length - missing.length : null,
			missing,
			usage: result.usage ?? null,
			decisions: result.decisions ?? null,
		};
	}),
);

const output = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
process.stdout.write(output);
if (receiptPath) writeFileSync(receiptPath, output);
for (const row of rows) {
	if (row.status !== "passed") process.exitCode = 1;
}
