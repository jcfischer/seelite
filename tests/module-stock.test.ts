import { expect, test } from "bun:test";
import { moduleStock } from "../src/module-stock";
import { moduleRows } from "../src/loadout";
import { marketStationOf } from "../src/market";

const input = (
	type: "trade" | "refinery" | "shipyard" = "trade",
	seed = 123,
) => ({
	station: marketStationOf(
		{ type, localCarrierId: `station-${type}`, blackMarket: false },
		seed,
	),
	economy: 3,
	displayTL: 8,
	gameTimeMin: 0,
});
test("every market-bearing station epoch includes the size one E essentials", () => {
	for (const type of ["trade", "refinery", "shipyard"] as const)
		for (const gameTimeMin of [0, 31, 62]) {
			const rows = moduleStock({ ...input(type), displayTL: 1, gameTimeMin });
			for (const kind of [
				"pulse-laser",
				"cargo-rack",
				"fuel-tank",
				"power-plant",
			])
				expect(
					rows.some((r) => r.kind === kind && r.size === 1 && r.grade === "E"),
				).toBe(true);
		}
});
test("stock is repeatable availability at catalogue prices, not mutable quantities", () => {
	const i = input();
	expect(moduleStock(i)).toEqual(moduleStock(i));
	for (const r of moduleStock(i)) expect(moduleRows()).toContain(r);
	expect(moduleStock(i)).not.toEqual(moduleStock({ ...i, gameTimeMin: 31 }));
	expect(moduleStock(i)).not.toEqual(moduleStock(input("trade", 456)));
});
test("type technology and economy each affect availability while exclusive equipment stays scoped", () => {
	const i = input();
	expect(moduleStock(i)).not.toEqual(moduleStock({ ...i, economy: 7 }));
	expect(moduleStock(i)).not.toEqual(moduleStock({ ...i, displayTL: 15 }));
	expect(moduleStock(i)).not.toEqual(moduleStock(input("shipyard")));
	for (const r of moduleStock(i))
		expect(["mining-laser", "fuel-scoop", "military-laser"]).not.toContain(
			r.kind,
		);
});
