/** Node #733: only a flown identification gives a contact. Sweep provenance
 * stays in system-sweep.ts. Headless, in float64 kilometres on the world clock. */
import type { DisplayContact } from "./display-contact";
import { HULL_SPECS } from "./hull";
import type { CarrierKey } from "./carrier-key";
import { derelictSlots } from "./derelict-slots"; // glossary-ignore: slot
import { derelictPose, deathWreckPose } from "./derelict";
import { systemIndexOfKey } from "./carrier-key";
import {
	relayScannerFitted,
	RELAY_IDENTIFY_RANGE_KM,
	relaySignal,
} from "./pirate-relay";
import type { System } from "./sim";
import type { Vec3 } from "./vec3";
import { length, sub } from "./vec3";
import {
	effectiveDerelict,
	observeDerelict,
	readKnowledge,
	type WorldState,
} from "./world-state";

export const DERELICT_VISUAL_FLOOR_KM = 10;
export function liveDerelicts(world: WorldState, system: System, at: number) {
	const record = system.record;
	// glossary-ignore: slot
	const live = derelictSlots(record.index, record.government).flatMap(
		({ key }) => {
			const row = effectiveDerelict(world, record.galaxy, key, at);
			return row.condition === "destroyed"
				? [
						{
							key,
							row,
							pose: derelictPose(system, key, row.instanceOrdinal, at),
						},
					]
				: [];
		},
	);
	const own = world.galaxies[record.galaxy].deathWreck;
	if (own && systemIndexOfKey(own.key) === record.index) {
		const row = effectiveDerelict(world, record.galaxy, own.key, at);
		if (row.condition === "destroyed")
			live.push({ key: own.key, row, pose: deathWreckPose(system, own, at) });
	}
	return live;
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

export type DerelictReading = ReturnType<typeof derelictReadings>[number];

/** Identification alone makes a live wreck a presentation contact. */
export function wreckContact(reading: DerelictReading): DisplayContact | null {
	if (!reading.identified) return null;
	const { key, pose } = reading;
	const env = HULL_SPECS[pose.hull].env;
	return {
		id: key,
		name: `${key.endsWith(":commander-wreck") ? "Own wreck" : "Derelict"} ${pose.hull}`,
		kind: "wreck",
		color: 0xbfa77c,
		pos: { ...pose.pos },
		velocity: { ...pose.vel },
		radiusKm: Math.hypot(env.beamKm, env.heightKm, env.lengthKm) / 2,
		standing: null,
		scannerClass: "unknown",
		condition: "destroyed",
		shipType: pose.hull,
	};
}

export function derelictRegion(
	system: System,
	pose: ReturnType<typeof derelictPose>,
): string {
	const body = system.bodies.find((b) => b.id === pose.bodyId);
	return `Near ${body?.name ?? "local body"}`;
}

/** The same proximity gate is read by the runtime pre-check and knowledge writer. */
export const identifyRangeKm = (modules: readonly string[]): number =>
	relayScannerFitted(modules)
		? RELAY_IDENTIFY_RANGE_KM
		: DERELICT_VISUAL_FLOOR_KM;

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
	const floor = identifyRangeKm(modules);
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
