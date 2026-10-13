// SPIKE #951: the deposit domain's save rules, through the real save path.
import { describe, expect, test } from "bun:test";
import {
	debitAt,
	depositKey,
	fieldKey,
	surveyBitmap,
} from "../src/deposit-state";
import { newWorld, parseWorld, serializeWorld } from "../src/world-state";

const roundTrip = (w: ReturnType<typeof newWorld>) =>
	parseWorld(JSON.parse(JSON.stringify(serializeWorld(w))));

describe("deposit domain (spike #951)", () => {
	test("an empty domain writes nothing, so an older save's bytes do not move", () => {
		const json = JSON.stringify(serializeWorld(newWorld(1)));
		expect(json).not.toContain("deposits");
		expect(roundTrip(newWorld(1)).galaxies[0].deposits).toEqual({
			rows: {},
			surveyed: {},
		});
	});

	test("a debit and a survey bitmap survive a round trip", () => {
		const w = newWorld(1);
		const k = depositKey(17, "field-00", 342);
		const f = fieldKey(17, "field-00");
		w.galaxies[3].deposits.rows[k] = { surface: 40, deep: 7, at: 3600.5 };
		w.galaxies[3].deposits.surveyed[f] = surveyBitmap(524, [0, 342, 523]);
		const back = roundTrip(w).galaxies[3].deposits;
		expect(back.rows[k]).toEqual({ surface: 40, deep: 7, at: 3600.5 });
		expect(back.surveyed[f]).toBe(surveyBitmap(524, [0, 342, 523]));
	});

	test("a fractional tonne, an unknown member and a foreign version are refused", () => {
		const bad = (deposits: unknown) => {
			const raw = JSON.parse(JSON.stringify(serializeWorld(newWorld(1))));
			raw.galaxies[0].deposits = deposits;
			return () => parseWorld(raw);
		};
		const k = "1:field-00:2";
		expect(bad({ fieldGeneratorVersion: 1, rows: { [k]: { surface: 1.5, at: 0 } } })).toThrow(/tonnes/);
		expect(bad({ fieldGeneratorVersion: 1, rows: { [k]: { left: 3 } } })).toThrow(/not declared/);
		expect(bad({ fieldGeneratorVersion: 2, rows: {} })).toThrow(/needs a migration/);
		expect(bad({ fieldGeneratorVersion: 1, rows: { "1:carrier:2": { surveyedAt: 0 } } })).toThrow(/not a deposit key/);
	});

	test("the debit refills in whole tonnes and reaches exactly zero", () => {
		expect(debitAt(3, 0, 0)).toBe(3);
		expect(debitAt(3, 0, 3599)).toBe(3);
		expect(debitAt(3, 0, 3600)).toBe(2);
		expect(debitAt(3, 0, 3 * 3600)).toBe(0);
		expect(debitAt(3, 0, 99 * 3600)).toBe(0);
	});
});
