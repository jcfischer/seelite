import { describe, expect, test } from "bun:test";
import { LONG_RANGE_SCANNER } from "../src/market";
import { fnv1a } from "../src/rng";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
	SAVE_SCHEMA_VERSION,
} from "../src/save-envelope";
import { applyTransition, newWorld } from "../src/world-state";
import { generateGalaxy } from "../src/galaxy";
import { relayActive } from "../src/pirate-relay";
import { relayPlan, relaySlot } from "../src/relay-slot"; // glossary-ignore: slot
import { generateContents } from "../src/system";
import {
	beginSweep,
	stepSweep,
	sweepRefusal,
	sweepSources,
	parseSweepReadings,
	SWEEP_CHARGE_S,
	replaceSystemReadings,
} from "../src/system-sweep";
import {
	sweepAge,
	sweepCompletion,
	sweepPanel,
} from "../src/system-sweep-view";

describe("node #482 system sweep", () => {
	test("the new provenance has its own envelope revision", () => {
		expect(SAVE_SCHEMA_VERSION).toBe(10);
		const world = newWorld(56);
		const raw = serializeSave({
			world,
			commander: newCommanderRecord("courier"),
		}) as { commander: Record<string, unknown> };
		expect(raw.commander.sweepReadings).toEqual([]);
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
			delete body.commander.sweepReadings;
		});
		const original = JSON.stringify(old);
		expect(parseSave(old).commander.sweepReadings).toEqual([]);
		expect(JSON.stringify(old)).toBe(original);
		expect(() =>
			parseSave(
				rehash((body) => {
					delete body.commander.sweepReadings;
				}),
			),
		).toThrow("sweepReadings");
		expect(() =>
			parseSave(
				rehash((body) => {
					body.saveSchemaVersion = 9;
				}),
			),
		).toThrow("sweepReadings");
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
			expect(row).not.toHaveProperty("pos");
			expect(row).not.toHaveProperty("targetId");
		}
		expect(JSON.stringify(world)).toBe(before);
	});
	test("saves roundtrip source, region and time; old saves have no rows", () => {
		const world = { ...newWorld(56), gameTime: 48 * 3600 };
		const commander = newCommanderRecord("courier");
		commander.state.ownedEquipment = [LONG_RANGE_SCANNER];
		commander.sweepReadings = sweepSources(world, 0, 0);
		const saved = parseSave(serializeSave({ world, commander }));
		expect(saved.commander.sweepReadings).toEqual(commander.sweepReadings);
		expect(
			sweepAge(commander.sweepReadings[0], world.gameTime + 3600),
		).toContain("STALE");
		expect(sweepAge(commander.sweepReadings[0], world.gameTime)).not.toContain(
			"STALE",
		);
		expect(
			parseSave(
				serializeSave({ world, commander: newCommanderRecord("courier") }),
			).commander.sweepReadings,
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
			expect(() => parseSweepReadings([{ ...row, ...change }], world)).toThrow(
				"sweep",
			);
		expect(() => parseSweepReadings([row, row], world)).toThrow("sweep");
	});
	test("a fresh sweep replaces this system only; a past reading ages unchanged", () => {
		const world = { ...newWorld(56), gameTime: 48 * 3600 };
		const rows = sweepSources(world, 0, 0);
		const elsewhere = sweepSources(world, 1, 1);
		expect(replaceSystemReadings([...rows, ...elsewhere], [], 0, 0)).toEqual(
			elsewhere,
		);
		expect(sweepAge(rows[0], world.gameTime + 60)).toContain("1m");
	});
	test("load refuses a relay absent from the generator and a region its subject never reports", () => {
		const world = { ...newWorld(56), gameTime: 48 * 3600 };
		const row = sweepSources(world, 0, 0).find((r) => r.kind === "relay")!;
		const absent = generateGalaxy(world.seed, 0).systems.find(
			(r) => !relayActive(r) && relayPlan(generateContents(r), r.seed),
		)!;
		const plan = relayPlan(generateContents(absent), absent.seed)!;
		expect(() =>
			parseSweepReadings(
				[
					{
						...row,
						id: `sweep:0:${absent.index}:relay-00`,
						systemIndex: absent.index,
						region: {
							kind: "station-surrounds",
							stationId: plan.watchedStationId,
						},
					},
				],
				world,
			),
		).toThrow("sweep");
		const otherStation = generateContents(
			generateGalaxy(world.seed, 0).systems[0],
		).stations.find(
			(s) =>
				row.region.kind === "station-surrounds" &&
				s.id !== row.region.stationId,
		)!;
		expect(otherStation).toBeDefined();
		expect(() =>
			parseSweepReadings(
				[
					{
						...row,
						region: { kind: "station-surrounds", stationId: otherStation.id },
					},
				],
				world,
			),
		).toThrow("sweep");
		for (const reading of sweepSources(world, 0, 0)) {
			const wrongRegion =
				reading.region.kind === "station-surrounds"
					? { kind: "system-space" }
					: row.region;
			expect(() =>
				parseSweepReadings([{ ...reading, region: wrongRegion }], world),
			).toThrow("sweep");
		}
	});
	test("load preserves dated provenance after the relay disappears", () => {
		const world = { ...newWorld(56), gameTime: 48 * 3600 };
		const rows = sweepSources(world, 0, 0);
		const later = applyTransition(world, 0, relaySlot(0).key, {
			// glossary-ignore: slot
			kind: "destroy",
			occurredAt: world.gameTime + 1,
			cause: {
				causeKind: "player-weapons",
				actorId: "player",
				playerRole: "direct",
			},
		});
		later.gameTime = world.gameTime + 3600;
		expect(sweepSources(later, 0, 0).some((r) => r.kind === "relay")).toBe(
			false,
		);
		expect(parseSweepReadings(rows, later)).toEqual(rows);
		expect(sweepAge(rows[0], later.gameTime)).toContain("STALE");
	});
	test("generated readings roundtrip across every system, with one pressure region rather than ships", () => {
		const world = { ...newWorld(56), gameTime: 48 * 3600 };
		for (let index = 0; index < 256; index++) {
			const readings = sweepSources(world, 0, index);
			expect(readings.filter((r) => r.kind === "pressure")).toHaveLength(1);
			expect(parseSweepReadings(readings, world)).toEqual(readings);
		}
	});
	test("view filters by galaxy and system and derives ages without refreshing provenance", () => {
		const world = { ...newWorld(56), gameTime: 48 * 3600 };
		const readings = [
			...sweepSources(world, 0, 0),
			...sweepSources(world, 1, 0),
		];
		const before = JSON.stringify(readings);
		const context = {
			fitted: true,
			flying: true,
			cruise: false,
			galaxyIndex: 0,
			systemIndex: 0,
			visible: true,
			charge: null,
			status: "Ready",
		};
		const panel = sweepPanel(
			readings,
			world.gameTime + 3600,
			world.seed,
			context,
		);
		expect(panel.rows).toHaveLength(
			readings.filter((r) => r.galaxyIndex === 0).length,
		);
		expect(panel.rows.every((r) => r.age.includes("STALE"))).toBe(true);
		expect(
			sweepPanel(readings, world.gameTime, world.seed, {
				...context,
				visible: false,
			}).rows,
		).toEqual([]);
		expect(JSON.stringify(readings)).toBe(before);
		expect(sweepCompletion(0)).toContain("no signal regions found");
		expect(sweepCompletion(1)).toContain("1 region recorded");
		expect(sweepCompletion(2)).toContain("2 regions recorded");
	});
});
