/**
 * Which form each of a system's stations is built in (node #717).
 *
 * Every system draws its stations' forms from **its own seed**, so two systems
 * whose trade stations share a role need not share a station. The pools are
 * `station.ts`'s (`STATION_FORM_POOL`); this module is only the draw, kept
 * beside `station-name.ts` because it has that module's shape for that
 * module's reason.
 *
 * **One sub-stream per fixed type slot, drawn for every slot.** A draw // glossary-ignore: slot
 * consumed in station order would hand a beltless system's shipyard the
 * refinery's position in the stream — #109's hazard, which `stationNames`
 * already answers the same way. So each drawn role reads its own
 * `mix(mix(seed, DOMAIN.STATION_FORM), STATION_FORM_SLOT[type])`, and a system
 * draws every role's form whether or not it places that station.
 *
 * **Its own domain tag** (`DOMAIN.STATION_FORM`), and not a read of the
 * assembly or berth draw: a pool that grows must move no plan and no berth,
 * and a form drawn off the assembly seed would tie a station's form to the
 * plan it solves.
 *
 * Imports no Three.js: `system.ts` calls it, and the sim must not reach the
 * renderer.
 */

import { DOMAIN } from "./domains";
import { mix, seededRand } from "./rng";
import {
	DRAWN_STATION_TYPES,
	type DrawnStationType,
	STATION_FORM_POOL,
	type StationFormId,
} from "./station";

/** Append-only slot tags. Renumbering one moves that role's form everywhere. */ // glossary-ignore: slot
export const STATION_FORM_SLOT: Record<DrawnStationType, number> = {
	trade: 1,
	shipyard: 2,
	refinery: 3,
};

/**
 * One form from a pool, uniformly: one draw, whatever the pool's size.
 *
 * Exactly one draw even for a pool of one, so the stream's position never
 * depends on how many forms a pool holds — the sub-stream is per slot and // glossary-ignore: slot
 * nothing else reads it today, but a second draw added to it later would
 * otherwise move with every pool edit.
 */
export function drawStationForm(
	rand: () => number,
	pool: readonly StationFormId[],
): StationFormId {
	if (pool.length === 0) throw new Error("a form pool cannot be empty");
	const roll = rand();
	return pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))];
}

/** Every drawn role's form for one system, from that system's seed. */
export function stationForms(
	systemSeed: number,
	pools: Readonly<
		Record<DrawnStationType, readonly StationFormId[]>
	> = STATION_FORM_POOL,
): Readonly<Record<DrawnStationType, StationFormId>> {
	const root = mix(systemSeed, DOMAIN.STATION_FORM);
	const forms = {} as Record<DrawnStationType, StationFormId>;
	for (const type of DRAWN_STATION_TYPES)
		forms[type] = drawStationForm(
			seededRand(mix(root, STATION_FORM_SLOT[type])),
			pools[type],
		);
	return forms;
}
