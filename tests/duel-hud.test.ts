/**
 * Node #324 part (c)'s combat HUD, headless: what the glass combat row and the
 * Flight console say, the firing cue's tone, and when the row shows.
 *
 * The principal's rulings (2026-09-14): the gauges live **both** on the glass
 * (a minimal row during a fight) and on the Flight console (full detail); a
 * hostile's cue is **amber, red only while it fires**; and the cue is an
 * **in-cone firing cue** — the laser is a ray, so "on target" is whether a shot
 * would land now, not a lead dot ahead of the ship.
 *
 * Every row builds from `ship-condition.ts`'s exported constants, so a retune
 * of a pool or the heat ceiling moves the rows with it.
 */
import { describe, expect, test } from "bun:test";
import {
	DUEL_ROW_LABELS,
	HEAT_ACTION_FRACTION,
	duelConsoleReadout,
	raiderCueTone,
	duelRowCells,
	duelRowWidest,
	showDuelRow,
} from "../src/duel-hud";
import {
	ENERGY_BANK,
	HEAT_LOCK,
	SHIELD_POOL,
	type ShipCondition,
	fullCondition,
} from "../src/ship-condition";

const courier = (over: Partial<ShipCondition> = {}): ShipCondition => ({
	...fullCondition("courier"),
	...over,
});

const cell = (c: ShipCondition, label: string) => {
	const found = duelRowCells(c).find((x) => x.label === label);
	if (!found) throw new Error(`no ${label} cell`);
	return found;
};

describe("the glass combat row", () => {
	test("is two cells, shields then heat", () => {
		expect(duelRowCells(courier()).map((c) => c.label)).toEqual([
			...DUEL_ROW_LABELS,
		]);
		expect(DUEL_ROW_LABELS).toEqual(["SHD", "HEAT"]);
	});

	test("the shield cell prints both pools, rounded, fore first", () => {
		const c = courier({ fore: 71.6, aft: SHIELD_POOL });
		expect(cell(c, "SHD").value).toBe(`F 72 A ${SHIELD_POOL}`);
		expect(cell(c, "SHD").tone).toBe("passive");
	});

	test("an empty shield pool is a refusal, whichever side", () => {
		expect(cell(courier({ fore: 0 }), "SHD").tone).toBe("refused");
		expect(cell(courier({ aft: 0 }), "SHD").tone).toBe("refused");
	});

	test("the refusal reads the printed value, not the raw pool", () => {
		// A pool at 0.3 prints as 0; a tone keyed on the raw number would go calm
		// while the cell still says 0 — the CHARGE cell's lesson (§5.1).
		expect(cell(courier({ fore: 0.3 }), "SHD").value).toBe(
			`F 0 A ${SHIELD_POOL}`,
		);
		expect(cell(courier({ fore: 0.3 }), "SHD").tone).toBe("refused");
	});

	test("heat prints as a share of the lock, and goes amber near it", () => {
		expect(cell(courier({ heat: 0 }), "HEAT").value).toBe("0%");
		expect(cell(courier({ heat: 0 }), "HEAT").tone).toBe("passive");
		const near = HEAT_LOCK * HEAT_ACTION_FRACTION;
		expect(cell(courier({ heat: near }), "HEAT").tone).toBe("action");
		expect(cell(courier({ heat: near - 1 }), "HEAT").tone).toBe("passive");
	});

	test("a locked gun says LOCK, in red", () => {
		const c = courier({ heat: HEAT_LOCK * 0.7, heatLocked: true });
		expect(cell(c, "HEAT").value).toBe("LOCK");
		expect(cell(c, "HEAT").tone).toBe("refused");
	});

	test("the widest reading bounds every reading the row can print", () => {
		const widest = duelRowWidest();
		const readings: ShipCondition[] = [];
		for (const fore of [0, 0.4, 9.6, 55, SHIELD_POOL])
			for (const aft of [0, 99.5, SHIELD_POOL])
				for (const heat of [0, 9.9, 50, HEAT_LOCK - 0.1, HEAT_LOCK])
					for (const heatLocked of [false, true])
						readings.push(courier({ fore, aft, heat, heatLocked }));
		for (const c of readings)
			for (const x of duelRowCells(c))
				expect(x.value.length).toBeLessThanOrEqual(
					widest[x.label as (typeof DUEL_ROW_LABELS)[number]].length,
				);
	});
});

describe("the Flight console readout", () => {
	test("gives every pool against its capacity, and the bank and heat", () => {
		const c = courier({
			fore: 71.6,
			aft: 12.2,
			hull: 64.5,
			energy: 42.4,
			heat: 37,
		});
		expect(duelConsoleReadout(c)).toEqual({
			fore: `72 / ${SHIELD_POOL}`,
			aft: `12 / ${SHIELD_POOL}`,
			hull: `65 / ${c.hullMax}`,
			energy: `42 / ${ENERGY_BANK}`,
			heat: "37%",
		});
	});

	test("the console and the glass say the same heat", () => {
		for (const c of [
			courier({ heat: 37 }),
			courier({ heatLocked: true, heat: 80 }),
		])
			expect(duelConsoleReadout(c).heat).toBe(cell(c, "HEAT").value);
	});
});

describe("the firing cue", () => {
	test("is amber, and red only while the raider fires", () => {
		expect(raiderCueTone(false)).toBe("action");
		expect(raiderCueTone(true)).toBe("refused");
	});
});

describe("when the combat row shows", () => {
	test("during a contest or a duel", () => {
		expect(
			showDuelRow({ encounterPhase: "contest", targetIsRaider: false }),
		).toBe(true);
		expect(showDuelRow({ encounterPhase: "duel", targetIsRaider: false })).toBe(
			true,
		);
	});

	test("while the raider is the selected target, whatever the phase", () => {
		expect(showDuelRow({ encounterPhase: null, targetIsRaider: true })).toBe(
			true,
		);
	});

	test("not in peace: no encounter showing, no raider targeted", () => {
		for (const encounterPhase of [null, "inbound", "over"] as const)
			expect(showDuelRow({ encounterPhase, targetIsRaider: false })).toBe(
				false,
			);
	});
});
