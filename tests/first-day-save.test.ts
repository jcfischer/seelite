/**
 * #408 D4: a new game's guided/free choice is saved on the commander.
 *
 * Version 6 adds `firstDay`. Every older version loads as `free` — a pilot who
 * already has a save is not new — and an older version that carries the key
 * was assembled rather than saved, so it is refused by name.
 */

import { describe, expect, test } from "bun:test";
import {
	LEGACY_SAVE_SCHEMA_VERSIONS,
	newCommanderRecord,
	parseSave,
	SAVE_SCHEMA_VERSION,
	serializeSave,
} from "../src/save-envelope";
import { fnv1a } from "../src/rng";
import { newWorld } from "../src/world-state";

const saveOf = (firstDay?: "guided" | "free") => ({
	world: newWorld(42),
	commander: newCommanderRecord(
		"courier",
		firstDay === undefined ? {} : { firstDay },
	),
});

/** A serialized save with its body edited and its hash re-sealed, so the
 *  parser reaches the edit instead of stopping at the integrity check. */
const resealed = (
	raw: unknown,
	edit: (body: Record<string, any>) => void,
): unknown => {
	const { integrity: _, ...body } = JSON.parse(JSON.stringify(raw));
	edit(body);
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
};

describe("#408 D4 — the saved first-day choice", () => {
	test("the schema is 6", () => {
		// A literal, so the next bump has to come through here.
		expect(SAVE_SCHEMA_VERSION).toBe(6);
		expect([...LEGACY_SAVE_SCHEMA_VERSIONS]).toEqual([2, 3, 4, 5]);
	});

	test("a new commander is free unless the caller says guided", () => {
		expect(newCommanderRecord("courier").firstDay).toBe("free");
		expect(newCommanderRecord("courier", { firstDay: "guided" }).firstDay).toBe(
			"guided",
		);
	});

	test("both choices round-trip", () => {
		for (const choice of ["guided", "free"] as const)
			expect(parseSave(serializeSave(saveOf(choice))).commander.firstDay).toBe(
				choice,
			);
	});

	test("a version 5 record, which has no choice, loads as free", () => {
		const v5 = resealed(serializeSave(saveOf("guided")), (body) => {
			body.saveSchemaVersion = 5;
			delete body.commander.firstDay;
		});
		expect(parseSave(v5).commander.firstDay).toBe("free");
	});

	test("every older version carrying the key is refused by name", () => {
		// The v2 body also drops `requests`, which v2 forbids for its own reason;
		// without that this row would be red on the wrong key.
		for (const version of LEGACY_SAVE_SCHEMA_VERSIONS) {
			const grafted = resealed(serializeSave(saveOf("free")), (body) => {
				body.saveSchemaVersion = version;
				if (version === 2) delete body.commander.requests;
			});
			expect(() => parseSave(grafted)).toThrow(
				`saveSchemaVersion ${version} cannot contain "firstDay"`,
			);
		}
	});

	test("a version 6 record without the key is truncated, not free", () => {
		const truncated = resealed(serializeSave(saveOf("free")), (body) => {
			delete body.commander.firstDay;
		});
		expect(() => parseSave(truncated)).toThrow(/firstDay/);
	});

	test("a value that is neither choice is refused", () => {
		const bad = resealed(serializeSave(saveOf("free")), (body) => {
			body.commander.firstDay = "tutorial";
		});
		expect(() => parseSave(bad)).toThrow(/firstDay/);
	});
});
