/**
 * What resample-until-connected does to the radial profile.
 *
 * `bun scripts/measure-rejection-bias.ts [worldSeeds]`
 *
 * The spec (§5) says rejection "distorts the density profile not at all",
 * arguing that it keeps only samples that were already good. That is true of
 * each system taken alone and false of the population: acceptance depends on
 * where all 256 landed *together*, so the surviving layouts are drawn from a
 * conditioned joint distribution, not from ρ(r).
 *
 * This measures the size of that conditioning by comparing every attempt-0
 * layout (accepted or not — the unconditioned sample) against the layouts that
 * were actually accepted. It exists because the alternative was an argument in
 * a comment, and an argument in a comment is what got the claim wrong.
 *
 * A script rather than a test: separating a sub-percent shift from noise needs
 * ~10⁵ systems per arm, which is seconds of CPU rather than a suite's budget.
 * The suite's KS test (2,048 samples) cannot see a shift this small, and saying
 * so is part of the point.
 */

import {
	GALAXY_COUNT,
	GALAXY_RADIUS_LY,
	MAX_LAYOUT_ATTEMPTS,
	SYSTEMS_PER_GALAXY,
	isConnected,
	radialCdf,
	systemPosition,
	systemSeedFor,
} from "../src/galaxy";
import { type Vec3, lengthSq } from "../src/sim";

const seeds = Number(process.argv[2] ?? 400);
const SHELLS = 8;
const unconditioned = new Array(SHELLS).fill(0);
const accepted = new Array(SHELLS).fill(0);
let unconditionedN = 0;
let acceptedN = 0;

const shellOf = (r: number) =>
	Math.min(SHELLS - 1, Math.floor((r / GALAXY_RADIUS_LY) * SHELLS));

const started = performance.now();
for (let world = 1; world <= seeds; world++) {
	for (let g = 0; g < GALAXY_COUNT; g++) {
		for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt++) {
			const positions: Vec3[] = [];
			for (let n = 0; n < SYSTEMS_PER_GALAXY; n++) {
				positions.push(systemPosition(systemSeedFor(world, g, attempt, n)));
			}
			const radii = positions.map((p) => Math.sqrt(lengthSq(p)));
			if (attempt === 0) {
				for (const r of radii) unconditioned[shellOf(r)]++;
				unconditionedN += radii.length;
			}
			if (isConnected(positions)) {
				for (const r of radii) accepted[shellOf(r)]++;
				acceptedN += radii.length;
				break;
			}
		}
	}
}

const meanRadius = (hist: number[], n: number) =>
	hist.reduce(
		(acc, count, i) =>
			acc + (count / n) * ((i + 0.5) / SHELLS) * GALAXY_RADIUS_LY,
		0,
	);

console.log(`galaxies: ${seeds * GALAXY_COUNT}, systems per arm: ${acceptedN}`);
console.log(
	"shell        r/R    analytic  unconditioned   accepted    accepted/uncond",
);
for (let i = 0; i < SHELLS; i++) {
	const lo = (i / SHELLS) * GALAXY_RADIUS_LY;
	const hi = ((i + 1) / SHELLS) * GALAXY_RADIUS_LY;
	const u = unconditioned[i] / unconditionedN;
	const a = accepted[i] / acceptedN;
	console.log(
		`  ${i}    ${(i / SHELLS).toFixed(2)}-${((i + 1) / SHELLS).toFixed(2)}   ${(radialCdf(hi) - radialCdf(lo)).toFixed(5)}     ${u.toFixed(5)}       ${a.toFixed(5)}      ${(a / u).toFixed(4)}`,
	);
}
const mu = meanRadius(unconditioned, unconditionedN);
const ma = meanRadius(accepted, acceptedN);
console.log(
	`mean radius: unconditioned ${mu.toFixed(4)} LY, accepted ${ma.toFixed(4)} LY (${(((ma - mu) / mu) * 100).toFixed(2)}%)`,
);
console.log(`elapsed: ${((performance.now() - started) / 1000).toFixed(1)}s`);
