/**
 * How much GPU memory #208's cubes cost, over the galaxies that exist.
 *
 * ```
 * bun scripts/measure-bake-census.ts [worlds]
 * ```
 *
 * `planet-bake.ts`'s `BAKE_FACE_PX` states the answer and this reprints what a
 * fresh run derives, which is the rule `measure-hull-pricing.ts` set: a figure
 * stated as measured owes a shipped instrument that reproduces it.
 *
 * **A census rather than an estimate**, because the interesting number is the
 * worst case and the worst case is not the mean times anything. The bakeable
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
import { BAKE_FACE_PX } from "../src/planet-bake";
import { isBakeable } from "../src/planet-shaders";
import { generateContents, orbitWarmth } from "../src/system";

const WORLDS = Number(process.argv[2] ?? 4);

/**
 * Bytes one cube **pair** holds, mipmaps included.
 *
 * Six faces, four bytes a texel, times two cubes — albedo with `specMask` in
 * alpha, and the object-space normal with the class's spare scalar. The 4/3 is
 * the mip chain, which is not optional here: a body at 8 radii is 0.41 screen
 * pixels per texel on a 256 cube and 0.16 at 20, so minification of six times
 * over shimmers without one.
 */
const pairBytes = (facePx: number) => (6 * facePx * facePx * 4 * 2 * 4) / 3;

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
			for (const _ of planet.moons) if (isBakeable("airless")) n++;
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
// One body is in the near layer at any moment and holds the large pair; the
// rest hold the small one. Whether that near cube is ever *sampled* is a
// separate question — a large planet at two radii is past the band and drawn
// procedurally with its 512 pair idle, which is the one case this figure counts
// and the frame does not.
const held = (n: number) =>
	pairBytes(BAKE_FACE_PX.near) +
	Math.max(0, n - 1) * pairBytes(BAKE_FACE_PX.approach);

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
	`one ${BAKE_FACE_PX.near} pair ${mb(pairBytes(BAKE_FACE_PX.near))}, ` +
		`one ${BAKE_FACE_PX.approach} pair ${mb(pairBytes(BAKE_FACE_PX.approach))}`,
);
console.log(
	`held: typical (${mean.toFixed(2)} bodies) ${mb(held(mean))}, ` +
		`worst (${worst}) ${mb(held(worst))}`,
);
