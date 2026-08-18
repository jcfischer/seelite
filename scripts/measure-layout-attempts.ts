/**
 * How many layouts a galaxy needs before its jump graph is one component.
 *
 * `bun scripts/measure-layout-attempts.ts [worldSeeds]`
 *
 * This produces the distribution quoted on `MAX_LAYOUT_ATTEMPTS` in
 * `src/galaxy.ts`. It exists because that constant is justified by a
 * measurement, and a measurement a reader cannot re-run is an assertion:
 * the spec's §10 says a sharp rise in these counts is the signal to revisit
 * the density profile (§3) or the radius (§2.1), and acting on that means
 * comparing against a baseline you can reproduce rather than against a number
 * in a comment.
 *
 * A script and not a test, deliberately. It asserts nothing — the suite's job is
 * to catch a *change*, which it does with a pinned attempt vector for one seed
 * plus a five-seed ceiling sweep. This is the instrument, not the alarm. (It
 * prints its own elapsed time; ~5 s at the default 200 seeds, which is also
 * where `MAX_LAYOUT_ATTEMPTS`'s per-attempt cost figure comes from.)
 */

import {
	GALAXY_COUNT,
	MAX_LAYOUT_ATTEMPTS,
	clearLayoutCache,
	layoutGalaxy,
} from "../src/galaxy";

const seeds = Number(process.argv[2] ?? 200);
const attempts: number[] = [];
const started = performance.now();

for (let world = 1; world <= seeds; world++) {
	// The cache is keyed on (worldSeed, galaxy) and every seed here is distinct,
	// so it never hits — cleared anyway, so that a future caching change cannot
	// silently turn this into a measurement of the cache.
	clearLayoutCache();
	for (let g = 0; g < GALAXY_COUNT; g++) {
		attempts.push(layoutGalaxy(world, g).attempt);
	}
}

attempts.sort((a, b) => a - b);
const at = (q: number) =>
	attempts[Math.min(attempts.length - 1, Math.floor(attempts.length * q))];
const mean = attempts.reduce((a, b) => a + b, 0) / attempts.length;
const elapsed = ((performance.now() - started) / 1000).toFixed(1);

console.log(
	`galaxies sampled : ${attempts.length} (${seeds} world seeds x ${GALAXY_COUNT})`,
);
console.log(`mean attempts    : ${mean.toFixed(2)}`);
console.log(`median           : ${at(0.5)}`);
console.log(`p95              : ${at(0.95)}`);
console.log(`p99              : ${at(0.99)}`);
console.log(`max              : ${attempts[attempts.length - 1]}`);
console.log(`ceiling          : ${MAX_LAYOUT_ATTEMPTS} (MAX_LAYOUT_ATTEMPTS)`);
console.log(
	`first-try rate   : ${((attempts.filter((a) => a === 0).length / attempts.length) * 100).toFixed(1)}%`,
);
console.log(`elapsed          : ${elapsed}s`);
