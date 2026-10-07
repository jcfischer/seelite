/**
 * #619: save schema 7 → 8, the ship's rates on the flight record.
 *
 * Under the vent substrate rotation carries momentum no held key implies, so a
 * save taken tumbling resumes tumbling (`flight-model.md` §3.9). A version 7
 * record has no rates and loads at rest.
 */

import { describe, expect, test } from "bun:test";
import { fnv1a } from "../src/rng";
import {
	LEGACY_SAVE_SCHEMA_VERSIONS,
	newCommanderRecord,
	parseSave,
	SAVE_SCHEMA_VERSION,
	serializeSave,
} from "../src/save-envelope";
import { newWorld } from "../src/world-state";

const resealed = (
	raw: unknown,
	edit: (body: Record<string, any>) => void,
): unknown => {
	const { integrity: _, ...body } = JSON.parse(JSON.stringify(raw));
	edit(body);
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
};

const tumbling = () => {
	const commander = newCommanderRecord("courier");
	commander.flight = {
		...commander.flight,
		rates: [2.5, -4, 7],
	};
	return { world: newWorld(42), commander };
};

describe("#619 — the rates in the save", () => {
	test("rates arrived at 8, which is still read beside 7", () => {
		// Node #731 took 9 for the world's derelict rows, #732 10 and #482 11.
		expect(SAVE_SCHEMA_VERSION).toBe(12);
		expect(LEGACY_SAVE_SCHEMA_VERSIONS).toContain(7);
		expect(LEGACY_SAVE_SCHEMA_VERSIONS).toContain(8);
	});

	test("a new commander is at rest", () => {
		expect(newCommanderRecord("courier").flight.rates).toEqual([0, 0, 0]);
	});

	test("a tumbling save round-trips its rates", () => {
		const save = tumbling();
		expect(parseSave(serializeSave(save)).commander.flight.rates).toEqual([
			2.5, -4, 7,
		]);
	});

	test("a version 7 record loads at rest", () => {
		const v7 = resealed(serializeSave(tumbling()), (body) => {
			body.saveSchemaVersion = 7;
			delete body.commander.sweepReadings;
			delete body.commander.flight.rates;
		});
		expect(parseSave(v7).commander.flight.rates).toEqual([0, 0, 0]);
	});

	test("a version 7 record carrying rates was assembled, and is refused", () => {
		const grafted = resealed(serializeSave(tumbling()), (body) => {
			body.saveSchemaVersion = 7;
			delete body.commander.sweepReadings;
		});
		expect(() => parseSave(grafted)).toThrow("rates is not a version 7 field");
	});

	test("a current record without rates is truncated, and is refused", () => {
		const truncated = resealed(serializeSave(tumbling()), (body) => {
			delete body.commander.flight.rates;
		});
		expect(() => parseSave(truncated)).toThrow("rates is not 3 numbers");
	});

	test("a non-finite rate is refused", () => {
		const bad = resealed(serializeSave(tumbling()), (body) => {
			body.commander.flight.rates = [0, null, 0];
		});
		expect(() => parseSave(bad)).toThrow("rates holds a non-finite value");
	});
});
