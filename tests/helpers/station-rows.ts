/**
 * Shared corpus machinery for the generator tests and the measurement scripts:
 * one traversal, one set of world seeds, and one serialisation of a station's
 * placement used by both the capture script and the guard that checks against
 * what it captured.
 *
 * It lives under `tests/helpers/` rather than in `scripts/` because the guard is
 * the thing that must not drift: the dependency should point from the operator
 * tooling into shared test code, not from the guarded tier out into tooling.
 *
 * It lives in its own module because the two sides must agree exactly. The
 * first version copied the row builder into `tests/station-orbits.test.ts` with
 * a comment asking the next editor to keep them identical — which is a
 * convention, not a mechanism: adding a field to one side and not the other
 * makes the guard compare a format the fixture was never written in, and
 * nothing fails.
 */

import {
	GALAXY_COUNT,
	generateGalaxy,
	type SystemRecord,
} from "../../src/galaxy";
import { type SystemContents, generateContents } from "../../src/system";

/**
 * Walks `galaxies` of one world, generating each system's contents once.
 *
 * The single traversal both the row builder and the undockable-systems census
 * go through, for the reason in this module's header: two hand-copied walks
 * over the same generator entry points drift, and nothing fails when they do.
 */
export function forEachSystem(
	worldSeed: number,
	galaxies: readonly number[],
	visit: (
		record: SystemRecord,
		contents: SystemContents,
		galaxy: number,
	) => void,
): void {
	for (const g of galaxies) {
		// Both bounds and integrality: `generateGalaxy` will derive a seed for a
		// negative or fractional index and cheerfully return systems belonging to
		// no galaxy, which is a silently wrong corpus rather than an error.
		if (!Number.isInteger(g) || g < 0 || g >= GALAXY_COUNT)
			throw new Error(`galaxy ${g} does not exist`);
		for (const record of generateGalaxy(worldSeed, g).systems) {
			visit(record, generateContents(record), g);
		}
	}
}

/**
 * Every station of every system in `galaxies`, one tab-separated row each.
 *
 * Floats are written as `toExponential(12)` rather than compared numerically.
 * `tests/galaxy.test.ts` records why an exact float cannot be pinned across
 * platforms; station orbits are plain arithmetic over `rand()` with no
 * transcendental in the chain, so twelve significant digits sits far inside any
 * real divergence while still catching a shifted draw — which moves the first
 * digit, not the last.
 */
export function stationRows(
	worldSeed: number,
	galaxies: readonly number[],
): string[] {
	const rows: string[] = [];
	forEachSystem(worldSeed, galaxies, (record, contents, g) => {
		for (const s of contents.stations) {
			rows.push(
				[
					g,
					record.index,
					s.id,
					s.type,
					s.parentId ?? "-",
					s.orbit.radiusKm.toExponential(12),
					s.orbit.periodS.toExponential(12),
					s.orbit.theta0.toExponential(12),
					s.orbit.inclination.toExponential(12),
					s.orbit.node.toExponential(12),
				].join("\t"),
			);
		}
	});
	return rows;
}

/** Every galaxy of a world. The census and the clamp measurement sweep all of
 *  them; the placement fixture pins only the two its capture script names. */
export const ALL_GALAXIES: readonly number[] = Array.from(
	{ length: GALAXY_COUNT },
	(_, i) => i,
);

/**
 * `n` arbitrary but reproducible world seeds.
 *
 * Spread by Knuth's multiplicative constant, the same decorrelation `rng.ts`
 * relies on, because consecutive integers make poor seeds — a generator's first
 * draw from seeds one apart is nearly the same number, which `rng.ts` documents
 * at length. Measuring one world would measure one world; `main.ts` picks the
 * real one with `Math.random()`.
 */
export function worldSeeds(n: number): number[] {
	return Array.from({ length: n }, (_, i) => ((i + 1) * 2654435761) >>> 0);
}
