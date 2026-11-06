import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	stationModelNames,
	stationModelUrl,
} from "../spikes/stations/model-paths";

const forms = [
	["ring", "trade"],
	["drum", "trade"],
	["assembly", "trade"],
	["wheel", "trade"],
	["derrick", "outpost"],
	["buoy", "outpost"],
	["rig", "outpost"],
	["cluster", "outpost"],
	["salvage", "outpost"],
];

test("the station study checks every model button", () => {
	expect(stationModelNames).toEqual(forms.map(([id]) => id));
});

test.each(forms)("%s flight mode loads its shipped %s model", (id, kind) => {
	const url = stationModelUrl(id, true);
	expect(url).toBe(`/src/models/${kind}-${id}.glb`);
	expect(existsSync(url.slice(1))).toBe(true);
});

test.each(forms)("%s review mode keeps its local study model", (id) => {
	expect(stationModelUrl(id, false)).toBe(`./${id}.glb`);
});
