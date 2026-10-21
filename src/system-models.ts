import { carrierKey } from "./carrier-key";
import type { HullId } from "./hull";
import type { Galaxy } from "./galaxy";
import {
	buildHaulerPlans,
	inboundCandidates,
	type ContentsQuery,
} from "./inter-system-traffic";
import {
	isAuthoredHullModel,
	stationModel,
	type ModelId,
} from "./model-catalog";
import { systemFields } from "./asteroid-field";
import type { System } from "./sim";

/** Complete seeded home and inbound roster, including currently distant ships. */
export function trafficRosterHulls(
	galaxy: Galaxy,
	index: number,
	contentsFor: ContentsQuery,
): HullId[] {
	return [
		...buildHaulerPlans(galaxy, index, contentsFor),
		...inboundCandidates(galaxy, index, contentsFor),
	].map((p) => p.actor.hullId);
}

/** A fresh pilot's home is the trade station; a docked save names its own.
 * Procedural exteriors need no file. No other model may block ordinary boot. */
export function bootModelIds(
	system: System,
	dockedAt: string | null,
): ModelId[] {
	const home = dockedAt
		? system.contents.stations.find(
				(s) => carrierKey(system.record.index, s.localCarrierId) === dockedAt,
			)
		: system.contents.stations.find((s) => s.type === "trade");
	const exterior = home && stationModel(home);
	return exterior ? ["cockpit", exterior] : ["cockpit"];
}

/** Traffic comes from the game's complete home + inbound candidate roster,
 * not merely the contacts materialised near the pilot this frame. */
export function systemModelIds(
	system: System,
	trafficHulls: readonly HullId[],
	flownHull: HullId,
): ModelId[] {
	const ids = new Set<ModelId>(["cockpit"]);
	for (const station of system.contents.stations) {
		const id = stationModel(station);
		if (id) ids.add(id);
	}
	for (const hull of [flownHull, ...trafficHulls])
		if (isAuthoredHullModel(hull)) ids.add(hull);
	if (system.contents.stations.length) ids.add("interiors");
	if (systemFields(system.record, system.contents).length) ids.add("asteroids");
	return [...ids];
}
