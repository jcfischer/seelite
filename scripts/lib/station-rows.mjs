/* https://github.com/jcfischer/seelite/issues/1287 — 0.05 is the requested historical
 * reference, not a calibrated limit; readings above it are expected. Re-measure
 * before gating: even the later 0.12 ceiling failed intermittently on clean main. */
const MAX_CONTROL_DIFFERENCE = 0.05;

/** Creates station silhouette row evaluation with explicit capture dependencies. */
export function createStationRows({
	stations,
	grid,
	check,
	viewAlongAxis,
	framedWhereItAsked,
	silhouette,
	isAuthored,
	iou,
}) {
	return async function silhouettesAt(rangeKm, floor, gate) {
		const shapes = new Map();
		let control = null;
		for (const station of stations) {
			framedWhereItAsked(
				`${rangeKm} km — ${station.type}`,
				await viewAlongAxis(station.id, rangeKm),
			);
			const captured = await silhouette(station.id, station.type === "trade");
			const shape = captured.again ? captured.shape : captured;
			if (captured.again) {
				control = captured.again;
				check(
					rangeKm + " km — both control captures use the same pinned clock",
					captured.measuredClocks.length === 4 &&
						captured.measuredClocks.every((t) => t === 0),
					JSON.stringify(captured.measuredClocks),
				);
			}
			const authored = await isAuthored(station.id);
			let detail = "no mesh";
			if (!shape.missing) {
				detail = "no pixels changed";
				if (!shape.empty) {
					detail =
						`${shape.pixels} px, box ${shape.box.w}×${shape.box.h}, ` +
						`fill ${(100 * shape.coverage).toFixed(0)}%`;
				}
			}
			check(
				`${rangeKm} km — ${station.type}: the station is drawn and has a silhouette`,
				!shape.missing && !shape.empty && (authored || shape.pixels > 20),
				detail,
			);
			if (shape.cells) shapes.set(station.type, shape);
		}

		const types = [...shapes.keys()];
		console.log(
			`\nsilhouettes at ${rangeKm} km, desaturated, ${grid}×${grid} after crop:`,
		);
		for (let i = 0; i < types.length; i++) {
			for (let j = i + 1; j < types.length; j++) {
				const difference =
					1 - iou(shapes.get(types[i]).cells, shapes.get(types[j]).cells);
				console.log(
					`  ${types[i]} vs ${types[j]}: 1 − IoU = ${difference.toFixed(3)}`,
				);
				if (gate.pairs)
					check(
						`${rangeKm} km — ${types[i]} and ${types[j]} differ by outline alone`,
						difference > floor,
						`1 − IoU = ${difference.toFixed(3)} (floor ${floor})`,
					);
			}
		}

		const first = shapes.get("trade");
		let detail = "no second silhouette to compare";
		if (first?.cells && control?.cells) {
			const drift = 1 - iou(first.cells, control.cells);
			detail = `1 − IoU = ${drift.toFixed(3)}`;
		}
		console.log(
			`  report-only: ${rangeKm} km — re-measuring one station reproduces its silhouette — ` +
				`${detail} (ceiling ${MAX_CONTROL_DIFFERENCE})`,
		);
		return shapes;
	};
}
