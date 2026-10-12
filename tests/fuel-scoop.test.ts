/**
 * The fuel scoop (#932): on a cruise pass inside the skim band a fitted scoop
 * fills the hyperspace tank, up to the fitted capacity (#926), and the energy
 * bank pays the catalogue row's draw (#871 D1, D2).
 *
 * The figures are #930's approved table, which `scripts/measure-star-skim.ts`
 * derived. That script prints rather than exports, so the rows below restate
 * its linear fill shape from the table's own text, and fly a pass through the
 * real `advanceCruise` as the instrument does, to hold the step to the table's
 * flown "LY per pass" column.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_CRUISE, type Mass, advanceCruise } from "../src/cruise";
import { HULL_SPECS } from "../src/hull";
import {
	type Loadout,
	fittedCapacity,
	makeModule,
	moduleRow,
	scoopShape,
	stepFuelScoop,
	stockLoadout,
} from "../src/loadout";
import { SKIM_BAND_R, SKIM_SHELL_R } from "../src/ship-condition";
import { STAR_CLASSES } from "../src/system";
import { length, v3 } from "../src/vec3";

const DT = 1 / 60;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** #930's fill shape, as the table writes it. */
const tableShape = (r: number) => clamp01((2 - r) / (2 - 1.05));
/** #930's fill peak: the catalogue row's size-1 E output, LY/s. */
const TABLE_PEAK = 1.0;

const bare = stockLoadout("courier");
/** A size-1 E scoop in the courier's tagged fuel internal. */
const scooped: Loadout = { ...bare, i1: makeModule("fuel-scoop", 1) };
const capacityLy = fittedCapacity("courier", scooped).fuelCapacityLy;
const scoopRow = moduleRow(makeModule("fuel-scoop", 1));

const step = (over: Partial<Parameters<typeof stepFuelScoop>[0]> = {}) =>
	stepFuelScoop({
		rOverR: 1.2,
		cruising: true,
		hull: "courier",
		loadout: scooped,
		fuelLy: 1,
		energy: 50,
		dt: DT,
		...over,
	});

describe("the approved table (#930)", () => {
	test("the catalogue row's size-1 E output is the table's peak", () => {
		expect(scoopRow.output.fuelLyPerS).toBe(TABLE_PEAK);
	});

	test("the band and shell are the table's", () => {
		expect(SKIM_BAND_R).toBe(2);
		expect(SKIM_SHELL_R).toBe(1.05);
	});

	test("the fill shape is the table's linear curve, at every distance", () => {
		for (let r = 0.5; r <= 3; r += 0.01)
			expect(scoopShape(r)).toBeCloseTo(tableShape(r), 12);
		expect(scoopShape(SKIM_SHELL_R)).toBe(1);
		expect(scoopShape(SKIM_BAND_R)).toBe(0);
		expect(scoopShape(2.5)).toBe(0);
	});

	test("fuel rises at the approved rate for the distance", () => {
		for (const r of [1.05, 1.2, 1.5, 1.9]) {
			const out = step({ rOverR: r, fuelLy: 0 });
			expect(out.fuelLy).toBeCloseTo(TABLE_PEAK * tableShape(r) * DT, 12);
			expect(out.filling).toBe(true);
		}
	});

	// The instrument's section 1 "linear ∫" column: seconds at peak, so LY at
	// the approved 1.0 LY/s. Not the resolution's "LY per pass" column, which
	// section 5 printed at its fitted 0.986 LY/s before the principal rounded
	// the peak to 1.0 — G at 1.2 R reads 2.33 there and 2.37 here. The
	// instrument integrates the shape at segment midpoints and the game holds it
	// over a frame from the frame's start, so the two agree to the printed digit.
	test("a pass flown through the real cruise step fills what the instrument's linear column says", () => {
		const flown = (cls: string, bR: number) => {
			const radiusKm = STAR_CLASSES.find((c) => c.cls === cls)!.radiusKm;
			const masses: Mass[] = [
				{ id: "star", kind: "star", pos: v3(), radiusKm },
			];
			const startX = -Math.sqrt(16 - bR * bR) * radiusKm;
			let pos = v3(startX, bR * radiusKm, 0);
			let fuelLy = 0;
			for (let t = 0; t < 600 && pos.x <= -startX; t += DT) {
				fuelLy = stepFuelScoop({
					rOverR: length(pos) / radiusKm,
					cruising: true,
					hull: "courier",
					loadout: scooped,
					fuelLy,
					energy: 1_000,
					dt: DT,
				}).fuelLy;
				const s = advanceCruise({
					pos,
					nose: v3(1, 0, 0),
					throttle: 1,
					dt: DT,
					masses,
					target: null,
					params: DEFAULT_CRUISE,
					targetParentId: null,
				});
				if (s.dropped) throw new Error("the pass dropped out");
				pos = s.pos;
			}
			return fuelLy;
		};
		expect(Math.abs(flown("G", 1.2) - 2.37)).toBeLessThan(0.01);
		expect(Math.abs(flown("M", 1.2) - 1.64)).toBeLessThan(0.01);
		expect(Math.abs(flown("A", 1.5) - 1.4)).toBeLessThan(0.01);
		expect(Math.abs(flown("G", 1.06) - 3.07)).toBeLessThan(0.01);
	});
});

describe("the bank pays the row's draw", () => {
	test("a filling step takes the row's drawPerS from the bank", () => {
		const out = step({ energy: 50 });
		expect(scoopRow.drawPerS).toBeGreaterThan(0);
		expect(out.energy).toBeCloseTo(50 - scoopRow.drawPerS * DT, 12);
	});

	test("a bank too low to pay the draw fills nothing that step, and pays nothing", () => {
		const short = scoopRow.drawPerS * DT * 0.99;
		expect(step({ energy: short })).toEqual({
			fuelLy: 1,
			energy: short,
			filling: false,
		});
		// Exactly the draw is enough.
		const exact = scoopRow.drawPerS * DT;
		expect(step({ energy: exact }).filling).toBe(true);
	});
});

describe("the tank stops at the fitted capacity (#926)", () => {
	test("capacity is the hull's tank plus fitted tanks, not the jump range", () => {
		const tanked: Loadout = { ...bare, i1: makeModule("fuel-tank", 2) };
		const withBoth: Loadout = { ...tanked, flex: makeModule("fuel-scoop", 1) };
		const cap = fittedCapacity("courier", withBoth).fuelCapacityLy;
		expect(cap).toBeGreaterThan(HULL_SPECS.courier.tankLy);
		// Above the jump range and below capacity, the scoop still fills.
		const out = step({
			loadout: withBoth,
			fuelLy: HULL_SPECS.courier.tankLy + 0.5,
		});
		expect(out.filling).toBe(true);
		expect(out.fuelLy).toBeGreaterThan(HULL_SPECS.courier.tankLy + 0.5);
	});

	test("a full tank neither fills nor draws", () => {
		expect(step({ fuelLy: capacityLy, energy: 50 })).toEqual({
			fuelLy: capacityLy,
			energy: 50,
			filling: false,
		});
	});

	test("the last step tops the tank up to capacity, never past it", () => {
		const out = step({ rOverR: 1.05, fuelLy: capacityLy - 0.001 });
		expect(out.fuelLy).toBe(capacityLy);
		expect(out.filling).toBe(true);
	});

	test("a tank over capacity is left alone", () => {
		expect(step({ fuelLy: capacityLy + 1 }).fuelLy).toBe(capacityLy + 1);
	});
});

describe("when the scoop does not fill", () => {
	test("no scoop fitted", () => {
		expect(step({ loadout: bare })).toEqual({
			fuelLy: 1,
			energy: 50,
			filling: false,
		});
	});

	test("normal flight inside the band (#871 D1)", () => {
		expect(step({ cruising: false })).toEqual({
			fuelLy: 1,
			energy: 50,
			filling: false,
		});
	});

	test("at and beyond the band edge", () => {
		for (const r of [SKIM_BAND_R, 2.01, 40, Number.POSITIVE_INFINITY])
			expect(step({ rOverR: r }).filling).toBe(false);
	});

	test("a non-positive or non-finite step", () => {
		for (const dt of [0, -DT, Number.NaN])
			expect(step({ dt }).filling).toBe(false);
	});
});

describe("the fitted scoop's row sets the rate", () => {
	test("a larger or better scoop fills and draws by its own row", () => {
		const big = makeModule("fuel-scoop", 2, "A");
		const row = moduleRow(big);
		const out = step({ loadout: { ...bare, i1: big }, fuelLy: 0, energy: 50 });
		expect(out.fuelLy).toBeCloseTo(
			row.output.fuelLyPerS * tableShape(1.2) * DT,
			12,
		);
		expect(out.energy).toBeCloseTo(50 - row.drawPerS * DT, 12);
	});

	test("two fitted scoops fill and draw as their sum", () => {
		const two: Loadout = { ...scooped, flex: makeModule("fuel-scoop", 1) };
		const out = step({ loadout: two, fuelLy: 0, energy: 50 });
		expect(out.fuelLy).toBeCloseTo(
			2 * TABLE_PEAK * tableShape(1.2) * DT,
			12,
		);
		expect(out.energy).toBeCloseTo(50 - 2 * scoopRow.drawPerS * DT, 12);
	});
});
