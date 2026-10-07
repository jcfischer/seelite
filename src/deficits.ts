/**
 * §5.5's stock deficit: the mark the player leaves on a market, as saved.
 *
 * `economy-trade.md` §5.5 and `persistent-world-state.md` §7. Base prices stay
 * `f(stationSeed, epoch)` and are regenerated; this map is the rest of what a
 * market knows, and it is the first world state seelite cannot rebuild from a
 * seed.
 *
 * **It lived in `market.ts`, which is a pricing module**, and that module said
 * so in a comment rather than pretending otherwise. It was left there
 * deliberately by [#25](https://github.com/jcfischer/seelite/issues/25): the
 * map had one consumer and no owner, and a module with one consumer is a file
 * rather than a boundary. [#46](https://github.com/jcfischer/seelite/issues/46)
 * is what changed that — it built the persistence envelope, and
 * `world-state.ts` now imports `DeficitMap` and calls `parseDeficits` when it
 * reads a snapshot back. That is the second consumer, and the save is its whole
 * job. [#67](https://github.com/jcfischer/seelite/issues/67) is the move that
 * follows, and it finishes what #46 started: #46 took the canonical *key* out
 * of the pricing module on exactly this argument and left the rows that key
 * names behind.
 *
 * **The dependency runs from here to `market.ts` and not the other way.** What
 * moved is the map — the row, the key space, the drop rule and the parser.
 * `market.ts`'s §6–§7 divider is the one copy of why §5.2's arithmetic did not
 * come with it; restating any part of that argument here would be the second
 * copy the divider exists to avoid. `market.ts` imports nothing from this
 * file, and `tests/deficits.test.ts` is what keeps that true.
 *
 * `CarrierKey` is not re-exported here for the reason `carrier-key.ts` gives:
 * two import paths to one persisted identity is the coupling that leaf was
 * extracted to end.
 */

import { type CarrierKey, isCarrierKey } from "./carrier-key";
import { addDeficit, decayDeficit } from "./market";

/** §5.5: drop marks below half a unit, the shelf's rounding boundary.
 * A fresh one-unit trade must survive advancing game time (node #777).
 * The positive cutoff still bounds the lifetime of saved market memory. */
export const DEFICIT_DROP_UNITS = 0.5;

/**
 * One station's memory, as saved.
 *
 * `updatedAt` is game minutes, and it is per **row** rather than per good: the
 * whole row is decayed to the moment of any write, so one timestamp describes
 * every good in it. A per-good timestamp would be a second thing to keep in
 * step for no observable difference.
 */
export interface DeficitRow {
	/** Commodity name → units. Positive means the player bought (a thinner
	 *  shelf, a dearer price); negative means they sold. */
	goods: Record<string, number>;
	/** Game minutes at which `goods` was last brought up to date. */
	updatedAt: number;
}

/**
 * §5.5's sparse map, one galaxy's worth.
 *
 * Keyed by `carrierKey(systemIndex, localCarrierId)` — the envelope-relative
 * pair `persistent-world-state.md` §7 requires. **A bare `Station.id` is not a
 * save key**: it is system-local, so `station-trade` names one station in every
 * system in the galaxy.
 */
export type DeficitMap = Record<CarrierKey, DeficitRow>;

/** A row decayed to `gameTimeMin`, with marks below the cutoff dropped. */
const decayRow = (row: DeficitRow, gameTimeMin: number): DeficitRow => {
	const elapsed = Math.max(0, gameTimeMin - row.updatedAt);
	const goods: Record<string, number> = {};
	for (const [name, units] of Object.entries(row.goods)) {
		const decayed = decayDeficit(units, elapsed);
		if (Math.abs(decayed) >= DEFICIT_DROP_UNITS) goods[name] = decayed;
	}
	return { goods, updatedAt: gameTimeMin };
};

/**
 * §5.2's deficit for one good, decayed lazily on read.
 *
 * Absence means zero, which is what makes the map sparse: a station never
 * traded at costs nothing to save and reads exactly like one whose mark has
 * faded away.
 */
export const readDeficit = (
	map: DeficitMap,
	key: CarrierKey,
	goodName: string,
	gameTimeMin: number,
): number => {
	const row = map[key];
	if (!row) return 0;
	const elapsed = Math.max(0, gameTimeMin - row.updatedAt);
	const decayed = decayDeficit(row.goods[goodName] ?? 0, elapsed);
	return Math.abs(decayed) < DEFICIT_DROP_UNITS ? 0 : decayed;
};

/**
 * Records a trade: `units` positive when the player buys, negative when they
 * sell (§5.2's sign).
 *
 * Returns a new map rather than mutating, so a caller cannot half-apply a trade
 * and leave the save describing a station that was never traded at. The whole
 * row decays to `gameTimeMin` first — the mark being added is the only one at
 * full strength.
 *
 * **`holdT` is the flown hull's hold** and is required rather than defaulted
 * (#182): it is what `addDeficit` saturates against, so a caller that forgot to
 * name a hull would give a freighter the courier's memory cap. The units stored
 * stay tonnes — `shelfQuantity` reads them against Bell's own 63-unit shelf,
 * which is a shelf and not a memory.
 *
 * **The trade is a record and not three more positionals.** Adding `holdT`
 * would have made this six arguments of which three are bare numbers, with
 * `units`, `gameTimeMin` and `holdT` transposable without a type error — and a
 * transposed clock and hold both read as plausible. The keyed form keeps
 * `holdT` required and makes the call sites say which number is which.
 */
export interface TradeRecord {
	goodName: string;
	/** Signed units: positive when the player buys, negative when they sell. */
	units: number;
	gameTimeMin: number;
	/** The flown hull's hold, tonnes. */
	holdT: number;
}

export function recordTrade(
	map: DeficitMap,
	key: CarrierKey,
	trade: TradeRecord,
): DeficitMap {
	const { goodName, units, gameTimeMin, holdT } = trade;
	const current = map[key] ?? { goods: {}, updatedAt: gameTimeMin };
	const decayed = decayRow(current, gameTimeMin);
	const next = addDeficit(decayed.goods[goodName] ?? 0, units, holdT);
	const goods = { ...decayed.goods };
	if (Math.abs(next) < DEFICIT_DROP_UNITS) delete goods[goodName];
	else goods[goodName] = next;

	const out = { ...map };
	if (Object.keys(goods).length === 0) delete out[key];
	else out[key] = { goods, updatedAt: gameTimeMin };
	return out;
}

/**
 * Every row decayed to `gameTimeMin`, with faded goods and emptied rows
 * dropped — §5.5's bound on how large the save can get.
 *
 * Called on save rather than on a tick: the decay is lazy everywhere else, and
 * a game that never docks anywhere writes nothing.
 */
export function pruneDeficits(
	map: DeficitMap,
	gameTimeMin: number,
): DeficitMap {
	const out: DeficitMap = {};
	for (const [key, row] of Object.entries(map) as [CarrierKey, DeficitRow][]) {
		const decayed = decayRow(row, gameTimeMin);
		if (Object.keys(decayed.goods).length > 0) out[key] = decayed;
	}
	return out;
}

/**
 * Reads a serialized map back, rejecting a malformed one loudly.
 *
 * `persistent-world-state.md` §7: sparse absence is meaningful, so a truncated
 * or half-written snapshot must not be reinterpreted as an untouched healthy
 * carrier. Anything that is not a well-formed row throws rather than being
 * silently skipped.
 */
export function parseDeficits(raw: unknown): DeficitMap {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		throw new Error("deficit map: not an object");
	const out: DeficitMap = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		// **Checked, not asserted.** The brand exists so that `carrierKey` is the
		// only way to make one, and a cast here would have let a save keyed on a
		// bare `Station.id` — `"station-trade"`, the exact hazard the key type
		// was introduced for — load silently and file one system's market memory
		// under every system's.
		if (!isCarrierKey(key))
			throw new Error(
				`deficit map: ${key} is not a carrier key (systemIndex:localCarrierId)`,
			);
		const carrier = key as CarrierKey;
		if (value === null || typeof value !== "object" || Array.isArray(value))
			throw new Error(`deficit map: row ${key} is not an object`);
		const row = value as Record<string, unknown>;
		if (typeof row.updatedAt !== "number" || !Number.isFinite(row.updatedAt))
			throw new Error(`deficit map: row ${key} has no finite updatedAt`);
		if (
			row.goods === null ||
			typeof row.goods !== "object" ||
			Array.isArray(row.goods)
		)
			throw new Error(`deficit map: row ${key} has no goods object`);
		const goods: Record<string, number> = {};
		for (const [name, units] of Object.entries(
			row.goods as Record<string, unknown>,
		)) {
			if (typeof units !== "number" || !Number.isFinite(units))
				throw new Error(`deficit map: ${key}/${name} is not a finite number`);
			goods[name] = units;
		}
		out[carrier] = { goods, updatedAt: row.updatedAt };
	}
	return out;
}
