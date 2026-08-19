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
 * The dead-end defect, pinned rather than left silent (`station-types.md` §5.4).
 *
 * The trade station is guarded by `if (primary)` while §6.2's ladder can
 * discard every rung outside the orbit envelope, so a planetless system
 * generates with nothing to dock at. §5.4 owns the analysis; this pins the
 * extent.
 *
 * **It is measured as a rate over many worlds, not as two named systems.**
 * `main.ts` seeds the world from `Math.random()` unless `?seed=` pins it, so
 * there is no "shipped world" whose bad systems could be listed — every session
 * generates its own. Naming two would pin an artefact of this file's fixture
 * seed and say nothing about what a player meets. Measured at 0.143% over 40
 * worlds, roughly three per world.
 *
 * It asserts the defect's **current** extent rather than the invariant, because
 * asserting the invariant today would simply fail. It is meant to break when
 * the defect is fixed, and how it breaks depends on which of §5.4's three
 * answers the fixing node takes:
 *
 * - **star-orbiting trade station** — `stationless` goes to 0, `planetless`
 *   stays where it is, and the identity below is *dropped*, not repinned.
 * - **force the ladder to keep a planet** — both go to 0.
 * - **drop such systems from the galaxy** — both go to 0, and the system count
 *   changes, so `galaxy.test.ts`'s digest moves too.
 */
describe("undockable systems (known defect, station-types.md §5.4)", () => {
	/** Eight arbitrary worlds. One world would measure one world, and
	 *  `scripts/measure-clamp-bite.ts` sweeps the same series. */
	const WORLDS = worldSeeds(8);

	test("about 1 system in 700 generates undockable", () => {
		let systems = 0;
		const planetless: string[] = [];
		const stationless: string[] = [];
		for (const world of WORLDS) {
			forEachSystem(world, ALL_GALAXIES, (record, contents, g) => {
				systems++;
				const key = `${world}:g${g}#${record.index}`;
				if (contents.planets.length === 0) planetless.push(key);
				if (contents.stations.length === 0) stationless.push(key);
			});
		}
		expect(systems).toBe(WORLDS.length * ALL_GALAXIES.length * 256);
		// Measured at 0.143% over 40 worlds (81,920 systems). The band is ±50%
		// around that: wide enough to absorb sampling over eight worlds, narrow
		// enough that fixing the defect fails the lower bound and roughly
		// doubling it fails the upper. It does not claim to catch a 10% drift.
		const rate = stationless.length / systems;
		expect(rate).toBeGreaterThan(0.0007);
		expect(rate).toBeLessThan(0.0022);
		// The *same* systems, not merely the same count — §5.4 claims the
		// stationless ones are stationless *because* they are planetless, and
		// comparing two counts would let a second cause appear on one side while
		// a first-cause system dropped off the other, with both totals equal.
		expect(stationless).toEqual(planetless);
	});
});
