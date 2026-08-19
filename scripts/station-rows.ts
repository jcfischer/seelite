/**
 * One serialisation of a station's placement, shared by the capture script and
 * the guard that checks against what it captured.
 *
 * It lives in its own module because the two sides must agree exactly. The
 * first version copied the row builder into `tests/station-orbits.test.ts` with
 * a comment asking the next editor to keep them identical — which is a
 * convention, not a mechanism: adding a field to one side and not the other
 * makes the guard compare a format the fixture was never written in, and
 * nothing fails.
 */

import { GALAXY_COUNT, generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";

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
	for (const g of galaxies) {
		if (g >= GALAXY_COUNT) throw new Error(`galaxy ${g} does not exist`);
		const galaxy = generateGalaxy(worldSeed, g);
		for (const record of galaxy.systems) {
			for (const s of generateContents(record).stations) {
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
		}
	}
	return rows;
}
