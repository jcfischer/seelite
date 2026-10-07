import { describe, expect, test } from "bun:test";
import { LONG_RANGE_SCANNER } from "../src/market";
import { fnv1a } from "../src/rng";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
	SAVE_SCHEMA_VERSION,
} from "../src/save-envelope";
import { newWorld } from "../src/world-state";
import {
	beginSweep,
	stepSweep,
	sweepRefusal,
	sweepSources,
	sweepAge,
	parseSweepLeads,
	SWEEP_CHARGE_S,
	replaceSystemLeads,
} from "../src/system-sweep";

describe("node #482 system sweep", () => {
	test("the new provenance has its own envelope revision", () => {
		expect(SAVE_SCHEMA_VERSION).toBe(10);
		const world = newWorld(56);
		const raw = serializeSave({
			world,
			commander: newCommanderRecord("courier"),
		}) as { commander: Record<string, unknown> };
		expect(raw.commander.sweepLeads).toEqual([]);
	});
	test("a verified v9 migrates empty without editing its original; a truncated v10 refuses", () => {
		const current = serializeSave({
			world: newWorld(56),
			commander: newCommanderRecord("courier"),
		});
		const rehash = (edit: (body: any) => void) => {
			const { integrity: _, ...body } = JSON.parse(JSON.stringify(current));
			edit(body);
			return { ...body, integrity: fnv1a(JSON.stringify(body)) };
		};
		const old = rehash((body) => {
			body.saveSchemaVersion = 9;
			delete body.commander.sweepLeads;
		});
		const original = JSON.stringify(old);
		expect(parseSave(old).commander.sweepLeads).toEqual([]);
		expect(JSON.stringify(old)).toBe(original);
		expect(() =>
			parseSave(
				rehash((body) => {
					delete body.commander.sweepLeads;
				}),
			),
		).toThrow("sweepLeads");
		expect(() =>
			parseSave(
				rehash((body) => {
					body.saveSchemaVersion = 9;
				}),
			),
		).toThrow("sweepLeads");
	});
	test("one press runs for ten seconds; another press cannot restart it", () => {
		const context = { fitted: true, flying: true, cruise: false };
		const begun = beginSweep(null, 10, context);
		expect(SWEEP_CHARGE_S).toBe(10);
		expect(beginSweep(begun, 15, context)).toEqual(begun);
		expect(stepSweep(begun, 19.99, context)).toEqual({
			charge: begun,
			completed: false,
		});
		expect(stepSweep(begun, 20, context)).toEqual({
			charge: null,
			completed: true,
		});
		expect(stepSweep(null, 21, context).completed).toBe(false);
	});
	test("cruise, docking and loss of the module break the charge", () => {
		const context = { fitted: true, flying: true, cruise: false };
		for (const refusal of [
			{ cruise: true },
			{ flying: false },
			{ fitted: false },
		]) {
			const blocked = { ...context, ...refusal };
			expect(sweepRefusal(blocked)).not.toBeNull();
			expect(beginSweep(null, 0, blocked)).toBeNull();
			expect(stepSweep(beginSweep(null, 0, context), 10, blocked)).toEqual({
				charge: null,
				completed: false,
			});
		}
	});
	test("source reading is pure, finds active wrecks and one pressure region, never carriers", () => {
		const world = { ...newWorld(56), gameTime: 48 * 3600 };
		const before = JSON.stringify(world);
		const rows = sweepSources(world, 0, 0);
		expect(rows.some((r) => r.kind === "relay")).toBe(true);
		expect(rows.some((r) => r.kind === "wreck")).toBe(true);
		expect(rows.filter((r) => r.kind === "pressure")).toHaveLength(1);
		for (const row of rows) {
			expect(row.source).toBe("own-sensors");
			expect(row.observedAt).toBe(world.gameTime);
			expect(row.confirmation).toBe("unconfirmed");
			expect(row).not.toHaveProperty("pos");
			expect(row).not.toHaveProperty("targetId");
		}
		expect(JSON.stringify(world)).toBe(before);
	});
	test("saves roundtrip source, region and time; old saves have no rows", () => {
		const world = { ...newWorld(56), gameTime: 48 * 3600 };
		const commander = newCommanderRecord("courier");
		commander.state.ownedEquipment = [LONG_RANGE_SCANNER];
		commander.sweepLeads = sweepSources(world, 0, 0);
		const saved = parseSave(serializeSave({ world, commander }));
		expect(saved.commander.sweepLeads).toEqual(commander.sweepLeads);
		expect(sweepAge(commander.sweepLeads[0], world.gameTime + 3600)).toContain(
			"STALE",
		);
		expect(sweepAge(commander.sweepLeads[0], world.gameTime)).not.toContain(
			"STALE",
		);
		expect(
			parseSave(
				serializeSave({ world, commander: newCommanderRecord("courier") }),
			).commander.sweepLeads,
		).toEqual([]);
	});
	test("bad provenance, clocks, references and point geometry refuse on load", () => {
		const world = { ...newWorld(56), gameTime: 48 * 3600 };
		const row = sweepSources(world, 0, 0).find((r) => r.kind === "relay")!;
		for (const change of [
			{ source: "broker" },
			{ observedAt: world.gameTime + 1 },
			{ galaxyIndex: 8 },
			{ systemIndex: 999 },
			{ id: "other" },
			{ confirmation: "identified" },
			{ region: { kind: "point", x: 1, y: 2, z: 3 } },
		])
			expect(() => parseSweepLeads([{ ...row, ...change }], world)).toThrow(
				"sweep",
			);
		expect(() => parseSweepLeads([row, row], world)).toThrow("sweep");
	});
	test("a fresh sweep replaces this system only; a past reading ages unchanged", () => {
		const world = { ...newWorld(56), gameTime: 48 * 3600 };
		const rows = sweepSources(world, 0, 0);
		const elsewhere = sweepSources(world, 1, 1);
		expect(replaceSystemLeads([...rows, ...elsewhere], [], 0, 0)).toEqual(
			elsewhere,
		);
		expect(sweepAge(rows[0], world.gameTime + 60)).toContain("1m");
	});
});
