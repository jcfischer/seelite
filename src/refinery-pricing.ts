/**
 * The refinery's market price for one quote, and the one submit path that can
 * be re-run over a checkpoint snapshot (node #1195).
 *
 * `refinery.ts` owns the queue arithmetic and imports nothing that could reach
 * a world; this module joins it to a generated refinery, the market that prices
 * the product and the commander who owns the ore. It is kept out of
 * `world-state.ts`'s import graph on purpose: `station-commerce.ts` reaches
 * `ladder.ts`, which imports `world-state.ts`, so a world import of this file
 * would close a cycle.
 *
 * https://github.com/jcfischer/seelite/issues/1195
 */

import {
	type CarrierKey,
	carrierKey,
	isCarrierKey,
	systemIndexOfKey,
} from "./carrier-key";
import { accountOf, nativeGrams, withAccount } from "./commodity-pools";
import { massFromNative, quoteFromNumber, quoteMass } from "./exact-amount";
import { systemAt } from "./galaxy";
import {
	commodity,
	commodityStockResponse,
	marketQuote,
	marketRow,
	marketStationOf,
} from "./market";
import { oreGood } from "./ore-goods";
import { entrustedTonnesAboard } from "./requests";
import type { CommanderRecord } from "./save-envelope";
import { commanderHold } from "./station-commerce";
import { generateContents } from "./system";
import {
	refineryCollect,
	refineryFeePerTonne,
	refineryQuote,
	refineryRefusal,
	refinerySubmit,
	type RefineryQuote,
	type RefineryRefusal,
	type RefineryCollected,
	type RefinerySubmitted,
} from "./refinery";
import {
	stationServices,
	withRefineryQueue,
	type WorldState,
} from "./world-state";
import { readDeficit } from "./deficits";

export interface RefineryEnvelope {
	world: WorldState;
	commander: CommanderRecord;
}

export type RefineryResult =
	| { ok: true; quote: RefineryQuote }
	| RefineryRefusal;

const notRefinery = (): RefineryRefusal => refineryRefusal("not-refinery");

/**
 * One quote for one refinery, re-derived from the envelope alone.
 *
 * That is what lets `SaveStore.commit` re-run the op over its checkpoint
 * snapshot: the fee is this envelope's market price, not a number remembered
 * from the frame the button was pressed.
 */
export function refineryQuoteAt(
	envelope: RefineryEnvelope,
	galaxyIndex: number,
	stationKey: CarrierKey,
	good: string,
	tonnes: number,
): RefineryResult {
	const at = envelope.world.gameTime;
	if (!isCarrierKey(stationKey)) return notRefinery();
	const record = systemAt(
		envelope.world.seed,
		galaxyIndex,
		systemIndexOfKey(stationKey),
	);
	const station = generateContents(record).stations.find(
		(candidate) =>
			carrierKey(record.index, candidate.localCarrierId) === stationKey,
	);
	if (!station || station.type !== "refinery") return notRefinery();
	const ore = oreGood(good);
	if (!ore) return refineryRefusal("unknown-good");
	const product = commodity(ore.product);
	const market = marketStationOf(station, envelope.world.seed);
	const gameTimeMin = at / 60;
	const hold = commanderHold(
		envelope.commander.state,
		entrustedTonnesAboard(envelope.commander.requests),
	);
	const deficit = readDeficit(
		envelope.world.galaxies[galaxyIndex].deficits,
		stationKey,
		product.name,
		gameTimeMin,
	);
	const base = marketRow(product, record.economy, market, gameTimeMin);
	const mid = commodityStockResponse(
		product,
		base.priceCr,
		deficit,
		hold.capacityT,
	);
	const { sellCr } = marketQuote(mid, record.displayTL);
	const unitValue = quoteMass(
		quoteFromNumber(sellCr),
		massFromNative(ore.yieldGPerT, 1),
		nativeGrams(product.name),
	);
	const services = stationServices(envelope.world, galaxyIndex, stationKey, at);
	return refineryQuote({
		station: stationKey,
		queue: envelope.world.galaxies[galaxyIndex].refineries[stationKey],
		oreAboard: envelope.commander.state.cargo[good] ?? 0,
		cash: accountOf(envelope.commander.state).cash,
		offline: services.exclusive === false,
		good,
		tonnes,
		feePerTonne: refineryFeePerTonne(unitValue),
	});
}

export type RefinerySubmitResult =
	| { ok: true; envelope: RefineryEnvelope }
	| RefineryRefusal;

/**
 * The commit's `apply`: recompute the quote, refuse a changed one, and move
 * the ore, the fee and the job into one candidate envelope. Pure over its
 * argument, so the store may call it again on a checkpoint snapshot.
 */
export function submitRefineryEnvelope(
	envelope: RefineryEnvelope,
	galaxyIndex: number,
	quote: RefineryQuote,
	at = envelope.world.gameTime,
): RefinerySubmitResult {
	const fresh = refineryQuoteAt(
		envelope,
		galaxyIndex,
		quote.station,
		quote.good,
		quote.tonnes,
	);
	if (!fresh.ok) return fresh;
	if (fresh.quote.signature !== quote.signature)
		return refineryRefusal("stale-quote");
	const submitted: RefinerySubmitted | RefineryRefusal = refinerySubmit({
		account: accountOf(envelope.commander.state),
		queue: envelope.world.galaxies[galaxyIndex].refineries[quote.station],
		quote: fresh.quote,
		at,
	});
	if (!submitted.ok) return submitted;
	return {
		ok: true,
		envelope: {
			world: withRefineryQueue(
				envelope.world,
				galaxyIndex,
				quote.station,
				submitted.queue,
			),
			commander: {
				...envelope.commander,
				state: withAccount(envelope.commander.state, submitted.account),
			},
		},
	};
}

/** Whole native units of `product` the pilot's hold admits (kg and g goods take no hold). */
export function collectionRoomUnits(
	commander: CommanderRecord,
	product: string,
): number {
	if (commodity(product).unit !== "t") return Number.POSITIVE_INFINITY;
	const hold = commanderHold(
		commander.state,
		entrustedTonnesAboard(commander.requests),
	);
	return Math.max(0, Math.floor(hold.capacityT - hold.usedT));
}

export type RefineryCollectResult =
	| { ok: true; envelope: RefineryEnvelope; units: number }
	| RefineryRefusal;

/**
 * The commit's `apply` for a collection: pure over its argument, so the store
 * may run it again on a checkpoint snapshot. A zero-fit collection refuses,
 * which is what keeps it from writing a save. An outage does not refuse one
 * (#921 D6), so no service is read.
 */
export function collectRefineryEnvelope(
	envelope: RefineryEnvelope,
	galaxyIndex: number,
	stationKey: CarrierKey,
	product: string,
): RefineryCollectResult {
	if (!isCarrierKey(stationKey)) return notRefinery();
	const queue = envelope.world.galaxies[galaxyIndex].refineries[stationKey];
	const collected: RefineryCollected | RefineryRefusal = refineryCollect({
		account: accountOf(envelope.commander.state),
		queue,
		product,
		roomUnits: collectionRoomUnits(envelope.commander, product),
	});
	if (!collected.ok) return collected;
	return {
		ok: true,
		units: collected.units,
		envelope: {
			world: withRefineryQueue(
				envelope.world,
				galaxyIndex,
				stationKey,
				collected.queue,
			),
			commander: {
				...envelope.commander,
				state: withAccount(envelope.commander.state, collected.account),
			},
		},
	};
}
