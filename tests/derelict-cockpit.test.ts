import { expect, test, spyOn } from "bun:test";
import { derelictPose, tetherOffset } from "../src/derelict";
import { scoopWreckContainer } from "../src/derelict-salvage";
import { derelictSlots, derelictFirstLossAt } from "../src/derelict-slots";
import { HULL_SPECS, PURCHASABLE_HULL_IDS } from "../src/hull";
import { makeWorld, advanceSystem } from "../src/sim";
import { newCommander, commanderHold } from "../src/station-commerce";
import {
	CANISTER_SCOOP_RADIUS_KM,
	CANISTER_SCOOP_SPEED_KMS,
} from "../src/raider-wreck";
import { length, sub, v3, rotateAbout } from "../src/vec3";
import { applyHoldEvent } from "../src/holdings";
import { emptyRequests } from "../src/requests";
import { emptyLadderRecord, emptyPending } from "../src/ladder";
import {
	newWorld,
	effectiveDerelict,
	advanceTo,
	scoopDerelict,
} from "../src/world-state";
import {
	newCommanderRecord,
	serializeSave,
	parseSave,
} from "../src/save-envelope";

const system = makeWorld(47).system;
const key = derelictSlots(system.record.index, system.record.government)[0].key;
const container = { kind: "good" as const, id: "Food", tonnes: 8, left: 8 };
const row = { instanceOrdinal: 0, lostAt: 0, containers: [container] };
const pose = { pos: v3(), vel: v3() };
test("the shared gate takes only what fits and returns the unchanged refusal", () => {
	const hold = { ...newCommander("courier"), cargo: { Food: 18 } };
	const took = scoopWreckContainer(row, 0, hold, 0, pose, pose, 1);
	expect(took.tonnes).toBe(2);
	expect(took.row.containers[0].left).toBe(6);
	expect(took.commander.cargo.Food).toBe(20);
	expect(row.containers[0].left).toBe(8);
	const refused = scoopWreckContainer(
		took.row,
		0,
		took.commander,
		0,
		pose,
		pose,
		2,
	);
	expect(refused.row).toBe(took.row);
	expect(refused.commander).toBe(took.commander);
	expect(refused.refusal).toContain("0 t free");
	for (const ship of [
		{ pos: v3(CANISTER_SCOOP_RADIUS_KM * 1.01, 0, 0), vel: v3() },
		{ pos: v3(), vel: v3(CANISTER_SCOOP_SPEED_KMS * 1.01, 0, 0) },
	])
		expect(scoopWreckContainer(row, 0, hold, 0, pose, ship, 1).tonnes).toBe(0);
});
test("a recovered fitting is a hold item rather than fitted equipment", () => {
	const r = {
		...row,
		containers: [
			{ kind: "fitting" as const, id: "Military Laser", tonnes: 1, left: 1 },
		],
	};
	const out = scoopWreckContainer(
		r,
		0,
		newCommander("courier"),
		0,
		pose,
		pose,
		1,
	);
	expect(out.commander.recoveredFittings).toEqual([
		{ id: "Military Laser", tonnes: 1 },
	]);
	expect(out.commander.ownedEquipment).toEqual([]);
	expect(commanderHold(out.commander, 0).usedT).toBe(1);
	expect(out.row.salvaged?.at).toBe(1);
});
test("a multi-tonne fitting refuses partial room and recovers exactly one whole item", () => {
	const fittingRow = {
		...row,
		containers: [
			{ kind: "fitting" as const, id: "Military Laser", tonnes: 3, left: 3 },
		],
	};
	const commander = { ...newCommander("courier"), cargo: { Food: 18 } };
	const refused = scoopWreckContainer(
		fittingRow,
		0,
		commander,
		0,
		pose,
		pose,
		1,
	);
	expect(refused.tonnes).toBe(0);
	expect(refused.row).toBe(fittingRow);
	expect(refused.commander).toBe(commander);
	expect(refused.refusal).toContain("2 t free");
	expect(refused.refusal).toContain("3 t");
	const took = scoopWreckContainer(
		fittingRow,
		0,
		{ ...commander, cargo: { Food: 17 } },
		0,
		pose,
		pose,
		2,
	);
	expect(took.tonnes).toBe(3);
	expect(took.row.containers[0].left).toBe(0);
	expect(took.commander.recoveredFittings).toEqual([
		{ id: "Military Laser", tonnes: 3 },
	]);
	expect(
		scoopWreckContainer(took.row, 0, took.commander, 0, pose, pose, 3).tonnes,
	).toBe(0);
	const sale = transactAtStation({
		...commerce,
		commander: took.commander,
		action: { type: "sell-recovered", index: 0 },
	});
	expect(sale.accepted).toBe(true);
	expect(sale.commander.credits - took.commander.credits).toBe(
		EQUIPMENT.find((e) => e.name === "Military Laser")!.priceCr,
	);
	expect(
		transactAtStation({
			...commerce,
			commander: sale.commander,
			action: { type: "sell-recovered", index: 0 },
		}).accepted,
	).toBe(false);
});
test("Holdings reports adopted takes and refusals, while a stale wreck event has no scoop signal", () => {
	const at = derelictFirstLossAt(system.record.seed, key) + 1;
	const world = advanceTo(newWorld(47), at);
	const wreck = effectiveDerelict(world, 0, key, at);
	if (wreck.condition !== "destroyed") throw Error("no wreck");
	const hold = {
		commander: { ...newCommander("courier"), cargo: { Food: 19 } },
		requests: emptyRequests(),
		ladders: emptyLadderRecord(),
		ladderPending: emptyPending(),
	};
	const event = {
		kind: "wreck-scoop" as const,
		key,
		galaxyIndex: 0,
		containerIndex: 0,
		instanceOrdinal: wreck.instanceOrdinal,
		at,
		container: pose,
		ship: pose,
	};
	const took = applyHoldEvent(hold, world, event);
	expect(took.signals.wreckScoop).toEqual({
		commodity: wreck.containers[0].id,
		tonnes: 1,
		freeT: 1,
		leftT: wreck.containers[0].left - 1,
		refusal: null,
	});
	const refused = applyHoldEvent(took.holdings, took.world, event);
	expect(refused.holdings).toBe(took.holdings);
	expect(refused.world).toBe(took.world);
	expect(refused.signals.wreckScoop?.tonnes).toBe(0);
	expect(refused.signals.wreckScoop?.freeT).toBe(0);
	expect(refused.signals.wreckScoop?.refusal).toContain("0 t free");
	const stale = applyHoldEvent(hold, world, {
		...event,
		instanceOrdinal: wreck.instanceOrdinal + 1,
	});
	expect(stale.holdings).toBe(hold);
	expect(stale.world).toBe(world);
	expect(stale.signals.wreckScoop).toBeUndefined();
});
test("each tether gate clears the real hull proxies through sampled turns", () => {
	for (const hull of PURCHASABLE_HULL_IDS)
		for (const pilot of PURCHASABLE_HULL_IDS)
			for (let i = 0; i < 5; i++) {
				const offset = tetherOffset(hull, i);
				const spec = HULL_SPECS[hull];
				const pilotSpec = HULL_SPECS[pilot];
				const axis = scale(v3(1, 2, 3), 1 / Math.sqrt(14));
				const atGate = add(
					offset,
					scale(offset, -CANISTER_SCOOP_RADIUS_KM / length(offset)),
				);
				for (const phase of [0, 0.7, 2.1, 4.6]) {
					const attitude = (origin: ReturnType<typeof v3>, angle: number) =>
						shipPose(
							origin,
							rotateAbout(v3(0, 0, -1), axis, angle),
							rotateAbout(v3(0, 1, 0), axis, angle),
						);
					const swept = sweepShip(
						{
							primitives: [hullBox(pilotSpec.env, pilotSpec.envCentre)],
							start: attitude(offset, phase + 1),
							end: attitude(atGate, phase + 1.1),
							velStart: v3(),
							velEnd: v3(),
						},
						[
							{
								primitives: [hullBox(spec.env, spec.envCentre)],
								start: attitude(v3(), phase),
								end: attitude(v3(), phase + 0.1),
								velStart: v3(),
								velEnd: v3(),
							},
						],
						1,
					);
					expect(swept.impacts).toEqual([]);
					expect(length(sub(swept.pos, atGate))).toBeLessThan(1e-9);
				}
			}
});
test("pose follows the seeded body at the requested clock and tumbles slowly", () => {
	const a = derelictPose(system, key, 0, 100);
	const b = derelictPose(system, key, 0, 101);
	expect(a).toEqual(derelictPose(system, key, 0, 100));
	expect(a.bodyId).toBe(b.bodyId);
	expect(length(sub(a.pos, b.pos))).toBeGreaterThan(0);
	expect(length(sub(a.nose, b.nose))).toBeGreaterThan(0);
	advanceSystem(system, 999);
	expect(derelictPose(system, key, 0, 100)).toEqual(a);
});
test("the hold event writes the row and reloads remainder with the same hold", () => {
	const at = derelictFirstLossAt(system.record.seed, key) + 1;
	let world = advanceTo(newWorld(47), at);
	const e = effectiveDerelict(world, 0, key, at);
	if (e.condition !== "destroyed") throw Error("no wreck");
	const hold = {
		commander: { ...newCommander("courier"), cargo: { Food: 19 } },
		requests: emptyRequests(),
		ladders: emptyLadderRecord(),
		ladderPending: emptyPending(),
	};
	const out = applyHoldEvent(hold, world, {
		kind: "wreck-scoop",
		key,
		galaxyIndex: 0,
		containerIndex: 0,
		instanceOrdinal: e.instanceOrdinal,
		at,
		container: pose,
		ship: pose,
	});
	expect(out.holdings).not.toBe(hold);
	expect(out.world.galaxies[0].derelicts[key].containers[0].left).toBe(
		e.containers[0].left - 1,
	);
	const commander = {
		...newCommanderRecord("courier", { systemIndex: system.record.index }),
		state: out.holdings.commander,
		ladders: out.holdings.ladders,
	};
	const loaded = parseSave(serializeSave({ world: out.world, commander }));
	expect(loaded.commander.state).toEqual(commander.state);
	expect(loaded.world.galaxies[0].derelicts[key]).toEqual(
		out.world.galaxies[0].derelicts[key],
	);
});

import { TOP_RUNGS, bankTrade, ladderAfterMarket } from "../src/ladder";
import { transactAtStation, scoopCargo } from "../src/station-commerce";
import { marketStationOf, EQUIPMENT } from "../src/market";
import { commanderAfterDeath } from "../src/holdings";
import { fnv1a } from "../src/rng";
import { holdSummary, pilotGoods } from "../src/hold";
import { hullBox, shipPose, sweepShip } from "../src/collision";
import { add, scale } from "../src/vec3";
import { buildDerelictMesh, disposeDerelict } from "../src/derelict-mesh";
import { buildShipMesh } from "../src/ship-mesh";
import * as THREE from "three";

const recovered = {
	...newCommander("courier"),
	recoveredFittings: [{ id: "Military Laser", tonnes: 1 }],
};
const commerce = {
	commander: recovered,
	deficits: {},
	station: marketStationOf(
		{ type: "trade", localCarrierId: "station-trade", blackMarket: false },
		47,
	),
	stationKey: key,
	economy: 3,
	gameTimeMin: 0,
	displayTL: 0,
	entrustedT: 0,
	rungs: { combat: 0, trade: 0, exploration: 0 },
	hullReach: () => ({ ok: true, systems: 1 }) as const,
};
test("a locked recovered fitting sells at Equipment, fits only at its rung, and banks its sale", () => {
	const refused = transactAtStation({
		...commerce,
		action: { type: "fit-recovered", index: 0 },
	});
	expect(refused.accepted).toBe(false);
	expect(refused.reason).toBe("equipment-locked");
	expect(refused.commander).toBe(recovered);
	const sold = transactAtStation({
		...commerce,
		action: { type: "sell-recovered", index: 0 },
	});
	expect(sold.accepted).toBe(true);
	expect(sold.commander.recoveredFittings).toBeUndefined();
	const price = EQUIPMENT.find((e) => e.name === "Military Laser")!.priceCr;
	expect(sold.commander.credits - recovered.credits).toBe(price);
	expect(
		ladderAfterMarket(
			emptyLadderRecord(),
			{ type: "sell-recovered", index: 0 },
			recovered,
			sold.commander,
		).banked.trade,
	).toBe(price);
	const fitted = transactAtStation({
		...commerce,
		rungs: TOP_RUNGS,
		action: { type: "fit-recovered", index: 0 },
	});
	expect(fitted.accepted).toBe(true);
	expect(fitted.commander.ownedEquipment).toContain("Military Laser");
	expect(fitted.commander.credits).toBe(recovered.credits);
	expect(commanderHold(fitted.commander, 0).usedT).toBe(0);
});
test("carried fittings occupy every hold boundary and have a Hold line", () => {
	const full = { ...recovered, cargo: { Food: 19 } };
	expect(scoopCargo(full, "Food", 1, 0).accepted).toBe(false);
	expect(
		transactAtStation({
			...commerce,
			commander: { ...full, credits: 10000 },
			displayTL: 8,
			action: { type: "buy-commodity", commodity: "Food" },
		}).reason,
	).toBe("cargo-full");
	const summary = holdSummary(recovered, emptyRequests());
	expect(summary.usedT).toBe(1);
	expect(summary.lines[0].kind).toBe("fitting");
	expect(pilotGoods(summary)).toEqual({});
});
test("fitting items survive reload and legacy or malformed fitting rows refuse", () => {
	const record = { ...newCommanderRecord("courier"), state: recovered };
	const world = newWorld(47);
	const raw = serializeSave({ world, commander: record }) as any;
	expect(parseSave(raw).commander.state.recoveredFittings).toEqual(
		recovered.recoveredFittings,
	);
	const corrupt = (mutate: (r: any) => void) => {
		const copy = structuredClone(raw);
		mutate(copy);
		delete copy.integrity;
		copy.integrity = fnv1a(JSON.stringify(copy));
		return copy;
	};
	expect(() =>
		parseSave(
			corrupt(
				(r) => (r.commander.state.recoveredFittings[0].id = "Unknown module"),
			),
		),
	).toThrow("fitting items");
	expect(() =>
		parseSave(
			corrupt((r) => (r.commander.state.recoveredFittings[0].tonnes = -1)),
		),
	).toThrow("fitting items");
	expect(() =>
		parseSave(
			corrupt((r) => {
				r.saveSchemaVersion = 9;
				delete r.commander.sweepReadings;
			}),
		),
	).toThrow("not a version 9 field");
});
test("a death loses goods and carried fittings while its world keeps the strip", () => {
	const at = derelictFirstLossAt(system.record.seed, key) + 1;
	const world = advanceTo(newWorld(47), at);
	const e = effectiveDerelict(world, 0, key, at);
	if (e.condition !== "destroyed") throw Error("no wreck");
	const h = {
		commander: newCommander("courier"),
		requests: emptyRequests(),
		ladders: emptyLadderRecord(),
		ladderPending: emptyPending(),
	};
	const out = applyHoldEvent(h, world, {
		kind: "wreck-scoop",
		key,
		galaxyIndex: 0,
		containerIndex: 0,
		instanceOrdinal: e.instanceOrdinal,
		at,
		container: pose,
		ship: pose,
	});
	const dock = { ...newCommanderRecord("courier"), state: recovered };
	const dying = { ...dock, state: out.holdings.commander };
	for (const cause of ["destroyed", "eject"] as const) {
		const reverted = commanderAfterDeath(dock, dying, cause);
		expect(reverted.state.cargo).toEqual({});
		expect(reverted.state.recoveredFittings?.length ?? 0).toBe(0);
	}
	expect(out.world.galaxies[0].derelicts[key].containers[0].left).toBeLessThan(
		e.containers[0].left,
	);
});
test("a moving-frame wreck hull uses the live hull box and collision law", () => {
	const w = derelictPose(system, key, 0, 100);
	const next = derelictPose(system, key, 0, 101);
	const spec = HULL_SPECS[w.hull];
	const courier = HULL_SPECS.courier;
	const solid = {
		primitives: [hullBox(spec.env, spec.envCentre)],
		start: shipPose(w.pos, w.nose, w.up),
		end: shipPose(next.pos, next.nose, next.up),
		velStart: w.vel,
		velEnd: next.vel,
	};
	const start = add(w.pos, v3(1, 0, 0));
	const end = add(next.pos, v3(-1, 0, 0));
	const swept = sweepShip(
		{
			primitives: [hullBox(courier.env, courier.envCentre)],
			start: shipPose(start, v3(-1, 0, 0), v3(0, 1, 0)),
			end: shipPose(end, v3(-1, 0, 0), v3(0, 1, 0)),
			velStart: add(w.vel, v3(-2, 0, 0)),
			velEnd: add(next.vel, v3(-2, 0, 0)),
		},
		[solid],
		1,
	);
	expect(swept.impacts.length).toBeGreaterThan(0);
	expect(swept.impacts[0].closingKms).toBeLessThan(3);
	expect(swept.impacts[0].damage).toBeGreaterThan(0);
});
test("dark roster materials are isolated and the built envelope is unchanged", () => {
	const live = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
	const dark = buildDerelictMesh("courier");
	expect(
		new THREE.Box3().setFromObject(dark).getSize(new THREE.Vector3()),
	).toEqual(new THREE.Box3().setFromObject(live).getSize(new THREE.Vector3()));
	let darkMaterials = 0;
	dark.traverse((o) => {
		if (o.name === "nav-lights") expect(o.visible).toBe(false);
		if (
			o instanceof THREE.Mesh &&
			o.material instanceof THREE.MeshStandardMaterial
		) {
			expect(o.material.emissiveIntensity).toBe(0);
			darkMaterials++;
		}
	});
	expect(darkMaterials).toBeGreaterThan(0);
	// The first mesh anywhere under the root: the authored courier (node
	// #812) keeps its meshes in a frame group rather than as the root's own
	// children.
	let firstMesh: THREE.Mesh | undefined;
	live.traverse((o) => {
		if (!firstMesh && o instanceof THREE.Mesh) firstMesh = o;
	});
	const liveMaterial = (firstMesh as THREE.Mesh).material;
	dark.traverse((o) => {
		if (o instanceof THREE.Mesh) expect(o.material).not.toBe(liveMaterial);
	});
	disposeDerelict(dark);
});

import { PLANET_APPROACH_RADIUS } from "../src/planet-approach-boundary";
test("a seeded wreck and all its gates stand outside a planet's approach boundary", () => {
	for (let i = 0; i < 40; i++) {
		const p = derelictPose(system, key, i, 100);
		const body = system.byId.get(p.bodyId)!;
		if (body.kind === "planet")
			expect(length(p.offset)).toBeGreaterThan(
				body.radiusKm * PLANET_APPROACH_RADIUS +
					length(tetherOffset(p.hull, 0)) +
					CANISTER_SCOOP_RADIUS_KM,
			);
	}
});

import * as orbitalPlacement from "../src/system";
test("wrecks share one orbital placement per step end and reuse post-step poses", () => {
	const local = makeWorld(48).system;
	const keys = derelictSlots(local.record.index, local.record.government).map(
		(s) => s.key,
	);
	const solve = spyOn(orbitalPlacement, "placeBodies");
	try {
		const starts = keys.map((k) => derelictPose(local, k, 0, 101));
		const ends = keys.map((k) => derelictPose(local, k, 0, 102));
		expect(solve).toHaveBeenCalledTimes(2);
		keys.forEach((k, i) => {
			expect(derelictPose(local, k, 0, 101)).toBe(starts[i]);
			expect(derelictPose(local, k, 0, 102)).toBe(ends[i]);
		});
		expect(solve).toHaveBeenCalledTimes(2);
		derelictPose(local, keys[0], 1, 102);
		expect(solve).toHaveBeenCalledTimes(2);
		derelictPose(local, keys[0], 0, 103);
		expect(solve).toHaveBeenCalledTimes(3);
		derelictPose(local, keys[0], 0, 101);
		expect(solve).toHaveBeenCalledTimes(4);
	} finally {
		solve.mockRestore();
	}
});
test("a schema 9 save with a partially stripped derelict loads its world remainder", () => {
	const at = derelictFirstLossAt(system.record.seed, key) + 1;
	const initial = advanceTo(newWorld(47), at);
	const world = scoopDerelict(initial, 0, key, 0, 1, at);
	const commander = newCommanderRecord("courier", {
		systemIndex: system.record.index,
	});
	const { integrity: _, ...body } = serializeSave({
		world,
		commander,
	}) as Record<string, unknown>;
	delete (body.commander as Record<string, unknown>).sweepReadings;
	const legacy = { ...body, saveSchemaVersion: 9 };

	const loaded = parseSave({
		...legacy,
		integrity: fnv1a(JSON.stringify(legacy)),
	});
	const saved = world.galaxies[0].derelicts[key];
	expect(loaded.world.galaxies[0].derelicts[key]).toEqual(saved);
	expect(loaded.commander.state.recoveredFittings).toBeUndefined();
});
