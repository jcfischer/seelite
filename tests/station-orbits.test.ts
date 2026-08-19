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
} from "../scripts/station-rows";
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
 * The dead-end defect, pinned rather than left silent (`station-types.md` §5.4).
 *
 * `galaxy-generation.md` §6.4 says the trade station is present "always", and
 * `src/system.ts` says "The trade station is unconditional, so a system always
 * has somewhere to dock — a system with no station would be a dead end the
 * galaxy map has no way to warn". Neither is true: the station is guarded by
 * `if (primary)`, and §6.2's ladder can discard every rung outside the orbit
 * envelope, leaving a planetless system with nothing to dock at.
 *
 * This test asserts the defect's **current** extent rather than the invariant,
 * because asserting the invariant today would simply fail. It is deliberately
 * shaped to break when the defect is fixed: the node that fixes it flips these
 * two expectations to `0` and recaptures the fixture, and until then the number
 * is measured and visible instead of being a claim nobody checked.
 */
describe("undockable systems (known defect, station-types.md §5.4)", () => {
	test("exactly 2 of 2048 systems generate with no planet and no station", () => {
		let planetless = 0;
		let stationless = 0;
		forEachSystem(baseline.worldSeed, ALL_GALAXIES, (_record, contents) => {
			if (contents.planets.length === 0) planetless++;
			if (contents.stations.length === 0) stationless++;
		});
		expect(planetless).toBe(2);
		expect(stationless).toBe(2);
		// Every stationless system is stationless *because* it is planetless —
		// if these ever diverge, a second cause has appeared and §5.4's analysis
		// no longer covers it.
		expect(stationless).toBe(planetless);
	});
});
