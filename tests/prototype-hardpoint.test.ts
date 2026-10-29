import { expect, test } from "bun:test";
import { HULL_SPECS, withPrototypeMountHardpoints } from "../src/hull";
import { makeModule, parseLoadout, stockLoadout } from "../src/loadout";
import { withoutPrototypeSlot } from "../src/rock-drill";

test("the prototype miner gains h2 and h3 beside h1, the same size, and nothing else moves (D-D9)", () => {
	const before = HULL_SPECS.miner;
	const after = withPrototypeMountHardpoints(before);
	expect(after.hardpoints).toBe(3);
	expect(after.slots.map((s) => s.key)).toEqual([
		"h1",
		"h2",
		"h3",
		...before.slots.slice(1).map((s) => s.key),
	]);
	expect(after.slots[0]).toEqual(before.slots[0]);
	for (const key of ["h2", "h3"])
		expect(after.slots.find((s) => s.key === key) as object).toEqual({
			...(before.slots[0] as object),
			key,
			prototype: true,
		});
	const { hardpoints: _a, slots: _b, ...rest } = after;
	const { hardpoints: _c, slots: _d, ...was } = before;
	expect(rest).toEqual(was);
	expect(withPrototypeMountHardpoints(after)).toBe(after);
	expect(HULL_SPECS.miner.hardpoints).toBe(1);
});

test("a save carrying h2 or h3 does not load without the flag, so the prototype writes neither", () => {
	const loadout: Record<string, ReturnType<typeof makeModule>> = {
		...stockLoadout("miner"),
		h2: makeModule("mining-laser", 3),
		h3: makeModule("mining-laser", 3),
	};
	expect(() => parseLoadout(loadout, "miner")).toThrow("module does not fit");
	const written = withoutPrototypeSlot(loadout);
	expect(written).toEqual(stockLoadout("miner"));
	expect(() => parseLoadout(written, "miner")).not.toThrow();
});

test("under the flag NPC miners keep one laser, and two Mining Lasers fire as one group (D-D8, D-D10)", async () => {
	const { addPrototypeMinerHardpoints } = await import("../src/hull");
	const { npcLoadout } = await import("../src/npc-loadout");
	const { fireGroups } = await import("../src/fire-group");
	const { firedExtraction } = await import("../src/rock-extraction");
	const { moduleRow } = await import("../src/loadout");
	const original = HULL_SPECS.miner;
	try {
		addPrototypeMinerHardpoints();
		for (let seed = 1; seed < 40; seed++) {
			const fit = npcLoadout("miner", seed);
			expect(Object.keys(fit).filter((k) => /^h\d$/.test(k))).toEqual(["h1"]);
		}
		const player = {
			...stockLoadout("miner"),
			h2: makeModule("mining-laser", 3),
			h3: makeModule("mining-laser", 3),
		};
		const groups = fireGroups(player, "miner", true);
		const group = groups.find((g) => g.label === "MINING LASERS");
		expect(group?.slots).toEqual(["h2", "h3"]);
		expect(groups.map((g) => g.label)).toEqual([
			"ALL LASERS",
			"MINING LASERS",
			"H1 PULSE LASER",
			"H2 MINING LASER",
			"H3 MINING LASER",
			"BUILT-IN DRILL",
		]);
		const one = moduleRow(player.h2).output.extractionTPerS as number;
		const both = firedExtraction(
			(group?.slots ?? []).map((k) => ({
				grade: player[k as "h2"].grade,
				extractionTPerS: moduleRow(player[k as "h2"]).output
					.extractionTPerS as number,
			})),
		);
		expect(both.rate).toBeCloseTo(2 * one, 12);
		expect(one).toBeCloseTo(0.225, 12);
	} finally {
		(HULL_SPECS as Record<string, typeof original>).miner = original;
	}
	expect(HULL_SPECS.miner.hardpoints).toBe(1);
});

test("a second Mining Laser is bought on a station's Equipment tab and fits h3 (D-D12; the catalogue sells it at refineries)", async () => {
	const { addPrototypeMinerHardpoints } = await import("../src/hull");
	const { marketStationOf } = await import("../src/market");
	const { newCommander, transactAtStation } = await import(
		"../src/station-commerce"
	);
	const { TOP_RUNGS } = await import("../src/ladder");
	const original = HULL_SPECS.miner;
	try {
		addPrototypeMinerHardpoints();
		const loadout = {
			...stockLoadout("miner"),
			h2: makeModule("mining-laser", 3),
		};
		const out = transactAtStation({
			commander: { ...newCommander("miner"), credits: 100_000, loadout },
			deficits: {},
			station: marketStationOf(
				{
					type: "refinery",
					localCarrierId: "station-refinery",
					blackMarket: false,
				},
				0x51a7_10,
			),
			stationKey: "1:station-refinery" as never,
			economy: 3,
			gameTimeMin: 0,
			displayTL: 11,
			entrustedT: 0,
			rungs: TOP_RUNGS,
			hullReach: () => ({ ok: true, systems: 1 }) as const,
			action: { type: "buy-equipment", equipment: "Mining Laser" },
		});
		expect(out.accepted ? "ok" : (out as { reason: string }).reason).toBe("ok");
		if (!out.accepted) return;
		expect(out.commander.loadout.h1?.module).toBe("pulse-laser");
		expect(out.commander.loadout.h2?.module).toBe("mining-laser");
		expect(out.commander.loadout.h3?.module).toBe("mining-laser");
		expect(out.commander.credits).toBeLessThan(100_000);
	} finally {
		(HULL_SPECS as Record<string, typeof original>).miner = original;
	}
});
