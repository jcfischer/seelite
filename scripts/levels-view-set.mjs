#!/usr/bin/env node
/**
 * node scripts/levels-view-set.mjs <label> [other-label] [--out view-set]
 * One table per canonical run, saved beside its frames. Paired deltas are
 * second minus first; percentages differ in percentage points. No thresholds:
 * node #98's principal approval remains the visual gate.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { LEVELS_STRIDE, levels } from "./lib/levels.mjs";
import { VIEWS, contactSheet } from "./lib/view-set.mjs";

const columns = ["mean", "p1", "p50", "p99", "clip", "black"];
const width = Math.max(7, ...VIEWS.map((v) => v.name.length));
const number = (v) => {
	if (!Number.isFinite(v)) throw new Error("levels: non-finite statistic");
	return v.toFixed(2).padStart(8);
};
const signed = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`.padStart(8);
const row = (name, stats) =>
	`${name.padEnd(width)} ${columns.map((k) => number(stats[k] * (k === "clip" || k === "black" ? 100 : 1))).join(" ")}`;
const average = (rows) =>
	Object.fromEntries(
		columns.map((k) => [
			k,
			rows.reduce((sum, r) => sum + r.stats[k], 0) / rows.length,
		]),
	);
const labelOk = (label) =>
	typeof label === "string" &&
	/^[\w.-]+$/.test(label) &&
	label !== "." &&
	label !== "..";

/** Read every canonical frame before writing anything resembling a whole run.
 * @param {Parameters<typeof contactSheet>[0][number]} run
 * @param {string} [out]
 */
export async function writeRunLevels(run, out = "view-set") {
	if (!labelOk(run.label)) throw new Error("levels: invalid run label");
	const destination = join(out, run.label, "levels.txt");
	// A failed rerun cannot leave a stale table looking like today's reading.
	await rm(destination, { force: true });
	contactSheet([run]); // The sheet's missing/extra-view contract, shared.
	if (run.views.length !== VIEWS.length)
		throw new Error(`levels: duplicate views in ${run.label}`);
	const rows = [];
	for (const view of VIEWS) {
		const captured = run.views.find((v) => v.name === view.name);
		if (captured.file !== `${run.label}/${view.name}.png`)
			throw new Error(`levels: ${view.name} has an unexpected frame path`);
		try {
			const image = PNG.sync.read(await readFile(join(out, captured.file)));
			rows.push({ name: view.name, stats: levels(image) });
		} catch (error) {
			throw new Error(`levels: ${run.label}/${view.name}: ${error.message}`, {
				cause: error,
			});
		}
	}
	const mean = average(rows);
	const table = [
		`Run: ${run.label} · ref: ${run.gitRef} · renderer: ${run.renderer}`,
		`Display luma: rounded Rec. 709 RGB codes; nearest-rank percentiles; stride ${LEVELS_STRIDE} on both axes.`,
		"clip%: codes >=250; black%: codes <=7. Average: equal weight per view, including percentiles. Descriptive only.",
		`${"view".padEnd(width)} ${["mean", "p1", "p50", "p99", "clip%", "black%"].map((s) => s.padStart(8)).join(" ")}`,
		...rows.map((r) => row(r.name, r.stats)),
		row("average", mean),
		"",
	].join("\n");
	await writeFile(destination, table);
	return { label: run.label, rows, average: mean, table };
}

function comparison(first, second) {
	const delta = (name, a, b) =>
		`${name.padEnd(width)} ${[
			b.p99 - a.p99,
			100 * (b.clip - a.clip),
			100 * (b.black - a.black),
		]
			.map(signed)
			.join(" ")}`;
	return [
		`Delta: ${second.label} minus ${first.label} (clip and black in percentage points)`,
		`${"view".padEnd(width)} ${["Δp99", "Δclip%", "Δblack%"].map((s) => s.padStart(8)).join(" ")}`,
		...first.rows.map((r, i) => delta(r.name, r.stats, second.rows[i].stats)),
		delta("average", first.average, second.average),
		"",
	].join("\n");
}

async function main(argv) {
	let out = "view-set";
	const labels = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--out") {
			out = argv[++i];
			if (!out) throw new Error("--out requires a directory");
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
		await rm(join(out, label, "levels.txt"), { force: true });
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

// Importable by capture without running the command-line entry point.
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
