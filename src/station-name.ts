/**
 * Proper station names, drawn from Bell's digram vocabulary without touching
 * any stream that places or configures a station (node #110).
 *
 * `Station.id` remains lookup identity and `localCarrierId` remains persistence
 * identity. A name is display-only. Each fixed type slot receives its own
 * sub-stream below `DOMAIN.STATION_NAME`; station array order is deliberately
 * absent from the seed derivation.
 */

import { DOMAIN } from "./domains";
import { systemName as drawDigramName } from "./names";
import { mix, seededRand } from "./rng";
import type { StationType } from "./station";

/** Append-only slot tags. Renumbering one changes that type's name everywhere. */
export const STATION_NAME_SLOT: Record<StationType, number> = {
	trade: 1,
	refinery: 2,
	shipyard: 3,
	outpost: 4,
};

/** Fixed order makes collision resolution independent of which types exist. */
export const STATION_NAME_TYPES = [
	"trade",
	"refinery",
	"shipyard",
	"outpost",
] as const satisfies readonly StationType[];

const MAX_COLLISION_REDRAWS = 64;

/**
 * Draw until the name is unique inside this system.
 *
 * Exported at the collision boundary so a test can force both kinds of clash
 * without finding a magic world seed. `draw` is the real digram generator in
 * production; tests may supply a finite sequence of names.
 */
export function drawUniqueStationName(
	draw: () => string,
	forbidden: ReadonlySet<string>,
): string {
	for (let i = 0; i < MAX_COLLISION_REDRAWS; i++) {
		const name = draw();
		if (!forbidden.has(name)) return name;
	}
	throw new Error("station name collision redraw limit exhausted");
}

/**
 * Draw every fixed slot, including types absent from this particular system.
 * Reserving absent slots is what makes a beltless system's shipyard name equal
 * to the same seed's shipyard name when a refinery slot is present.
 */
export function stationNames(
	systemSeed: number,
	systemDisplayName: string,
): Readonly<Record<StationType, string>> {
	const root = mix(systemSeed, DOMAIN.STATION_NAME);
	const forbidden = new Set<string>([systemDisplayName]);
	const names = {} as Record<StationType, string>;
	for (const type of STATION_NAME_TYPES) {
		const rand = seededRand(mix(root, STATION_NAME_SLOT[type]));
		const name = drawUniqueStationName(() => drawDigramName(rand), forbidden);
		names[type] = name;
		forbidden.add(name);
	}
	return names;
}
