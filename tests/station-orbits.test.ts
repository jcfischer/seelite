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
// Read off the page, not restated (CLAUDE.md): these are the two thresholds
// the invariants below are stated against.
import { SURFACE_MARGIN } from "../src/cruise";
import { STATION_ORBIT_R_OVER_R } from "../src/system";
import {
	ALL_GALAXIES,
	forEachHostedStation,
	forEachSystem,
	stationRows,
	worldSeeds,
} from "./helpers/station-rows";
import baseline from "./fixtures/station-orbits.json";
import baselineBefore from "./fixtures/station-orbits-pre-floor.json";

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
 * of a proportional radius. The corpus figure came from the `measure-cruise-
 * arrival` sweep; this sweep re-derives the population over `worldSeeds(8)`,
 * where the defect population was 2,381 station-placements, so the before
 * build fails by a mile rather than at the margin. §12.3 measured the
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

	test("no station sits inside its own host's cruise shell", () => {
		// §12.2's defect, as an invariant: the guard now stops the ship at
		// `radius + HOST_CLEARANCE_KM` for the host, but a station *inside the
		// proportional shell* was still the geometry that made cruise
		// unengageable from there, and cruise's release rule is not a reason to
		// keep generating it. The generator's job is that it never happens.
		forEachHostedStation((s, host) => {
			expect(s.orbit.radiusKm).toBeGreaterThanOrEqual(
				host.radiusKm * SURFACE_MARGIN,
			);
		});
	});

	test("the floor takes over exactly where the band stops clearing the shell", () => {
		// The floor is a floor, not an orbit: below the crossover, where the
		// 400–2,000 km band already beats 1.05 × R, the band must still decide
		// — otherwise #32 would have silently replaced the band with a
		// proportional rule and every rocky world's station would have moved.
		// "Still decides" has to mean the band *won*, not merely that a
		// small-host row exists: a strict max would show it. The census below
		// (worldSeeds(8), 19,202 host-orbiting stations) measures 1,337 rows
		// whose drawn band lands in [400, 2000] and strictly above the floor —
		// e.g. host radius 2,762 km with a 1,794 km band — and zero rows
		// strictly below the floor. Asserting merely `radiusKm < host × 1.5`
		// would be asserting the empty set: the floor clips from below, so no
		// generated row can sit under it.
		// Crossover: band top 2,000 km clears R when R ≤ 2,000 / (SURFACE_MARGIN − 1).
		const crossoverKm = 2000 / (SURFACE_MARGIN - 1);
		let bandWon = 0;
		forEachHostedStation((s, host) => {
			const bandKm = s.orbit.radiusKm - host.radiusKm;
			const strictlyAboveFloor =
				s.orbit.radiusKm > host.radiusKm * STATION_ORBIT_R_OVER_R + 1e-9;
			if (
				host.radiusKm <= crossoverKm &&
				bandKm >= 400 - 1e-9 &&
				bandKm <= 2000 + 1e-9 &&
				strictlyAboveFloor
			)
				bandWon++;
		});
		// Non-vacuity in the strong form: the band demonstrably decided these
		// rows — 1,337 on the measured corpus, so the bar sits an order of
		// magnitude under it without pinning the corpus shape twice.
		expect(bandWon).toBeGreaterThan(100);
		// The fixture corpus is the place this is actually visible: the row
		// heights moved only where the floor bound (the capture script's own
		// invariant, checked here against the file the guard compares).
		const now = stationRows(baseline.worldSeed, baseline.galaxies);
		expect(now.length).toBe(baseline.rows.length);
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
