import { expect, test } from "bun:test";
import { TOP_RUNGS } from "../src/ladder";
import { carrierKey } from "../src/carrier-key";
import { marketStationOf } from "../src/market";
import {
	newCommander,
	transactAtStation,
	hullOffer,
	type StationCommerceInput,
} from "../src/station-commerce";
import { makeModule } from "../src/loadout";
const input = (
	patch: Partial<StationCommerceInput> = {},
): StationCommerceInput => ({
	commander: {
		...newCommander("courier"),
		credits: 1e7,
		fuelLy: 0,
		cargo: { Food: 1 },
	},
	deficits: {},
	station: marketStationOf(
		{
			type: "shipyard",
			localCarrierId: "station-shipyard",
			blackMarket: false,
		},
		47,
	),
	stationKey: carrierKey(0, "station-shipyard"),
	economy: 3,
	gameTimeMin: 0,
	displayTL: 15,
	entrustedT: 0,
	rungs: TOP_RUNGS,
	hullReach: () => ({ ok: true, systems: 2 }),
	mining: true,
	services: { market: false, equipment: false, exclusive: false },
	action: { type: "buy-commodity", commodity: "Food" },
	...patch,
});

test("mining services gate commodity trades, unscoped modules and hulls while fuel remains permanent", () => {
	expect(transactAtStation(input()).reason).toBe("market-damaged");
	expect(
		transactAtStation(
			input({ action: { type: "sell-commodity", commodity: "Food" } }),
		).reason,
	).toBe("market-damaged");
	expect(
		transactAtStation(
			input({
				action: {
					type: "buy-module",
					slot: "plant",
					module: makeModule("power-plant", 1),
				},
			}),
		).reason,
	).toBe("equipment-damaged");
	expect(hullOffer(input(), "freighter").reason).toBe("exclusive-damaged");
	expect(
		transactAtStation(input({ action: { type: "buy-fuel" } })).accepted,
	).toBe(true);
	const off = transactAtStation(input({ mining: false }));
	expect(off.reason).not.toBe("market-damaged");
});

test("hull rung refusal precedes damage and owned fitting operations remain outside purchase gates", () => {
	expect(
		hullOffer(
			input({ rungs: { combat: 0, trade: 0, exploration: 0 } }),
			"miner",
		).reason,
	).toBe("hull-locked");
	const remove = transactAtStation(
		input({ action: { type: "remove-module", slot: "h1" } }),
	);
	expect(remove.accepted).toBe(true);
});

test("type-scoped purchases consult exclusive service without changing existing catalogue scope or grades", async () => {
	const { moduleStock } = await import("../src/module-stock");
	const { LEGACY_MODULES, moduleFits, stockLoadout } = await import(
		"../src/loadout"
	);
	const { HULL_SPECS } = await import("../src/hull");
	const cases = [
		...["Fuel Scoops", "Mining Laser"].map((name) => ({
			name,
			type: "refinery" as const,
		})),
		...[
			"Extra Energy Unit",
			"Military Laser",
			"Identity Scanner",
			"Long-Range Scanner",
			"Mining Laser",
		].map((name) => ({ name, type: "shipyard" as const })),
	];
	for (const { name, type } of cases) {
		const commander = {
			...newCommander("miner"),
			credits: 1e7,
			cargo: {},
			loadout: { plant: stockLoadout("miner").plant },
		};
		const base = input({
			commander,
			station: marketStationOf(
				{ type, localCarrierId: `station-${type}`, blackMarket: false },
				47,
			),
			action: { type: "buy-equipment", equipment: name },
			services: undefined,
		});
		const ordinary = transactAtStation(base);
		expect(ordinary.accepted).toBe(true);
		expect(
			transactAtStation({
				...base,
				services: { equipment: true, exclusive: false },
			}).reason,
		).toBe("exclusive-damaged");
		expect(
			transactAtStation({
				...base,
				services: { equipment: false, exclusive: true },
			}),
		).toEqual(ordinary);
		const row = Array.from({ length: 12 }, (_, epoch) => ({
			...base,
			gameTimeMin: epoch * 30,
		}))
			.flatMap((state) =>
				moduleStock(state)
					.filter((row) => row.kind === LEGACY_MODULES[name])
					.map((row) => ({ state, row })),
			)
			.find(({ row }) =>
				HULL_SPECS.miner.slots.some((slot) =>
					moduleFits(makeModule(row.kind, row.size, row.grade), slot),
				),
			);
		if (name === "Mining Laser" && type === "shipyard") {
			expect(row).toBeUndefined();
			continue;
		}
		expect(row).toBeDefined();
		const module = makeModule(row!.row.kind, row!.row.size, row!.row.grade);
		const slot = HULL_SPECS.miner.slots.find((slot) =>
			moduleFits(module, slot),
		)!.key;
		const action = { type: "buy-module" as const, module, slot };
		expect(
			transactAtStation({
				...row!.state,
				action,
				services: { equipment: true, exclusive: false },
			}).reason,
		).toBe("exclusive-damaged");
		expect(
			transactAtStation({
				...row!.state,
				action,
				services: { equipment: false, exclusive: true },
			}),
		).toEqual(
			transactAtStation({ ...row!.state, action, services: undefined }),
		);
	}
	for (const action of [
		{ type: "buy-fuel" as const },
		{ type: "buy-commodity" as const, commodity: "Food" },
		{
			type: "buy-module" as const,
			slot: "plant",
			module: makeModule("power-plant", 1),
		},
		{ type: "buy-equipment" as const, equipment: "Mining Laser" },
	]) {
		const off = input({ mining: false, action });
		expect(transactAtStation(off)).toEqual(
			transactAtStation({ ...off, services: undefined }),
		);
	}
});

test("hull exchange needs market service only for a real overflow sale", () => {
	const base = input({
		services: { exclusive: true, market: false, equipment: true },
	});
	expect(hullOffer(base, "freighter").accepted).toBe(true);
	const smaller = {
		...base,
		commander: {
			...newCommander("freighter"),
			credits: 1e7,
			cargo: { Food: 60 },
		},
	};
	expect(hullOffer(smaller, "courier").reason).toBe("market-damaged");
	expect(
		hullOffer(
			{
				...smaller,
				entrustedT: 60,
				commander: { ...smaller.commander, cargo: {} },
			},
			"courier",
		).reason,
	).toBe("hull-hold");
});
