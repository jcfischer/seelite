import { expect, test } from "bun:test";
import { HULL_IDS, HULL_SPECS } from "../src/hull";
import { EQUIPMENT } from "../src/market";
import {
	migrateEquipment,
	loadoutValue,
	fittingValue,
	fitted,
	parseLoadout,
	moduleRow,
	stockLoadout,
} from "../src/loadout";
import { deathWreckContents } from "../src/death-wreck";
import {
	moduleFits,
	makeModule,
	transferLoadout,
	carriedModule,
} from "../src/loadout";

test("smaller modules fit larger slots without relaxing type or family", () => {
	const laser = makeModule("pulse-laser", 1);
	expect(moduleFits(laser, { key: "h", kind: "hardpoint", size: 3 })).toBe(
		true,
	);
	expect(
		moduleFits(makeModule("pulse-laser", 3), {
			key: "h",
			kind: "hardpoint",
			size: 1,
		}),
	).toBe(false);
	expect(moduleFits(laser, { key: "u", kind: "utility", size: 3 })).toBe(false);
	const rack = makeModule("cargo-rack", 1);
	expect(
		moduleFits(rack, {
			key: "i",
			kind: "internal",
			size: 3,
			accepts: ["fuel"],
		}),
	).toBe(false);
	expect(
		moduleFits(rack, {
			key: "flex",
			kind: "internal",
			size: 3,
			accepts: "any",
		}),
	).toBe(true);
	const stock = stockLoadout("courier");
	const moved = transferLoadout(stock, "freighter");
	expect(moved.loadout.h1).toEqual(stock.h1);
	expect(moved.loadout.plant).toEqual(stock.plant);
	expect(parseLoadout(moved.loadout, "freighter")).toEqual(moved.loadout);
});
import { newCommander, flownMassT } from "../src/station-commerce";
import {
	newCommanderRecord,
	serializeSave,
	parseSave,
} from "../src/save-envelope";
import { newWorld } from "../src/world-state";
import { fnv1a } from "../src/rng";

test("migration preserves every old item's list value on every hull, alone and together", () => {
	for (const hull of HULL_IDS)
		for (const items of [
			...EQUIPMENT.map((e) => [e.name]),
			EQUIPMENT.map((e) => e.name),
		]) {
			const before = items.reduce(
				(n, id) => n + EQUIPMENT.find((e) => e.name === id)!.priceCr,
				0,
			);
			const migrated = migrateEquipment(hull, items);
			const stock = stockLoadout(hull);
			const freeStockValue =
				moduleRow(stock.plant).priceCr +
				(items.some((name) =>
					["Military Laser", "Extra Beam Laser", "Extra Pulse Laser"].includes(
						name,
					),
				)
					? 0
					: moduleRow(stock.h1).priceCr);
			expect(
				migrated.refundCr +
					loadoutValue(migrated.loadout) -
					freeStockValue +
					migrated.recoveredFittings.reduce((n, f) => n + fittingValue(f), 0),
			).toBeGreaterThanOrEqual(before);
			expect(parseLoadout(migrated.loadout, hull)).toEqual(migrated.loadout);
		}
});
test("best owned combat laser leads; other weapons overflow without loss", () => {
	const m = migrateEquipment("courier", [
		"Extra Pulse Laser",
		"Extra Beam Laser",
		"Military Laser",
		"Missile",
	]);
	expect(m.loadout.h1.module).toBe("military-laser");
	expect(m.recoveredFittings.map((f) => f.module)).toEqual(
		expect.arrayContaining(["pulse-laser", "beam-laser", "missile-rack"]),
	);
	const rack = m.recoveredFittings.find((f) => f.module === "missile-rack")!;
	expect(rack.ammo).toBe(moduleRow(rack).output.missiles);
	expect(fitted(m.loadout, "Military Laser")).toBe(true);
	expect(fitted(m.loadout, "Missile")).toBe(false);
});
test("a cargo bay becomes the nearest rack to fifteen tonnes and retired items refund fully", () => {
	const m = migrateEquipment("courier", [
		"Large Cargo Bay",
		"Energy Bomb",
		"Galactic Hyperdrive",
	]);
	expect(
		moduleRow(Object.values(m.loadout).find((m) => m.module === "cargo-rack")!)
			.output.cargoT,
	).toBe(15);
	expect(m.refundCr).toBeGreaterThanOrEqual(5900);
});
test("stock fit contains the hull's plant and a pulse; fitted mass reaches handling", () => {
	for (const hull of HULL_IDS) {
		const c = newCommander(hull);
		expect(c.loadout).toEqual(stockLoadout(hull));
		expect(c.loadout.plant.size).toBe(HULL_SPECS[hull].plantSize);
		expect(flownMassT(hull, c, 0)).toBeCloseTo(
			HULL_SPECS[hull].massT +
				Object.values(c.loadout).reduce((n, m) => n + moduleRow(m).massT, 0),
			10,
		);
	}
});
const fixture = () =>
	serializeSave({
		world: newWorld(47),
		commander: newCommanderRecord("courier"),
	}) as any;
test("a carried typed fitting and a surviving wreck preserve grade, ammo and variant", () => {
	const c = newCommander("interceptor");
	const rack = {
		module: "missile-rack" as const,
		size: HULL_SPECS.interceptor.slots.find((s) => s.key === "h2")!.size,
		grade: "A" as const,
		ammo: 2,
		variant: "precise",
		purchaseCostCr: 725,
	};
	c.loadout = { ...c.loadout, h2: rack };
	let contents: ReturnType<typeof deathWreckContents> = [];
	for (
		let seed = 0;
		seed < 100 && !contents.some((c) => c.fitting?.variant === "precise");
		seed++
	)
		contents = deathWreckContents(seed, 1, c, "destroyed");
	expect(
		contents.find((c) => c.fitting?.variant === "precise")?.fitting,
	).toEqual(rack);
	const raw = fixture();
	raw.commander.state.recoveredFittings = [
		{ ...rack, id: "Missile", tonnes: 1 },
	];
	const saved = parseSave(seal(raw));
	expect(saved.commander.state.recoveredFittings).toEqual([
		{ ...rack, id: "Missile", tonnes: 1 },
	]);
	expect(parseSave(serializeSave(saved))).toEqual(saved);
	// Schema 14 already carried typed fittings and their purchase cost, before
	// sweep strength was added.
	raw.saveSchemaVersion = 14;
	expect(parseSave(seal(raw))).toEqual(saved);
});
test("invalid slots, grades, missing plants and impossible ammunition are refused", () => {
	for (const mutate of [
		(s: any) => delete s.loadout.plant,
		(s: any) => (s.loadout.h1.grade = "B"),
		(s: any) => (s.loadout.h1.size = "1"),
		(s: any) => (s.loadout.h1.module = "missing"),
		(s: any) => (s.loadout.h1.ammo = 1),
		(s: any) => (s.loadout.h99 = s.loadout.h1),
		(s: any) =>
			(s.loadout.h1 = {
				module: "missile-rack",
				size: 1,
				grade: "E",
				ammo: 99,
			}),
		(s: any) =>
			(s.recoveredFittings = [
				{
					id: "Docking Computer",
					tonnes: 1,
					module: "missile-rack",
					size: 1,
					grade: "E",
					ammo: 4,
				},
			]),
	]) {
		const raw = fixture();
		mutate(raw.commander.state);
		expect(() => parseSave(seal(raw))).toThrow();
	}
});
function seal(o: any) {
	const { integrity: _, ...body } = o;
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
}
test("v14 preserves cost in fitted, carried and wreck modules; v13 refuses the new field", () => {
	const raw = fixture();
	raw.commander.state.loadout.h1.purchaseCostCr = 850;
	raw.commander.state.recoveredFittings = [
		{ ...carriedModule(makeModule("pulse-laser", 1)), purchaseCostCr: 0 },
	];
	const parsed = parseSave(seal(raw));
	expect(parsed.commander.state.loadout.h1.purchaseCostCr).toBe(850);
	expect(parsed.commander.state.recoveredFittings?.[0].purchaseCostCr).toBe(0);
	expect(parseSave(serializeSave(parsed))).toEqual(parsed);
	const wrecks = Array.from({ length: 40 }, (_, seed) =>
		deathWreckContents(seed, 1, parsed.commander.state, "destroyed"),
	);
	expect(wrecks.flat().some((c) => c.fitting?.purchaseCostCr === 0)).toBe(true);
	raw.saveSchemaVersion = 13;
	expect(() => parseSave(seal(raw))).toThrow();
	delete raw.commander.state.loadout.h1.purchaseCostCr;
	delete raw.commander.state.recoveredFittings[0].purchaseCostCr;
	expect(parseSave(seal(raw)).commander.state.credits).toBe(
		raw.commander.state.credits,
	);
});
test("current saves write only loadout; mixed versions and unknown old ids are refused", () => {
	const current = fixture();
	expect(current.saveSchemaVersion).toBe(15);
	expect(current.commander.state.ownedEquipment).toBeUndefined();
	expect(() =>
		parseSave(
			seal({
				...current,
				commander: {
					...current.commander,
					state: { ...current.commander.state, ownedEquipment: [] },
				},
			}),
		),
	).toThrow();
	const old = fixture();
	old.saveSchemaVersion = 12;
	old.commander.state.ownedEquipment = [];
	expect(() => parseSave(seal(old))).toThrow();
	delete old.commander.state.loadout;
	old.commander.state.ownedEquipment = ["not equipment"];
	expect(() => parseSave(seal(old))).toThrow();
	old.commander.state.ownedEquipment = ["Missile", "Extra Beam Laser"];
	const original = JSON.stringify(old);
	const migrated = parseSave(seal(old));
	expect(migrated.commander.state.loadout.h1.module).toBe("beam-laser");
	expect(JSON.stringify(old)).toBe(original);
	expect(parseSave(serializeSave(migrated))).toEqual(migrated);
});
