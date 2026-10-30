import { expect, test } from "bun:test";
import { fireGroups, ArmedFireGroup, type FireGroup } from "../src/fire-group";
import { makeModule, stockLoadout, parseLoadout } from "../src/loadout";

const patrol = {
	...stockLoadout("patrol"),
	h2: makeModule("mining-laser", 1),
	u1: makeModule("identity-scanner", 1),
};
test("groups follow hull slots, include mining lasers and reserve a trigger", () => {
	const groups = fireGroups(patrol, "patrol");
	expect(groups.map((g) => g.label)).toEqual([
		"ALL LASERS",
		"H1 PULSE LASER",
		"H2 MINING LASER",
		"IDENTITY SCANNER",
	]);
	expect(groups.map((g) => g.trigger)).toEqual([
		"primary",
		"primary",
		"primary",
		"primary",
	]);
	expect(groups[0].slots).toEqual(["h1", "h2"]);
	expect(
		fireGroups(Object.fromEntries(Object.entries(patrol).reverse()), "patrol"),
	).toEqual(groups);
	expect(
		fireGroups(
			parseLoadout(JSON.parse(JSON.stringify(patrol)), "patrol"),
			"patrol",
		),
	).toEqual(groups);
});
test("one laser is one group; scanner, empty and non-primary devices", () => {
	const stock = stockLoadout("courier");
	const armed = new ArmedFireGroup();
	expect(armed.label(fireGroups(stock, "courier"))).toBe(
		"H1 PULSE LASER · 1/1",
	);
	const groups = fireGroups(
		{ ...stock, u1: makeModule("identity-scanner", 1) },
		"courier",
	);
	expect(armed.label(groups)).toBe("H1 PULSE LASER · 1/2");
	armed.cycle(groups);
	expect(armed.label(groups)).toBe("IDENTITY SCANNER · 2/2");
	expect(armed.firesLaser(groups)).toBe(false);
	armed.reset();
	expect(armed.firesLaser(groups)).toBe(true);
	expect(armed.label(groups)).toBe("H1 PULSE LASER · 1/2");
	armed.cycle(groups);
	armed.cycle(groups);
	expect(armed.label(groups)).toBe("H1 PULSE LASER · 1/2");
	const empty = fireGroups(
		{
			plant: stock.plant,
			h1: makeModule("missile-rack", 1),
			u1: makeModule("ecm", 1),
		},
		"courier",
	);
	expect(empty).toEqual([]);
	armed.cycle(empty);
	expect(armed.label(empty)).toBe("NO WEAPONS");
	expect(armed.firesLaser(empty)).toBe(false);
	expect(new ArmedFireGroup().label(groups)).toBe("H1 PULSE LASER · 1/2");
});

test("under ?mining=1 two or more Mining Lasers add MINING LASERS after ALL LASERS (#1147, #920 D-D11)", () => {
	const miner = {
		...stockLoadout("miner"),
		h2: makeModule("mining-laser", 3),
		h3: makeModule("mining-laser", 3),
	};
	const laser = (label: string, slots: string[]): FireGroup => ({
		label,
		trigger: "primary",
		kind: "lasers",
		slots,
	});
	expect(fireGroups(miner, "miner", true)).toEqual([
		laser("ALL LASERS", ["h1", "h2", "h3"]),
		laser("MINING LASERS", ["h2", "h3"]),
		laser("H1 PULSE LASER", ["h1"]),
		laser("H2 MINING LASER", ["h2"]),
		laser("H3 MINING LASER", ["h3"]),
	]);
	const flagless = [
		laser("ALL LASERS", ["h1", "h2", "h3"]),
		laser("H1 PULSE LASER", ["h1"]),
		laser("H2 MINING LASER", ["h2"]),
		laser("H3 MINING LASER", ["h3"]),
	];
	expect(fireGroups(miner, "miner", false)).toEqual(flagless);
	expect(fireGroups(miner, "miner")).toEqual(flagless);
	const one = { ...stockLoadout("miner"), h2: makeModule("mining-laser", 3) };
	expect(fireGroups(one, "miner", true)).toEqual([
		laser("ALL LASERS", ["h1", "h2"]),
		laser("H1 PULSE LASER", ["h1"]),
		laser("H2 MINING LASER", ["h2"]),
	]);
	const pulses = {
		...stockLoadout("miner"),
		h2: makeModule("pulse-laser", 3),
		h3: makeModule("pulse-laser", 3),
	};
	expect(fireGroups(pulses, "miner", true).map((g) => g.label)).not.toContain(
		"MINING LASERS",
	);
});
