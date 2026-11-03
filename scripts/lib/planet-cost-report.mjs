import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CELL_TREND_LIMIT,
	CLOSE_DETAIL_ARMS,
	CLOSE_DETAIL_RADII,
	RADII,
	armDelta,
	controlPairGap,
	farColumnVerdict,
	flagExcursions,
	identityLine,
} from "./planet-cost.mjs";

/** Print a completed planet-cost sweep and persist the same rows and qualifications. */
export async function reportPlanetCost(
	runs,
	{
		mode,
		pixelRatios,
		buildSha,
		lane,
		runLabel = "",
		orderSeed,
		hostLoad,
		viewport,
		subject,
		sunAngleDeg,
		pricedSeed,
		pricedView,
		seed,
		readings,
		narrowed = false,
		sweptRadii = RADII,
		controlLabel = `terran/four-tap at ${RADII[0]}r`,
		out,
	},
	{ log = console.log } = {},
) {
	const closeDetail = mode === "close-detail";
	const decompose = mode === "decomposition";
	const rows = runs.flatMap((r) => r.rows);

	const verdicts = Object.fromEntries(
		runs.map((r, i) => [pixelRatios[i], farColumnVerdict(r.rows, RADII[0])]),
	);

	flagExcursions(rows, verdicts);
	const renderer = runs[0].renderer;

	log(`  renderer: ${renderer}`);
	if (closeDetail) {
		log(`  build: ${buildSha} | lane: ${lane}`);
		log(
			`  mode: close-detail — node #758, terran ${subject}, arms shuffled from seed ${orderSeed}, no arm twice in a row${runLabel ? `, run "${runLabel}"` : ""}`,
		);
		log(`  host load average at start: ${hostLoad}`);
	}
	log(
		decompose
			? `  mode: decomposition — #248's ablation ladder on the subject as the view set frames it, its own class and its own shells`
			: `  mode: class sweep — every class on both relief paths`,
	);
	log(
		`  viewport: ${viewport.width}x${viewport.height}, ${subject} at ${sunAngleDeg}° from the star, seed ${pricedSeed} (${pricedView})`,
	);
	log(
		`  ms/frame off the ?fps readout — median of ${readings} readings, ±the full range across them`,
	);
	log(
		`  a cell marked ? never settled: its rate was still moving when the settle timed out, so it is a reading and not a measurement`,
	);
	log(
		`  a cell marked ! took a sample the meter had not refreshed — possibly a repeated line, possibly a stale one held over a stall`,
	);
	log("");

	for (const {
		pixelRatio,
		rows: runRows,
		controlBefore,
		controlAfter,
	} of runs.map((r, i) => ({ pixelRatio: pixelRatios[i], ...r }))) {
		const cellName = (r) =>
			decompose || closeDetail
				? `${r.arm}@${r.radii}r`
				: `${r.surfaceClass}/${r.relief}@${r.radii}r`;
		log(`  pixel ratio ${pixelRatio}`);
		if (closeDetail)
			log(
				`    figure: ${identityLine({ renderer, pixelRatio, buildSha: buildSha, lane: lane })}`,
			);
		const label = (row) =>
			`${row.ms.toFixed(1)}±${row.spreadMs.toFixed(1)}${row.settled ? "" : "?"}${
				row.staleSamples ? "!" : ""
			}`.padStart(14);
		if (closeDetail) {
			const armNames = CLOSE_DETAIL_ARMS.map((a) => a.name).filter((n) =>
				runRows.some((r) => r.arm === n),
			);
			const columns = [RADII[0], ...CLOSE_DETAIL_RADII].filter((r) =>
				runRows.some((row) => row.radii === r),
			);
			const at = (arm, radii) =>
				runRows.find((r) => r.arm === arm && r.radii === radii);
			log(
				`      ${"arm".padEnd(18)}${columns.map((r) => `${r}r`.padStart(14)).join("")}`,
			);
			for (const arm of armNames)
				log(
					`      ${arm.padEnd(18)}${columns.map((r) => label(at(arm, r))).join("")}`,
				);
			const close = columns.filter((r) => r !== RADII[0]);
			const deltaRow = (arm, versus) =>
				close
					.map((r) => {
						const d = armDelta(runRows, arm, versus, r);
						return `${d >= 0 ? "+" : ""}${d.toFixed(2)}`.padStart(14);
					})
					.join("");
			const have = (n) => armNames.includes(n);
			log("");
			log(
				`      ms against interim (the shipped frame), per arm — positive means the arm costs more`,
			);
			log(
				`      ${"arm".padEnd(18)}${close.map((r) => `${r}r`.padStart(14)).join("")}`,
			);
			if (have("interim"))
				for (const arm of armNames.filter((n) => n !== "interim"))
					log(`      ${arm.padEnd(18)}${deltaRow(arm, "interim")}`);
			log("");
			log(
				`      ms against cap-0 (the band off), per arm — what each cap costs over no band`,
			);
			log(
				`      ${"arm".padEnd(18)}${close.map((r) => `${r}r`.padStart(14)).join("")}`,
			);
			if (have("cap-0"))
				for (const arm of armNames.filter((n) =>
					/^(interim|cap-[246])$/.test(n),
				))
					log(`      ${arm.padEnd(18)}${deltaRow(arm, "cap-0")}`);
			if (have("interim") && have("cap-6")) {
				const gap = controlPairGap(runRows, close);
				log("");
				log(
					`      control pair — interim minus cap-6, one state reached two ways, so the noise floor under every delta above: ${close
						.map((r) => `${r}r ${gap[r] >= 0 ? "+" : ""}${gap[r].toFixed(2)}`)
						.join(", ")} ms`,
				);
			}
			log("");
			log(
				`      what the unpinned game draws at each radius: ${runs[
					pixelRatios.indexOf(pixelRatio)
				].unpinnedAtRadii
					.map(
						(u) =>
							`${u.radii}r ${u.surfacePath}${u.halfResEngaged ? " half-res" : " full-res"} cap ${u.groundCap}${u.footprintProgram ? " footprint-program" : " base-program"}`,
					)
					.join("; ")}`,
			);
			const noProgram = runRows.filter(
				(r) => r.footprintProgram === false && r.arm !== "cap-0",
			);
			log(
				noProgram.length
					? `      cells drawn with the base program although their cap is not 0: ${noProgram.map(cellName).join(", ")}`
					: `      every non-cap-0 cell inside the band drew the footprint program`,
			);
			log(
				`      sweep order: ${runs[pixelRatios.indexOf(pixelRatio)].sweepSeq.map((c) => `${c.arm}@${c.radii}`).join(" ")}`,
			);
		} else if (decompose) {
			const arms = [...new Set(runRows.map((r) => r.arm))];
			const at = (arm, radii) =>
				runRows.find((r) => r.arm === arm && r.radii === radii);
			log(
				`      ${"arm".padEnd(14)}${RADII.map((r) => `${r}r`.padStart(14)).join("")}`,
			);
			for (const arm of arms)
				log(
					`      ${arm.padEnd(14)}${RADII.map((r) => label(at(arm, r))).join("")}`,
				);

			log("");
			log(
				`      full minus each arm — what that arm's own \`prices\` line says it costs, ms. Read the arm's line for what is in it: \`flat\` carries the slope as well, so it is not the class body alone (that is flat minus no-relief). A figure inside the drift control below is not a difference.`,
			);
			log(
				`      ${"term".padEnd(14)}${RADII.map((r) => `${r}r`.padStart(14)).join("")}`,
			);
			for (const arm of arms) {
				if (arm === "full") continue;
				const cells = RADII.map((radii) => {
					const full = at("full", radii);
					const other = at(arm, radii);
					const d = full.ms - other.ms;
					const share = full.ms > 0 ? (100 * d) / full.ms : 0;
					return `${d >= 0 ? "+" : ""}${d.toFixed(1)} (${share.toFixed(0)}%)`.padStart(
						14,
					);
				});
				log(`      ${arm.padEnd(14)}${cells.join("")}`);
			}
		} else {
			const classes = [...new Set(runRows.map((r) => r.surfaceClass))];
			for (const relief of runs[0].reliefPaths) {
				log(`    relief: ${relief}`);
				log(
					`      ${"class".padEnd(10)}${sweptRadii.map((r) => `${r}r`.padStart(14)).join("")}`,
				);
				for (const surfaceClass of classes) {
					if (relief === "analytic-gradient" && surfaceClass !== "terran")
						continue;
					const cells = sweptRadii.map((radii) =>
						label(
							runRows.find(
								(r) =>
									r.surfaceClass === surfaceClass &&
									r.relief === relief &&
									r.radii === radii,
							),
						),
					);
					log(`      ${surfaceClass.padEnd(10)}${cells.join("")}`);
				}
			}
		}

		const far = verdicts[pixelRatio];
		log(
			`    widest column (${far.radii}r, where the subject is a few pixels and nothing should differ): ` +
				`${far.cells} cells, floor ${far.floorMs.toFixed(1)} ms` +
				(!far.excursion
					? ` — every cell inside ${far.factor}x it, which is what this column should look like`
					: ` — ${far.outliers.length} over ${far.factor}x it: ${far.outliers
							.map((r) => `${cellName(r)} ${r.ms.toFixed(1)}ms`)
							.join(
								", ",
							)}. THIS RUN HAD AN EXCURSION. Where is not established — detection is at one radius — so every row of it carries runExcursion in the JSON, and the far columns are the ones to drop first.`),
		);

		const stalls = runRows.filter((r) => r.peakRiseMs > 0);
		log(
			stalls.length
				? `    stalls (session peak rose during the cell): ${stalls
						.map((r) => `${cellName(r)} +${r.peakRiseMs.toFixed(0)}ms`)
						.join(", ")}`
				: "    stalls: none out-stalled an earlier cell in this run",
		);

		const unsettled = runRows.filter((r) => !r.settled);
		log(
			unsettled.length
				? `    unsettled (?): ${unsettled.length} of ${runRows.length} cells never held a steady rate — ${unsettled
						.map(cellName)
						.join(", ")}`
				: `    unsettled: none — every one of the ${runRows.length} cells held a steady rate before it was read`,
		);

		const stale = runRows.filter((r) => r.staleSamples > 0);
		log(
			stale.length
				? `    stale reads (!): ${stale.length} of ${runRows.length} cells — ${stale
						.map(cellName)
						.join(", ")}`
				: `    stale reads: none — every sample was taken on a line the meter had just written`,
		);
		if (closeDetail) {
			const reread = runRows.filter((r) => r.attempts > 1);
			log(
				reread.length
					? `    read again (trend over ${CELL_TREND_LIMIT}): ${reread.length} of ${runRows.length} cells — ${reread
							.map(
								(r) =>
									`${cellName(r)} discarded ${r.discarded
										.map((d) => d.samplesMs.map((v) => v.toFixed(1)).join(","))
										.join(" | ")}`,
							)
							.join("; ")}`
					: `    read again: none — every cell's readings were steady on the first read`,
			);
		}

		const drift = controlAfter.ms - controlBefore.ms;

		const controlsHeld =
			controlBefore.settled &&
			controlAfter.settled &&
			!controlBefore.staleSamples &&
			!controlAfter.staleSamples;
		log(
			`    drift control (${closeDetail ? `interim at ${RADII[0]}r` : decompose ? `full at ${RADII[0]}r` : controlLabel}): ${controlBefore.ms.toFixed(1)} ms before, ` +
				`${controlAfter.ms.toFixed(1)} ms after — the machine moved ` +
				`${drift >= 0 ? "+" : ""}${drift.toFixed(1)} ms end to end` +
				(controlsHeld
					? ""
					: " — BUT a control never settled or was read stale, so even this bound is unreliable"),
		);

		log(
			`      net movement only: two endpoints cannot locate a mid-run sag that recovered, so a small figure here says the run began and ended alike and nothing about the columns between`,
		);
		log("");
	}

	await mkdir(out, { recursive: true });

	const path = join(
		out,
		closeDetail
			? `planet-close-detail${runLabel ? `-${runLabel}` : ""}.json`
			: decompose
				? "planet-decomposition.json"
				: "planet-cost.json",
	);
	await writeFile(
		path,
		`${JSON.stringify(
			{
				measuredAt: new Date().toISOString(),
				renderer,
				viewport: viewport,
				seed: seed,
				subject: subject,
				sunAngleDeg: sunAngleDeg,
				mode: closeDetail
					? "close-detail"
					: decompose
						? "decomposition"
						: "class-sweep",
				closeDetail: closeDetail
					? {
							buildSha: buildSha,
							lane: lane,
							label: runLabel,
							orderSeed: orderSeed,
							hostLoadAtStart: hostLoad,
							narrowed: narrowed,
							orders: runs.map((r, i) => ({
								pixelRatio: pixelRatios[i],
								order: r.sweepSeq,
								unpinned: r.unpinnedAtRadii,
							})),
						}
					: null,

				farColumns: pixelRatios.map((ratio) => ({
					pixelRatio: ratio,
					...verdicts[ratio],
					outliers: verdicts[ratio].outliers.map((r) => ({
						arm: r.arm ?? null,
						surfaceClass: r.surfaceClass ?? null,
						relief: r.relief ?? null,
						radii: r.radii,
						ms: r.ms,
					})),
				})),

				arms: runs[0].armPrices,

				driftControl: runs.map((r, i) => ({
					pixelRatio: pixelRatios[i],
					cell: closeDetail
						? `interim at ${RADII[0]}r`
						: decompose
							? `full at ${RADII[0]}r`
							: controlLabel,
					beforeMs: r.controlBefore.ms,
					afterMs: r.controlAfter.ms,

					beforeSettled: r.controlBefore.settled,
					afterSettled: r.controlAfter.settled,
					beforeStaleSamples: r.controlBefore.staleSamples,
					afterStaleSamples: r.controlAfter.staleSamples,
				})),
				rows,
			},
			null,
			2,
		)}\n`,
	);
	log(`  wrote ${path} — ${rows.length} cells`);
}
