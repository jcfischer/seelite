import { expect, test } from "bun:test";
import {
	MINER_FACE_SCREENS,
	MINER_FACE_TITLES,
	type MinerFaceState,
	minerFaceRows,
} from "../src/miner-faces";

const state = (over: Partial<MinerFaceState> = {}): MinerFaceState => ({
	mining: true,
	surveyDesignation: null,
	minedT: 12,
	holdLabel: "RAW ORE",
	holdUsedT: 12.4,
	holdCapacityT: 3000,
	fireGroup: "BUILT-IN DRILL",
	heatPercent: 20,
	energyPercent: 80,
	drill: {
		block: null,
		gapM: 0.3,
		anchored: false,
		anchorWhy: "OK",
		feetOnRock: 4,
	},
	...over,
});
const texts = (rows: readonly (readonly [string, string])[]) =>
	rows.map(([text]) => text);

test("every face has a title and rows; the drill camera is not one of them", () => {
	const rows = minerFaceRows(state());
	for (const name of MINER_FACE_SCREENS) {
		expect(MINER_FACE_TITLES[name]).toBeTruthy();
		expect(rows[name].length).toBeGreaterThan(0);
	}
	expect(MINER_FACE_SCREENS as readonly string[]).not.toContain("drillcam");
});

test("without the mining flag the mining faces say so and read no drill", () => {
	const rows = minerFaceRows(state({ mining: false }));
	for (const name of ["survey", "drill", "anchor", "stance"] as const)
		expect(texts(rows[name])).toEqual(["MINING OFF"]);
	expect(texts(rows.ore)).toEqual(["ORE 12 T", "RAW ORE 12/3000 T"]);
	expect(texts(rows.lasers)).toEqual([
		"BUILT-IN DRILL",
		"HEAT 20%",
		"ENERGY 80%",
	]);
});

test("the survey face reads the designation's first three parts, or asks for a rock", () => {
	expect(texts(minerFaceRows(state()).survey)).toEqual(["NO ROCK TARGETED"]);
	expect(
		texts(minerFaceRows(state({ surveyDesignation: "A · B · C · D" })).survey),
	).toEqual(["A", "B", "C"]);
});

test("the drill face reads contact and gap, or what blocks it", () => {
	const contact = minerFaceRows(state()).drill;
	expect(contact).toEqual([
		["CONTACT", "#6dff9a"],
		["GAP 0.3 M", "#d8f6ff"],
	]);
	const blocked = minerFaceRows(
		state({
			drill: { ...state().drill, block: "OUT OF REACH", gapM: null },
		}),
	).drill;
	expect(blocked).toEqual([["OUT OF REACH", "#ff4a3a"]]);
	for (const block of ["STOWED", "DEPLOYING"])
		expect(
			minerFaceRows(state({ drill: { ...state().drill, block, gapM: null } }))
				.drill,
		).toEqual([[block, "#9fb7c0"]]);
});

test("the anchor and stance faces read the feet on the rock and the hold", () => {
	const free = minerFaceRows(
		state({
			drill: { ...state().drill, feetOnRock: 2, anchorWhy: "ALIGN" },
		}),
	);
	expect(texts(free.anchor)).toEqual(["TWO FEET GRIPPED", "ALIGN"]);
	expect(free.stance).toEqual([["2/4 FEET GRIPPED", "#ffb347"]]);
	expect(minerFaceRows(state()).stance).toEqual([
		["4/4 FEET GRIPPED", "#6dff9a"],
	]);
	const held = minerFaceRows(
		state({ drill: { ...state().drill, anchored: true } }),
	);
	expect(texts(held.anchor)).toEqual(["FOUR FEET GRIPPED", "ANCHORED"]);
});

test("the anchor face names each count of feet, and each face's tones hold", () => {
	const at = (feetOnRock: number) =>
		minerFaceRows(state({ drill: { ...state().drill, feetOnRock } }));
	expect([0, 1, 2, 3, 4].map((n) => at(n).anchor[0][0])).toEqual([
		"NO FEET GRIPPED",
		"ONE FOOT GRIPPED",
		"TWO FEET GRIPPED",
		"THREE FEET GRIPPED",
		"FOUR FEET GRIPPED",
	]);
	const rows = minerFaceRows(state({ mining: false }));
	expect(rows.ore[0][1]).toBe("#ffb347");
	expect(rows.survey[0][1]).toBe("#9fb7c0");
});
