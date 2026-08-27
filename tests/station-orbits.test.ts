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
		// A seed × body × station full walk over 1,200 worlds: measured 4.5–5.8 s
		// under full-suite load against bun's 5 s default. The timeout is a
		// floor with headroom, not a budget — it only refuses to fail a busy
		// machine, and costs nothing when the walk is fast.
	}, 30_000);

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
 * against its shape before #32: of the 791 rows that exist on both sides,
 * the moved count below moved **in their orbit-radius column only** —
 * every other field byte-identical, because the change adds no draws to the
 * `DOMAIN.STATIONS` stream — and the unchanged ones are exactly the
 * small-host rows the band still owns. Both directions of drift fail this:
 * re-applying the old band moves the large hosts back down, and replacing
 * the band with a proportional rule moves the small ones up.
 *
 * The comparison is keyed on station identity — galaxy, system, station id,
 * kind — not position, because #51 landed between the two shapes and moved
 * rows around and brought two of its own:
 *
 * - two trade stations appear at galaxy 110 and galaxy 114, which #51's
 *   ladder fix newly reaches (the counts below refuse to let #32's split
 *   drift, and these two are outside it), and
 * - two rows at system g1#253 (trade, shipyard) re-parent planet-4 →
 *   planet-3 with **all five of their orbital columns**, #51 having rebuilt
 *   that system's ladder — a re-parenting is a re-placement, so these two
 *   are accounted as #51's and exempt from the radius-only rule (the floor
 *   still holds on them: the parent is a planet, and the invariants above
 *   walk every hosted station on the live generator).
 *
 * The `before` shape is not regenerated here (a generator that could emit
 * both rules would put the second one's draws into the shared stream). It
 * is committed as `station-orbits-pre-floor.json`, captured from the
 * generator at the tag `node-32-before-orbit-floor` — the tag stays as
 * provenance for where that file came from, but reading a committed fixture
 * keeps this guard working in checkouts that never saw the tag (a shallow
 * clone, an npm pack, a release tarball).
 */

/** The identity columns of `stationRows`: galaxy, system, station, kind. */
const IDENTITY_COLS = 4;

/** The orbit-radius column of `stationRows`, so the comparison below names
 *  which column a row moved in rather than just that one did. */
const RADIUS_COL = 5;

/** The parent column, whose two merged rows are #51's, not #32's. */
const PARENT_COL = 4;

/** Sentinel so a stray-column diff fails naming the row and column, not
 *  with an API bun:test does not have. */
const RADIUS_COL_ONLY = "radius-column-only";

/**
 * Measured by hand over the two committed fixtures at the merge with #51
 * (see the block below): the exact split this guard refuses to let drift.
 * 544 + 245 + 2 + 2 = 793 rows on the after side.
 */
const MOVED_ROWS = 544;
const UNCHANGED_ROWS = 245;
const PARENT_MOVED_ROWS = 2;
const NEW_ROWS = 2;

describe("the floor moved only what the shell race moved (node #32)", () => {
	test("the repinned fixture differs from the pre-#32 baseline in the radius column alone", () => {
		const before = (baselineBefore.rows as string[]).map((r) => r.split("\t"));
		const after = stationRows(baseline.worldSeed, baseline.galaxies).map((r) =>
			r.split("\t"),
		);
		const beforeById = new Map(
			before.map((r) => [r.slice(0, IDENTITY_COLS).join("\t"), r]),
		);
		let moved = 0;
		let unchanged = 0;
		let parentMoved = 0;
		let added = 0;
		for (const row of after) {
			const key = row.slice(0, IDENTITY_COLS).join("\t");
			const was = beforeById.get(key);
			if (was === undefined) {
				added++;
				continue;
			}
			let radiusDiff = false;
			let reparented = false;
			for (let c = IDENTITY_COLS; c < row.length; c++) {
				if (was[c] === row[c]) continue;
				if (c === PARENT_COL) {
					// A re-parent is a re-placement: every orbit column may
					// follow it. #51's two rows are the only ones allowed.
					reparented = true;
					continue;
				}
				if (reparented) continue;
				if (c === RADIUS_COL) {
					radiusDiff = true;
					// Strictly upward: a floor never lowers an orbit.
					expect(+row[RADIUS_COL]).toBeGreaterThan(+was[RADIUS_COL]);
				} else {
					// Any other column differing is drift this guard exists to
					// catch; naming it in the expected value keeps the message.
					expect(`row ${key} drifted outside the radius column at ${c}`).toBe(
						RADIUS_COL_ONLY,
					);
				}
			}
			if (reparented) {
				parentMoved++;
				continue;
			}
			if (radiusDiff) moved++;
			else unchanged++;
		}
		// Every pre-#32 row still exists: #32 adds no draws and #51 dropped
		// none, so nothing may vanish from the before side.
		const afterIds = new Set(
			after.map((r) => r.slice(0, IDENTITY_COLS).join("\t")),
		);
		expect(
			before.filter((r) => !afterIds.has(r.slice(0, IDENTITY_COLS).join("\t"))),
		).toEqual([]);
		// The measured split, not a vague "some moved". All sides are
		// deterministic over a fixed corpus.
		expect(moved).toBe(MOVED_ROWS);
		expect(unchanged).toBe(UNCHANGED_ROWS);
		expect(parentMoved).toBe(PARENT_MOVED_ROWS);
		expect(added).toBe(NEW_ROWS);
	});
});
