/**
 * What the facility-chip guard in `projectFinder` saves, measured against a
 * build without it.
 *
 * **The first version of this script measured the wrong thing.** Its two arms
 * were "no chip" and "REFINERY chip" — both on the *guarded* build — so the
 * difference it printed was the cost of *using* a chip over a different row
 * set, not the cost the guard removes. No arm ran the unguarded code at all,
 * which leaves the figure unable to support the sentence it exists for. The
 * arms here are one filter through two implementations:
 *
 * - **guarded** — `projectFinder` as it ships: with no facility chip active it
 *   never reads a system's station roster.
 * - **roster read anyway** — the same projection plus `generateContents` for
 *   every system the name and economy narrowing admits, which is what the
 *   shipped code did before the guard.
 *
 * The second arm is reconstructed here rather than kept behind a flag in
 * `galaxy-finder.ts`: a production branch existing for one measurement is
 * production state serving a script. What the guard removes is
 * `generateContents` over the admitted set, and that is what this runs.
 *
 * **A query, not a bare browse.** The harm is per keystroke. With no query at
 * the default one-jump budget, `projectFinder` now skips a system that cannot
 * yield a row before it would read any roster, so a browse is not where the
 * cost was. A one-character query admits most of the galaxy, which is the shape
 * a player types through.
 *
 *   bun scripts/measure-finder-projection.ts
 *
 * **The arms are interleaved and the order is shuffled from a printed seed**,
 * because a block design that always runs its arms in the same order measures
 * the order: `measure-light-cost.mjs` reported a term at 0.12-0.14 ms with
 * 144/144 pairings separated, and shuffling dropped the same term to a coin
 * toss. Quantiles are printed, never one reading. Every sample is taken on a
 * warm JIT, which is the state a player's session is in.
 */

import { generateGalaxy } from "../src/galaxy";
import {
	FINDER_DEFAULT_BUDGET,
	finderDefaultFilter,
	finderMatches,
	projectFinder,
} from "../src/galaxy-finder";
import { generateContents } from "../src/system";

const WORLD_SEED = 0x5ee11e;
const REPEATS = 24;
const WARMUP = 4;
const QUERY = "a";

const seedArg = process.argv.find((a) => a.startsWith("--seed="));
const shuffleSeed = seedArg ? Number(seedArg.slice(7)) : Date.now() & 0xffff;

/** A tiny deterministic stream, so the printed seed reproduces the order. */
const rng = (state: number) => () => {
	state = (state * 1664525 + 1013904223) >>> 0;
	return state / 0x1_0000_0000;
};

const galaxy = generateGalaxy(WORLD_SEED, 0);
const here = galaxy.systems[0];
const filter = {
	...finderDefaultFilter(),
	query: QUERY,
	budgetJumps: FINDER_DEFAULT_BUDGET,
};
const normalised = QUERY.trim().toLowerCase();

const guarded = (): number => {
	const t0 = performance.now();
	projectFinder(galaxy.systems, here, filter);
	return performance.now() - t0;
};

/** The shipped projection plus the roster read the guard removes. */
const unguarded = (): number => {
	const t0 = performance.now();
	projectFinder(galaxy.systems, here, filter);
	for (const system of galaxy.systems) {
		if (system.galaxy !== here.galaxy) continue;
		if (!finderMatches(system, filter, normalised)) continue;
		generateContents(system);
	}
	return performance.now() - t0;
};

const arms = [
	{ name: "guarded (shipped)", run: guarded },
	{ name: "roster read anyway", run: unguarded },
];

for (const arm of arms) for (let i = 0; i < WARMUP; i++) arm.run();

const samples = new Map<string, number[]>(arms.map((a) => [a.name, []]));
const order: number[] = [];
for (let i = 0; i < REPEATS; i++)
	for (let a = 0; a < arms.length; a++) order.push(a);
const random = rng(shuffleSeed);
for (let i = order.length - 1; i > 0; i--) {
	const j = Math.floor(random() * (i + 1));
	[order[i], order[j]] = [order[j], order[i]];
}
for (const a of order) samples.get(arms[a].name)?.push(arms[a].run());

const quantile = (xs: number[], q: number): number => {
	const sorted = [...xs].sort((x, y) => x - y);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

const admitted = galaxy.systems.filter(
	(s) => s.galaxy === here.galaxy && finderMatches(s, filter, normalised),
).length;

console.log(
	`seelite finder projection — query "${QUERY}" at budget ${FINDER_DEFAULT_BUDGET}, ` +
		`${admitted} of ${galaxy.systems.length} systems admitted, ` +
		`${REPEATS} interleaved runs per arm, shuffle seed ${shuffleSeed}`,
);
for (const arm of arms) {
	const xs = samples.get(arm.name) ?? [];
	console.log(
		`  ${arm.name.padEnd(20)} median ${quantile(xs, 0.5).toFixed(3)} ms  ` +
			`(p10 ${quantile(xs, 0.1).toFixed(3)}, p90 ${quantile(xs, 0.9).toFixed(3)})`,
	);
}
console.log(
	"\nThe difference is `generateContents` over the admitted set, paid on every\n" +
		"keystroke. It is what the chip guard removes from the unannotated path.",
);
