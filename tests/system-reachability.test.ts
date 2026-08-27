/**
 * Every generated system is reachable: it has a planet, exactly one primary,
 * and a trade station on that primary.
 *
 * **This replaces an assertion of the defect with an assertion of the rule.**
 * `station-orbits.test.ts` used to pin the *rate* at which systems generated
 * unreachable — about one in 700 — because the invariant would simply have
 * failed. #23 chose to force the ladder to keep a planet, so the rate is now
 * zero and a rate is the wrong thing to measure: a band around 0.143% passes
 * for a generator that has quietly regressed to 0.1%, and only a rule refuses
 * every value but the right one.
 *
 * **Two defects, not one.** #23 measured planetless systems and this node's
 * task named the second: a system can keep planets while the *primary* rung is
 * the one filtered out, leaving no planet flagged `isPrimary` at all. Measured
 * on the generator before the fix, over 40 worlds and 10,240 systems: 14
 * planetless, and **42 more with planets but no primary**. The second is three
 * times the first and was invisible to the rate test, because
 * `generateStations` falls back to `planets[0]` — so those systems have a trade
 * station and simply do not have it on a primary.
 *
 * Both come from the same line. `scaleFactor` is `habitableAu /
 * ladder[primaryRung]`, so the primary rung is meant to land exactly on the
 * habitable distance — but `ladder[i] * scaleFactor` is not exactly
 * `habitableAu` in floating point, and when the habitable distance has been
 * clamped to an envelope boundary the product can fall a hair outside and be
 * discarded by the envelope test.
 */

import { describe, expect, test } from "bun:test";
import {
	ALL_GALAXIES,
	forEachSystem,
	worldSeeds,
} from "./helpers/station-rows";
import { MAX_ORBIT_AU, MIN_ORBIT_AU } from "../src/system";

/** Eight worlds. One world would measure one world, and the corpus helpers
 *  sweep the same series the measurement scripts do. */
const WORLDS = worldSeeds(8);

describe("every system is reachable", () => {
	test("the corpus is a real one, not an empty pass", () => {
		// The failure mode of every corpus-wide invariant: a traversal that
		// visits nothing satisfies all of them.
		let systems = 0;
		for (const world of WORLDS)
			forEachSystem(world, ALL_GALAXIES, () => {
				systems++;
			});
		expect(systems).toBe(WORLDS.length * ALL_GALAXIES.length * 256);
	});

	test("no system generates without a planet, a primary, or a trade station", () => {
		const planetless: string[] = [];
		const primaryless: string[] = [];
		const multiPrimary: string[] = [];
		const tradeless: string[] = [];
		const notOnPrimary: string[] = [];
		for (const world of WORLDS) {
			forEachSystem(world, ALL_GALAXIES, (record, contents, g) => {
				const where = `${world}:g${g}#${record.index}`;
				const primaries = contents.planets.filter((p) => p.isPrimary);
				if (contents.planets.length === 0) planetless.push(where);
				if (primaries.length === 0) primaryless.push(where);
				if (primaries.length > 1) multiPrimary.push(where);
				const trade = contents.stations.filter((s) => s.type === "trade");
				if (trade.length === 0) tradeless.push(where);
				// Hosted *by the primary*, not merely present. The generator falls
				// back to `planets[0]`, so a station exists either way and only its
				// parent says whether the primary was really there.
				else if (primaries[0] && trade[0].parentId !== primaries[0].id)
					notOnPrimary.push(where);
			});
		}
		// Named rather than counted: a count says how many and a name says which,
		// and which is what a regression here needs to be chased.
		expect(planetless).toEqual([]);
		expect(primaryless).toEqual([]);
		expect(multiPrimary).toEqual([]);
		expect(tradeless).toEqual([]);
		expect(notOnPrimary).toEqual([]);
	});

	test("the retained primary still sits inside the orbit envelope", () => {
		// The boundary case the fix turns on: a primary that would have been
		// filtered is kept and clamped, so it must land *on* the envelope rather
		// than outside it. An implementation that simply skipped the envelope
		// test for the primary would pass every assertion above and fail this.
		const outside: string[] = [];
		for (const world of WORLDS)
			forEachSystem(world, ALL_GALAXIES, (record, contents, g) => {
				for (const planet of contents.planets)
					if (planet.aAu < MIN_ORBIT_AU || planet.aAu > MAX_ORBIT_AU)
						outside.push(
							`${world}:g${g}#${record.index} ${planet.id} at ${planet.aAu}`,
						);
			});
		expect(outside).toEqual([]);
	});

	test("arrival can be computed for every system", () => {
		// Reachability, not merely dockability: #10's arrival point is placed
		// relative to a body, so a system with no body has nowhere to arrive even
		// if something dockable existed. This is the half of #23 that a station
		// count cannot see.
		const noArrivalBody: string[] = [];
		for (const world of WORLDS)
			forEachSystem(world, ALL_GALAXIES, (record, contents, g) => {
				const primary = contents.planets.find((p) => p.isPrimary);
				if (!primary || !Number.isFinite(primary.orbit.radiusKm))
					noArrivalBody.push(`${world}:g${g}#${record.index}`);
			});
		expect(noArrivalBody).toEqual([]);
	});
});
