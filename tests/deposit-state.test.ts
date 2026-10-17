import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	canonicalDeposits,
	compactDeposits,
	debitAt,
	depositKey,
	emptyDeposits,
	isDepositKey,
	isDerivable,
	parseDeposits,
	RECOVERY_T_PER_H,
	SURVEY_LIFETIME_H,
	surveyLive,
} from "../src/deposit-state";
import {
	FIELD_GENERATOR_VERSION,
	fieldRocks,
	systemFields,
} from "../src/asteroid-field";
import { generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";
import {
	canonicalSnapshot,
	compactWorld,
	newWorld,
	parseWorld,
	serializeWorld,
	WORLD_SCHEMA_VERSION,
} from "../src/world-state";
import { fnv1a } from "../src/rng";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";

const fixture = (seed = 1, galaxyIndex = 0) => {
	const galaxy = generateGalaxy(seed, galaxyIndex);
	for (const record of galaxy.systems) {
		const fields = systemFields(record, generateContents(record));
		if (fields.length) {
			const field = fields[0];
			return {
				key: depositKey(
					record.index,
					field.id,
					fieldRocks(record, field)[0].slot,
				),
				record,
				field,
			};
		}
	}
	throw new Error("fixture has no fields");
};

describe("deposit rows (node #967)", () => {
	test("recovery is whole-tonne linear on the seconds game clock", () => {
		expect(RECOVERY_T_PER_H).toBe(1);
		expect(SURVEY_LIFETIME_H).toBe(24);
		for (const [t, expected] of [
			[10, 3],
			[3609.999, 3],
			[3610, 2],
			[7210, 1],
			[10810, 0],
			[1e9, 0],
		])
			expect(debitAt(3, 10, t)).toBe(expected);
		expect(() => debitAt(3, 10, 9)).toThrow();
	});
	test("reading expires exactly at its lifetime", () => {
		expect(surveyLive({ surveyedAt: 10 }, 86409.999)).toBe(true);
		expect(surveyLive({ surveyedAt: 10 }, 86410)).toBe(false);
		expect(surveyLive({}, 10)).toBe(false);
	});
	test("compaction retains either debit and every live reading; drops only fully derivable rows", () => {
		const key = depositKey(0, "field-00", 1);
		for (const row of [
			{ surface: 25, at: 0 },
			{ deep: 25, at: 0 },
			{ surveyedAt: 1 },
			{ surface: 24, at: 0, surveyedAt: 1 },
		]) {
			expect(isDerivable(row, 86400)).toBe(false);
			expect(
				compactDeposits({ rows: { [key]: row } }, 86400).rows[key],
			).toEqual(row);
		}
		const expired = { surface: 24, deep: 1, at: 0, surveyedAt: 0 };
		expect(isDerivable(expired, 86400)).toBe(true);
		const original = { rows: { [key]: expired } };
		expect(compactDeposits(original, 86400)).toEqual(emptyDeposits());
		expect(original.rows[key]).toEqual(expired);
	});
	test("system key bounds read the supplied galaxy count", () => {
		expect(isDepositKey("299:field-00:1", 300)).toBe(true);
		expect(isDepositKey("7:field-00:1", 7)).toBe(false);
		for (const key of [
			"01:field-00:1",
			"-1:field-00:1",
			"1:field-0:1",
			"1:field-00:01",
			"1:field-00:-1",
		])
			expect(isDepositKey(key, 300)).toBe(false);
	});
	test("parser refuses empty, malformed, fractional, future and contents-bearing rows", () => {
		const { key } = fixture();
		const valid = canonicalDeposits(
			{ rows: { [key]: { surface: 2, deep: 3, at: 0, surveyedAt: 1 } } },
			1,
			0,
		);
		expect(parseDeposits(valid, 1, 0, 1).rows[key]).toEqual({
			surface: 2,
			deep: 3,
			at: 0,
			surveyedAt: 1,
		});
		for (const row of [
			null,
			[],
			{},
			{ at: 0 },
			{ surface: 1 },
			{ surface: 0, at: 0 },
			{ surface: 1.5, at: 0 },
			{ deep: -1, at: 0 },
			{ surface: Infinity, at: 0 },
			{ surveyedAt: 2 },
			{ surveyedAt: -1 },
			{ surface: 1, at: 2 },
			{ surveyedAt: 0, contents: { gold: 1 } },
		])
			expect(() =>
				parseDeposits({ ...valid, rows: { [key]: row } }, 1, 0, 1),
			).toThrow(/deposits/);
		for (const raw of [
			null,
			[],
			{ ...valid, rows: [] },
			{ ...valid, fingerprints: [] },
			{ ...valid, extra: 1 },
			{ ...valid, fingerprints: {} },
		])
			expect(() => parseDeposits(raw, 1, 0, 1)).toThrow(/deposits/);
	});
	test("empty domain writes no bytes", () => {
		expect(canonicalDeposits(emptyDeposits(), 1, 0)).toBeUndefined();
		expect(parseDeposits(undefined, 1, 0, 0)).toEqual(emptyDeposits());
	});
});

const saved = (world: ReturnType<typeof newWorld>) =>
	JSON.parse(JSON.stringify(serializeWorld(world)));
const rehash = (raw: ReturnType<typeof saved>) => {
	const { integrity: _, ...body } = raw;
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
};

describe("world deposit envelope", () => {
	test("a pre-deposit save loads untouched and re-saves to exactly its old bytes", () => {
		const world = newWorld(1);
		const raw = saved(world);
		// Captured before the optional domain landed, including its integrity.
		expect(fnv1a(JSON.stringify(raw))).toBe(1302952874);
		expect(WORLD_SCHEMA_VERSION).toBe(3);
		expect(
			raw.galaxies.every(
				(g: Record<string, unknown>) => !Object.hasOwn(g, "deposits"),
			),
		).toBe(true);
		const loaded = parseWorld(raw);
		expect(
			loaded.galaxies.every((g) => Object.keys(g.deposits.rows).length === 0),
		).toBe(true);
		expect(JSON.stringify(serializeWorld(loaded))).toBe(JSON.stringify(raw));
	});
	test("debits and readings round trip separately in each galaxy; keys canonicalize", () => {
		const { key } = fixture();
		const world = newWorld(1);
		world.gameTime = 1;
		world.galaxies[0].deposits.rows[key] = { surface: 2, at: 0, surveyedAt: 1 };
		const raw = saved(world);
		expect(raw.galaxies[0].deposits.fieldGeneratorVersion).toBe(
			FIELD_GENERATOR_VERSION,
		);
		expect(raw.galaxies[1].deposits).toBeUndefined();
		expect(saved(parseWorld(raw))).toEqual(raw);
		expect(compactWorld(world, 86401).galaxies[0].deposits).toEqual(
			emptyDeposits(),
		);
		expect(
			JSON.parse(canonicalSnapshot(world, 86400)).galaxies[0].deposits,
		).toBeDefined();
		expect(
			JSON.parse(canonicalSnapshot(world, 86401)).galaxies[0].deposits,
		).toBeUndefined();
		world.gameTime = 86401;
		expect(saved(world).galaxies[0].deposits).toBeUndefined();
		expect(world.galaxies[0].deposits.rows[key]).toBeDefined();
	});
	test("v1 per-field fingerprints are historical pins, not recomputed expectations", () => {
		// World seed 1, galaxy 0, captured from field generator v1. Keep this
		// fixture when the generator changes: these are the previous pins D5 needs.
		const domain = JSON.parse(
			readFileSync(
				new URL("./fixtures/deposits-v1.json", import.meta.url),
				"utf8",
			),
		);
		expect(
			canonicalDeposits({ rows: domain.rows }, 1, 0)?.fingerprints,
		).toEqual(domain.fingerprints);
		expect(parseDeposits(domain, 1, 0, 0).rows).toEqual(domain.rows);
	});
	test("version mismatch drops just changed fields and restamps unchanged rows", () => {
		const world = newWorld(1);
		let fields = 0;
		for (const record of generateGalaxy(1, 0).systems) {
			for (const field of systemFields(record, generateContents(record))) {
				for (const rock of fieldRocks(record, field).slice(0, 2))
					world.galaxies[0].deposits.rows[
						depositKey(record.index, field.id, rock.slot)
					] = { surface: 3, at: 0, surveyedAt: 0 };
				if (++fields === 2) break;
			}
			if (fields === 2) break;
		}
		const raw = saved(world);
		const domain = raw.galaxies[0].deposits;
		const fieldKeys = Object.keys(domain.fingerprints);
		expect(fieldKeys).toHaveLength(2);
		domain.fieldGeneratorVersion = FIELD_GENERATOR_VERSION + 1;
		domain.fingerprints[fieldKeys[0]] =
			(domain.fingerprints[fieldKeys[0]] ^ 1) >>> 0;
		const received = JSON.stringify(rehash(raw));
		const loaded = parseWorld(JSON.parse(received));
		const kept = Object.keys(loaded.galaxies[0].deposits.rows);
		expect(kept).toHaveLength(2);
		expect(kept.every((k) => k.startsWith(`${fieldKeys[1]}:`))).toBe(true);
		const again = saved(loaded);
		expect(again.galaxies[0].deposits.fieldGeneratorVersion).toBe(
			FIELD_GENERATOR_VERSION,
		);
		expect(again.galaxies[0].deposits.fingerprints).toEqual({
			[fieldKeys[1]]: domain.fingerprints[fieldKeys[1]],
		});
		expect(saved(parseWorld(again))).toEqual(again);
		// Migration still checks the received hash, never its rewritten rows.
		expect(() => parseWorld(raw)).toThrow(/integrity/);
	});
	test("same-version relabel keeps rows; unknown rock and invalid system refuse", () => {
		const { key } = fixture();
		const world = newWorld(1);
		world.galaxies[0].deposits.rows[key] = { surveyedAt: 0 };
		const raw = saved(world);
		const pin = Object.keys(raw.galaxies[0].deposits.fingerprints)[0];
		raw.galaxies[0].deposits.fingerprints[pin] =
			(raw.galaxies[0].deposits.fingerprints[pin] ^ 1) >>> 0;
		expect(parseWorld(rehash(raw)).galaxies[0].deposits.rows[key]).toEqual({
			surveyedAt: 0,
		});
		for (const badKey of [
			`${generateGalaxy(1, 0).systems.length}:field-00:0`,
			`${pin}:999999`,
		]) {
			const copy = saved(world);
			copy.galaxies[0].deposits.rows = { [badKey]: { surveyedAt: 0 } };
			expect(() => parseWorld(rehash(copy))).toThrow(/deposits/);
		}
	});
	test("v1 save migrates against a bumped generator with one changed field", () => {
		// Isolate the mocked new generator from the rest of the suite. The save's
		// v1 pins stay fixed while the running version and one field's pin move.
		const script = `
			import { mock } from "bun:test";
			import { readFileSync } from "node:fs";
			import assert from "node:assert/strict";
			const url = ${JSON.stringify(new URL("../src/asteroid-field.ts", import.meta.url).href)};
			const original = {...await import(url)};
			mock.module(url, () => ({...original, FIELD_GENERATOR_VERSION: 2,
				fieldFingerprintRow: (s, p, r) => original.fieldFingerprintRow(s, p, r) + (s === 0 ? "|moved" : "")
			}));
			const W = await import(${JSON.stringify(new URL("../src/world-state.ts", import.meta.url).href)});
			const {fnv1a} = await import(${JSON.stringify(new URL("../src/rng.ts", import.meta.url).href)});
			const raw = W.serializeWorld(W.newWorld(1));
			raw.galaxies[0].deposits = JSON.parse(readFileSync(${JSON.stringify(new URL("./fixtures/deposits-v1.json", import.meta.url).pathname)}, "utf8"));
			const {integrity, ...body} = raw;
			const loaded = W.parseWorld({...body, integrity: fnv1a(JSON.stringify(body))});
			assert.deepEqual(Object.keys(loaded.galaxies[0].deposits.rows), ["2:field-00:2"]);
			assert.equal(W.serializeWorld(loaded).galaxies[0].deposits.fieldGeneratorVersion, 2);
		`;
		const result = Bun.spawnSync([process.execPath, "--eval", script]);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
	});
	test("two galaxies retain independent readings and insertion order cannot change bytes", () => {
		const a = fixture();
		const b = fixture(1, 1);
		const world = newWorld(1);
		world.galaxies[0].deposits.rows[a.key] = { surface: 2, at: 0 };
		world.galaxies[1].deposits.rows[b.key] = { deep: 3, at: 0, surveyedAt: 0 };
		const loaded = parseWorld(saved(world));
		expect(loaded.galaxies[0].deposits).toEqual(world.galaxies[0].deposits);
		expect(loaded.galaxies[1].deposits).toEqual(world.galaxies[1].deposits);
		const rock = fieldRocks(a.record, a.field)[1];
		const key2 = depositKey(a.record.index, a.field.id, rock.slot);
		world.galaxies[0].deposits.rows[key2] = { surveyedAt: 0 };
		const bytes = JSON.stringify(serializeWorld(world));
		world.galaxies[0].deposits.rows = Object.fromEntries(
			Object.entries(world.galaxies[0].deposits.rows).reverse(),
		);
		expect(JSON.stringify(serializeWorld(world))).toBe(bytes);
	});
	test("the Commander save envelope retains deposits under its existing integrity hash", () => {
		const { key } = fixture();
		const world = newWorld(1);
		world.galaxies[0].deposits.rows[key] = {
			surface: 3,
			deep: 1,
			at: 0,
			surveyedAt: 0,
		};
		const raw = JSON.parse(
			JSON.stringify(
				serializeSave({ world, commander: newCommanderRecord("courier") }),
			),
		);
		expect(parseSave(raw).world.galaxies[0].deposits).toEqual(
			world.galaxies[0].deposits,
		);
		raw.world.galaxies[0].deposits.rows[key].surface = 2;
		expect(() => parseSave(raw)).toThrow(/integrity/);
	});
});
