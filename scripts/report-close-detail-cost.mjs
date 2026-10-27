import { readFile } from "node:fs/promises";
import {
	CLOSE_DETAIL_ARMS,
	CLOSE_DETAIL_RADII,
	RADII,
	armDelta,
	identityLine,
	sweepAgreement,
} from "./lib/planet-cost.mjs";

const files = process.argv.slice(2);
if (files.length < 2)
	throw new Error("give at least two sweep files: one run is not a repeat");
const runs = await Promise.all(
	files.map(async (f) => ({
		file: f,
		json: JSON.parse(await readFile(f, "utf8")),
	})),
);
for (const { file, json } of runs)
	if (json.mode !== "close-detail")
		throw new Error(`${file} is a ${json.mode} file, not a close-detail one`);

const identities = new Set(
	runs.map(
		({ json }) =>
			`${json.renderer}|${json.closeDetail.buildSha}|${json.closeDetail.lane}`,
	),
);
if (identities.size !== 1)
	throw new Error(
		`the files were not measured on one renderer, build and lane: ${[...identities].join(" ; ")}`,
	);
const ratios = [
	...new Set(runs.flatMap(({ json }) => json.rows.map((r) => r.pixelRatio))),
].sort();
const close = [...CLOSE_DETAIL_RADII];
const columns = [RADII[0], ...close];
const names = CLOSE_DETAIL_ARMS.map((a) => a.name);
const f2 = (v) => v.toFixed(2);
const signed = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
const labelOf = (i) => `S${i + 1}`;

for (const ratio of ratios) {
	const sweeps = runs
		.filter(({ json }) => json.rows.some((r) => r.pixelRatio === ratio))
		.map(({ json, file }) => ({
			file,
			seed: json.closeDetail.orderSeed,
			rows: json.rows.filter((r) => r.pixelRatio === ratio),
			drift: json.driftControl.find((d) => d.pixelRatio === ratio),
			far: json.farColumns.find((d) => d.pixelRatio === ratio),
		}));
	if (sweeps.length < 2)
		throw new Error(
			`pixel ratio ${ratio} has ${sweeps.length} sweep: the receipt compares at least two`,
		);
	if (new Set(sweeps.map((x) => x.seed)).size !== sweeps.length)
		throw new Error(
			`two sweeps at pixel ratio ${ratio} share an order seed (${sweeps.map((x) => x.seed).join(", ")}): the repeat would run the same order twice`,
		);
	const head = identityLine({
		renderer: runs[0].json.renderer,
		pixelRatio: ratio,
		buildSha: runs[0].json.closeDetail.buildSha,
		lane: runs[0].json.closeDetail.lane,
	});
	console.log(`### Pixel ratio ${ratio}`);
	console.log("");
	console.log(head);
	console.log("");
	for (const [i, s] of sweeps.entries())
		console.log(
			`- ${labelOf(i)}: ${s.file}, order seed ${s.seed}, drift control ${s.drift.beforeMs.toFixed(2)} -> ${s.drift.afterMs.toFixed(2)} ms, widest column floor ${s.far.floorMs.toFixed(2)} ms, ${s.far.excursion ? "EXCURSION" : "no excursion"}`,
		);
	console.log("");
	const cells = (rows, arm, r) =>
		rows.find((x) => x.arm === arm && x.radii === r);
	console.log(
		`Frame time, ms (${sweeps.map((_, i) => labelOf(i)).join(" / ")}):`,
	);
	console.log("");
	console.log(`| arm | ${columns.map((r) => `${r}R`).join(" | ")} |`);
	console.log(`|---|${columns.map(() => "---:").join("|")}|`);
	for (const arm of names)
		console.log(
			`| ${arm} | ${columns
				.map((r) => sweeps.map((s) => f2(cells(s.rows, arm, r).ms)).join(" / "))
				.join(" | ")} |`,
		);
	console.log("");
	for (const versus of ["interim", "cap-0"]) {
		console.log(
			`Delta against ${versus}, ms (${sweeps.map((_, i) => labelOf(i)).join(" / ")}):`,
		);
		console.log("");
		console.log(`| arm | ${close.map((r) => `${r}R`).join(" | ")} |`);
		console.log(`|---|${close.map(() => "---:").join("|")}|`);
		const set =
			versus === "interim"
				? names.filter((n) => n !== "interim")
				: names.filter((n) => /^(interim|cap-[246])$/.test(n));
		for (const arm of set)
			console.log(
				`| ${arm} | ${close
					.map((r) =>
						sweeps
							.map((s) => signed(armDelta(s.rows, arm, versus, r)))
							.join(" / "),
					)
					.join(" | ")} |`,
			);
		console.log("");
	}
	for (const [i, s] of sweeps.entries()) {
		const reread = s.rows.filter((r) => r.attempts > 1);
		console.log(
			reread.length
				? `${labelOf(i)} read again: ${reread.map((r) => `${r.arm}@${r.radii}R (discarded ${r.discarded.map((d) => d.samplesMs.map((v) => v.toFixed(1)).join(",")).join(" | ")})`).join("; ")}.`
				: `${labelOf(i)} read again: no cell.`,
		);
	}
	console.log("");
	for (let i = 0; i < sweeps.length; i++)
		for (let k = i + 1; k < sweeps.length; k++) {
			const gaps = sweepAgreement(sweeps[i].rows, sweeps[k].rows).filter((g) =>
				close.includes(g.radii),
			);
			const sorted = gaps.map((g) => g.gapMs).sort((x, y) => x - y);
			const worst = gaps.reduce((a, g) => (g.gapMs > a.gapMs ? g : a));
			console.log(
				`${labelOf(i)} and ${labelOf(k)} disagree on a close cell by a median of ${f2(sorted[sorted.length >> 1])} ms and at most ${f2(worst.gapMs)} ms (${worst.arm} at ${worst.radii}R).`,
			);
		}
	console.log("");
}
