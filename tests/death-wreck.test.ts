import {
	migrateEquipment,
	equipmentNames,
	stockLoadout,
	moduleRow,
} from "../src/loadout";
import { expect, test } from "bun:test";
import {
	deathWreckContents,
	deathWreckRow,
	clearStationWreck,
} from "../src/death-wreck";
import { deathWreckPose, tetherOffset, wreckFramePose } from "../src/derelict";
import { AVOID_CLEARANCE_KM } from "../src/combat-enemy";
import { RELAY_LOCAL_CARRIER_ID, relayPlan } from "../src/relay-slot"; // glossary-ignore: slot
import { relayPosition, relayVelocity } from "../src/pirate-relay";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import {
	newWorld,
	withDeathWreck,
	advanceTo,
	observeDerelict,
	observe,
	observeScan,
	observeSystemRelay,
	type WorldState,
} from "../src/world-state";
import type { DeathCause } from "../src/death-cost";
import type { CommanderRecord } from "../src/save-envelope";
import {
	makeWorld,
	advanceSystem,
	bodyVelocity,
	stationApertureFrame,
} from "../src/sim";
import { proxyReachKm, stationProxyOf } from "../src/station-proxy";
import { corridorRadiusKm } from "../src/station-interior";
import { scoopWreckContainer } from "../src/derelict-salvage";
import { sweepSources, parseSweepReadings } from "../src/system-sweep";
import {
	SaveStore,
	memorySaveBackend,
	memorySlotLocks,
} from "../src/save-store";
import { fnv1a } from "../src/rng";
import { requestAction, entrustedTonnesAboard } from "../src/requests";
import { generateGalaxy } from "../src/galaxy";
import { firstOffer } from "./helpers/job-board";
import { liveDerelicts, derelictReadings } from "../src/long-range-scanner";
import { applyHoldEvent, holdingsAfterDeath } from "../src/holdings";
import {
	scoopCargo,
	recoverWreckCargo,
	commanderHold,
	type CommanderState,
} from "../src/station-commerce";
import { EQUIPMENT, COMMODITIES, ESCAPE_POD } from "../src/market";
import { PURCHASABLE_HULL_IDS } from "../src/hull";
import { DEATH_WRECK_MAX_CONTAINERS } from "../src/world-state";
import { emptyPending } from "../src/ladder";
import { v3, add, sub, scale, dot, length } from "../src/vec3";

const system = makeWorld(47).system;
const worldAfterDeath = (
	world: WorldState,
	dying: CommanderRecord,
	cause: DeathCause,
	frameId?: string,
) =>
	holdingsAfterDeath(dying, { world, commander: dying }, cause, frameId).world;
const dying = {
	...newCommanderRecord("courier", { systemIndex: system.record.index }),
	state: {
		...newCommanderRecord("courier").state,
		cargo: { Food: 8, Gold: 12 },
		loadout: migrateEquipment("courier", [
			"Escape Pod",
			"Docking Computer",
			"Fuel Scoops",
		]).loadout,
	},
	flight: {
		...newCommanderRecord("courier").flight,
		pos: [1e8, 2e8, 3e8] as const,
	},
};
/** The fixtures' death time: the first clock from 10 at which every owned item
 * of `dying` survives its destroyed-cause draw and a later eject still leaves
 * cargo. Found rather than written, so a new DOMAIN tag or a retuned share
 * moves the fixture instead of emptying it — tag 35 became 36 in a merge, and
 * at 10 the new draws kept nothing. */
const DEATH_AT = (() => {
	for (let at = 10; at < 90; at++)
		if (
			deathWreckContents(47, at, dying.state, "destroyed").length === 4 &&
			deathWreckContents(47, at + 10, dying.state, "eject").length > 0
		)
			return at;
	throw Error("no fixture death time in [10, 90)");
})();
test("Holdings returns the restored commander beside the dying inventory's wreck for either cause", () => {
	const dock = { ...dying, state: { ...dying.state, cargo: { Textiles: 7 } } };
	const world = { ...newWorld(47), gameTime: DEATH_AT };
	for (const cause of ["destroyed", "eject"] as const) {
		const outcome = holdingsAfterDeath(
			dock,
			{ world, commander: dying },
			cause,
			system.contents.star.id,
		);
		expect(outcome.world.galaxies[0].deathWreck?.containers).toEqual(
			deathWreckContents(47, DEATH_AT, dying.state, cause),
		);
		expect(outcome.commander.state.cargo).toEqual({});
		expect(equipmentNames(outcome.commander.state.loadout)).toEqual(
			cause === "eject"
				? ["Extra Pulse Laser", "Docking Computer", "Fuel Scoops"]
				: ["Extra Pulse Laser"],
		);
		parseSave(serializeSave(outcome));
	}
});

test("wreck recovery takes native kg/g units with a full hold and updates basis while ordinary canisters refuse", () => {
	const full = {
		...dying.state,
		cargo: { Food: 20, Gold: 2, Platinum: 4, "Gem-Stones": 3 },
	};
	for (const good of ["Gold", "Platinum", "Gem-Stones"] as const) {
		const refused = scoopCargo(full, good, 12, 0);
		expect(refused.accepted).toBe(false);
		expect(refused.commander).toBe(full);
		expect(refused.tonnes).toBe(0);
		const scooped = recoverWreckCargo(full, good, 12, 0);
		expect(scooped.accepted).toBe(true);
		expect(scooped.tonnes).toBe(12);
		expect(scooped.commander.cargo[good]).toBe(full.cargo[good] + 12);
		expect(commanderHold(scooped.commander, 0).usedT).toBe(20);
		const world = worldAfterDeath(
			{ ...newWorld(47), gameTime: DEATH_AT },
			dying,
			"destroyed",
		);
		const wreck = world.galaxies[0].deathWreck!;
		wreck.containers = [
			{
				kind: "good",
				id: good,
				tonnes: 12,
				left: 12,
				unit: good === "Gem-Stones" ? "g" : "kg",
			},
		];
		const holdings = {
			commander: full,
			requests: dying.requests,
			ladders: {
				...dying.ladders,
				basis: {
					[good]: { units: full.cargo[good], cr: 30 },
				},
			},
			ladderPending: emptyPending(),
		};
		const pose = { pos: v3(), vel: v3() };
		const outcome = applyHoldEvent(holdings, world, {
			kind: "wreck-scoop",
			key: wreck.key,
			galaxyIndex: 0,
			instanceOrdinal: wreck.instanceOrdinal,
			containerIndex: 0,
			at: DEATH_AT,
			container: pose,
			ship: pose,
		});
		expect(outcome.holdings.commander).toEqual(scooped.commander);
		expect(outcome.holdings.ladders.basis[good]).toEqual({
			units: scooped.commander.cargo[good],
			cr: 30,
		});
		expect(outcome.world.galaxies[0].deathWreck).toBeUndefined();
	}
});

test("schema 12 persists explicit native units and refuses missing or mismatched units", () => {
	const world = worldAfterDeath(
		{ ...newWorld(47), gameTime: DEATH_AT },
		dying,
		"destroyed",
	);
	const row = world.galaxies[0].deathWreck!;
	row.containers = [
		{ kind: "good", id: "Food", tonnes: 8, left: 3, unit: "t" },
		{ kind: "good", id: "Gold", tonnes: 12, left: 7, unit: "kg" },
		{ kind: "good", id: "Platinum", tonnes: 9, left: 4, unit: "kg" },
		{ kind: "good", id: "Gem-Stones", tonnes: 6, left: 2, unit: "g" },
		{ kind: "fitting", id: "Docking Computer", tonnes: 1, left: 1, unit: "t" },
	];
	const saved = serializeSave({ world, commander: dying }) as any;
	// On the wire a death container's quantity is `amount`, because it is in
	// `unit`. A derelict row keeps `tonnes`: it is tonnes, and schema 9 shipped it.
	expect(Object.values(saved.world.galaxies[0].deathWreck.containers)).toEqual(
		row.containers.map(({ tonnes, ...c }) => ({ ...c, amount: tonnes })),
	);
	expect(parseSave(saved).world.galaxies[0].deathWreck?.containers).toEqual(
		row.containers,
	);
	const misnamed = structuredClone(saved);
	for (const c of Object.values(
		misnamed.world.galaxies[0].deathWreck.containers,
	) as { amount?: number; tonnes?: number }[]) {
		c.tonnes = c.amount;
		delete c.amount;
	}
	const { integrity: misnamedWorld, ...misnamedWorldBody } = misnamed.world;
	misnamed.world.integrity = fnv1a(JSON.stringify(misnamedWorldBody));
	const { integrity: misnamedSave, ...misnamedSaveBody } = misnamed;
	misnamed.integrity = fnv1a(JSON.stringify(misnamedSaveBody));
	expect(() => parseSave(misnamed)).toThrow("amount");
	for (let index = 0; index < row.containers.length; index++) {
		for (const unit of [
			undefined,
			"lb",
			...["t", "kg", "g"].filter((u) => u !== row.containers[index].unit),
		]) {
			const bad = structuredClone(saved);
			const item = bad.world.galaxies[0].deathWreck.containers[index];
			if (unit === undefined) delete item.unit;
			else item.unit = unit;
			const { integrity: worldIntegrity, ...worldBody } = bad.world;
			bad.world.integrity = fnv1a(JSON.stringify(worldBody));
			const { integrity: saveIntegrity, ...saveBody } = bad;
			bad.integrity = fnv1a(JSON.stringify(saveBody));
			expect(() => parseSave(bad)).toThrow("unit");
		}
	}
});

test("every purchasable hull's largest container inventory fits the death row bound", () => {
	const fittings = EQUIPMENT.filter((e) => e.name !== ESCAPE_POD).map(
		(e) => e.name,
	);
	const cargo = Object.fromEntries(
		COMMODITIES.filter((c) => c.unit !== "t").map((c) => [c.name, 1000]),
	);
	for (const hull of PURCHASABLE_HULL_IDS) {
		const state: CommanderState = {
			...newCommanderRecord(hull).state,
			loadout: migrateEquipment(hull, fittings).loadout,
			cargo,
		};
		const capacity = commanderHold(state, 0).capacityT;
		state.recoveredFittings = Array.from({ length: capacity }, () => ({
			id: "Docking Computer",
			tonnes: 1,
		}));
		expect(commanderHold(state, 0).usedT).toBe(capacity);
		// One recovered fitting per tonne maximises row count; a cargo lot
		// using the same tonne cannot add another container.
		expect(
			capacity + fittings.length + Object.keys(cargo).length,
		).toBeLessThanOrEqual(DEATH_WRECK_MAX_CONTAINERS);
		for (let at = 10; at < 15; at++) {
			const commander = { ...dying, state };
			const world = worldAfterDeath(
				{ ...newWorld(47), gameTime: at },
				commander,
				"destroyed",
			);
			expect(
				world.galaxies[0].deathWreck!.containers.length,
			).toBeLessThanOrEqual(DEATH_WRECK_MAX_CONTAINERS);
			parseSave(serializeSave({ world, commander }));
		}
	}
});
test("per-item death draws are deterministic, independent of list order and other inventory", () => {
	const draw = deathWreckContents(47, 10, dying.state, "destroyed");
	expect(deathWreckContents(47, 10, dying.state, "destroyed")).toEqual(draw);
	const reordered = {
		...dying.state,
		cargo: { Gold: 12, Food: 8 },
		loadout: Object.fromEntries(Object.entries(dying.state.loadout).reverse()),
	};
	expect(deathWreckContents(47, 10, reordered, "destroyed")).toEqual(draw);
	for (let at = 0; at < 100; at++) {
		const original = deathWreckContents(47, at, dying.state, "destroyed");
		const extra = deathWreckContents(
			47,
			at,
			{ ...dying.state, cargo: { ...dying.state.cargo, Textiles: 3 } },
			"destroyed",
		);
		expect(extra.filter((c) => c.id !== "Textiles")).toEqual(original);
		expect(
			original.some((c) => c.id === "Escape Pod" || c.id === "courier"),
		).toBe(false);
		expect(
			deathWreckContents(47, at, dying.state, "eject").every(
				(c) => c.kind === "good",
			),
		).toBe(true);
	}
	const survivors = Array.from({ length: 1000 }, (_, at) =>
		deathWreckContents(47, at, dying.state, "destroyed"),
	);
	for (const id of ["Food", "Gold", "Docking Computer", "Fuel Scoops"]) {
		const count = survivors.filter((cs) => cs.some((c) => c.id === id)).length;
		expect(count).toBeGreaterThan(420);
		expect(count).toBeLessThan(580);
	}
});
test("re-observing an own-loss wreck preserves its death-time knowledge and save round-trip", () => {
	const world = worldAfterDeath(
		{ ...newWorld(47), gameTime: DEATH_AT },
		dying,
		"destroyed",
	);
	const row = world.galaxies[0].deathWreck!;
	const knowledge = world.galaxies[0].knowledge[row.key];
	for (const observed of [
		observeDerelict(world, 0, row.key, DEATH_AT + 10, "visual identification"),
		observe(world, 0, row.key, DEATH_AT + 10, "revisit"),
		observeScan(world, 0, row.key, DEATH_AT + 10, {
			instanceOrdinal: row.instanceOrdinal,
			voyageOrdinal: 0,
		}),
		observeSystemRelay(world, 0, [row.key], DEATH_AT + 10),
	]) {
		expect(observed.galaxies[0].knowledge[row.key]).toEqual(knowledge);
		const saved = parseSave(
			serializeSave({ world: observed, commander: dying }),
		);
		expect(saved.world.galaxies[0].knowledge[row.key]).toEqual(knowledge);
		expect(saved.world.galaxies[0].deathWreck).toEqual(row);
	}
});

test("one own-loss wreck persists without expiry, follows the death frame and is replaced", () => {
	const world = worldAfterDeath(
		{ ...newWorld(47), gameTime: DEATH_AT },
		dying,
		"destroyed",
		system.contents.star.id,
	);
	const row = world.galaxies[0].deathWreck!;
	expect(row).toBeDefined();
	expect(world.galaxies[0].knowledge[row.key].source).toBe("own loss");
	expect(deathWreckPose(system, row, DEATH_AT).pos).toEqual(v3(1e8, 2e8, 3e8));
	const saved = parseSave(serializeSave({ world, commander: dying }));
	expect(saved.world.galaxies[0].deathWreck).toEqual(row);
	expect(liveDerelicts(world, system, 1e7).some((w) => w.key === row.key)).toBe(
		true,
	);
	expect(
		derelictReadings(world, system, v3(), [], DEATH_AT).find(
			(w) => w.key === row.key,
		)?.identified,
	).toBe(true);
	const next = worldAfterDeath(
		{ ...world, gameTime: DEATH_AT + 10 },
		{ ...dying, galaxyIndex: 1, systemIndex: 4 },
		"eject",
	);
	expect(next.galaxies.filter((g) => g.deathWreck)).toHaveLength(1);
	expect(next.galaxies[0].knowledge[row.key]).toBeUndefined();
});
test("the Holdings wreck scoop recovers goods and fittings once and removes a stripped death wreck", () => {
	let world = worldAfterDeath(
		{ ...newWorld(47), gameTime: DEATH_AT },
		dying,
		"destroyed",
		system.contents.star.id,
	);
	const wreck = world.galaxies[0].deathWreck!;
	let holdings = {
		commander: newCommanderRecord("courier").state,
		requests: dying.requests,
		ladders: dying.ladders,
		ladderPending: emptyPending(),
	};
	for (let i = 0; i < wreck.containers.length; i++) {
		const at = { pos: v3(), vel: v3() };
		const event = {
			kind: "wreck-scoop" as const,
			key: wreck.key,
			galaxyIndex: 0,
			instanceOrdinal: wreck.instanceOrdinal,
			containerIndex: i,
			at: DEATH_AT,
			container: at,
			ship: at,
		};
		const outcome = applyHoldEvent(holdings, world, event);
		expect(outcome.signals.wreckScoop?.tonnes).toBe(wreck.containers[i].left);
		world = outcome.world;
		holdings = outcome.holdings;
		expect(
			applyHoldEvent(holdings, world, event).signals.wreckScoop?.tonnes ?? 0,
		).toBe(0);
	}
	expect(world.galaxies[0].deathWreck).toBeUndefined();
	expect(holdings.commander.loadout).toEqual(stockLoadout("courier"));
	parseSave(
		serializeSave({
			world,
			commander: {
				...dying,
				state: holdings.commander,
				ladders: holdings.ladders,
			},
		}),
	);
});

test("a body-frame death follows that body over time; station deaths clear keep-out and corridor", () => {
	const station = system.contents.stations[0];
	advanceSystem(system, DEATH_AT);
	const centre = system.byId.get(station.id)!.pos;
	const atStation = {
		...dying,
		flight: { ...dying.flight, pos: [centre.x, centre.y, centre.z] as const },
	};
	const world = worldAfterDeath(
		{ ...newWorld(47), gameTime: DEATH_AT },
		atStation,
		"destroyed",
		station.id,
	);
	const row = world.galaxies[0].deathWreck!;
	const frame = stationApertureFrame(system, station.id, DEATH_AT);
	const delta = row.offset;
	const margin = length(tetherOffset(row.hull, 0)) + AVOID_CLEARANCE_KM;
	expect(length(delta)).toBeGreaterThanOrEqual(
		proxyReachKm(stationProxyOf(station)) + margin - 1e-6,
	);
	expect(
		length(sub(delta, scale(frame.axis, dot(delta, frame.axis)))),
	).toBeGreaterThanOrEqual(corridorRadiusKm(frame.aperture) + margin - 1e-6);
	for (let i = 0; i < row.containers.length; i++) {
		const tether = add(delta, tetherOffset(row.hull, i));
		expect(length(tether)).toBeGreaterThan(
			proxyReachKm(stationProxyOf(station)) + AVOID_CLEARANCE_KM,
		);
		expect(
			length(sub(tether, scale(frame.axis, dot(tether, frame.axis)))),
		).toBeGreaterThan(corridorRadiusKm(frame.aperture) + AVOID_CLEARANCE_KM);
	}
	const later = deathWreckPose(system, row, 100);
	advanceSystem(system, 100);
	expect(sub(later.pos, system.byId.get(station.id)!.pos)).toEqual(row.offset);
	expect(later.vel).toEqual(bodyVelocity(system, station.id, 100));
	const p = clearStationWreck(v3(0, 0, 10), {
		centre: v3(),
		axis: v3(0, 0, 1),
		reference: v3(1, 0, 0),
		radius: 2,
		corridor: 1,
	});
	expect(p).toEqual(v3(1, 0, 10));
	const q = clearStationWreck(v3(), {
		centre: v3(),
		axis: v3(0, 0, 1),
		reference: v3(1, 0, 0),
		radius: 2,
		corridor: 1,
	});
	expect(length(q)).toBeCloseTo(2);
	expect(q.x).toBe(1);
});

test("the own-loss writer advances the world, refuses stale writes and clears an empty replacement atomically", () => {
	const before = newWorld(47);
	const row = deathWreckRow(
		{ ...before, gameTime: DEATH_AT },
		dying,
		"destroyed",
	)!;
	const written = withDeathWreck(before, 0, row, DEATH_AT);
	const advanced = advanceTo(before, DEATH_AT);
	expect(written.gameTime).toBe(DEATH_AT);
	expect(written.galaxies[0].objective).toEqual(advanced.galaxies[0].objective);
	expect(written.galaxies[0].episodes).toEqual(advanced.galaxies[0].episodes);
	expect(before.galaxies[0].deathWreck).toBeUndefined();
	expect(before.galaxies[0].knowledge[row.key]).toBeUndefined();
	expect(() => withDeathWreck(written, 0, row, DEATH_AT - 1)).toThrow(
		"before the clock",
	);
	expect(() => withDeathWreck(written, 8, row, DEATH_AT)).toThrow();
	const cleared = withDeathWreck(written, 1, undefined, DEATH_AT + 10);
	expect(cleared.gameTime).toBe(DEATH_AT + 10);
	expect(cleared.galaxies.some((g) => g.deathWreck)).toBe(false);
	expect(cleared.galaxies[0].knowledge[row.key]).toBeUndefined();
	expect(written.galaxies[0].deathWreck).toEqual(row);
	parseSave(serializeSave({ world: cleared, commander: dying }));
});

test("cached wreck frames retain both step endpoints and track the relay orbit", () => {
	const plan = relayPlan(system.contents, system.record.seed)!;
	expect(plan).toBeDefined();
	for (const at of [10, 11, 10]) {
		const frame = wreckFramePose(system, RELAY_LOCAL_CARRIER_ID, at);
		expect(wreckFramePose(system, RELAY_LOCAL_CARRIER_ID, at)).toBe(frame);
		expect(frame.pos).toEqual(relayPosition(plan, system.contents, at));
		expect(frame.vel).toEqual(relayVelocity(plan, system.contents, at));
	}
	const world = worldAfterDeath(
		{ ...newWorld(47), gameTime: DEATH_AT },
		dying,
		"destroyed",
		RELAY_LOCAL_CARRIER_ID,
	);
	const own = liveDerelicts(world, system, DEATH_AT).find(
		(w) => w.key === world.galaxies[0].deathWreck!.key,
	)!;
	expect(own.poseAt(DEATH_AT + 1)).toEqual(
		deathWreckPose(system, world.galaxies[0].deathWreck!, DEATH_AT + 1),
	);
});

test("creation enforces the container bound before a death outcome can be serialized", () => {
	const state = {
		...dying.state,
		recoveredFittings: Array.from(
			{ length: DEATH_WRECK_MAX_CONTAINERS * 4 },
			() => ({ id: "Docking Computer", tonnes: 1 }),
		),
	};
	expect(() => deathWreckContents(47, 10, state, "destroyed")).toThrow(
		"containers exceeds 512",
	);
});

test("death scoop honors speed, partial tonnes, whole fittings and native kg/g without extra hold tonnage", () => {
	const row = {
		instanceOrdinal: 0,
		lostAt: 0,
		containers: [
			{ kind: "good" as const, id: "Food", tonnes: 8, left: 8 },
			{ kind: "good" as const, id: "Gold", tonnes: 12, left: 12 },
			{ kind: "fitting" as const, id: "Docking Computer", tonnes: 1, left: 1 },
		],
	};
	const pose = { pos: v3(), vel: v3() };
	const full = { ...dying.state, cargo: { Food: 19 } };
	const partial = scoopWreckContainer(row, 0, full, 0, pose, pose, 1);
	expect(partial.tonnes).toBe(1);
	expect(partial.row.containers[0].left).toBe(7);
	const kg = scoopWreckContainer(row, 1, partial.commander, 0, pose, pose, 1);
	expect(kg.commander.cargo.Gold).toBe(12);
	expect(
		scoopWreckContainer(row, 2, kg.commander, 0, pose, pose, 1).refusal,
	).toContain("0 t free");
	expect(
		scoopWreckContainer(
			row,
			1,
			full,
			0,
			pose,
			{ pos: v3(), vel: v3(2, 0, 0) },
			1,
		).tonnes,
	).toBe(0);
});

test("schema 11 migrates empty and refuses a grafted death wreck; malformed new rows refuse", () => {
	const raw = serializeSave({ world: newWorld(47), commander: dying }) as any;
	raw.saveSchemaVersion = 11;
	raw.commander.state.ownedEquipment = [];
	delete raw.commander.state.loadout;
	const { integrity, ...body } = raw;
	raw.integrity = fnv1a(JSON.stringify(body));
	expect(parseSave(raw).world.galaxies.every((g) => !g.deathWreck)).toBe(true);
	const world = worldAfterDeath(
		{ ...newWorld(47), gameTime: DEATH_AT },
		dying,
		"destroyed",
	);
	const saved = serializeSave({ world, commander: dying }) as any;
	for (const mutate of [
		(r: any) => {
			r.saveSchemaVersion = 11;
			r.commander.state.ownedEquipment = [];
			delete r.commander.state.loadout;
		},
		(r: any) => {
			r.world.galaxies[1].deathWreck = structuredClone(
				r.world.galaxies[0].deathWreck,
			);
		},
		(r: any) => {
			r.world.galaxies[0].deathWreck.bodyId = "missing-frame";
		},
		(r: any) => {
			r.world.galaxies[0].deathWreck.containers[0].id = "Escape Pod";
			r.world.galaxies[0].deathWreck.containers[0].kind = "fitting";
		},
		(r: any) => {
			r.world.galaxies[0].deathWreck.lostAt = DEATH_AT + 1;
		},
		(r: any) => {
			r.world.galaxies[0].deathWreck.containers[0].amount = 0;
		},
		(r: any) => {
			const item = r.world.galaxies[0].deathWreck.containers[0];
			item.left = item.amount + 1;
		},
		(r: any) => {
			const row = r.world.galaxies[0].deathWreck;
			row.containers = Object.fromEntries(
				Array.from({ length: DEATH_WRECK_MAX_CONTAINERS + 1 }, (_, i) => [
					i,
					{ ...row.containers[0] },
				]),
			);
		},
	]) {
		const bad = structuredClone(saved);
		mutate(bad);
		// Check schema/row refusals, rather than merely a stale checksum.
		const { integrity: worldIntegrity, ...worldBody } = bad.world;
		bad.world.integrity = fnv1a(JSON.stringify(worldBody));
		const { integrity: saveIntegrity, ...saveBody } = bad;
		bad.integrity = fnv1a(JSON.stringify(saveBody));
		expect(() => parseSave(bad)).toThrow();
	}
});

test("sweep provenance names an own wreck but remains valid after it disappears", () => {
	const world = worldAfterDeath(
		{ ...newWorld(47), gameTime: DEATH_AT },
		dying,
		"destroyed",
	);
	const hasOwnWreck = (w: WorldState, systemIndex = dying.systemIndex) =>
		sweepSources(w, 0, systemIndex).some((r) =>
			r.id.endsWith(":commander-wreck"),
		);
	expect(hasOwnWreck({ ...newWorld(47), gameTime: DEATH_AT })).toBe(false);
	expect(hasOwnWreck(world, (dying.systemIndex + 1) % 256)).toBe(false);
	expect(hasOwnWreck(withDeathWreck(world, 0, undefined, DEATH_AT))).toBe(
		false,
	);
	const readings = sweepSources(world, 0, dying.systemIndex);
	expect(hasOwnWreck(world)).toBe(true);
	expect(
		parseSweepReadings(readings, { ...newWorld(47), gameTime: DEATH_AT }),
	).toEqual(readings);
});

test("SaveStore writes the dying leg's owned cargo, not launch cargo or entrusted Requests lots", async () => {
	const backend = memorySaveBackend();
	const launch = {
		...dying,
		state: { ...dying.state, cargo: { Textiles: 7 } },
	};
	await backend.write(
		"death-test",
		"lastDocked",
		serializeSave({ world: newWorld(47), commander: launch }),
	);
	const envelope = {
		world: { ...newWorld(47), gameTime: DEATH_AT },
		commander: dying,
	};
	const store = new SaveStore({
		locks: memorySlotLocks(),
		schedule: () => () => {},
		backend,
		slot: "death-test", // glossary-ignore: slot
		current: () => envelope,
	});
	const restored = await store.revertToLastDocked(
		dying,
		"destroyed",
		system.contents.star.id,
	);
	expect(restored?.world.galaxies[0].deathWreck?.containers).toEqual(
		deathWreckContents(47, DEATH_AT, dying.state, "destroyed"),
	);
	expect(
		restored?.world.galaxies[0].deathWreck?.containers.some(
			(c) => c.id === "Textiles",
		),
	).toBe(false);
	expect(restored?.commander.state.cargo).toEqual({});
});

test("entrusted lots never enter either death cause's wreck", () => {
	const { offers, offer } = firstOffer(
		generateGalaxy(47, 0).systems,
		"courier",
	);
	const accepted = requestAction(dying.requests, offers, "accept", offer.id, {
		now: 60,
		docked: {
			galaxyIndex: offer.requester.galaxyIndex,
			carrierKey: offer.requester.carrierKey,
		},
		cargo: {},
		holdRoomT: 200,
		standing: "clean",
		equipment: [],
	});
	expect(accepted.ok).toBe(true);
	expect(entrustedTonnesAboard(accepted.state)).toBeGreaterThan(0);
	for (const cause of ["destroyed", "eject"] as const) {
		for (let at = 60; at < 160; at++) {
			const withLots = worldAfterDeath(
				{ ...newWorld(47), gameTime: at },
				{ ...dying, requests: accepted.state },
				cause,
			);
			const ownedOnly = worldAfterDeath(
				{ ...newWorld(47), gameTime: at },
				dying,
				cause,
			);
			expect(withLots).toEqual(ownedOnly);
		}
	}
});
