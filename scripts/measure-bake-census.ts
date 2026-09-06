/**
 * How much GPU memory #208's cubes cost, over the galaxies that exist.
 *
 * ```
 * bun scripts/measure-bake-census.ts [worlds]
 * ```
 *
 * `planet-bake.ts` states the answer and this reprints what a
 * fresh run derives, which is the rule `measure-hull-pricing.ts` set: a figure
 * stated as measured owes a shipped instrument that reproduces it.
 *
 * **A census rather than an estimate**, because the interesting number is the
 * worst case and the worst case is not the mean times anything — but read `max`
 * as a **sample** maximum: `worldSeed` is a free number and this sweeps four of
 * them, so 14 is the largest count seen over 8,192 systems and not a proof that
 * no seed makes fifteen (sage, PR #256, round 5). The megabyte figures inherit
 * that, and `main.ts`'s one-large-pair policy is what keeps them from growing
 * with the count rather than the census. The bakeable
 * bodies in a system are its rocky planets plus **every** moon — a moon is
 * always `airless` — so the count follows the generator's moon draw rather than
 * its planet count, and the distribution has a long right tail.
 *
 * What it cannot say: whether the driver honours the format. RGBA8 is what is
 * asked for and a driver may allocate wider, so these are lower bounds on what
 * the GPU holds. Nothing in this repo can read a byte count back — the same
 * limit `gpu-teardown.ts` opens with.
 */
import { GALAXY_COUNT, generateGalaxy } from "../src/galaxy";
import { classify } from "../src/planet-appearance";
import { bakePairBytes, systemBakeBytes } from "../src/planet-bake";
import { BAKE_FACE_SIZES } from "../src/relief-bands";
import { isBakeable } from "../src/planet-shaders";
import { generateContents, orbitWarmth } from "../src/system";

const WORLDS = Number(process.argv[2] ?? 4);

// The memory model is `planet-bake.ts`'s, imported rather than restated: this
// script exists to reprint what that module claims, and a second spelling of
// the arithmetic would let the two disagree silently.

const bakeableIn = (world: number, galaxy: number): number[] => {
	const out: number[] = [];
	for (const record of generateGalaxy(world, galaxy).systems) {
		const contents = generateContents(record);
		let n = 0;
		for (const planet of contents.planets) {
			const warmth = orbitWarmth(planet.aAu, contents.star.luminosity);
			if (isBakeable(classify("planet", warmth, planet.isGasGiant))) n++;
			// A moon is `airless` by `classify`'s first line, and `airless` bakes.
			// Counted from the roster rather than re-derived, so a class that stops
			// baking moves this figure without anything here being edited.
			// A moon is `airless` by `classify`'s first line. Read off the roster
			// rather than assumed, so a class that stops baking moves this figure.
			if (isBakeable("airless")) n += planet.moons.length;
		}
		out.push(n);
	}
	return out;
};

const counts: number[] = [];
let worstAt = "";
let worst = -1;
for (let world = 1; world <= WORLDS; world++)
	for (let galaxy = 0; galaxy < GALAXY_COUNT; galaxy++) {
		const here = bakeableIn(world, galaxy);
		for (const [index, n] of here.entries()) {
			counts.push(n);
			if (n > worst) {
				worst = n;
				worstAt = `world ${world}, galaxy ${galaxy}, system ${index}`;
			}
		}
	}

const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
const histogram = new Map<number, number>();
for (const n of counts) histogram.set(n, (histogram.get(n) ?? 0) + 1);

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
// At most one body at a time is near enough to want the large pair; the rest
// hold the small one. An upper bound rather than a reading — a system where
// every body is distant holds nothing but small pairs.
const [SMALL, LARGE] = BAKE_FACE_SIZES;
const held = (n: number) => systemBakeBytes(n, SMALL, LARGE);

console.log(
	`worlds 1..${WORLDS} x ${GALAXY_COUNT} galaxies = ${counts.length} systems`,
);
console.log(
	`bakeable bodies per system: mean ${mean.toFixed(2)}, max ${worst} (${worstAt})`,
);
console.log(
	[...histogram]
		.sort((a, b) => a[0] - b[0])
		.map(([n, k]) => `${n}:${k}`)
		.join("  "),
);
console.log(
	`one ${LARGE} pair ${mb(bakePairBytes(LARGE))}, one ${SMALL} pair ${mb(bakePairBytes(SMALL))}`,
);
console.log(
	`held: typical (${mean.toFixed(2)} bodies) ${mb(held(mean))}, ` +
		`worst (${worst}) ${mb(held(worst))}`,
);
