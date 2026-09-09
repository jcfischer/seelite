/**
 * What one finder projection costs, with and without a facility chip.
 *
 * **The figure this exists for is a two-arm timing quoted in a PR body**, and a
 * measurement stated with no instrument behind it reads as measured while being
 * unreproducible — the failure `a-prediction-in-a-spec-reads-as-a-measurement`
 * names. So the number is not written down anywhere; this prints it on the
 * machine it is run on.
 *
 * The arms differ by one thing: `projectFinder` reads a system's whole station
 * roster (`generateContents`) only when a facility chip is active. Without that
 * guard, a keystroke generated the contents of every matching system — up to the
 * galaxy's 256 — to answer a question no chip had posed.
 *
 *   bun scripts/measure-finder-projection.ts
 *
 * **The arms are interleaved and the order is shuffled from a printed seed**,
 * because a block design that always runs its arms in the same order measures
 * the order: `measure-light-cost.mjs` reported a term at 0.12–0.14 ms with
 * 144/144 pairings separated, and shuffling dropped the same term to a coin
 * toss. A range is quoted, never one reading.
 */

import { generateGalaxy } from "../src/galaxy";
import {
	FINDER_MAX_BUDGET,
	type FacilityChip,
	finderDefaultFilter,
	projectFinder,
} from "../src/galaxy-finder";

const WORLD_SEED = 0x5ee11e;
const REPEATS = 24;
const WARMUP = 8;

const seedArg = process.argv.find((a) => a.startsWith("--seed="));
const shuffleSeed = seedArg ? Number(seedArg.slice(7)) : Date.now() & 0xffff;

/** A tiny deterministic stream, so the printed seed reproduces the order. */
const rng = (state: number) => () => {
	state = (state * 1664525 + 1013904223) >>> 0;
	return state / 0x1_0000_0000;
};

const galaxy = generateGalaxy(WORLD_SEED, 0);
const here = galaxy.systems[0];

const arms: Array<{ name: string; facilities: readonly FacilityChip[] }> = [
	{ name: "no facility chip", facilities: [] },
	{ name: "REFINERY", facilities: ["REFINERY"] },
];

const once = (facilities: readonly FacilityChip[]): number => {
	const filter = {
		...finderDefaultFilter(),
		facilities,
		budgetJumps: FINDER_MAX_BUDGET,
	};
	const t0 = performance.now();
	projectFinder(galaxy.systems, here, filter, {
		knowledge: {},
	});
	return performance.now() - t0;
};

for (const arm of arms) for (let i = 0; i < WARMUP; i++) once(arm.facilities);

const samples = new Map<string, number[]>(arms.map((a) => [a.name, []]));
const order: number[] = [];
for (let i = 0; i < REPEATS; i++)
	for (let a = 0; a < arms.length; a++) order.push(a);
const random = rng(shuffleSeed);
for (let i = order.length - 1; i > 0; i--) {
	const j = Math.floor(random() * (i + 1));
	[order[i], order[j]] = [order[j], order[i]];
}
for (const a of order)
	samples.get(arms[a].name)?.push(once(arms[a].facilities));

const quantile = (xs: number[], q: number): number => {
	const sorted = [...xs].sort((x, y) => x - y);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

console.log(
	`seelite finder projection — ${galaxy.systems.length} systems, seed 0x${WORLD_SEED.toString(16)}, ` +
		`${REPEATS} interleaved runs per arm, shuffle seed ${shuffleSeed}`,
);
for (const arm of arms) {
	const xs = samples.get(arm.name) ?? [];
	console.log(
		`  ${arm.name.padEnd(18)} median ${quantile(xs, 0.5).toFixed(3)} ms  ` +
			`(p10 ${quantile(xs, 0.1).toFixed(3)}, p90 ${quantile(xs, 0.9).toFixed(3)})`,
	);
}
console.log(
	"\nThe difference is `generateContents` over every system the name and economy\n" +
		"narrowing admits. It is paid on every keystroke, which is why the guard is\n" +
		"on the chip rather than on the result.",
);
