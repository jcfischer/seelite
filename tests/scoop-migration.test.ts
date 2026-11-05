import { describe, expect, test } from "bun:test";
import { HULL_SPECS, type HullId } from "../src/hull";
import { makeModule, moduleFits, type Loadout } from "../src/loadout";
import { moduleRows } from "../src/loadout";
import { fnv1a } from "../src/rng";
import {
	LEGACY_SAVE_SCHEMA_VERSIONS,
	newCommanderRecord,
	parseSave,
	SAVE_SCHEMA_VERSION,
	serializeSave,
} from "../src/save-envelope";
import { newWorld } from "../src/world-state";

const cargoSlots = (hull: HullId) =>
	HULL_SPECS[hull].slots.filter(
		(s) =>
			s.kind === "internal" &&
			s.accepts !== "any" &&
			s.accepts.includes("cargo"),
	);

const withoutScoop = (loadout: Loadout): Loadout =>
	Object.fromEntries(
		Object.entries(loadout).filter(([, m]) => m.module !== "cargo-scoop"),
	);

const fullOfRacks = (hull: HullId, loadout: Loadout): Loadout => {
	const out: Record<string, (typeof loadout)[string]> = { ...loadout };
	for (const slot of cargoSlots(hull)) {
		const row = moduleRows().find(
			(r) =>
				r.kind === "cargo-rack" &&
				moduleFits(makeModule(r.kind, r.size, r.grade), slot),
		)!;
		out[slot.key] = makeModule(row.kind, row.size, row.grade);
	}
	return out;
};

const baseLoadout = (hull: HullId): Loadout =>
	newCommanderRecord(hull).state.loadout;

const record = (hull: HullId, loadout: Loadout) => {
	const commander = newCommanderRecord(hull);
	commander.state.loadout = loadout;
	return { world: newWorld(42), commander };
};

const resealed = (
	raw: unknown,
	edit: (body: Record<string, any>) => void,
): unknown => {
	const { integrity: _, ...body } = JSON.parse(JSON.stringify(raw));
	edit(body);
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
};

const asLegacy = (raw: unknown, version = 16) =>
	resealed(raw, (body) => {
		body.saveSchemaVersion = version;
		delete body.commander.scoopNotice;
	});

const HULLS = Object.keys(HULL_SPECS) as HullId[];

describe("node #1097 — the one-time cargo scoop grant", () => {
	test("the schema moved from 16 to 17 and 16 is legacy", () => {
		expect(SAVE_SCHEMA_VERSION).toBe(17);
		expect([...LEGACY_SAVE_SCHEMA_VERSIONS]).toContain(16);
	});

	test("a legacy loadout with a free cargo internal gets a 1E scoop in the first such slot", () => {
		for (const hull of HULLS) {
			const slots = cargoSlots(hull);
			if (slots.length === 0) continue;
			const loadout = withoutScoop(baseLoadout(hull));
			const legacy = asLegacy(serializeSave(record(hull, loadout)));
			const parsed = parseSave(legacy).commander;
			const first = [...slots].sort((a, b) => a.key.localeCompare(b.key))[0];
			expect(parsed.state.loadout[first.key]).toEqual({
				module: "cargo-scoop",
				size: 1,
				grade: "E",
			});
			expect(parsed.scoopNotice).toBe(false);
			expect(parsed.state.loadout.flex).toBeUndefined();
		}
	});

	test("the flex slot is not touched even when it is the only empty slot that fits", () => {
		for (const hull of HULLS) {
			const loadout = fullOfRacks(hull, withoutScoop(baseLoadout(hull)));
			const legacy = asLegacy(serializeSave(record(hull, loadout)));
			const parsed = parseSave(legacy).commander;
			expect(parsed.state.loadout).toEqual(loadout);
			expect(parsed.state.loadout.flex).toBeUndefined();
			expect(parsed.scoopNotice).toBe(true);
		}
	});

	test("a legacy save that already carries a scoop is left alone", () => {
		for (const hull of HULLS) {
			const base = baseLoadout(hull);
			const loadout: Loadout = {
				...withoutScoop(base),
				flex: makeModule("cargo-scoop", 1),
			};
			const legacy = asLegacy(serializeSave(record(hull, loadout)));
			const parsed = parseSave(legacy).commander;
			expect(parsed.state.loadout).toEqual(loadout);
			expect(parsed.scoopNotice).toBe(false);
		}
	});

	test("a current save whose pilot sold the scoop is not granted another", () => {
		for (const hull of HULLS) {
			const loadout = withoutScoop(baseLoadout(hull));
			const parsed = parseSave(serializeSave(record(hull, loadout))).commander;
			expect(parsed.state.loadout).toEqual(loadout);
			expect(parsed.scoopNotice).toBe(false);
		}
	});

	test("the notice survives a round trip and is written only while owed", () => {
		const hull = HULLS.find((h) => cargoSlots(h).length > 0)!;
		const loadout = fullOfRacks(hull, withoutScoop(baseLoadout(hull)));
		const owed = parseSave(asLegacy(serializeSave(record(hull, loadout))));
		expect(owed.commander.scoopNotice).toBe(true);
		const written = serializeSave(owed) as {
			commander: Record<string, unknown>;
		};
		expect(written.commander.scoopNotice).toBe(true);
		expect(parseSave(written).commander.scoopNotice).toBe(true);
		const clear = serializeSave({
			...owed,
			commander: { ...owed.commander, scoopNotice: false },
		}) as { commander: Record<string, unknown> };
		expect("scoopNotice" in clear.commander).toBe(false);
	});

	test("a legacy record may not carry the notice, and a current one carries it only as true", () => {
		const hull = HULLS[0];
		const raw = serializeSave(record(hull, baseLoadout(hull)));
		const stamped = (version: number, value: unknown) =>
			resealed(raw, (body) => {
				body.saveSchemaVersion = version;
				body.commander.scoopNotice = value;
			});
		expect(() => parseSave(stamped(16, true))).toThrow(/scoopNotice/);
		expect(() => parseSave(stamped(17, false))).toThrow(/scoopNotice/);
		expect(() => parseSave(stamped(17, "yes"))).toThrow(/scoopNotice/);
		expect(parseSave(stamped(17, true)).commander.scoopNotice).toBe(true);
	});

	test("a version that is neither current nor legacy is refused", () => {
		const raw = serializeSave(record("courier", baseLoadout("courier")));
		expect(() =>
			parseSave(resealed(raw, (b) => (b.saveSchemaVersion = 18))),
		).toThrow(/unsupported/);
		expect(() =>
			parseSave(resealed(raw, (b) => (b.saveSchemaVersion = 1))),
		).toThrow(/unsupported/);
	});

	test("an older legacy version, migrated from the equipment list, is granted too", () => {
		const raw = serializeSave(record("courier", baseLoadout("courier")));
		const v12 = resealed(raw, (body) => {
			body.saveSchemaVersion = 12;
			body.commander.state.ownedEquipment = [];
			delete body.commander.state.loadout;
			delete body.commander.txSeq;
			delete body.commander.scoopNotice;
		});
		const parsed = parseSave(v12).commander;
		expect(
			Object.values(parsed.state.loadout).filter(
				(m) => m.module === "cargo-scoop",
			),
		).toHaveLength(1);
		expect(parsed.state.loadout.flex).toBeUndefined();
	});
});
