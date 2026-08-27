/**
 * The station-placement baseline (spec `station-types.md` §5.3, §5.4, §9.1).
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
 * (`galaxy.test.ts`) pins the *record* and will legitimately move when the
 * spec's new fields land. This one pins *placement* and must not move with
 * them — if both are repinned in the same commit, neither is evidence any more.
 */

import { describe, expect, test } from "bun:test";
import {
	ALL_GALAXIES,
	forEachSystem,
	stationRows,
	worldSeeds,
} from "./helpers/station-rows";
import baseline from "./fixtures/station-orbits.json";

describe("station placement is stable against added draws", () => {
	test("the fixture is a real corpus, not an empty pass", () => {
		// A fixture that silently became empty would make every assertion below
		// vacuous, which is the failure mode a golden file is most prone to.
		expect(baseline.rows.length).toBe(baseline.stationCount);
		expect(baseline.rows.length).toBeGreaterThan(500);
	});

	test("every station's type, parent and orbit match the baseline", () => {
		const now = stationRows(baseline.worldSeed, baseline.galaxies);
		// Count first: a length mismatch means stations appeared or vanished, and
		// the row-by-row diff below would then misalign and report every station
		// as changed rather than naming the real one.
		expect(now.length).toBe(baseline.rows.length);
		expect(now).toEqual(baseline.rows);
	});
});

/**
 * **The defect this file used to pin is gone, and the pin with it.**
 *
 * It asserted a *rate* — about one system in 700 generating with no planet and
 * no station — and said in its own docstring that it was meant to break when
 * the defect was fixed. #51 took §5.4's second answer, forcing the ladder to
 * keep the primary rung, so the rate is zero.
 *
 * A rate test is the wrong shape once the answer is "never": a band around
 * 0.143% passes a generator that has quietly regressed to 0.1%, and only a rule
 * refuses every value but the right one. The invariant lives in
 * `tests/system-reachability.test.ts`, which asserts what must always hold
 * rather than how often it currently does not — and which also covers the
 * second defect #51 measured and this rate test could not see: a system that
 * keeps planets while the primary rung alone is filtered, which had a trade
 * station only through `generateStations`' fallback to `planets[0]`.
 */
