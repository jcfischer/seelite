/** Node #734: loss provenance and lifecycle, with no discovery side effect. */
import { carrierKey } from "./carrier-key";
import { carrierInstanceSeed } from "./carrier-standing";
import { derelictSlots, DERELICT_SALVAGER_S } from "./derelict-slots";
import { derelictPose } from "./derelict";
import { DOMAIN } from "./domains";
import {
	SALVAGE_OFFER_WINDOW_S,
	canPostJobs,
	type SalvageTarget,
} from "./jobs";
import { derelictRegion } from "./long-range-scanner";
import type { RequestsState } from "./requests";
import { seededRand } from "./rng";
import type { System } from "./sim";
import { effectiveDerelict, type WorldState } from "./world-state";

export function salvageTargetsOf(
	world: WorldState,
	system: System,
	at: number,
): SalvageTarget[] {
	const { record, contents } = system;
	const stations = contents.stations.filter(canPostJobs);
	if (!stations.length) return [];
	return derelictSlots(record.index, record.government).flatMap(({ key }) => {
		const row = effectiveDerelict(world, record.galaxy, key, at);
		if (
			row.condition !== "destroyed" ||
			at >= row.lostAt + SALVAGE_OFFER_WINDOW_S
		)
			return [];
		const rand = seededRand(
			carrierInstanceSeed(
				record.seed,
				key,
				row.instanceOrdinal,
				DOMAIN.DERELICT_HOME,
			),
		);
		const station =
			stations[
				Math.min(stations.length - 1, Math.floor(rand() * stations.length))
			];
		return [
			{
				slotKey: key,
				instanceOrdinal: row.instanceOrdinal,
				lostAt: row.lostAt,
				containers: row.containers,
				homeStationKey: carrierKey(record.index, station.localCarrierId),
				region: derelictRegion(
					system,
					derelictPose(system, key, row.instanceOrdinal, at),
				),
			},
		];
	});
}

/** Read lazily when Requests is read. A scooped lot survives every later fate
 * of its wreck; an unscooped obligation cannot survive the salvager deadline. */
export function refreshSalvageRequests(
	state: RequestsState,
	world: WorldState,
	at: number,
): RequestsState {
	let byId: RequestsState["byId"] | null = null;
	let tracked = state.trackedRequestId;
	for (const request of Object.values(state.byId)) {
		const op = request.terms.operand;
		if (
			request.status !== "accepted" ||
			op.kind !== "salvage" ||
			Object.values(state.entrustedByLotId).some(
				(l) =>
					l.offerId === request.offerId &&
					l.issuedOrdinal === request.acceptanceOrdinal,
			)
		)
			continue;
		if (at < request.terms.observedAt + DERELICT_SALVAGER_S) continue;
		const wreck = effectiveDerelict(
			world,
			request.terms.requester.galaxyIndex,
			op.slotKey,
			at,
		);
		if (
			wreck.condition === "destroyed" &&
			wreck.instanceOrdinal === op.instanceOrdinal
		)
			continue;
		byId ??= { ...state.byId };
		byId[request.offerId] = {
			...request,
			status: "failed",
			outcomeReason:
				"Wreck taken by salvagers. Cancelled free; you owe nothing.",
		};
		if (tracked === request.offerId) tracked = null;
	}
	return byId ? { ...state, byId, trackedRequestId: tracked } : state;
}
