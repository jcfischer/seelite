/**
 * #564: save schema 6 → 7, the ladders' record on the commander (#183 D9).
 *
 * A v6 save migrates at zero on every ladder, seeds its visited sets with the
 * system it is in and the station it is docked at, and keeps everything it
 * owns — a gate blocks only new purchases.
 */

import { describe, expect, test } from "bun:test";
import type { CarrierKey } from "../src/carrier-key";
import { emptyLadderRecord } from "../src/ladder";
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

const saved = () => {
	const commander = newCommanderRecord("courier", {
		firstDay: "guided",
		galaxyIndex: 2,
		systemIndex: 17,
	});
	commander.dockedAt = "17:station-trade" as CarrierKey;
	commander.state = {
		...commander.state,
		credits: 5000,
		cargo: { Food: 6 },
		ownedEquipment: ["Military Laser"],
	};
	return { world: newWorld(42), commander };
};

describe("#183 D9 — the ladders in the save", () => {
	test("the schema is 7", () => {
		// A literal, so the next bump has to come through here.
		expect(SAVE_SCHEMA_VERSION).toBe(7);
		expect([...LEGACY_SAVE_SCHEMA_VERSIONS]).toEqual([2, 3, 4, 5, 6]);
	});

	test("a new commander starts at zero, seeded with where it starts", () => {
		const record = newCommanderRecord("courier", {
			galaxyIndex: 1,
			systemIndex: 9,
		});
		expect(record.ladders.banked).toEqual(emptyLadderRecord().banked);
		expect(record.ladders.visited).toEqual({
			1: { systems: [9], stations: [] },
		});
	});

	test("a record round-trips with its ladders", () => {
		const save = saved();
		save.commander.ladders = {
			banked: { combat: 2.5, trade: 12_000, exploration: 7 },
			visited: {
				2: {
					systems: [3, 17],
					stations: ["17:station-trade" as CarrierKey],
				},
			},
			basis: { Food: { units: 6, cr: 30 } },
			playedS: 3600,
			capstoneAt: null,
		};
		expect(parseSave(serializeSave(save))).toEqual(save);
	});

	test("a v6 record migrates at zero, seeded, and keeps what it owns", () => {
		const v6 = resealed(serializeSave(saved()), (body) => {
			body.saveSchemaVersion = 6;
			delete body.commander.ladders;
		});
		const { commander } = parseSave(v6);
		expect(commander.ladders.banked).toEqual({
			combat: 0,
			trade: 0,
			exploration: 0,
		});
		expect(commander.ladders.visited).toEqual({
			2: { systems: [17], stations: ["17:station-trade" as CarrierKey] },
		});
		// Its hold has no basis, so its first sale pays no margin.
		expect(commander.ladders.basis).toEqual({});
		expect(commander.ladders.playedS).toBe(0);
		// Owned stays owned (a gated item), and a v6 guided choice is kept: 6
		// is the version that added it.
		expect(commander.state.ownedEquipment).toEqual(["Military Laser"]);
		expect(commander.state.credits).toBe(5000);
		expect(commander.firstDay).toBe("guided");
	});

	test("a v6 migration seeds every system the old world marks visited", () => {
		const save = saved();
		save.world.galaxies[2] = {
			...save.world.galaxies[2],
			visited: [3, 17, 40],
		};
		save.world.galaxies[0] = { ...save.world.galaxies[0], visited: [5] };
		const v6 = resealed(serializeSave(save), (body) => {
			body.saveSchemaVersion = 6;
			delete body.commander.ladders;
		});
		const { commander } = parseSave(v6);
		expect(commander.ladders.banked.exploration).toBe(0);
		expect(commander.ladders.visited).toEqual({
			0: { systems: [5], stations: [] },
			2: {
				systems: [3, 17, 40],
				stations: ["17:station-trade" as CarrierKey],
			},
		});
	});

	test("an older version carrying the key is refused by name", () => {
		const grafted = resealed(serializeSave(saved()), (body) => {
			body.saveSchemaVersion = 6;
		});
		expect(() => parseSave(grafted)).toThrow(
			'saveSchemaVersion 6 cannot contain "ladders"',
		);
	});

	test("a v7 record without the key is truncated, not zero", () => {
		const truncated = resealed(serializeSave(saved()), (body) => {
			delete body.commander.ladders;
		});
		expect(() => parseSave(truncated)).toThrow(/ladders/);
	});

	test("a basis for a good that is not a commodity, or not aboard, is refused", () => {
		const unknown = resealed(serializeSave(saved()), (body) => {
			body.commander.ladders.basis = { Unobtainium: { units: 1, cr: 1 } };
		});
		expect(() => parseSave(unknown)).toThrow(/Unobtainium/);
		const more = resealed(serializeSave(saved()), (body) => {
			body.commander.ladders.basis = { Food: { units: 7, cr: 1 } };
		});
		expect(() => parseSave(more)).toThrow(/Food/);
	});
});
