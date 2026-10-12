/**
 * The scoop's line on the glass (#932, #871 D6): `SCOOPING` and the tank in
 * LY while the scoop fills, and nothing once it stops.
 */
import { describe, expect, test } from "bun:test";
import {
	DUEL_ROW_LABELS,
	HULL_TEMP_LABEL,
	SCOOP_LABEL,
	duelBandCells,
	scoopCells,
	scoopWidest,
} from "../src/duel-hud";
import { HULL_SPECS, PURCHASABLE_HULL_IDS } from "../src/hull";
import {
	type Loadout,
	fittedCapacity,
	makeModule,
	stepFuelScoop,
	stockLoadout,
} from "../src/loadout";
import { fullCondition } from "../src/ship-condition";

describe("the line", () => {
	test("reads SCOOPING and the tank in LY while the scoop fills", () => {
		expect(scoopCells(true, 3.24)).toEqual([
			{ label: SCOOP_LABEL, value: "3.2 LY", tone: "passive" },
		]);
		expect(SCOOP_LABEL).toBe("SCOOPING");
		expect(SCOOP_LABEL).not.toBe(HULL_TEMP_LABEL);
	});

	test("is absent while the scoop does not fill", () => {
		expect(scoopCells(false, 3.24)).toEqual([]);
	});

	test("rises with the tank over a pass, and goes when the tank is full", () => {
		const loadout: Loadout = {
			...stockLoadout("courier"),
			i1: makeModule("fuel-scoop", 1),
		};
		let fuelLy = 6.5;
		const seen: string[] = [];
		let last: ReturnType<typeof scoopCells> = [];
		for (let i = 0; i < 120; i++) {
			const s = stepFuelScoop({
				rOverR: 1.1,
				cruising: true,
				hull: "courier",
				loadout,
				fuelLy,
				energy: 100,
				dt: 1 / 60,
			});
			fuelLy = s.fuelLy;
			last = scoopCells(s.filling, s.fuelLy);
			if (last[0]) seen.push(last[0].value);
		}
		expect(seen[0]).toBe("6.5 LY");
		expect(seen.at(-1)).toBe("7.0 LY");
		expect(fuelLy).toBe(HULL_SPECS.courier.tankLy);
		expect(last).toEqual([]);
	});
});

describe("the widest reading", () => {
	// The fit is solved over the widest value (`floorWidest`'s rule). Every
	// fuel-accepting internal holding the largest A tank it takes is more than
	// any ship can carry, and still prints in two digits.
	test("no fitted tank on any hull a pilot can fly prints wider", () => {
		for (const hull of PURCHASABLE_HULL_IDS) {
			const loadout: Record<string, ReturnType<typeof makeModule>> = {};
			for (const slot of HULL_SPECS[hull].slots)
				if (
					slot.kind === "internal" &&
					(slot.accepts === "any" || slot.accepts.includes("fuel"))
				)
					loadout[slot.key] = makeModule("fuel-tank", slot.size, "A");
			const most = fittedCapacity(hull, loadout).fuelCapacityLy;
			expect(scoopCells(true, most)[0].value.length).toBeLessThanOrEqual(
				scoopWidest().length,
			);
		}
	});
});

describe("the duel band in and out of combat (#932, the principal's ruling)", () => {
	// "In combat" is `showDuelRow`, the predicate that already puts SHD and
	// HEAT on the glass: a raider contesting or dueling, or one selected.
	const warm = { ...fullCondition("courier"), hullTemp: 0.3 };
	const labels = (inCombat: boolean, scooping: boolean) =>
		duelBandCells({ inCombat, condition: warm, scooping, fuelLy: 3.2 }).map(
			(c) => c.label,
		);

	test("out of combat, the SCOOPING line shows beside TEMP", () => {
		expect(labels(false, true)).toEqual([HULL_TEMP_LABEL, SCOOP_LABEL]);
	});

	test("in combat, SHD and HEAT stay and the SCOOPING line drops", () => {
		expect(labels(true, true)).toEqual([...DUEL_ROW_LABELS, HULL_TEMP_LABEL]);
	});

	test("without a scoop filling, combat shows SHD and HEAT as before", () => {
		expect(labels(true, false)).toEqual([...DUEL_ROW_LABELS, HULL_TEMP_LABEL]);
		expect(labels(false, false)).toEqual([HULL_TEMP_LABEL]);
	});

	test("SHD, HEAT and SCOOPING never share the row", () => {
		for (const inCombat of [false, true])
			for (const scooping of [false, true]) {
				const row = labels(inCombat, scooping);
				expect(
					row.includes(SCOOP_LABEL) &&
						DUEL_ROW_LABELS.some((l) => row.includes(l)),
				).toBe(false);
			}
	});
});
