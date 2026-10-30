import {
	migrateEquipment,
	equipmentNames,
	stockLoadout,
	moduleRow,
} from "../src/loadout";
import { describe, expect, test } from "bun:test";
import { LONG_RANGE_SCANNER } from "../src/market";
import { fnv1a } from "../src/rng";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
	SAVE_SCHEMA_VERSION,
} from "../src/save-envelope";
import {
	applyTransition,
	newWorld,
	enumerateCarriers,
	effectiveCarrier,
} from "../src/world-state";
import { generateGalaxy } from "../src/galaxy";
import { relayActive } from "../src/pirate-relay";
import { relayPlan, relaySlot, relayTenderSlot } from "../src/relay-slot"; // glossary-ignore: slot
import { generateContents } from "../src/system";
import {
	beginSweep,
	stepSweep,
	sweepRefusal,
	sweepSources,
	parseSweepReadings,
	SWEEP_CHARGE_S,
	sweepRemainingS,
	replaceSystemReadings,
	PRESSURE_HEAVY_CHANCE,
	PRESSURE_MODERATE_CHANCE,
	PRESSURE_STRENGTHS,
	pressureStrength,
	type SweepReading,
} from "../src/system-sweep";
import {
	PRESSURE_UNRECORDED,
	sweepAge,
	sweepCompletion,
	sweepPanel,
	sweepRegionLabel,
	sweepRowLabel,
} from "../src/system-sweep-view";
import { scheduleEncounter } from "../src/encounter";
import {
	RAIDER_REPAIR_S,
	RAIDER_WRECK_S,
	raiderDestruction,
} from "../src/raider-wreck";
import {
	raiderLegMeetChance,
	raiderSlotCount,
	raiderSlots,
} from "../src/raider-slots";

import { derelictNextLossAt, derelictSlots } from "../src/derelict-slots"; // glossary-ignore: slot

/** A clock at which seed 56's system 0 has a wreck adrift: its next loss. A
 *  system holds one about a fifth of the time (node #775), so a fixed hour
 *  would find one or not by luck. */
const WRECK_AT = (() => {
	const record = generateGalaxy(56, 0).systems[0];
	return (
		Math.min(
			...derelictSlots(record.index, record.government).map(({ key }) =>
				derelictNextLossAt(record.seed, key),
			),
		) + 1
	);
})();

describe("node #482 system sweep", () => {
	test("the new provenance has its own envelope revision", () => {
		expect(SAVE_SCHEMA_VERSION).toBe(17);
		const world = newWorld(56);
		const raw = serializeSave({
			world,
			commander: newCommanderRecord("courier"),
		}) as { commander: Record<string, unknown> };
		expect(raw.commander.sweepReadings).toEqual([]);
	});
	test("a verified v10 migrates empty without editing its original; a truncated v11 refuses", () => {
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
			body.saveSchemaVersion = 10;
			body.commander.state.ownedEquipment = [];
			delete body.commander.state.loadout;
			delete body.commander.sweepReadings;
			delete body.commander.txSeq;
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
					body.saveSchemaVersion = 10;
					body.commander.state.ownedEquipment = [];
					delete body.commander.state.loadout;
					delete body.commander.txSeq;
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
		expect(sweepRemainingS(null, 21)).toBeNull();
		expect(sweepRemainingS(begun, 10)).toBe(SWEEP_CHARGE_S);
		expect(sweepRemainingS(begun, 19.99)).toBe(1);
		expect(sweepRemainingS(begun, 21)).toBe(0);
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
	test("source reading is pure and finds active wrecks and one pressure region", () => {
		const world = { ...newWorld(56), gameTime: WRECK_AT };
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
	test("disabled ordinary carriers and the operational repair tender add no sweep sources", () => {
		let world = { ...newWorld(56), gameTime: WRECK_AT };
		const before = sweepSources(world, 0, 0);
		const ordinary = [...enumerateCarriers(world.seed, 0)].filter(
			(c) => c.systemIndex === 0 && c.kind === "traffic",
		);
		expect(ordinary.length).toBeGreaterThan(0);
		for (const carrier of ordinary) {
			world = applyTransition(world, 0, carrier.key, {
				kind: "disable",
				occurredAt: world.gameTime,
				cause: {
					causeKind: "player-weapons",
					actorId: "player",
					playerRole: "direct",
				},
			});
			expect(
				effectiveCarrier(world.galaxies[0], carrier.key, world.gameTime)
					.condition,
			).toBe("disabled");
		}
		const tender = relayTenderSlot(0); // glossary-ignore: slot
		expect(
			effectiveCarrier(world.galaxies[0], tender.key, world.gameTime).condition,
		).toBe("operational");
		const after = sweepSources(world, 0, 0);
		expect(after).toEqual(before);
		for (const carrier of [...ordinary, tender]) {
			expect(
				after.some((r) => r.id === `sweep:0:0:${carrier.localCarrierId}`),
			).toBe(false);
		}
	});
	test("saves roundtrip source, region and time; old saves have no rows", () => {
		const world = { ...newWorld(56), gameTime: WRECK_AT };
		const commander = newCommanderRecord("courier");
		commander.state.loadout = migrateEquipment(commander.state.hull, [
			LONG_RANGE_SCANNER,
		]).loadout;
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
		const world = { ...newWorld(56), gameTime: WRECK_AT };
		const row = sweepSources(world, 0, 0).find((r) => r.kind === "relay")!;
		for (const change of [
			{ source: "broker" },
			{ observedAt: world.gameTime + 1 },
			{ galaxyIndex: 8 },
			{ systemIndex: 999 },
			{ id: "other" },
			{ kind: "wreck" },
			{ confirmation: "identified" },
			{ region: { kind: "point", x: 1, y: 2, z: 3 } },
			{ region: { kind: "system-space", pos: { x: 1, y: 2, z: 3 } } },
			{ region: { kind: "station-surrounds", stationId: "missing" } },
			{ region: { kind: "station-surrounds", stationId: 1 } },
		])
			expect(() =>
				parseSweepReadings([{ ...row, ...change }], world, SAVE_SCHEMA_VERSION),
			).toThrow("sweep");
		expect(() =>
			parseSweepReadings([row, row], world, SAVE_SCHEMA_VERSION),
		).toThrow("sweep");
	});
	test("a fresh sweep replaces this system only; a past reading ages unchanged", () => {
		const world = { ...newWorld(56), gameTime: WRECK_AT };
		const rows = sweepSources(world, 0, 0);
		const elsewhere = sweepSources(world, 1, 1);
		expect(replaceSystemReadings([...rows, ...elsewhere], [], 0, 0)).toEqual(
			elsewhere,
		);
		expect(sweepAge(rows[0], world.gameTime + 60)).toContain("1m");
	});
	test("load refuses a relay absent from the generator", () => {
		const world = { ...newWorld(56), gameTime: WRECK_AT };
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
				SAVE_SCHEMA_VERSION,
			),
		).toThrow("sweep");
	});
	test("historical regions survive placement changes without refreshing provenance", () => {
		const world = { ...newWorld(56), gameTime: WRECK_AT };
		const rows = sweepSources(world, 0, 0);
		const row = rows.find((r) => r.kind === "relay")!;
		const otherStation = generateContents(
			generateGalaxy(world.seed, 0).systems[0],
		).stations.find(
			(s) =>
				row.region.kind === "station-surrounds" &&
				s.id !== row.region.stationId,
		)!;
		expect(otherStation).toBeDefined();
		// A pressure row with a recorded strength never names system space: the
		// build that recorded it names the cruise lanes instead (node #769).
		const historical: SweepReading[] = rows.map((reading) => ({
			...reading,
			region:
				reading.region.kind === "station-surrounds"
					? {
							kind:
								reading.kind === "pressure" ? "cruise-lanes" : "system-space",
						}
					: { kind: "station-surrounds", stationId: otherStation.id },
		}));
		historical.push({
			...row,
			region: { kind: "station-surrounds", stationId: otherStation.id },
		});
		const commander = newCommanderRecord("courier");
		// Each alternate region is accepted individually, while duplicate ids still refuse.
		for (const reading of historical) {
			commander.sweepReadings = [reading];
			const saved = serializeSave({ world, commander });
			world.gameTime += 1;
			expect(parseSave(saved).commander.sweepReadings).toEqual([reading]);
		}
	});
	test("load preserves dated provenance after the relay disappears", () => {
		const world = { ...newWorld(56), gameTime: WRECK_AT };
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
		expect(parseSweepReadings(rows, later, SAVE_SCHEMA_VERSION)).toEqual(rows);
		expect(sweepAge(rows[0], later.gameTime)).toContain("STALE");
	});
	test("generated readings roundtrip across every system, with one pressure region rather than ships", () => {
		const world = { ...newWorld(56), gameTime: WRECK_AT };
		for (let index = 0; index < 256; index++) {
			const readings = sweepSources(world, 0, index);
			expect(readings.filter((r) => r.kind === "pressure")).toHaveLength(1);
			expect(parseSweepReadings(readings, world, SAVE_SCHEMA_VERSION)).toEqual(
				readings,
			);
		}
	});
	test("view filters by galaxy and system and derives ages without refreshing provenance", () => {
		const world = { ...newWorld(56), gameTime: WRECK_AT };
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

describe("node #769 raider pressure strength and cruise lanes", () => {
	const law = (operational: number, government: number) => {
		const record = { seed: 0x769, government };
		const up = new Set(
			raiderSlots(0, government)
				.slice(0, operational)
				.map((s) => s.key),
		);
		let met = 0;
		const legs = 20000;
		for (let leg = 0; leg < legs; leg++)
			if (scheduleEncounter((k) => up.has(k), 0, record, leg, 0, "law")) met++;
		return met / legs;
	};
	test("the meet chance is what the leg law delivers, down slots included", () => {
		for (const [government, operational] of [
			[0, 4],
			[0, 1],
			[3, 2],
			[7, 1],
		])
			expect(
				Math.abs(
					law(operational, government) -
						raiderLegMeetChance(government, operational),
				),
			).toBeLessThan(0.015);
	});
	test("every reachable state sits clear of both edges, and full strength splits 0–2 / 3–5 / 6–7", () => {
		for (let government = 0; government <= 7; government++) {
			const count = raiderSlotCount(government);
			let last: number | null = null;
			for (let operational = 1; operational <= count; operational++) {
				const chance = raiderLegMeetChance(government, operational);
				for (const edge of [PRESSURE_HEAVY_CHANCE, PRESSURE_MODERATE_CHANCE])
					expect(Math.abs(chance - edge)).toBeGreaterThan(0.005);
				const rank = PRESSURE_STRENGTHS.indexOf(
					pressureStrength(government, operational),
				);
				if (last !== null) expect(rank).toBeGreaterThanOrEqual(last);
				last = rank;
			}
			expect(pressureStrength(government, count)).toBe(
				government <= 2 ? "heavy" : government <= 5 ? "moderate" : "light",
			);
		}
		// Accepted consequence: an anarchy that lost three raiders reads lighter
		// than it did, and as light as a lawful system.
		expect(pressureStrength(0, 1)).toBe("light");
	});
	test("a lawful system and an anarchy sweep to different strengths, and no outpost names the cruise lanes", () => {
		const world = { ...newWorld(56), gameTime: 48 * 3600 };
		const systems = generateGalaxy(world.seed, 0).systems;
		const pressure = (index: number) =>
			sweepSources(world, 0, index).find((r) => r.kind === "pressure")!;
		const anarchy = systems.find((r) => r.government === 0)!;
		const lawful = systems.find(
			(r) =>
				r.government >= 6 &&
				!generateContents(r).stations.some((s) => s.type === "outpost"),
		)!;
		const a = pressure(anarchy.index);
		const l = pressure(lawful.index);
		expect(a.strength).toBe("heavy");
		expect(l.strength).toBe("light");
		expect(l.region).toEqual({ kind: "cruise-lanes" });
		expect(sweepRegionLabel(l, world.seed)).toBe(
			`${lawful.name} · cruise lanes`,
		);
		for (const row of [a, l]) expect(sweepRowLabel(row)).not.toMatch(/\d/);
		expect(sweepRowLabel(a)).toBe("Heavy raider pressure");
		expect(sweepRowLabel(l)).toBe("Light raider pressure");
		// The outpost keeps its station name; the strength rides on the label.
		const outpostSystem = systems.find((r) =>
			generateContents(r).stations.some((s) => s.type === "outpost"),
		)!;
		expect(pressure(outpostSystem.index).region.kind).toBe("station-surrounds");
		for (let index = 0; index < 256; index++) {
			const row = pressure(index);
			expect(PRESSURE_STRENGTHS).toContain(row.strength!);
			expect(row.region.kind).not.toBe("system-space");
		}
	});
	test("down raider slots lower the strength until they recover, and a stored row keeps its reading", () => {
		const world = { ...newWorld(56), gameTime: 48 * 3600 };
		const record = generateGalaxy(world.seed, 0).systems.find(
			(r) => r.government === 0,
		)!;
		let later = world;
		for (const slot of raiderSlots(record.index, 0).slice(1))
			later = applyTransition(
				later,
				0,
				slot.key,
				raiderDestruction(record.index, world.gameTime),
			);
		const read = (w: typeof world) =>
			sweepSources(w, 0, record.index).find((r) => r.kind === "pressure")!
				.strength;
		const stored = sweepSources(world, 0, record.index);
		expect(read(world)).toBe("heavy");
		expect(read(later)).toBe("light");
		// Repairing is not operational; the replacement is.
		const at = (s: number) => ({ ...later, gameTime: world.gameTime + s });
		expect(read(at(RAIDER_WRECK_S + 1))).toBe("light");
		expect(read(at(RAIDER_WRECK_S + RAIDER_REPAIR_S + 1))).toBe("heavy");
		// Loading is not an observation: the stored row keeps what it read.
		expect(parseSweepReadings(stored, later, SAVE_SCHEMA_VERSION)).toEqual(
			stored,
		);
	});
	test("a current save refuses a missing, malformed or misplaced strength or cruise lanes", () => {
		const record = generateGalaxy(56, 0).systems[14];
		const gameTime =
			Math.min(
				...derelictSlots(record.index, record.government).map(({ key }) =>
					derelictNextLossAt(record.seed, key),
				),
			) + 1;
		const world = { ...newWorld(56), gameTime };
		const rows = sweepSources(world, 0, 14);
		const pressure = rows.find((r) => r.kind === "pressure")!;
		const wreck = rows.find((r) => r.kind === "wreck")!;
		expect(wreck).toBeDefined();
		expect(pressure.region).toEqual({ kind: "cruise-lanes" });
		const { strength: _, ...bare } = pressure;
		for (const row of [
			bare,
			{ ...pressure, strength: "extreme" },
			{ ...pressure, strength: 3 },
			{ ...pressure, strength: null },
			{ ...wreck, strength: "light" },
			{ ...wreck, region: { kind: "cruise-lanes" } },
			{ ...pressure, region: { kind: "cruise-lanes", pos: { x: 1 } } },
			// A recorded strength was read by a build that names the cruise
			// lanes, never system space.
			{ ...pressure, region: { kind: "system-space" } },
		])
			expect(() =>
				parseSweepReadings([row], world, SAVE_SCHEMA_VERSION),
			).toThrow("sweep");
		// A migrated row written back at the current version still loads.
		const migrated = {
			...bare,
			region: { kind: "system-space" as const },
			strength: null,
		};
		expect(parseSweepReadings([migrated], world, SAVE_SCHEMA_VERSION)).toEqual([
			migrated,
		]);
	});
	test.each([11, 12, 13, 14])(
		"a schema %i pressure row keeps its region and loads with no recorded strength",
		(version) => {
			const world = { ...newWorld(56), gameTime: 48 * 3600 };
			const current = sweepSources(world, 0, 14);
			const legacy = current.map(({ strength: _, ...r }) =>
				r.kind === "pressure"
					? { ...r, region: { kind: "system-space" as const } }
					: r,
			);
			const commander = newCommanderRecord("courier");
			const saved = serializeSave({ world, commander });
			const { integrity: _i, ...body } = JSON.parse(JSON.stringify(saved));
			body.saveSchemaVersion = version;
			delete body.commander.txSeq;
			if (version < 13) {
				body.commander.state.ownedEquipment = [];
				delete body.commander.state.loadout;
			} else if (version < 14) {
				for (const fitting of Object.values(body.commander.state.loadout))
					if (fitting && typeof fitting === "object")
						delete (fitting as { purchaseCostCr?: number }).purchaseCostCr;
			}
			body.commander.sweepReadings = legacy;
			const raw = { ...body, integrity: fnv1a(JSON.stringify(body)) };
			const original = JSON.stringify(raw);
			const loaded = parseSave(raw).commander.sweepReadings;
			expect(JSON.stringify(raw)).toBe(original);
			const row = loaded.find((r) => r.kind === "pressure")!;
			expect(row.strength).toBeNull();
			expect(row.region).toEqual({ kind: "system-space" });
			expect(sweepRowLabel(row)).toBe(PRESSURE_UNRECORDED);
			expect(loaded.filter((r) => r.kind !== "pressure")).toEqual(
				legacy.filter((r) => r.kind !== "pressure"),
			);
			// Written back at the current version and read again unchanged.
			expect(
				parseSave(
					serializeSave({
						world,
						commander: { ...commander, sweepReadings: loaded },
					}),
				).commander.sweepReadings,
			).toEqual(loaded);
			const legacyPressure = legacy.find((r) => r.kind === "pressure")!;
			for (const row of [
				{ ...legacyPressure, strength: "light" },
				{ ...legacyPressure, strength: null },
				{ ...legacyPressure, region: { kind: "cruise-lanes" } },
			])
				for (const version of [11, 12, 13, 14])
					expect(() => parseSweepReadings([row], world, version)).toThrow(
						"sweep",
					);
		},
	);
});
