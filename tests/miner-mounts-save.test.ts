import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { makeModule, stockLoadout } from "../src/loadout";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import { newWorld, visit } from "../src/world-state";

const world = () => visit(newWorld(0x5ee11e), 0, 3);

test("a miner save carries h2 and h3 when they are fitted, and reads them back (#1147)", () => {
	const base = newCommanderRecord("miner");
	const loadout = {
		...stockLoadout("miner"),
		h2: makeModule("mining-laser", 3),
		h3: { ...makeModule("pulse-laser", 3), purchaseCostCr: 1234 },
	};
	const save = {
		world: world(),
		commander: { ...base, state: { ...base.state, loadout } },
	};
	const raw = JSON.parse(JSON.stringify(serializeSave(save)));
	expect(Object.keys(raw.commander.state.loadout).sort()).toEqual([
		"h1",
		"h2",
		"h3",
		"i1",
		"plant",
	]);
	const back = parseSave(raw);
	expect(back.commander.state.loadout).toEqual(loadout);
	expect(serializeSave(back)).toEqual(serializeSave(save));
});

test("a miner save written before the mounts loads with h2 and h3 empty and h1 as saved", () => {
	const raw = JSON.parse(
		readFileSync(
			new URL("./fixtures/save-miner-before-mounts.json", import.meta.url),
			"utf8",
		),
	);
	const saved = raw.commander.state.loadout;
	expect(Object.keys(saved).sort()).toEqual(["h1", "i1", "plant"]);
	const { loadout } = parseSave(raw).commander.state;
	expect(loadout).toEqual(saved);
	expect(loadout.h1).toEqual(makeModule("pulse-laser", 3));
	expect(loadout.h2).toBeUndefined();
	expect(loadout.h3).toBeUndefined();
});
