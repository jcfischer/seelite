/** Node #734: loss provenance and Operational condition, with no discovery side effect. */
import { carrierKey } from "./carrier-key";
import { carrierInstanceSeed } from "./carrier-standing";
import { derelictSlots, DERELICT_SALVAGER_S } from "./derelict-slots";
import { derelictPose } from "./derelict";
import { DOMAIN } from "./domains";
import {
	SALVAGE_OFFER_WINDOW_S,
	SALVAGE_PAY_FACTOR,
	canPostJobs,
	matchesSalvageItem,
	salvageItemPrice,
	type BindContext,
	type JobOffer,
	type SalvageOperand,
	type SalvageTarget,
} from "./jobs";
import { derelictRegion } from "./long-range-scanner";
import type { RequestsState } from "./requests";
import { seededRand } from "./rng";
import type { System } from "./sim";
import {
	type EffectiveDerelict,
	effectiveDerelict,
	type WorldState,
} from "./world-state";

export type SalvagePosting = Pick<BindContext, "system" | "station">;

/** Revalidate the loss and pin the act's price using the caller's dock context. */
export function repriceSalvageOffer(
	world: WorldState,
	offer: JobOffer & { operand: SalvageOperand },
	at: number,
	holdT: number,
	posting: SalvagePosting | undefined,
): JobOffer | null {
	const op = offer.operand;
	const wreck = effectiveDerelict(
		world,
		offer.requester.galaxyIndex,
		op.slotKey,
		at,
	);
	const container =
		wreck.condition === "destroyed"
			? wreck.containers[op.containerIndex]
			: null;
	if (
		wreck.condition !== "destroyed" ||
		wreck.instanceOrdinal !== op.instanceOrdinal ||
		!container ||
		!matchesSalvageItem({ ...container, tonnes: container.left }, op.item) ||
		at >= offer.observedAt + SALVAGE_OFFER_WINDOW_S
	)
		return null;
	if (
		!posting ||
		posting.system.galaxy !== offer.requester.galaxyIndex ||
		carrierKey(posting.system.index, posting.station.localCarrierId) !==
			offer.requester.carrierKey
	)
		return null;
	const priceCr = salvageItemPrice(
		{
			...posting,
			deficits: world.galaxies[offer.requester.galaxyIndex].deficits,
			gameTimeMin: at / 60,
			holdT,
		},
		op.item,
	);
	return {
		...offer,
		operand: { ...op, item: { ...op.item, priceCr } },
		rewardCr: SALVAGE_PAY_FACTOR * priceCr,
	};
}

/**
 * Whether the station that lost this instance still posts it: inside the offer
 * window after the loss, and only for a loss on the clock. A slot's first
 * instance can be lost before game time 0 (S16, node #775), and an offer is
 * stamped with its loss, which no journal can hold before zero — so a wreck
 * already adrift when the clock started is free salvage from the start.
 */
const offerOpen = (
	row: Extract<EffectiveDerelict, { condition: "destroyed" }>,
	at: number,
): boolean => row.lostAt >= 0 && at < row.lostAt + SALVAGE_OFFER_WINDOW_S;

/** The cheap board facts; frame pose and lead region are derived only on a miss. */
export function salvageBoardKey(
	world: WorldState,
	system: System,
	at: number,
): string {
	const { record } = system;
	return derelictSlots(record.index, record.government)
		.flatMap(({ key }) => {
			const row = effectiveDerelict(world, record.galaxy, key, at);
			return row.condition === "destroyed" && offerOpen(row, at)
				? [
						`${key}:${row.instanceOrdinal}:${row.containers.map((c) => c.left).join(",")}`,
					]
				: [];
		})
		.join(";");
}

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
		if (row.condition !== "destroyed" || !offerOpen(row, at)) return [];
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

/** Refreshed by the game clock. A scooped lot survives every later fate
 * of its wreck; an unscooped obligation cannot survive the salvager deadline. */
export function refreshSalvageRequests(
	state: RequestsState,
	world: WorldState,
	at: number,
): RequestsState {
	const accepted = Object.values(state.byId).filter(
		(r) => r.status === "accepted" && r.terms.operand.kind === "salvage",
	);
	if (!accepted.length) return state;
	const issued = new Set(
		Object.values(state.entrustedByLotId).map(
			(l) => `${l.offerId}#${l.issuedOrdinal}`,
		),
	);
	let byId: RequestsState["byId"] | null = null;
	let tracked = state.trackedRequestId;
	for (const request of accepted) {
		const op = request.terms.operand;
		if (
			request.status !== "accepted" ||
			op.kind !== "salvage" ||
			issued.has(`${request.offerId}#${request.acceptanceOrdinal}`)
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
