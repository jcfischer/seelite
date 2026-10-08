import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { LEVELS_STRIDE, levels } from "./levels.mjs";
import { VIEWS, validateRunViews } from "./view-set.mjs";

/** Relative report path, shared by CLI invalidation and capture manifests. */
export const levelsFile = (label) => `${label}/levels.txt`;

const columns = [
	{ key: "mean", header: "mean", scale: 1 },
	{ key: "p1", header: "p1", scale: 1 },
	{ key: "p50", header: "p50", scale: 1 },
	{ key: "p99", header: "p99", scale: 1, delta: true },
	{ key: "clip", header: "clip%", scale: 100, delta: true },
	{ key: "black", header: "black%", scale: 100, delta: true },
];
const width = Math.max(7, ...VIEWS.map((v) => v.name.length));
const number = (v) => {
	if (!Number.isFinite(v)) throw new Error("levels: non-finite statistic");
	return v.toFixed(2).padStart(8);
};
const signed = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`.padStart(8);
const row = (name, stats) =>
	`${name.padEnd(width)} ${columns.map(({ key, scale }) => number(stats[key] * scale)).join(" ")}`;
const average = (rows) =>
	Object.fromEntries(
		columns.map(({ key }) => [
			key,
			rows.reduce((sum, r) => sum + r.stats[key], 0) / rows.length,
		]),
	);
export const labelOk = (label) =>
	typeof label === "string" &&
	/^[\w.-]+$/.test(label) &&
	label !== "." &&
	label !== "..";

/** Read every canonical frame before writing anything resembling a whole run.
 * @param {Parameters<typeof validateRunViews>[0]} run
 * @param {string} [out]
 */
export async function writeRunLevels(run, out = "view-set") {
	if (!labelOk(run.label)) throw new Error("levels: invalid run label");
	const destination = join(out, levelsFile(run.label));
	// A failed rerun cannot leave a stale table looking like today's reading.
	await rm(destination, { force: true });
	validateRunViews(run);
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
		`${"view".padEnd(width)} ${columns.map(({ header }) => header.padStart(8)).join(" ")}`,
		...rows.map((r) => row(r.name, r.stats)),
		row("average", mean),
		"",
	].join("\n");
	await writeFile(destination, table);
	return { label: run.label, rows, average: mean, table };
}

export function comparison(first, second) {
	const deltaColumns = columns.filter((column) => column.delta);
	const delta = (name, a, b) =>
		`${name.padEnd(width)} ${deltaColumns
			.map(({ key, scale }) => signed(scale * (b[key] - a[key])))
			.join(" ")}`;
	return [
		`Delta: ${second.label} minus ${first.label} (clip and black in percentage points)`,
		`${"view".padEnd(width)} ${deltaColumns.map(({ header }) => `Δ${header}`.padStart(8)).join(" ")}`,
		...first.rows.map((r, i) => delta(r.name, r.stats, second.rows[i].stats)),
		delta("average", first.average, second.average),
		"",
	].join("\n");
}
