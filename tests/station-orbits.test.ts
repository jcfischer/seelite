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
import { forEachSystem, stationRows } from "../scripts/station-rows";
import { GALAXY_COUNT } from "../src/galaxy";
import baseline from "./fixtures/station-orbits.json";

/** Every galaxy of the world: the census sweeps all 8, where the placement
 *  fixture pins only the two the capture script names. */
const ALL_GALAXIES = Array.from({ length: GALAXY_COUNT }, (_, i) => i);

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
 * The trade station is guarded by `if (primary)` while §6.2's ladder can
 * discard every rung outside the orbit envelope, so a planetless system
 * generates with nothing to dock at. §5.4 owns the analysis; this pins the
 * extent.
 *
 * It asserts the defect's **current** shape rather than the invariant, because
 * asserting the invariant today would simply fail. It is meant to break when
 * the defect is fixed, and how it breaks depends on which of §5.4's three
 * answers the fixing node takes:
 *
 * - **star-orbiting trade station** — `stationless` goes to 0, `planetless`
 *   stays at 2, and the identity below is *dropped*, not repinned.
 * - **force the ladder to keep a planet** — both go to 0.
 * - **drop such systems from the galaxy** — both go to 0, and the system count
 *   changes, so `galaxy.test.ts`'s digest moves too.
 */
describe("undockable systems (known defect, station-types.md §5.4)", () => {
	test("2 of 2048 systems generate with no planet and no station", () => {
		const planetless: string[] = [];
		const stationless: string[] = [];
		forEachSystem(baseline.worldSeed, ALL_GALAXIES, (record, contents, g) => {
			const key = `g${g}#${record.index} ${record.name}`;
			if (contents.planets.length === 0) planetless.push(key);
			if (contents.stations.length === 0) stationless.push(key);
		});
		expect(planetless).toEqual(["g0#110 EDSOISLA", "g1#114 ORTITEZA"]);
		// The *same* systems, not merely the same count — §5.4 claims the
		// stationless ones are stationless *because* they are planetless, and
		// comparing two counts would let a second cause appear on one side while
		// a first-cause system dropped off the other, with both totals still 2.
		expect(stationless).toEqual(planetless);
	});
});
