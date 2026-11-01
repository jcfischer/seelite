import { expect, test } from "bun:test";
import type { CarrierKey } from "../src/carrier-key";
import { fireGroups } from "../src/fire-group";
import { HULL_IDS, HULL_SPECS, type HullId } from "../src/hull";
import { TOP_RUNGS } from "../src/ladder";
import {
	boughtModule,
	LEGACY_MODULES,
	legacyModule,
	type Loadout,
	makeModule,
	moduleRow,
	stockLoadout,
} from "../src/loadout";
import { marketStationOf } from "../src/market";
import { npcLoadout } from "../src/npc-loadout";
import {
	firedExtraction,
	prototypeMiningLaserSlot,
} from "../src/rock-extraction";
import { newCommander, transactAtStation } from "../src/station-commerce";
import { stationEquipmentScreen } from "../src/station-console";

const hardpoints = (id: HullId) =>
	HULL_SPECS[id].slots.filter((s) => s.kind === "hardpoint");

test("the miner has h1 and the size-3 mount slots h2 and h3, and no other slot moves (#1147 D-D8, D-D10)", () => {
	const spec = HULL_SPECS.miner;
	expect(spec.hardpoints).toBe(3);
	expect(hardpoints("miner")).toEqual([
		{ key: "h1", kind: "hardpoint", size: 3 },
		{ key: "h2", kind: "hardpoint", size: 3, mount: true },
		{ key: "h3", kind: "hardpoint", size: 3, mount: true },
	]);
	expect(
		spec.slots.filter((s) => s.kind !== "hardpoint").map((s) => s.key),
	).toEqual(["u1", "u2", "u3", "i1", "i2", "i3", "i4", "flex"]);
	for (const id of HULL_IDS)
		if (id !== "miner")
			expect(
				`${id} ${hardpoints(id).some((s) => s.kind === "hardpoint" && s.mount)}`,
			).toBe(`${id} false`);
});

test("NPC and Traffic miners fly the stock fit: one laser, the mounts empty (D-D9)", () => {
	for (let seed = 1; seed < 60; seed++) {
		const fit = npcLoadout("miner", seed);
		expect(Object.keys(fit).filter((k) => /^h\d$/.test(k))).toEqual(["h1"]);
		expect(fit).toEqual(stockLoadout("miner"));
	}
});

test("a new miner game under the flag fits the Mining Laser in h2 at size 3 and keeps the Pulse Laser in h1", () => {
	const stock = stockLoadout("miner");
	expect(stock.h1).toEqual(makeModule("pulse-laser", 3));
	expect(stock.h2).toBeUndefined();
	expect(stock.h3).toBeUndefined();
	expect(prototypeMiningLaserSlot(hardpoints("miner"), stock)).toBe("h2");
});

const MINING_LASER = "Mining Laser";

const buyAt = (
	type: "refinery" | "shipyard",
	loadout: Loadout,
	mining: boolean,
) =>
	transactAtStation({
		commander: { ...newCommander("miner"), credits: 100_000, loadout },
		deficits: {},
		station: marketStationOf(
			{ type, localCarrierId: `station-${type}`, blackMarket: false },
			0x51a7_10,
		),
		stationKey: `1:station-${type}` as CarrierKey,
		economy: 3,
		gameTimeMin: 0,
		displayTL: 11,
		entrustedT: 0,
		rungs: TOP_RUNGS,
		hullReach: () => ({ ok: true, systems: 1 }) as const,
		mining,
		action: { type: "buy-equipment", equipment: MINING_LASER },
	});

test("the first Mining Laser bought at a refinery goes to h2 at size 3, and the Pulse Laser stays (D-D7, D-D18)", () => {
	for (const mining of [false, true]) {
		const out = buyAt("refinery", stockLoadout("miner"), mining);
		if (!out.accepted) throw new Error(out.reason);
		expect(out.commander.loadout.h1).toEqual(makeModule("pulse-laser", 3));
		const { purchaseCostCr, ...h2 } = out.commander.loadout.h2;
		expect(h2).toEqual(makeModule("mining-laser", 3));
		expect(out.commander.recoveredFittings ?? []).toEqual([]);
		const price = moduleRow(makeModule("mining-laser", 3)).priceCr;
		expect(purchaseCostCr).toBe(price);
		expect(out.commander.credits).toBe(100_000 - price);
	}
});

test("a second Mining Laser is bought at a refinery, and under the flag at a shipyard, and fits h3 at size 3 (D-D12, D-D18)", () => {
	const one = { ...stockLoadout("miner"), h2: makeModule("mining-laser", 3) };
	for (const [type, mining] of [
		["refinery", false],
		["refinery", true],
		["shipyard", true],
	] as const) {
		const out = buyAt(type, one, mining);
		if (!out.accepted) throw new Error(`${type}: ${out.reason}`);
		expect(out.commander.loadout.h1?.module).toBe("pulse-laser");
		expect(out.commander.loadout.h2?.module).toBe("mining-laser");
		const { purchaseCostCr: _paid, ...h3 } = out.commander.loadout.h3;
		expect(h3).toEqual(makeModule("mining-laser", 3));
	}
});

test("without the flag a shipyard does not list or sell the Mining Laser", () => {
	const out = buyAt("shipyard", stockLoadout("miner"), false);
	expect(out.accepted ? "sold" : out.reason).toBe("equipment-unavailable");
	const screen = (mining: boolean) =>
		stationEquipmentScreen({
			hull: "miner",
			loadout: stockLoadout("miner"),
			type: "shipyard",
			displayTL: 11,
			rungs: TOP_RUNGS,
			mining,
		});
	expect(screen(false).unavailable).toContainEqual({
		name: MINING_LASER,
		reason: "refineries only",
	});
	expect(screen(false).available.map((e) => e.name)).not.toContain(
		MINING_LASER,
	);
	expect(screen(true).available.map((e) => e.name)).toContain(MINING_LASER);
	expect(screen(true).unavailable.map((e) => e.name)).not.toContain(
		MINING_LASER,
	);
});

test("every other hull is sold the module it was sold before, whatever its loadout", () => {
	for (const id of HULL_IDS) {
		if (id === "miner") continue;
		for (const loadout of [stockLoadout(id), undefined])
			for (const name of Object.keys(LEGACY_MODULES))
				expect(boughtModule(id, loadout, name)).toEqual(legacyModule(id, name));
	}
});

test("two size-3 E Mining Lasers fire as MINING LASERS under the flag and cut 0.45 t/s together (provisional, #922)", () => {
	const loadout = {
		...stockLoadout("miner"),
		h2: makeModule("mining-laser", 3),
		h3: makeModule("mining-laser", 3),
	};
	const groups = fireGroups(loadout, "miner", true);
	expect(groups.map((g) => g.label)).toEqual([
		"ALL LASERS",
		"MINING LASERS",
		"H1 PULSE LASER",
		"H2 MINING LASER",
		"H3 MINING LASER",
		"BUILT-IN DRILL",
	]);
	expect(groups.find((g) => g.label === "MINING LASERS")?.slots).toEqual([
		"h2",
		"h3",
	]);
	expect(fireGroups(loadout, "miner", false).map((g) => g.label)).not.toContain(
		"MINING LASERS",
	);
	expect(
		fireGroups(
			{ ...stockLoadout("miner"), h2: makeModule("mining-laser", 3) },
			"miner",
			true,
		).map((g) => g.label),
	).not.toContain("MINING LASERS");
	const both = firedExtraction(
		["h2", "h3"].map((k) => ({
			grade: loadout[k as "h2"].grade,
			extractionTPerS: moduleRow(loadout[k as "h2"]).output
				.extractionTPerS as number,
		})),
	);
	expect(both.rate).toBeCloseTo(0.45, 12);
});
