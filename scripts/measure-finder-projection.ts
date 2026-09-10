/**
 * What the facility-chip guard in `projectFinder` saves, measured against a
 * build without it.
 *
 * **The first version of this script measured the wrong thing.** Its two arms
 * were "no chip" and "REFINERY chip" — both on the *guarded* build — so the
 * difference it printed was the cost of *using* a chip over a different row
 * set, not the cost the guard removes. No arm ran the unguarded code at all,
 * which leaves the figure unable to support the sentence it exists for. The
 * arms here are one filter through three implementations:
 *
 * - **no chip** — `projectFinder` as it ships: with no facility chip active it
 *   never reads a system's station roster at all.
 * - **chip on, cache warm** — the same projection with `REFINERY` active, after
 *   the roster cache has been populated. This is what a keystroke costs while a
 *   chip is on, from the second keystroke onward.
 * - **roster read per system** — the projection plus `generateContents` for
 *   every admitted system. That is what the shipped code did before the chip
 *   guard, and before the roster cache; it is also the *first* keystroke's cost
 *   with a chip on, once per session per system.
 *
 * The third arm is reconstructed here rather than kept behind a flag in
 * `galaxy-finder.ts`: a production branch existing for one measurement is
 * production state serving a script.
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
const byIndex = new Map<number, (typeof galaxy.systems)[number]>();
for (const system of galaxy.systems) byIndex.set(system.index, system);

const guarded = (): number => {
	const t0 = performance.now();
	projectFinder(galaxy.systems, here, filter);
	return performance.now() - t0;
};

/** The shipped chip path, with the roster cache warm — what a keystroke costs
 *  while a facility chip is on, after the first one. */
const chipped = (): number => {
	const t0 = performance.now();
	projectFinder(galaxy.systems, here, { ...filter, facilities: ["REFINERY"] });
	return performance.now() - t0;
};

/** `generateContents` over the admitted set: the work the chip guard removes
 *  from the unannotated path, and — since the roster cache landed — the work
 *  that cache removes from every keystroke after the first. Measured beside the
 *  projection so the arms share their baseline. */
const rosterPerSystem = (): number => {
	const t0 = performance.now();
	// **The rows the projection already found, not a second filter pass.** This
	// re-walked all 256 systems through `finderMatches` — work arm 1 had already
	// paid inside `projectFinder`, and work the chip guard does not remove — so
	// the printed delta carried a whole extra name-and-economy sweep.
	const rows = projectFinder(galaxy.systems, here, filter);
	for (const row of [...rows.inBudget, ...rows.beyondRange])
		generateContents(byIndex.get(row.index) as (typeof galaxy.systems)[number]);
	return performance.now() - t0;
};

const arms = [
	{ name: "no chip (shipped)", run: guarded },
	{ name: "chip on, cache warm", run: chipped },
	{ name: "roster read per system", run: rosterPerSystem },
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
		`  ${arm.name.padEnd(24)} median ${quantile(xs, 0.5).toFixed(3)} ms  ` +
			`(p10 ${quantile(xs, 0.1).toFixed(3)}, p90 ${quantile(xs, 0.9).toFixed(3)})`,
	);
}
console.log(
	"\nThe third arm is `generateContents` over the admitted set. It is what the\n" +
		"chip guard removes from the unannotated path, and what the roster cache\n" +
		"removes from every keystroke after the first — so the second arm is the\n" +
		"warm cost of a chip, not the cold one. The cold pass is the third arm's\n" +
		"figure once, on the first keystroke of a session.",
);
