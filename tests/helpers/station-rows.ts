/**
 * Shared corpus machinery for the generator tests and the measurement scripts:
 * one traversal, one set of world seeds, and one serialisation of a station's
 * placement used by both the capture script and the guard that checks against
 * what it captured.
 *
 * It lives under `tests/helpers/` rather than in `scripts/` because the guard is
 * the thing that must not drift: the dependency should point from the operator
 * tooling into shared test code, not from the guarded tier out into tooling.
 *
 * It lives in its own module because the two sides must agree exactly. The
 * first version copied the row builder into `tests/station-orbits.test.ts` with
 * a comment asking the next editor to keep them identical — which is a
 * convention, not a mechanism: adding a field to one side and not the other
 * makes the guard compare a format the fixture was never written in, and
 * nothing fails.
 */

import { SURFACE_MARGIN } from "../../src/cruise";
import {
	GALAXY_COUNT,
	generateGalaxy,
	type SystemRecord,
} from "../../src/galaxy";
import { type Body, makeWorld } from "../../src/sim";
import { generateContents, type SystemContents } from "../../src/system";
import type { Vec3 } from "../../src/vec3";

/**
 * Walks `galaxies` of one world, generating each system's contents once.
 *
 * The single traversal both the row builder and the undockable-systems census
 * go through, for the reason in this module's header: two hand-copied walks
 * over the same generator entry points drift, and nothing fails when they do.
 */
export function forEachSystem(
	worldSeed: number,
	galaxies: readonly number[],
	visit: (
		record: SystemRecord,
		contents: SystemContents,
		galaxy: number,
	) => void,
): void {
	for (const g of galaxies) {
		// Both bounds and integrality: `generateGalaxy` will derive a seed for a
		// negative or fractional index and cheerfully return systems belonging to
		// no galaxy, which is a silently wrong corpus rather than an error.
		if (!Number.isInteger(g) || g < 0 || g >= GALAXY_COUNT)
			throw new Error(`galaxy ${g} does not exist`);
		for (const record of generateGalaxy(worldSeed, g).systems) {
			visit(record, generateContents(record), g);
		}
	}
}

/**
 * Every station of every system in `galaxies`, one tab-separated row each.
 *
 * Floats are written as `toExponential(12)` rather than compared numerically.
 * `tests/galaxy.test.ts` records why an exact float cannot be pinned across
 * platforms; station orbits are plain arithmetic over `rand()` with no
 * transcendental in the chain, so twelve significant digits sits far inside any
 * real divergence while still catching a shifted draw — which moves the first
 * digit, not the last.
 */
export function stationRows(
	worldSeed: number,
	galaxies: readonly number[],
): string[] {
	const rows: string[] = [];
	forEachSystem(worldSeed, galaxies, (record, contents, g) => {
		for (const s of contents.stations) {
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
	});
	return rows;
}

/**
 * Every host-orbiting station, paired with the body it orbits.
 *
 * The three node-#32 invariants — at or above the r/R floor, never inside the
 * host's cruise shell, and the band still winning below the crossover — walk
 * the same tree over the same corpus, and a fourth is cheap to imagine. A
 * hand-copied walk that forgets the star-centric refineries (`parentId: null`,
 * no host to clear) or treats an orphan host as a skip instead of an error
 * changes what "every station" means between two tests that both claim it.
 */
export function forEachHostedStation(
	visit: (
		station: SystemContents["stations"][number],
		host: SystemContents["planets"][number],
	) => void,
	opts: { galaxies?: readonly number[]; worlds?: readonly number[] } = {},
): void {
	for (const world of opts.worlds ?? worldSeeds(8)) {
		forEachSystem(world, opts.galaxies ?? ALL_GALAXIES, (_record, contents) => {
			for (const s of contents.stations) {
				if (!s.parentId) continue; // star-centric refinery: no host
				const host = contents.planets.find((p) => p.id === s.parentId);
				if (!host) throw new Error(`orphan station ${s.id}`);
				visit(s, host);
			}
		});
	}
}

/** Seeds the placed-geometry walk covers by default — the headless tier's
 *  budget. The floor is by construction, so a regression in it fails any
 *  sample; the deep sweep belongs to `scripts/measure-station-shells.ts`,
 *  which goes to 8,000 on demand (500 seeds ≈ 850 placed stations). */
export const DEFAULT_SHELL_SEEDS: readonly number[] = Array.from(
	{ length: 500 },
	(_, i) => i + 1,
);

/**
 * Every host-orbiting station **at its placed t0 position**, beside every
 * other body the game moves.
 *
 * `makeWorld(seed).system`, not `generateContents`: the question is where the
 * station *sits* at t0, which only the world build resolves — and the bodies
 * come from `byId`, the complete set the game moves: star, planets, moons,
 * stations. `contents.planets` is pre-placement (no `pos`) and silently omits
 * the moons. Both this walk and the instrument `measure-station-shells.ts`
 * go through it for the reason this module's header gives: a hand-copied
 * sweep is a second definition of "every station", and the two drift.
 *
 * The bodies resolve once per world rather than once per station-body pair,
 * and the orphan guard is the same throw the radius walk uses.
 */
export function forEachPlacedStation(
	visit: (
		station: Body,
		host: Body,
		others: readonly Body[],
		seed: number,
	) => void,
	seeds: Iterable<number> = DEFAULT_SHELL_SEEDS,
): void {
	for (const seed of seeds) {
		const S = makeWorld(seed).system;
		const bodies = [...S.byId.values()];
		for (const st of S.contents.stations) {
			if (!st.parentId) continue; // star-centric refinery: no host
			const station = S.byId.get(st.id);
			const host = S.byId.get(st.parentId);
			if (!station?.pos || !host?.pos)
				throw new Error(`orphan station ${st.id}`);
			visit(station, host, bodies, seed);
		}
	}
}

/** Flat distance between two placed positions, km. Shared by the t0 shell
 *  test and the instrument so the measure cannot drift from the assertion —
 *  the reason this module exists. */
export function dist(a: Vec3, b: Vec3): number {
	return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Whether `a` sits inside `b`'s cruise shell — the placed-geometry predicate
 *  the t0 test asserts *never* holds and the instrument counts when it does.
 *  One definition, shared, so the two cannot drift. A body with no position
 *  (pre-placement) or a non-positive radius has no shell and never counts. */
export function shellViolation(a: Body, b: Body): boolean {
	const pa = a.pos;
	const pb = b.pos;
	if (!pa || !pb) return false;
	if (!(b.radiusKm > 0)) return false;
	return dist(pa, pb) < b.radiusKm * SURFACE_MARGIN;
}

/** Every galaxy of a world. The census and the clamp measurement sweep all of
 *  them; the placement fixture pins only the two its capture script names. */
export const ALL_GALAXIES: readonly number[] = Array.from(
	{ length: GALAXY_COUNT },
	(_, i) => i,
);

/**
 * `n` arbitrary but reproducible world seeds.
 *
 * Spread by Knuth's multiplicative constant, the same decorrelation `rng.ts`
 * relies on, because consecutive integers make poor seeds — a generator's first
 * draw from seeds one apart is nearly the same number, which `rng.ts` documents
 * at length. Measuring one world would measure one world; `main.ts` picks the
 * real one with `Math.random()`.
 */
export function worldSeeds(n: number): number[] {
	return Array.from({ length: n }, (_, i) => ((i + 1) * 2654435761) >>> 0);
}

/**
 * Every station's *generated fields*, one row each — the companion to
 * `stationRows` for node #28's `blackMarket` and `spinRpm`.
 *
 * Separate from `stationRows` rather than columns added to it, because the two
 * fixtures make opposite claims and must be able to move independently: the
 * placement rows are pinned to a world captured *before* these fields existed
 * and must not move when they land, while these rows can only be captured
 * after. Widening the placement row would have made repinning one an alarm on
 * the other, which is the failure `station-orbits.test.ts` warns about between
 * itself and the galaxy digest.
 */
export function stationFieldRows(
	worldSeed: number,
	galaxies: readonly number[],
): string[] {
	const rows: string[] = [];
	forEachSystem(worldSeed, galaxies, (record, contents, g) => {
		for (const s of contents.stations) {
			rows.push(
				[
					g,
					record.index,
					s.id,
					s.type,
					record.government,
					s.blackMarket ? "fence" : "-",
					s.spinRpm.toExponential(12),
				].join("\t"),
			);
		}
	});
	return rows;
}

/**
 * Refineries by government, and how many of them are fences.
 *
 * Shared by `tests/station.test.ts` and `scripts/measure-fence-rate.ts` for the
 * reason in this module's header: the two sweep different corpora on purpose —
 * a second and a quarter of a minute — but they must agree exactly on *what a
 * fence rate is*. Two hand-copied tallies drift, and nothing fails when they do.
 *
 * `stopAt` ends the sweep early: the test wants a refinery total, the instrument
 * wants the `government = 7` bucket alone, and neither wants the other's cost.
 */
export interface FenceTally {
	/** Refineries seen, by government 0–7. */
	total: number[];
	/** How many of those were fences. */
	fences: number[];
	refineries: number;
	systems: number;
	worlds: number;
}

export function fenceTally(
	worlds: readonly number[],
	galaxies: readonly number[],
	stopAt: (tally: FenceTally) => boolean,
): FenceTally {
	const tally: FenceTally = {
		total: new Array(8).fill(0),
		fences: new Array(8).fill(0),
		refineries: 0,
		systems: 0,
		worlds: 0,
	};
	for (const world of worlds) {
		if (stopAt(tally)) break;
		tally.worlds++;
		forEachSystem(world, galaxies, (record, contents) => {
			tally.systems++;
			for (const station of contents.stations) {
				if (station.type !== "refinery") continue;
				tally.refineries++;
				tally.total[record.government]++;
				if (station.blackMarket) tally.fences[record.government]++;
			}
		});
	}
	return tally;
}

/** How many standard errors an observed rate sits from the ramp's `p`, over
 *  `n` samples. Shared for the same reason as the tally: the test and the
 *  instrument both gate on 4σ, and a bucket that "passes" under two different
 *  definitions of σ is evidence of nothing. */
export function sigmaOff(rate: number, p: number, n: number): number {
	return (rate - p) / Math.sqrt((p * (1 - p)) / n);
}
