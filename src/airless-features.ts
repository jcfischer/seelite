import { mix, seededRand } from "./rng";

type V3 = [number, number, number];
type Basin = [number, number, number, number];
export const planetSeedOffset = (seed: number) => (seed % 997) / 97;

// Float32 approximation of NOISE_GLSL.hash31, used only to select candidate
// cells. The shader reconstructs ray anchors from the cells with its own hash,
// so CPU/GPU rounding cannot move a ray away from the crater it names.
const f = Math.fround;
const fract = (v: number) => v - Math.floor(v);
function hash(cell: V3, add = 0): number {
	const p = cell.map((v) => fract(f(f(v + add) * f(0.1031))));
	const d = f(
		f(f(p[0] * f(p[1] + f(33.33))) + f(p[1] * f(p[2] + f(33.33)))) +
			f(p[2] * f(p[0] + f(33.33))),
	);
	const q = p.map((v) => f(v + d));
	return fract(f(f(q[0] + q[1]) * q[2]));
}

/** Fine-octave candidate geometry, in unit-sphere object space. */
export function smallCrater(cell: V3, seedOffset: number) {
	const offset = f(f(seedOffset) * f(1.7));
	const centre = cell.map(
		(v, i) => (v + hash(cell, [0, 61.7, 13.3][i])) / 8 - offset,
	) as V3;
	return { centre, radius: (0.16 + 0.34 * hash(cell, 3.1)) / 8 };
}

/** Node #213's sparse populations. Constructed once, never per fragment.
 * Basins: jittered low-frequency cell walk projected onto the unit sphere.
 * Rays: the youngest surface-intersecting cells of the existing 8x field.
 * Age is a seeded display property; neither population changes world state.
 */
export function airlessFeatures(seed: number): {
	basins: Basin[];
	rayCells: V3[];
} {
	const rand = seededRand(mix(seed, 0x213ba51));
	const count = 2 + Math.floor(rand() * 3);
	const candidates: { basin: Basin; age: number }[] = [];
	for (let x = -2; x <= 2; x++)
		for (let y = -2; y <= 2; y++)
			for (let z = -2; z <= 2; z++)
				for (let sample = 0; sample < 4; sample++) {
					const c = [x + rand(), y + rand(), z + rand()];
					const n = Math.hypot(...c);
					// Four basins need more packing room than two on a unit sphere.
					const radius = 0.78 - (count - 2) * 0.04 + rand() * 0.02;
					const age = rand();
					if (n > 1.2 && n < 2.2)
						candidates.push({
							basin: [...c.map((v) => v / n), radius] as Basin,
							age,
						});
				}
	candidates.sort((a, b) => a.age - b.age);
	const basins: Basin[] = [];
	// Wide basins can leave a greedy choice no room for the fourth. Search
	// the bounded low-frequency candidate set, preserving seeded age order.
	const place = (start: number): boolean => {
		if (basins.length === count) return true;
		for (let i = start; i < candidates.length; i++) {
			const { basin } = candidates[i];
			if (
				basins.some(
					(other) =>
						Math.hypot(...basin.slice(0, 3).map((v, j) => v - other[j])) <=
						basin[3] + other[3] + 0.06,
				)
			)
				continue;
			basins.push(basin);
			if (place(i + 1)) return true;
			basins.pop();
		}
		return false;
	};
	place(0);
	if (basins.length !== count)
		throw new Error("airless basin cell walk exhausted");

	const offset = planetSeedOffset(seed);
	const origin = f(f(offset) * f(1.7)) * 8;
	const young: { cell: V3; age: number }[] = [];
	for (let x = Math.floor(origin - 9); x <= Math.ceil(origin + 8); x++)
		for (let y = Math.floor(origin - 9); y <= Math.ceil(origin + 8); y++)
			for (let z = Math.floor(origin - 9); z <= Math.ceil(origin + 8); z++) {
				const cell: V3 = [x, y, z];
				const crater = smallCrater(cell, offset);
				const n = Math.hypot(...crater.centre);
				// Flooded small impacts no longer have relief: date only the
				// surviving highland craters, so every ray has a visible source.
				if (
					Math.abs(n - 1) < crater.radius * 0.25 &&
					basins.every(
						(basin) =>
							Math.hypot(...crater.centre.map((v, i) => v / n - basin[i])) >
							basin[3] + crater.radius,
					)
				)
					young.push({
						cell,
						age: mix(mix(mix(seed, x), y), z) / 0x1_0000_0000,
					});
			}
	young.sort((a, b) => a.age - b.age);
	const rayCells = young
		.slice(0, 2 + Math.floor(rand() * 2))
		.map((c) => c.cell);
	if (rayCells.length < 2)
		throw new Error("airless young crater cell walk exhausted");
	return { basins, rayCells };
}
