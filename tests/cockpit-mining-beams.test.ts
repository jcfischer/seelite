import { afterAll, beforeAll, expect, test } from "bun:test";
import { fireGroups } from "../src/fire-group";
import { HULL_SPECS, withPrototypeMountHardpoints } from "../src/hull";
import { groupMuzzleIndices } from "../src/laser-modules";
import { type Loadout, makeModule, stockLoadout } from "../src/loadout";
import { glassTracerIndices } from "../src/rock-drill";

const stock = HULL_SPECS.miner;
const spec = withPrototypeMountHardpoints(stock);
const specs = HULL_SPECS as Record<string, typeof spec>;
beforeAll(() => {
	specs.miner = spec;
});
afterAll(() => {
	specs.miner = stock;
});

const loadout = (h3: boolean): Loadout => ({
	...stockLoadout("miner"),
	h1: makeModule("pulse-laser", 1),
	h2: makeModule("mining-laser", 3, "A"),
	...(h3 ? { h3: makeModule("mining-laser", 3, "A") } : {}),
});

function fireGroupsWith(lo: Loadout) {
	specs.miner = spec;
	try {
		return fireGroups(lo, "miner", true);
	} finally {
		specs.miner = stock;
	}
}

for (const h3 of [false, true])
	for (const group of fireGroupsWith(loadout(h3)).filter(
		(g) => g.kind === "lasers",
	))
		test(`${h3 ? "h2+h3" : "h2"}, ${group.label}: one cockpit beam per armed laser, a Mining Laser never from the glass (F1)`, () => {
			const lo = loadout(h3);
			const fired = groupMuzzleIndices("miner", group);
			const glass = glassTracerIndices("miner", lo, fired, true);
			const slots = spec.slots.filter((s) => s.kind === "hardpoint");
			const mining = fired.filter(
				(i) => lo[slots[i].key]?.module === "mining-laser",
			);
			expect(glass.length + mining.length).toBe(group.slots.length);
			for (const i of glass)
				expect(lo[slots[i].key]?.module).not.toBe("mining-laser");
		});

test("without mounts a Mining Laser keeps its glass tracer", () => {
	const lo = loadout(false);
	expect(glassTracerIndices("miner", lo, [0, 1], false)).toEqual([0, 1]);
});
