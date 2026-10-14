/**
 * The Equipment tab's preview prints every effect a candidate module has on
 * the fitted ship, as before → after with its signed change (principal,
 * 2026-10-14, on #927). A row shows only when its printed value moves; ACCEL
 * and CREDIT / RAIDER always show.
 */
import { describe, expect, test } from "bun:test";
import { HULL_SPECS } from "../src/hull";
import {
	freeSlot,
	type FittedModule,
	makeModule,
	moduleFits,
} from "../src/loadout";
import type { ModuleKind } from "../src/module-catalog";
import { fitDeltas, fitReadout, MODULE_LABELS } from "../src/outfitting";
import { type CommanderState, newCommander } from "../src/station-commerce";

const base = (): CommanderState => newCommander("courier");

/** The courier with `m` fitted: into a free slot, or over the first slot that
 *  takes it (the hardpoint's stock pulse, the plant). */
function withModule(c: CommanderState, m: FittedModule): CommanderState {
	if (m.module === "power-plant")
		return { ...c, loadout: { ...c.loadout, plant: m } };
	const slot =
		freeSlot(c.loadout, c.hull, m) ??
		HULL_SPECS[c.hull].slots.find((s) => moduleFits(m, s));
	if (!slot) throw Error(`no courier slot takes ${m.module}`);
	return { ...c, loadout: { ...c.loadout, [slot.key]: m } };
}

const rowsFor = (m: FittedModule, from: CommanderState = base()) =>
	fitDeltas(fitReadout(from, 0), fitReadout(withModule(from, m), 0));
const row = (rows: ReturnType<typeof fitDeltas>, label: string) =>
	rows.find((r) => r.label === label);

describe("fitDeltas", () => {
	test("a 1E plate: HULL 100 → 125, +25", () => {
		expect(row(rowsFor(makeModule("armour-plating", 1, "E")), "HULL")).toEqual({
			label: "HULL",
			before: "100.0",
			after: "125.0",
			delta: "+25.0",
			unit: "pts",
		});
	});

	test("a 1E booster: SHIELD 106 → 131 per pool", () => {
		const r = row(rowsFor(makeModule("shield-booster", 1, "E")), "SHIELD");
		expect([r?.before, r?.after, r?.delta]).toEqual([
			"106.0",
			"131.0",
			"+25.0",
		]);
	});

	test("a 1A plant: BANK +50 and REGEN +6", () => {
		const rows = rowsFor(makeModule("power-plant", 1, "A"));
		expect(row(rows, "BANK")?.delta).toBe("+50.0");
		expect(row(rows, "REGEN")?.delta).toBe("+6.0");
	});

	test("a beam over the stock pulse: DPS 6 → 9; a missile rack over it: DPS −6, MISSILES +4", () => {
		expect(row(rowsFor(makeModule("beam-laser", 1, "E")), "DPS")?.delta).toBe(
			"+3.0",
		);
		const rack = rowsFor(makeModule("missile-rack", 1, "E"));
		expect(row(rack, "DPS")?.delta).toBe("−6.0");
		expect(row(rack, "MISSILES")?.delta).toBe("+4");
	});

	test("a cargo rack moves HOLD; a tank moves TANK and not JUMP; a scoop moves SCOOP", () => {
		const hold = row(rowsFor(makeModule("cargo-rack", 1, "E")), "HOLD");
		expect(hold?.delta).toMatch(/^\+\d+$/);
		const tank = rowsFor(makeModule("fuel-tank", 1, "E"));
		expect(row(tank, "TANK")?.delta).toMatch(/^\+/);
		expect(row(tank, "JUMP")).toBeUndefined();
		expect(
			row(rowsFor(makeModule("fuel-scoop", 1, "E")), "SCOOP")?.delta,
		).toMatch(/^\+/);
	});

	test("ACCEL and CREDIT / RAIDER always show; a removal reads negative", () => {
		const plated = withModule(base(), makeModule("armour-plating", 1, "E"));
		const rows = fitDeltas(fitReadout(plated, 0), fitReadout(base(), 0));
		expect(row(rows, "ACCEL")?.delta).toMatch(/^\+/);
		expect(row(rows, "HULL")?.delta).toBe("−25.0");
		expect(row(rows, "CREDIT / RAIDER")?.delta).toMatch(/^\+/);
		const same = fitDeltas(fitReadout(base(), 0), fitReadout(base(), 0));
		expect(same.map((r) => [r.label, r.delta])).toEqual([
			["ACCEL", "±0.000"],
			["CREDIT / RAIDER", "±0.00"],
		]);
	});

	/**
	 * The kinds whose catalogue output no game system reads yet: the module's
	 * presence is its whole effect, so size and grade move only mass and price,
	 * and a row for their figure would promise what the game does not do. A kind
	 * that gains a reader must leave this list and gain a row.
	 */
	const PRESENCE_ONLY: readonly ModuleKind[] = [
		"mining-laser",
		"ecm",
		"identity-scanner",
		"docking-computer",
		"escape-pod",
		"long-range-scanner",
	];

	test("every other module kind moves at least one row beside ACCEL and CREDIT", () => {
		// Into an empty slot, so a hardpoint kind is not read as the stock pulse
		// it would replace.
		const { h1: _, ...unarmed } = base().loadout;
		const empty = { ...base(), loadout: unarmed };
		for (const kind of Object.keys(MODULE_LABELS) as ModuleKind[]) {
			const effects = rowsFor(makeModule(kind, 1, "A"), empty)
				.map((r) => r.label)
				.filter((l) => l !== "ACCEL" && l !== "CREDIT / RAIDER");
			if (PRESENCE_ONLY.includes(kind))
				expect([kind, effects]).toEqual([kind, []]);
			else expect([kind, effects.length > 0]).toEqual([kind, true]);
		}
	});
});
