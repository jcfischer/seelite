/** Node #733: a sweep gives provenance; only a flown identification gives a
 * contact. Headless, in the sim's float64 kilometres and authoritative clock. */
import type { CarrierKey } from "./carrier-key";
import { derelictSlots } from "./derelict-slots";
import { derelictPose } from "./derelict";
import {
	relayActive,
	relayScannerFitted,
	RELAY_IDENTIFY_RANGE_KM,
	relaySignal,
} from "./pirate-relay";
import { relayPlan, relaySlot } from "./relay-slot";
import type { System } from "./sim";
import type { Vec3 } from "./vec3";
import { length, sub } from "./vec3";
import {
	effectiveCarrier,
	effectiveDerelict,
	observeDerelict,
	readKnowledge,
	replaceSystemLeads,
	type RegionLead,
	type WorldState,
} from "./world-state";

export const DERELICT_VISUAL_FLOOR_KM = 10;
export const SWEEP_CHARGE_S = 10;
export const SWEEP_SOURCE = "Long-Range Scanner sweep";

export function stepSweep(
	elapsed: number,
	dt: number,
	modules: readonly string[],
) {
	if (!relayScannerFitted(modules)) return { elapsed: 0, complete: false };
	const next = Math.min(SWEEP_CHARGE_S, elapsed + Math.max(0, dt));
	return { elapsed: next, complete: next >= SWEEP_CHARGE_S };
}

export function liveDerelicts(world: WorldState, system: System, at: number) {
	const record = system.record;
	return derelictSlots(record.index, record.government).flatMap(({ key }) => {
		const row = effectiveDerelict(world, record.galaxy, key, at);
		return row.condition === "destroyed"
			? [{ key, row, pose: derelictPose(system, key, row.instanceOrdinal, at) }]
			: [];
	});
}

export function derelictReadings(
	world: WorldState,
	system: System,
	shipPos: Vec3,
	modules: readonly string[],
	at: number,
) {
	return liveDerelicts(world, system, at).map((wreck) => {
		const known = readKnowledge(
			world.galaxies[system.record.galaxy],
			wreck.key,
		);
		return {
			...wreck,
			km: length(sub(wreck.pose.pos, shipPos)),
			identified:
				known?.observedCondition === "destroyed" &&
				known.observedInstanceOrdinal === wreck.row.instanceOrdinal,
			signal: relayScannerFitted(modules)
				? relaySignal(shipPos, wreck.pose.pos)
				: null,
		};
	});
}

export function identifyDerelicts(
	world: WorldState,
	system: System,
	shipPos: Vec3,
	modules: readonly string[],
	at: number,
) {
	let next = world;
	const identified: CarrierKey[] = [];
	const fitted = relayScannerFitted(modules);
	const floor = fitted ? RELAY_IDENTIFY_RANGE_KM : DERELICT_VISUAL_FLOOR_KM;
	for (const wreck of derelictReadings(world, system, shipPos, modules, at)) {
		if (wreck.identified || wreck.km > floor) continue;
		next = observeDerelict(
			next,
			system.record.galaxy,
			wreck.key,
			at,
			fitted ? "scanner identification" : "visual identification",
		);
		identified.push(wreck.key);
	}
	return { world: next, identified };
}

export function sweepSystem(
	world: WorldState,
	system: System,
	modules: readonly string[],
	at: number,
): WorldState {
	if (!relayScannerFitted(modules)) return world;
	const rows: Record<CarrierKey, RegionLead> = {};
	for (const wreck of liveDerelicts(world, system, at)) {
		const body = system.bodies.find((b) => b.id === wreck.pose.bodyId);
		rows[wreck.key] = {
			kind: "derelict",
			region: `Near ${body?.name ?? "local body"}`,
			observedAt: at,
			source: SWEEP_SOURCE,
		};
	}
	const record = system.record;
	const plan = relayActive(record)
		? relayPlan(system.contents, record.seed)
		: null;
	const key = relaySlot(record.index).key;
	if (
		plan &&
		effectiveCarrier(world.galaxies[record.galaxy], key, at).condition ===
			"operational"
	) {
		const watched = system.contents.stations.find(
			(s) => s.id === plan.watchedStationId,
		);
		rows[key] = {
			kind: "relay",
			region: `Approach of ${watched?.name ?? "watched station"}`,
			observedAt: at,
			source: SWEEP_SOURCE,
		};
	}
	return replaceSystemLeads(world, record.galaxy, record.index, at, rows);
}
