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
	duelConsoleReadout,
	duelRowCells,
	duelRowWidest,
	HEAT_ACTION_FRACTION,
	onTargetMark,
	raiderCueTone,
	showDuelRow,
	targetConditionLine,
	targetConditionWidest,
} from "../src/duel-hud";
import { HULL_IDS, HULL_SPECS, type HullId } from "../src/hull";
import {
	applyDamage,
	ENERGY_BANK,
	fullCondition,
	HEAT_LOCK,
	isAlive,
	SHIELD_POOL,
	type ShipCondition,
} from "../src/ship-condition";
import { walkDownToKill } from "./helpers/pulse-walk";

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

	test("prints both shield pools and the hull as a share of its own", () => {
		const line = targetConditionLine(
			raider({ fore: 71.6, aft: 105.5, hull: 40.4 }),
		);
		expect(line.text).toBe("SHD F 72 A 106  HULL 50%");
		expect(line.tone).toBe("passive");
	});

	test("is refused while either printed pool is 0, and not before", () => {
		expect(targetConditionLine(raider({ aft: 0.4 })).tone).toBe("refused");
		expect(targetConditionLine(raider({ fore: 0 })).tone).toBe("refused");
		expect(targetConditionLine(raider({ fore: 0.6 })).tone).toBe("passive");
	});

	test("both faces print, so which one is going is on the glass (#395)", () => {
		// The measurement #395 was opened with had `fore` untouched at 106 while
		// `aft` fell to 0. Approaching from ahead and from behind are different
		// fights, and a reading that named one pool would not tell them apart.
		const fromBehind = targetConditionLine(
			raider({ fore: SHIELD_POOL, aft: 0 }),
		).text;
		const fromAhead = targetConditionLine(
			raider({ fore: 0, aft: SHIELD_POOL }),
		).text;
		expect(fromBehind).not.toBe(fromAhead);
		expect(fromBehind).toBe(`SHD F ${SHIELD_POOL} A 0  HULL 100%`);
		expect(fromAhead).toBe(`SHD F 0 A ${SHIELD_POOL}  HULL 100%`);
	});
});

// ---------------------------------------------------------------------------
// #395. The fit. `duelRowWidest` bounds the floor's duel row and always has; the
// line under a selected target's name had no widest case of its own, and a
// Traffic reading is not the raider's — its hull capacity is a different figure
// per hull, eight different ordinary hulls running 85 to 215 points. Printing a
// share is what makes one widest case cover them all, and these rows are what
// keeps it that way: a hull figure put back on this line puts the hull table into
// the fit again, and the row goes red rather than clipping a callsign.
// **What these rows bound, and what they do not.** They compare *character
// counts*, and a character count reaches the glass as a width through one
// assumption, made far away in `main.ts`: the sky label is drawn in
// `ui-monospace, Menlo, monospace`, and `labelBounds` asks `ctx.measureText` for
// the box. Under a uniform advance, more characters is the only way to be wider,
// so this is a pixel bound. Under a proportional face it stops being one — `111`
// and `106` are equal length and unequal width — and no row here could see it,
// because the headless tier has no canvas to ask. Changing that font is the change
// that would need a browser row over `measureText` on the reachable lines, not a
// longer comment; this note is the tripwire, not the guarantee.
// ---------------------------------------------------------------------------
describe("the widest line a selected target can print", () => {
	test("no reading any hull can reach prints more characters than the widest", () => {
		const widest = targetConditionWidest();
		for (const id of HULL_IDS)
			for (const c of WALKS.get(id) as ShipCondition[])
				expect(targetConditionLine(c).text.length).toBeLessThanOrEqual(
					widest.length,
				);
	});

	test("a sweep over every pool figure bounds it, not only the walks", () => {
		// The walks above are what the game actually produces. They are not the
		// whole argument that this is the widest reading: the doc's claim is that
		// one case covers the roster because both facings are clamped to
		// `SHIELD_POOL` and a live hull's percent tops out at 100, and a claim about
		// a clamp wants the sweep that matches it rather than a sample that happens
		// to agree. So: every pool figure the form can print, both facings, crossed.
		// A pool that could print a fourth character, or a percent that could print
		// four, puts this red at the number that does it instead of on a glass.
		const widest = targetConditionWidest();
		const figures: number[] = [];
		for (let n = 0; n <= SHIELD_POOL; n++) figures.push(n);
		// `hull <= hullMax`, and that limit is doing real work rather than tidying
		// the sweep: the first version crossed every hull against every capacity and
		// went red at 27 characters, because a 2635-point hull over a 1-point capacity
		// prints `HULL 263500%`. That is not a bound failing — it is the unclamped
		// ceiling that `printHullPercent`'s own row says is deliberate, reached
		// through an invariant the sim cannot break. A bound on reachable readings is
		// allowed to assume the invariant; what it may not do is assume the clamp.
		// One assertion over the whole sweep, carrying the worst case it saw. The
		// first version called `expect` 316k times, which is both slow and the wrong
		// shape: on a failure the runner reports the first mismatch and the rest of
		// the grid never gets read, so the number actually worth having — how far
		// over, at which reading — is the one thing it would not print.
		let over: { text: string; fore: number; aft: number; hull: number } | null =
			null;
		for (const fore of figures)
			for (const aft of figures)
				for (const hullMax of [1, 85, 215, 2635])
					for (const hull of [1, 2, 50, hullMax].filter((h) => h <= hullMax)) {
						const text = targetConditionLine({ fore, aft, hull, hullMax }).text;
						if (text.length > widest.length && over === null)
							over = { text, fore, aft, hull };
					}
		expect({ width: widest.length, over }).toEqual({
			width: widest.length,
			over: null,
		});
	});

	test("it is attained, so it is a bound and not a guess with room in it", () => {
		const widest = targetConditionWidest();
		const lengths = new Set<string>();
		for (const id of HULL_IDS)
			for (const c of WALKS.get(id) as ShipCondition[]) {
				const text = targetConditionLine(c).text;
				if (text.length === widest.length) lengths.add(text);
			}
		expect(lengths.has(widest)).toBe(true);
	});

	test("no hull's reading is wider than any other's, which is what the share buys", () => {
		// The row the node asked for, stated as the thing it actually has to hold.
		// Every hull the game can put under the beam — the eight Traffic hulls,
		// the raider, and the two capitals that never dock — reads its hull within
		// the same width. Under a point figure a miner's 215 is three digits and a
		// raider's 81 is two, and the fit holds the raider's reading only.
		const widest = targetConditionWidest();
		const whole = fullCondition("miner");
		expect(whole.hullMax).toBeGreaterThan(HULL_SPECS.raider.integrity);
		// Over every hull, not between two of them: this is the claim the label's
		// reservation rests on, and a pair of hulls that happen to agree is not it.
		for (const id of HULL_IDS) {
			expect(targetConditionLine(fullCondition(id)).text).toHaveLength(
				widest.length,
			);
			// A whole hull reads 100% whatever its capacity — the one thing the
			// share form can say across a roster that a point form cannot.
			expect(targetConditionLine(fullCondition(id)).text).toMatch(/HULL 100%$/);
		}
		expect(widest).toBe(targetConditionLine(whole).text);
	});
});

// ---------------------------------------------------------------------------
// #367 D1. The playtest of 2026-09-16 reported `SHD F 22 A 22  HULL 0` on a
// raider that was alive and rebuilding: `isAlive` is `hull > 0` and both
// readouts print `Math.round(hull)`, so the band under half a point was alive
// and read dead. These rows are keyed on the **print**, the way the refusal
// tone above is — the law itself is `ship-condition.test.ts`'s.
// ---------------------------------------------------------------------------
/** The glass says a ship is dead. Both readouts, because either one alone would
 *  let the other keep lying. */
const printsWithoutADigit = (c: ShipCondition): boolean =>
	targetConditionLine(c).text.endsWith("HULL 0%") ||
	duelConsoleReadout(c).hull.startsWith("0 /");

/** One walk per hull, read by every row below. The capitals are twenty-four
 *  hundred points at a tenth of a point a frame, so a walk is some twenty-five
 *  thousand states, and rebuilding one per row made the suite do it three times
 *  over for the same states. */
const WALKS = new Map(
	HULL_IDS.map((id) => [id, walkDownToKill(fullCondition(id))] as const),
);

describe("HULL 0 on the glass is always a kill (#367 D1)", () => {
	test("no readout prints a live hull as 0, and no dead one is stepped past", () => {
		// One direction, not two: the contrapositive ("what prints 0 is dead") is
		// the same condition stated backwards over the same states, and it was a
		// second row that could not fail without this one failing first.
		for (const id of HULL_IDS) {
			for (const c of WALKS.get(id) as ShipCondition[]) {
				if (isAlive(c)) expect(printsWithoutADigit(c)).toBe(false);
			}
		}
	});

	test("the walk reaches the band, and the frame before the kill prints 1", () => {
		// What a walk can show, and no more. It cannot put a live hull *under* the
		// tolerance in front of the glass: that state is what the law forbids, and
		// `applyDamage` is the thing that refuses to produce it — so a row claiming
		// to reach it by firing would be claiming something the funnel declines.
		// `tests/ship-condition.test.ts` measures the band at the funnel instead.
		for (const id of HULL_IDS) {
			const walk = WALKS.get(id) as ShipCondition[];
			const dead = walk.at(-1) as ShipCondition;
			expect(isAlive(dead)).toBe(false);
			expect(dead.hull).toBe(0);
			const lastAlive = walk.at(-2) as ShipCondition;
			expect(isAlive(lastAlive)).toBe(true);
			// Both readouts, both forms: the console still prints the point figure
			// it has always printed, the glass a share since #395. One is not
			// allowed to heal by rounding what the other has declared dead.
			expect(targetConditionLine(lastAlive).text.endsWith("HULL 1%")).toBe(
				true,
			);
			expect(duelConsoleReadout(lastAlive).hull.startsWith("1 /")).toBe(true);
		}
	});
});
