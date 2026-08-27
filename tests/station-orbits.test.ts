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
// Read off the page, not restated (CLAUDE.md): these are the thresholds the
// invariants below are stated against.
import { SURFACE_MARGIN } from "../src/cruise";
import { STATION_ORBIT_R_OVER_R } from "../src/system";
import type { Vec3 } from "../src/vec3";
import {
	ALL_GALAXIES,
	forEachHostedStation,
	forEachPlacedStation,
	forEachSystem,
	stationRows,
	worldSeeds,
} from "./helpers/station-rows";
import baseline from "./fixtures/station-orbits.json";
import baselineBefore from "./fixtures/station-orbits-pre-floor.json";

/** Flat distance between two placed positions (both resolved here; the type
 *  keeps the helper's optional `pos` honest at the call sites). */
function dist(a: Vec3, b: Vec3): number {
	return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

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
/** `station-types.md` §5.4's measurement, over 40 worlds. Not re-derived here —
 *  eight worlds would measure eight worlds. */
const MEASURED_RATE = 0.00143;

describe("unreachable systems (known defect, station-types.md §5.4)", () => {
	/** Eight arbitrary worlds. One world would measure one world, and
	 *  `scripts/measure-clamp-bite.ts` sweeps the same series. */
	const WORLDS = worldSeeds(8);

	test("about 1 system in 700 generates with no planet and no station", () => {
		let systems = 0;
		const planetless: string[] = [];
		const stationless: string[] = [];
		for (const world of WORLDS) {
			forEachSystem(world, ALL_GALAXIES, (record, contents, g) => {
				systems++;
				// Built inside the branches: ~0.14% of 16,384 systems keep it.
				if (contents.planets.length === 0)
					planetless.push(`${world}:g${g}#${record.index}`);
				if (contents.stations.length === 0)
					stationless.push(`${world}:g${g}#${record.index}`);
			});
		}
		expect(systems).toBe(WORLDS.length * ALL_GALAXIES.length * 256);
		// Measured at 0.143% over 40 worlds (81,920 systems) by
		// `scripts/measure-clamp-bite.ts`, which reports the same figure. The band
		// is ±50%
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

/**
 * Node #32's invariants: no station inside its host's guard shell, and an
 * explicit floor under the orbit band.
 *
 * Both replace measured-defect pins with the rule the defect's node filed.
 * §12.2 (`in-system-travel.md`) measured **49 of 337** planet-orbiting
 * stations sitting inside their own host's 1.05× cruise shell — a draw,
 * because a 400–2,000 km absolute altitude loses a race against a 5% shell
 * of a proportional radius. Re-running that census by radius over the corpus
 * this file walks — `worldSeeds(8)`, the before tag (`node-32-before-orbit-
 * floor`), the same `forEachHostedStation` traversal — finds 1,059 of 19,202
 * host-orbiting stations inside their own shell, so the before build fails
 * by a mile rather than at the margin; over placed t0 positions the before
 * build holds 382 inside-shell stations across seeds 1..1500. §12.3 measured the
 * occlusion side (26.1% of legs); the *rule* being ratified is the floor,
 * whose value is measured there and pinned here as a generator invariant:
 * every station orbits at or above `STATION_ORBIT_R_OVER_R` of its host.
 */
describe("station orbits clear their host (node #32)", () => {
	test("every station orbits at or above the r/R floor of its host", () => {
		let hostOrbiting = 0;
		forEachHostedStation((s, host) => {
			hostOrbiting++;
			expect(s.orbit.radiusKm / host.radiusKm).toBeGreaterThanOrEqual(
				STATION_ORBIT_R_OVER_R,
			);
		});
		// Non-vacuity: the invariant above over an empty corpus passes any test.
		expect(hostOrbiting).toBeGreaterThan(1000);
	});

	test("the floor leaves no station inside its host's cruise shell", () => {
		// The generator can violate §12.2's defect in one of two ways, and this
		// pins both rather than re-walking the radius floor under a shell-shaped
		// name: the constants may drift (a shell at 1.6 × R would swallow a 1.5
		// floor), or the generator may stop applying the max.
		expect(STATION_ORBIT_R_OVER_R).toBeGreaterThanOrEqual(SURFACE_MARGIN);
		// The defect population directly: 1,059 of 19,202 host-orbiting stations
		// inside their own shell on the before build over this corpus, zero now.
		// (The t0 test
		// below covers the same rule over the placed positions; this one needs
		// no world build.)
		let hostOrbiting = 0;
		forEachHostedStation((s, host) => {
			hostOrbiting++;
			expect(s.orbit.radiusKm).toBeGreaterThanOrEqual(
				host.radiusKm * SURFACE_MARGIN,
			);
		});
		expect(hostOrbiting).toBeGreaterThan(1000);
	});

	test("no station sits inside *any* body's shell at t0, own or foreign", () => {
		// Own and foreign share one walk here — the host's shell is part of "any
		// body's", and dropping it would narrow the guarantee every time a loop
		// got refactored. It is what `probe-arrival.mjs`'s deleted seed-118 block
		// measured in the browser; the floor took the geometry away from every
		// seeded world, so the pin moved here rather than dying with the block.
		//
		// "Any body" means `byId`: the complete set the game moves. The first
		// spelling looped `contents.planets` and was honest about less than its
		// title claimed — the moons (every gas giant carries up to MAX_MOONS = 3,
		// and the cruise guard applies its shell to every body it holds) were
		// never measured. Measured now, 1,200 seeds: a station never hosts a
		// moon, never touches the star's surface, and the foreign pair population
		// — planets, moons, other stations — is empty inside every shell.
		//
		// The seeds and the world build come from `forEachPlacedStation`; the
		// committed instrument `scripts/measure-station-shells.ts` walks the same
		// helper as far back as asked (zero inside any shell at 1..8000 when the
		// floor landed). Its closest foreign pair at that budget is 3.2 body
		// radii — seed 3573, two co-orbiting stations 1.9 km apart across an
		// 0.6 km core — the station-vs-station pair the planets-only loop never
		// compared. Still outside every shell by a wide margin, and the pairs
		// the floor is about (a station to any *body* it does not orbit) stay
		// hundreds of radii clear.
		let placed = 0;
		forEachPlacedStation((station, host, others) => {
			placed++;
			const pos = station.pos!;
			expect(dist(pos, host.pos!)).toBeGreaterThanOrEqual(
				host.radiusKm * SURFACE_MARGIN,
			);
			for (const b of others) {
				if (b.id === station.id || b.id === host.id || !b.pos) continue;
				expect(dist(pos, b.pos)).toBeGreaterThanOrEqual(
					b.radiusKm * SURFACE_MARGIN,
				);
			}
		});
		expect(placed).toBeGreaterThan(1000);
	});

	test("the floor takes over exactly where the band stops clearing the shell", () => {
		// The floor is a floor, not an orbit: wherever the 400–2,000 km band
		// can still beat it, the band must decide — otherwise #32 would have
		// silently replaced the band with a proportional rule and every rocky
		// world's station would have moved. Two crossovers are in play and the
		// test names both:
		//   vs the shell — band top 2,000 km clears 1.05 × R up to
		//     2,000 / (SURFACE_MARGIN − 1) = 40,000 km of host radius;
		//   vs the floor itself — a band row can only *exist* above the floor
		//     below 2,000 / (STATION_ORBIT_R_OVER_R − 1) = 4,000 km of host
		//     radius, which is the tighter bound and the one the census uses.
		// Above the floor crossover the floor term is the max by arithmetic,
		// so every row there sits exactly on 1.5 × R (all 14,000 of them on this
		// corpus). Below it the band must be seen winning, not merely present:
		// the census counts rows whose orbit is *strictly* above the floor, so
		// every counted row's radius came from the band draw. The band being
		// drawable in [400, 2000] below the crossover is not the evidence — the
		// floor wins most of those rows anyway (3,865 of 5,202 sit exactly on
		// 1.5 × R), and a census that counted by band-window would still pass if
		// the band had never won once. Measured here (worldSeeds(8), 19,202
		// host-orbiting stations): 1,337 strictly above — e.g. a 2,762 km host
		// with a 1,794 km band. Zero rows sit strictly under the floor, so an
		// assertion of `radiusKm < host × 1.5` would be asserting the empty set —
		// the floor clips from below and nothing generated can sit under it.
		const floorCrossoverKm = 2000 / (STATION_ORBIT_R_OVER_R - 1);
		let bandWon = 0;
		let aboveCrossover = 0;
		forEachHostedStation((s, host) => {
			if (host.radiusKm > floorCrossoverKm) {
				// Above the crossover the floor must own the row exactly.
				aboveCrossover++;
				expect(s.orbit.radiusKm).toBeCloseTo(
					host.radiusKm * STATION_ORBIT_R_OVER_R,
					6,
				);
				return;
			}
			if (s.orbit.radiusKm > host.radiusKm * STATION_ORBIT_R_OVER_R + 1e-9)
				bandWon++;
		});
		// Non-vacuity on both sides of the crossover.
		expect(bandWon).toBeGreaterThan(100);
		expect(aboveCrossover).toBeGreaterThan(1000);
	});
});

/**
 * Node #32's own guard: the floor took over **where it had to and nowhere
 * else**.
 *
 * The floor is not a new orbit rule — the 400–2,000 km band still decides
 * whenever it lands above `STATION_ORBIT_R_OVER_R` × the host's radius, and
 * that is most small hosts. The evidence is this file's baseline, compared
 * row by row against its shape before #32: 791 station rows, of which 546
 * moved **in their orbit-radius column only** — every other field
 * byte-identical, because the change adds no draws to the `DOMAIN.STATIONS`
 * stream — and the unchanged 245 are exactly the small-host rows the band
 * still owns. Both directions of drift fail this: re-applying the old band
 * moves the large hosts back down, and replacing the band with a
 * proportional rule moves the small ones up.
 *
 * The before shape is not regenerated here (a generator that could emit
 * both rules would put the second one's draws into the shared stream). It
 * is committed as `station-orbits-pre-floor.json`, captured from the
 * generator at the tag `node-32-before-orbit-floor` — the tag stays as
 * provenance for where that file came from, but reading a committed fixture
 * keeps this guard working in checkouts that never saw the tag (a shallow
 * clone, an npm pack, a release tarball).
 */

/** The orbit-radius column of `stationRows`, so the comparison below names
 *  which column a row moved in rather than just that one did. */
const RADIUS_COL = 5;

function beforeRows(): string[][] {
	return (baselineBefore.rows as string[]).map((r) => r.split("\t"));
}

describe("the floor moved only what the shell race moved (node #32)", () => {
	test("the repinned fixture differs from the pre-#32 baseline in the radius column alone", () => {
		const before = beforeRows();
		const after = stationRows(baseline.worldSeed, baseline.galaxies).map((r) =>
			r.split("\t"),
		);
		expect(after.length).toBe(before.length);
		let moved = 0;
		for (let i = 0; i < before.length; i++) {
			for (let c = 0; c < before[i].length; c++) {
				if (before[i][c] === after[i][c]) continue;
				expect(c).toBe(RADIUS_COL);
				// Strictly upward: a floor never lowers an orbit.
				expect(+after[i][RADIUS_COL]).toBeGreaterThan(+before[i][RADIUS_COL]);
				moved++;
			}
		}
		// The measured split, not a vague "some moved": 546 rows up, 245 left
		// alone. Both sides are deterministic over a fixed corpus.
		expect(moved).toBe(546);
		expect(before.length - moved).toBe(245);
	});
});
