/**
 * Node #1302: a charted rock carries a realistic reserve.
 *
 * The principal's ruling (2026-11-17): a few dozen tonnes per asteroid is not
 * realistic, and a normal rock should hold about 400 t so the Longwall's
 * 3,000 t ore bay takes several rocks or one large one. The area and volume
 * laws and the deep-deposit chance are unchanged.
 *
 * https://github.com/jcfischer/seelite/issues/1302
 */
import { describe, expect, test } from "bun:test";
import { fieldRocks, systemFields } from "../src/asteroid-field";
import {
	canonicalDeposits,
	depositKey,
	parseDeposits,
} from "../src/deposit-state";
import { generateGalaxy } from "../src/galaxy";
import { HULL_SPECS } from "../src/hull";
import { RESERVE, rockContents, surveyReading } from "../src/rock-survey";
import {
	parseSave,
	serializeSave,
	newCommanderRecord,
} from "../src/save-envelope";
import { newCommander } from "../src/station-commerce";
import { generateContents } from "../src/system";
import { newWorld } from "../src/world-state";

const median = (values: readonly number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor((sorted.length - 1) / 2)];
};

const chartedFields = (seed: number) =>
	generateGalaxy(seed, 0).systems.flatMap((record) =>
		systemFields(record, generateContents(record))
			.filter((plan) => plan.profile === "charted")
			.map((plan) => ({ record, plan, rocks: fieldRocks(record, plan) })),
	);

const contentsOf = (seed: number) =>
	chartedFields(seed).flatMap(({ record, plan, rocks }) =>
		rocks.map((rock) => ({
			rock,
			contents: rockContents(record.seed, plan.slot, plan.profile, rock),
		})),
	);

const totalsOf = (seed: number) =>
	contentsOf(seed).map(({ contents }) => contents.surfaceT + contents.deepT);

describe("the reserve scale (node #1302)", () => {
	test("the chosen figures are the ones the PR carries", () => {
		expect(RESERVE.surfaceAtLargestT).toBe(50_000);
		expect(RESERVE.deepAtLargestT).toBe(200_000);
		expect(RESERVE.surfaceMinT).toBe(50);
		expect(RESERVE.deepMinT).toBe(100);
		expect(RESERVE.deepChanceAtSmallest).toBe(0.2);
		expect(RESERVE.deepChanceAtLargest).toBe(0.9);
	});

	test("the median charted rock holds at least 400 t of minable ore", () => {
		for (const seed of [1, 2, 47, 1234])
			expect(median(totalsOf(seed))).toBeGreaterThanOrEqual(400);
	});

	test("every charted field's median rock holds at least 400 t", () => {
		for (const seed of [1, 2, 47]) {
			for (const { record, plan, rocks } of chartedFields(seed)) {
				const totals = rocks.map((rock) => {
					const contents = rockContents(
						record.seed,
						plan.slot,
						plan.profile,
						rock,
					);
					return contents.surfaceT + contents.deepT;
				});
				expect(median(totals)).toBeGreaterThanOrEqual(400);
			}
		}
	});

	test("the largest rock scales up by the area and volume laws", () => {
		const contents = contentsOf(2).map(({ contents }) => contents);
		const surface = contents.map((c) => c.surfaceT);
		const deep = contents.map((c) => c.deepT);
		expect(Math.max(...surface)).toBeGreaterThanOrEqual(40_000);
		expect(Math.max(...deep)).toBeGreaterThanOrEqual(100_000);
	});
});

describe("a full hold leaves most of a large rock", () => {
	test("the Longwall's 3,000 t is a fraction of the largest rock's surface", () => {
		const { contents } = contentsOf(2).reduce((best, next) =>
			next.rock.radiusKm > best.rock.radiusKm ? next : best,
		);
		const hold = HULL_SPECS.miner.oreHoldT ?? 0;
		expect(hold).toBe(3000);
		expect(contents.surfaceT).toBeGreaterThan(hold);
		const reading = surveyReading(
			contents,
			{ surface: hold, at: 0, surveyedAt: 0 },
			0,
			24,
		);
		if (!reading) throw new Error("a surveyed rock reads");
		expect(reading.surfaceLeftT).toBe(contents.surfaceT - hold);
		expect(reading.surfaceLeftT).toBeGreaterThan(contents.surfaceT * 0.5);
	});
});

describe("a save written before the change keeps its debits", () => {
	const field = () => {
		for (const record of generateGalaxy(1, 0).systems) {
			for (const plan of systemFields(record, generateContents(record))) {
				if (plan.profile !== "charted") continue;
				const rock = fieldRocks(record, plan).find(
					(candidate) =>
						rockContents(record.seed, plan.slot, plan.profile, candidate)
							.deepT > 600,
				);
				if (rock) return { record, plan, rock };
			}
		}
		throw new Error("the seed has no deep charted rock");
	};

	test("an old-scale debit loads and reads as the new reserve minus the debit", () => {
		const { record, plan, rock } = field();
		const contents = rockContents(record.seed, plan.slot, plan.profile, rock);
		const key = depositKey(record.index, plan.id, rock.slot);
		const oldDebit = { surface: 150, deep: 600, at: 0, surveyedAt: 0 };
		const envelope = canonicalDeposits({ rows: { [key]: oldDebit } }, 1, 0);
		const parsed = parseDeposits(envelope, 1, 0, 0);
		const reading = surveyReading(contents, parsed.rows[key], 0, 24);
		if (!reading) throw new Error("the debit's rock reads");
		expect(reading.surfaceLeftT).toBe(contents.surfaceT - 150);
		expect(reading.deepLeftT).toBe(contents.deepT - 600);
		expect(reading.surfaceLeftT).toBeGreaterThan(0);
		expect(reading.deepLeftT).toBeGreaterThan(0);
	});

	test("a whole save with the debit loads through parseSave", () => {
		const { record, plan, rock } = field();
		const key = depositKey(record.index, plan.id, rock.slot);
		const world = newWorld(1);
		world.gameTime = 0;
		world.galaxies[0].deposits.rows[key] = {
			surface: 150,
			deep: 600,
			at: 0,
			surveyedAt: 0,
		};
		const raw = serializeSave({
			world,
			commander: newCommanderRecord("courier"),
		});
		const loaded = parseSave(raw);
		expect(loaded.world.galaxies[0].deposits.rows[key]).toEqual({
			surface: 150,
			deep: 600,
			at: 0,
			surveyedAt: 0,
		});
		expect(loaded.commander.state.hull).toBe(newCommander("courier").hull);
	});
});
