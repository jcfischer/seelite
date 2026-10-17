/**
 * The duel band's plates (#945, the principal's ruling, 2026-10-12): every
 * cell stands on its own dark plate whenever it shows — SHD, HEAT and the
 * armed-group label as much as TEMP — and TEMP and SCOOPING keep the one plate
 * #932 gave them. `scripts/probe-duel-hud.mjs` reads the plates off the paint;
 * this owns which cells carry one in each state.
 */
import { describe, expect, test } from "bun:test";
import type { FloorCell } from "../src/cockpit";
import {
	ARMED_GROUP_PLATE,
	HULL_TEMP_LABEL,
	SCOOP_LABEL,
	duelBandCells,
	duelBandPlates,
} from "../src/duel-hud";
import { fullCondition } from "../src/ship-condition";

/** The band as `drawFlightFloor` composes it: the cells, then the armed group. */
const band = (state: {
	fighting: boolean;
	hullTemp?: number;
	scooping?: boolean;
}): FloorCell[] => [
	...duelBandCells({
		fighting: state.fighting,
		condition: { ...fullCondition("courier"), hullTemp: state.hullTemp ?? 0 },
		scooping: state.scooping ?? false,
		fuelLy: 3.2,
	}),
	{ label: "", value: "H1 PULSE LASER · 1/1", tone: "passive" },
];

/** Each plate as its name and the labels of the cells it stands behind. */
const plates = (row: FloorCell[]) =>
	duelBandPlates(row).map((p) => ({
		label: p.label,
		cells: row.slice(p.from, p.to + 1).map((c) => c.label),
	}));

describe("which cells stand on a plate", () => {
	test("a fight away from a star: SHD, HEAT and the armed group each on its own", () => {
		expect(plates(band({ fighting: true }))).toEqual([
			{ label: "SHD", cells: ["SHD"] },
			{ label: "HEAT", cells: ["HEAT"] },
			{ label: ARMED_GROUP_PLATE, cells: [""] },
		]);
	});

	test("a fight inside the band: TEMP keeps a plate of its own beside SHD and HEAT", () => {
		expect(plates(band({ fighting: true, hullTemp: 0.4 }))).toEqual([
			{ label: "SHD", cells: ["SHD"] },
			{ label: "HEAT", cells: ["HEAT"] },
			{ label: HULL_TEMP_LABEL, cells: [HULL_TEMP_LABEL] },
			{ label: ARMED_GROUP_PLATE, cells: [""] },
		]);
	});

	test("in combat the scoop's line drops, so it has no plate", () => {
		const row = band({ fighting: true, hullTemp: 0.4, scooping: true });
		expect(plates(row).map((p) => p.label)).toEqual([
			"SHD",
			"HEAT",
			HULL_TEMP_LABEL,
			ARMED_GROUP_PLATE,
		]);
	});

	test("no fight: no SHD or HEAT plate, and the armed group has its own", () => {
		expect(plates(band({ fighting: false }))).toEqual([
			{ label: ARMED_GROUP_PLATE, cells: [""] },
		]);
	});

	test("no cell, no plate", () => {
		expect(duelBandPlates([])).toEqual([]);
	});

	test("the scoop filling out of combat: TEMP and SCOOPING share one plate, as #932 shipped", () => {
		expect(
			plates(band({ fighting: false, hullTemp: 0.4, scooping: true })),
		).toEqual([
			{ label: HULL_TEMP_LABEL, cells: [HULL_TEMP_LABEL, SCOOP_LABEL] },
			{ label: ARMED_GROUP_PLATE, cells: [""] },
		]);
	});

	test("TEMP alone out of combat stands on its plate", () => {
		expect(plates(band({ fighting: false, hullTemp: 0.4 }))).toEqual([
			{ label: HULL_TEMP_LABEL, cells: [HULL_TEMP_LABEL] },
			{ label: ARMED_GROUP_PLATE, cells: [""] },
		]);
	});
});

describe("the plates cover the row once", () => {
	test("in every state each cell is under exactly one plate, in order", () => {
		const states = [
			{ fighting: true },
			{ fighting: true, hullTemp: 0.4 },
			{ fighting: true, hullTemp: 0.4, scooping: true },
			{ fighting: false },
			{ fighting: false, hullTemp: 0.4 },
			{ fighting: false, hullTemp: 0.4, scooping: true },
		];
		for (const state of states) {
			const row = band(state);
			const covered = duelBandPlates(row).flatMap((p) =>
				Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from + i),
			);
			expect(covered).toEqual(row.map((_, i) => i));
		}
	});
});
