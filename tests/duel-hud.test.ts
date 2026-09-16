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
	onTargetMark,
	raiderCueTone,
	targetConditionLine,
	duelRowCells,
	duelRowWidest,
	showDuelRow,
} from "../src/duel-hud";
import { HULL_IDS, type HullId } from "../src/hull";
import {
	ENERGY_BANK,
	HEAT_LOCK,
	PULSE_LASER,
	SHIELD_POOL,
	type ShipCondition,
	applyDamage,
	fullCondition,
	isAlive,
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
		// The tone reads the printed percent: 74.6% prints 75% and is amber.
		const printsAtAction = courier({ heat: HEAT_LOCK * 0.746 });
		expect(cell(printsAtAction, "HEAT").value).toBe("75%");
		expect(cell(printsAtAction, "HEAT").tone).toBe("action");
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
			bank: `42 / ${ENERGY_BANK}`,
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

describe("the on-target mark", () => {
	test("is drawn in the duel when a shot would land", () => {
		expect(onTargetMark("duel", true)).toBe(true);
		expect(onTargetMark("duel", false)).toBe(false);
	});

	test("is never drawn outside the duel, however well aimed", () => {
		// The contest flies no duel step, so a shot there does nothing (sage #327).
		for (const phase of [null, "inbound", "contest", "over"] as const)
			expect(onTargetMark(phase, true)).toBe(false);
	});
});

describe("the enemy's condition line", () => {
	const raider = (over: Partial<ShipCondition> = {}): ShipCondition => ({
		...fullCondition("raider"),
		...over,
	});

	test("prints both shield pools and the hull, rounded as the duel row rounds", () => {
		const line = targetConditionLine(
			raider({ fore: 71.6, aft: 105.5, hull: 40.4 }),
		);
		expect(line.text).toBe("SHD F 72 A 106  HULL 40");
		expect(line.tone).toBe("passive");
	});

	test("is refused while either printed pool is 0, and not before", () => {
		expect(targetConditionLine(raider({ aft: 0.4 })).tone).toBe("refused");
		expect(targetConditionLine(raider({ fore: 0 })).tone).toBe("refused");
		expect(targetConditionLine(raider({ fore: 0.6 })).tone).toBe("passive");
	});
});

// ---------------------------------------------------------------------------
// #367 D1. The playtest of 2026-09-16 reported `SHD F 22 A 22  HULL 0` on a
// raider that was alive and rebuilding: `isAlive` is `hull > 0` and both
// readouts print `Math.round(hull)`, so the band under half a point was alive
// and read dead. These rows are keyed on the **print**, the way the refusal
// tone above is — the law itself is `ship-condition.test.ts`'s.
// ---------------------------------------------------------------------------
const DT = 1 / 60;

/** Every condition the damage funnel hands the glass as a duel walks a hull
 *  down one pulse tick at a time, alive and dead states in order. */
function walkedDown(id: HullId): ShipCondition[] {
	const seen: ShipCondition[] = [];
	let c: ShipCondition = fullCondition(id);
	while (isAlive(c)) {
		c = applyDamage(c, PULSE_LASER.damagePerS * DT, "fore");
		seen.push(c);
	}
	return seen;
}

describe("HULL 0 on the glass is always a kill (#367 D1)", () => {
	test("no readout prints a live hull as 0, on any hull", () => {
		for (const id of HULL_IDS) {
			for (const c of walkedDown(id)) {
				if (isAlive(c)) {
					expect(targetConditionLine(c).text.endsWith("HULL 0")).toBe(false);
					expect(duelConsoleReadout(c).hull.startsWith("0 /")).toBe(false);
				}
			}
		}
	});

	test("the reading the playtest reported belongs to a dead ship", () => {
		for (const id of HULL_IDS) {
			for (const c of walkedDown(id)) {
				const printedZero =
					targetConditionLine(c).text.endsWith("HULL 0") ||
					duelConsoleReadout(c).hull.startsWith("0 /");
				if (printedZero) expect(isAlive(c)).toBe(false);
			}
		}
	});

	test("and a walk down is not vacuous: the frame before the kill prints 1", () => {
		for (const id of HULL_IDS) {
			const walk = walkedDown(id);
			const dead = walk.at(-1) as ShipCondition;
			expect(isAlive(dead)).toBe(false);
			expect(dead.hull).toBe(0);
			const lastAlive = walk.at(-2) as ShipCondition;
			expect(isAlive(lastAlive)).toBe(true);
			expect(targetConditionLine(lastAlive).text.endsWith("HULL 1")).toBe(true);
		}
	});
});
