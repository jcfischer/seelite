/**
 * Every generated system is reachable: it has a planet, exactly one primary,
 * and a trade station on that primary.
 *
 * **This replaces an assertion of the defect with an assertion of the rule.**
 * `station-orbits.test.ts` used to pin the *rate* at which systems generated
 * unreachable — about one in 700 — because the invariant would simply have
 * failed. #23 framed three answers and deliberately left the choice to a later
 * node; #51 took the second of them, forcing the ladder to keep its primary
 * rung. The rate is now zero, and a rate is the wrong thing to measure: a band around 0.143% passes
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
import { generateGalaxy } from "../src/galaxy";
import {
	arrivalPoint,
	generateContents,
	MAX_ORBIT_AU,
	MIN_ORBIT_AU,
} from "../src/system";
import {
	ALL_GALAXIES,
	forEachSystem,
	worldSeeds,
} from "./helpers/station-rows";

/**
 * Forty worlds — 81,920 systems — not eight.
 *
 * Eight was the retired rate test's sample, and a rate only needed enough
 * systems to estimate one. This asserts a rule that must hold for every seed a
 * player can generate, and `main.ts` seeds from `Math.random()` unless `?seed=`
 * pins it, so there is no shipped world whose systems could be enumerated
 * instead. Forty is what `scripts/measure-clamp-bite.ts` sweeps and what §5.4's
 * figures were measured over, so the corpus and the measurement agree.
 *
 * It is still a sample. The guarantee itself is by construction and the three
 * facts behind it are in `generateContents`; this is what would catch those
 * facts being broken.
 */
const WORLDS = worldSeeds(40);

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

	test("arrival computes for a system with no bodies at all", () => {
		/*
		 * The artefact behind the correction to #23, so the claim does not rest
		 * on an experiment that left nothing behind.
		 *
		 * #23 said a planetless system "has no body for #10's arrival point,
		 * which assumes one". Handed contents with no planets, no stations and
		 * no belt, `arrivalPoint` still returns a finite position — it places
		 * along a seeded bearing from the system origin and pushes clear of
		 * whatever bodies exist, of which there are none. So the unreachability
		 * was never a failure to place the ship; it was having nowhere to go.
		 */
		const record = generateGalaxy(worldSeeds(1)[0], 0).systems[0];
		const empty = { ...generateContents(record), planets: [], stations: [] };
		const at = arrivalPoint(record, empty, null, 0);
		expect(Number.isFinite(at.x)).toBe(true);
		expect(Number.isFinite(at.y)).toBe(true);
		expect(Number.isFinite(at.z)).toBe(true);
		// And it is a real distance out, not the origin — the property that made
		// it look like arrival "worked" on the broken generator.
		expect(Math.hypot(at.x, at.y, at.z)).toBeGreaterThan(0);
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

	test("arrival lands somewhere there is something to arrive at", () => {
		/*
		 * **Computing arrival was never the broken half**, and saying so
		 * corrects #23 as well as an earlier version of this test.
		 *
		 * #23 wrote that a planetless system "has no body for #10's arrival
		 * point, which assumes one". `arrivalPoint` assumes nothing: it places
		 * the ship a fixed distance along a seeded bearing from the system
		 * origin and pushes clear of whatever bodies exist, so it returns a
		 * finite point for a system with no bodies at all — which the test below
		 * demonstrates on a system with none, rather than leaving the claim to
		 * an experiment nobody can repeat.
		 *
		 * What was actually broken is the other half: there was nothing to
		 * travel *to*. So the property worth asserting pairs the two — arrival
		 * computes, and the system it computes into has a dockable body.
		 */
		const bad: string[] = [];
		for (const world of WORLDS)
			forEachSystem(world, ALL_GALAXIES, (record, contents, g) => {
				const at = arrivalPoint(record, contents, null, 0);
				const finite =
					Number.isFinite(at.x) &&
					Number.isFinite(at.y) &&
					Number.isFinite(at.z);
				if (!finite || contents.stations.length === 0)
					bad.push(
						`${world}:g${g}#${record.index} finite=${finite} stations=${contents.stations.length}`,
					);
			});
		expect(bad).toEqual([]);
	});
});
