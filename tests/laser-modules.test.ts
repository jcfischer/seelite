import { describe, expect, test } from "bun:test";
import { fireGroups } from "../src/fire-group";
import { groupLaserRates, groupMuzzleIndices } from "../src/laser-modules";
import { fittedDps, killCredit } from "../src/kill-credit";
import {
	makeModule,
	moduleRow,
	stockLoadout,
	type Loadout,
} from "../src/loadout";
import {
	fullCondition,
	HEAT_LOCK,
	HEAT_RELEASE,
	PULSE_LASER,
	stepCondition,
} from "../src/ship-condition";

const fit: Loadout = {
	...stockLoadout("patrol"),
	h1: makeModule("beam-laser", 2, "A"),
	h2: makeModule("military-laser", 1, "D"),
	u1: makeModule("identity-scanner", 1),
};

describe("fitted laser behaviour", () => {
	test("tracers keep slot identity when only the second hardpoint fires", () => {
		const groups = fireGroups(fit, "patrol");
		expect(groupMuzzleIndices("patrol", groups[0])).toEqual([0, 1]);
		expect(groupMuzzleIndices("patrol", groups[2])).toEqual([1]);
		expect(groupMuzzleIndices("patrol", groups[3])).toEqual([]);
	});
	test("every combat kind, size and grade fires the approved catalogue rates", () => {
		for (const kind of ["pulse-laser", "beam-laser", "military-laser"] as const)
			for (const size of [1, 2, 3] as const)
				for (const grade of ["E", "D", "A"] as const) {
					const m = makeModule(kind, size, grade),
						row = moduleRow(m);
					const rates = groupLaserRates(
						{ h1: m },
						{
							kind: "lasers",
							slots: ["h1"],
							label: "test",
							trigger: "primary",
						},
					);
					expect(rates).toEqual({
						damagePerS: row.output.damagePerS,
						energyPerS: row.drawPerS,
						heatPerS: row.heatPerS,
					});
					const c = fullCondition("patrol");
					const shot = stepCondition(c, 0.1, true, rates);
					expect(shot.damage).toBeCloseTo(row.output.damagePerS * 0.1, 12);
					expect(c.energy - shot.condition.energy).toBeCloseTo(
						row.drawPerS * 0.1,
						12,
					);
					expect(shot.condition.heat).toBeCloseTo(row.heatPerS * 0.1, 12);
				}
	});

	test("armed group sums every gun; cycling excludes the other gun and scanner fires none", () => {
		const groups = fireGroups(fit, "patrol");
		const all = groupLaserRates(fit, groups[0]);
		const a = groupLaserRates(fit, groups[1]),
			b = groupLaserRates(fit, groups[2]);
		expect(all.damagePerS).toBeCloseTo(20.25 + 9.6, 12);
		expect(all.energyPerS).toBeCloseTo(6.75 + 4, 12);
		expect(all.heatPerS).toBeCloseTo(10.125 + 4.8, 12);
		for (const key of ["damagePerS", "energyPerS", "heatPerS"] as const)
			expect(all[key]).toBeCloseTo(a[key] + b[key], 12);
		expect(
			stepCondition(
				fullCondition("patrol"),
				0.1,
				true,
				groupLaserRates(fit, groups[3]),
			).fired,
		).toBe(false);
		expect(
			stepCondition(
				fullCondition("patrol"),
				0.1,
				true,
				groupLaserRates(fit, undefined),
			).fired,
		).toBe(false);
	});

	test("all guns share energy and the heat lock; an unaffordable volley fires none", () => {
		const rates = groupLaserRates(fit, fireGroups(fit, "patrol")[0]);
		const c = fullCondition("patrol"),
			dt = 0.1;
		const flat = stepCondition(
			{ ...c, energy: rates.energyPerS * dt - 0.001 },
			dt,
			true,
			rates,
		);
		expect(flat.fired).toBe(false);
		expect(flat.damage).toBe(0);
		expect(
			stepCondition({ ...c, energy: rates.energyPerS * dt }, dt, true, rates)
				.fired,
		).toBe(true);
		const hot = stepCondition(
			{ ...c, heat: HEAT_LOCK - 0.01 },
			dt,
			true,
			rates,
		);
		expect(hot.condition.heatLocked).toBe(true);
		expect(stepCondition(hot.condition, dt, true, rates).fired).toBe(false);
		expect(
			stepCondition(
				{ ...c, heat: HEAT_RELEASE + 1, heatLocked: true },
				dt,
				true,
				rates,
			).fired,
		).toBe(false);
	});

	test("mining fires with combat lasers at ten percent of equivalent Pulse hull damage", () => {
		for (const size of [1, 2, 3] as const)
			for (const grade of ["E", "D", "A"] as const) {
				const m = makeModule("mining-laser", size, grade);
				const rates = groupLaserRates(
					{ h1: m },
					{
						kind: "lasers",
						slots: ["h1"],
						label: "mining",
						trigger: "primary",
					},
				);
				expect(rates.damagePerS).toBeCloseTo(
					moduleRow(makeModule("pulse-laser", size, grade)).output.damagePerS *
						0.1,
					12,
				);
				expect(rates.energyPerS).toBe(moduleRow(m).drawPerS);
			}
		const mixed = {
			...stockLoadout("patrol"),
			h1: makeModule("pulse-laser", 1),
			h2: makeModule("mining-laser", 1),
		};
		expect(
			groupLaserRates(mixed, fireGroups(mixed, "patrol")[0]).damagePerS,
		).toBeCloseTo(6.6, 12);
		expect(fittedDps({ hull: "patrol", loadout: mixed })).toBe(
			PULSE_LASER.damagePerS,
		);
	});

	test("credit reads the whole fit, ignores mining and carried modules, and rewards better fits less", () => {
		const ship = { hull: "patrol" as const, loadout: fit };
		expect(fittedDps(ship)).toBeCloseTo(29.85, 12);
		expect(killCredit(ship, "raider")).toBeLessThan(
			killCredit({ ...ship, loadout: stockLoadout("patrol") }, "raider"),
		);
		expect(
			fittedDps({
				...ship,
				loadout: { plant: fit.plant, h1: makeModule("mining-laser", 1) },
			}),
		).toBe(0);
		expect(fittedDps({ ...ship, loadout: { plant: fit.plant } })).toBe(0);
		expect(killCredit(ship, "courier")).toBe(0);
	});
});
