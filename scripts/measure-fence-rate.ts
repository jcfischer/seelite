/**
 * The fence rate against government, measured over a corpus big enough to carry
 * the claim (`station-types.md` §5.2, §9.1).
 *
 * **Why this is a script and not only a test.** §9.1 sizes the corpus by *total
 * refineries* — "over ≥ 20,000" — and that is the wrong quantity. The binding
 * assertion is the rate at `government = 7`, and a `government = 7` system that
 * also has a belt is rare: over 200 worlds (409,600 systems, 156,388
 * refineries) only 735 refineries sat at `g = 7`, against 16,647 at `g = 0`. At
 * §9.1's 20,000 total the `g = 7` bucket holds about 120 refineries, where the
 * standard error on a rate of 0.075 is 0.024 — the whole width of the
 * [0.05, 0.11] band the spec asks to be inside. A test written that way passes
 * or fails on the seed set it happens to use, which is the "assertion that
 * cannot fail" defect §9.1 objects to, wearing the opposite face.
 *
 * So the in-suite test (`tests/station.test.ts`) asserts the buckets its budget
 * can carry, and this instrument is where the `g = 7` band is actually
 * measured. It sweeps until that bucket alone is large enough, which costs
 * roughly a quarter of a minute — too slow for a suite that is run on every
 * edit, and cheap for something run when the ramp changes.
 *
 *   bun run scripts/measure-fence-rate.ts [minG7]
 *
 * Exit code is the assertion: non-zero if any bucket is outside four standard
 * errors of `fenceProbability(g)`, or if the two ends miss §5.2's bands.
 */

import { GALAXY_COUNT, generateGalaxy } from "../src/galaxy";
import { fenceProbability } from "../src/station";
import { generateContents } from "../src/system";
import { worldSeeds } from "../tests/helpers/station-rows";

/** The `g = 7` bucket size to sweep for. 2,000 puts the standard error at
 *  0.0059, so §5.2's ±0.025 band is a little over four of them. */
const MIN_G7 = Number(process.argv[2] ?? 2000);
/** A ceiling, so a change that stops generating refineries at all reports that
 *  rather than sweeping for ever. */
const MAX_WORLDS = 2000;

/** Every figure printed goes through this (#7's rule): an instrument that
 *  quietly reports garbage is worse than one that dies, because its numbers get
 *  transcribed into a spec. */
function finite(label: string, x: number): number {
	if (!Number.isFinite(x)) throw new Error(`${label} is not finite: ${x}`);
	return x;
}

const total = new Array(8).fill(0);
const fences = new Array(8).fill(0);
let worlds = 0;
let systems = 0;

for (const world of worldSeeds(MAX_WORLDS)) {
	worlds++;
	for (let g = 0; g < GALAXY_COUNT; g++) {
		for (const record of generateGalaxy(world, g).systems) {
			systems++;
			for (const station of generateContents(record).stations) {
				if (station.type !== "refinery") continue;
				total[record.government]++;
				if (station.blackMarket) fences[record.government]++;
			}
		}
	}
	if (total[7] >= MIN_G7) break;
}

const refineries = total.reduce((a, b) => a + b, 0);
console.log(
	`${worlds} worlds, ${systems} systems, ${refineries} refineries ` +
		`(${((100 * refineries) / systems).toFixed(1)}% of systems)\n`,
);
console.log("  g |      n |    rate | expected |  (rate − expected) / SE");

let failures = 0;
for (let g = 0; g < 8; g++) {
	const n = total[g];
	if (n === 0) {
		console.log(
			`  ${g} |      0 |       — |        — |  no refineries sampled`,
		);
		failures++;
		continue;
	}
	const rate = finite(`rate at g=${g}`, fences[g] / n);
	const expected = fenceProbability(g);
	const se = finite(`SE at g=${g}`, Math.sqrt((expected * (1 - expected)) / n));
	const z = finite(`z at g=${g}`, (rate - expected) / se);
	const bad = Math.abs(z) > 4;
	if (bad) failures++;
	console.log(
		`  ${g} | ${String(n).padStart(6)} | ${rate.toFixed(4)} |   ${expected.toFixed(4)} |  ` +
			`${z >= 0 ? "+" : ""}${z.toFixed(2)}σ${bad ? "   ← outside 4σ" : ""}`,
	);
}

/** §5.2's two named bands, which is what §9.1 actually asks to be checked. */
const band = (g: number, lo: number, hi: number) => {
	const rate = fences[g] / total[g];
	const ok = rate > lo && rate < hi;
	if (!ok) failures++;
	console.log(
		`\n  g=${g}: ${rate.toFixed(4)} ${ok ? "inside" : "OUTSIDE"} [${lo}, ${hi}] over ${total[g]} refineries`,
	);
};
band(0, 0.92, 0.98);
band(7, 0.05, 0.11);

if (failures > 0) {
	console.error(`\n${failures} bucket(s) failed`);
	process.exit(1);
}
console.log("\nevery bucket within 4σ of the ramp, both bands held");
