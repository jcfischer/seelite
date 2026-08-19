/**
 * The station-placement baseline (spec `station-types.md` §5.3, §9.1).
 *
 * This guards one specific regression. `generateStations` draws trade →
 * refinery → shipyard from a single `DOMAIN.STATIONS` stream, so a draw
 * inserted anywhere in that sequence shifts every station after it, in every
 * system — silently, because nothing else in the suite pins a station's orbit.
 * The `blackMarket` and `spinRpm` fields the spec adds are exactly such draws,
 * and §5.3 requires them to come from `DOMAIN.STATION_FLAGS` instead.
 *
 * A before/after comparison cannot be written after the fact: once the tag
 * exists there is no before state left to generate. So the baseline is a
 * committed fixture, captured by `scripts/capture-station-orbits.ts` on the
 * generator as it stood before those fields were added.
 *
 * **This fixture is not the galaxy determinism digest.** That one
 * (`galaxy.test.ts`) pins the *record* and will legitimately move when the spec's
 * new fields land. This one pins *placement* and must not move with them — if
 * both are repinned in the same commit, neither is evidence any more.
 *
 * Floats are compared as `toExponential(12)` strings rather than by equality.
 * `galaxy.test.ts` records why a float cannot be pinned exactly across
 * platforms; station orbits are plain arithmetic over `rand()` with no
 * transcendental in the chain, so twelve significant digits is far inside any
 * real divergence while still catching a shifted draw, which changes the first
 * digit.
 */

import { describe, expect, test } from "bun:test";
import baseline from "./fixtures/station-orbits.json";
import { GALAXY_COUNT, generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";

/** Kept identical to `scripts/capture-station-orbits.ts` — the capture script
 *  and the check must serialise a station the same way or the comparison is
 *  meaningless. */
function rowsForCurrentGenerator(): string[] {
	const rows: string[] = [];
	for (const g of baseline.galaxies) {
		if (g >= GALAXY_COUNT) throw new Error(`galaxy ${g} does not exist`);
		const galaxy = generateGalaxy(baseline.worldSeed, g);
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

describe("station placement is stable against added draws", () => {
	test("the fixture is a real corpus, not an empty pass", () => {
		// A fixture that silently became empty would make every assertion below
		// vacuous, which is the failure mode a golden file is most prone to.
		expect(baseline.rows.length).toBe(baseline.stationCount);
		expect(baseline.rows.length).toBeGreaterThan(500);
	});

	test("every station's type, parent and orbit match the baseline", () => {
		const now = rowsForCurrentGenerator();
		// Count first: a length mismatch means stations appeared or vanished, and
		// the row-by-row diff below would then misalign and report every station
		// as changed rather than naming the real one.
		expect(now.length).toBe(baseline.rows.length);
		expect(now).toEqual(baseline.rows);
	});
});
