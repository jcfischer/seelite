import { mix, seededRand } from "./rng";
import { planetSeedOffset } from "./planet-appearance";

type V3 = [number, number, number];
type Basin = [number, number, number, number];

/** Seed-order clique search. At most 500 shell candidates, 124,750 scalar
 * pair checks, and 10,000 search visits per body. Return null on exhaustion
 * rather than stall or abort boot.
 * The lower budget argument exercises exhaustion without a timing assertion.
 */
export function selectBasins(
	candidates: Basin[],
	count: number,
	budget = 10_000,
): Basin[] | null {
	if (
		candidates.length > 500 ||
		!Number.isInteger(budget) ||
		budget < 1 ||
		budget > 10_000 ||
		!Number.isInteger(count) ||
		count < 2 ||
		count > 4
	)
		throw new Error("invalid airless basin search budget");
	const n = candidates.length;
	const compatible = new Uint8Array(n * n);
	for (let i = 0; i < n; i++)
		for (let j = i + 1; j < n; j++) {
			const a = candidates[i],
				b = candidates[j];
			const fits = Number(
				Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > a[3] + b[3] + 0.06,
			);
			compatible[i * n + j] = compatible[j * n + i] = fits;
		}
	const chosen: number[] = [];
	let visits = 0;
	const place = (start: number): boolean => {
		if (chosen.length === count) return true;
		for (let i = start; i < n; i++) {
			if (++visits > budget) return false;
			if (chosen.some((j) => !compatible[i * n + j])) continue;
			chosen.push(i);
			if (place(i + 1)) return true;
			chosen.pop();
			if (visits > budget) return false;
		}
		return false;
	};
	if (!place(0)) return null;
	return chosen.map((i) => candidates[i]);
}

// Float32 approximation of NOISE_GLSL.hash31, used only to select candidate
// cells. The GPU reconstructs anchors and rechecks eligibility independently;
// rounding can reject a selected source. Probe evidence covers sampled seeds,
// not agreement on every seed or renderer.
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
export function airlessFeatures(
	seed: number,
	basinBudget = 10_000,
): {
	basins: Basin[];
	rayCells: V3[];
	exhausted: "basins" | "rays" | null;
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
	const basins = selectBasins(
		candidates.map((c) => c.basin),
		count,
		basinBudget,
	);
	// Sparse decoration cannot make a seeded body unbuildable. The caller
	// reports the seed; zero counts keep the existing crater terrain drawable.
	if (!basins) return { basins: [], rayCells: [], exhausted: "basins" };

	const offset = planetSeedOffset(seed);
	const origin = f(f(offset) * f(1.7)) * 8;
	const young: { cell: V3; age: number }[] = [];
	for (let x = Math.floor(origin - 9); x <= Math.ceil(origin + 8); x++)
		for (let y = Math.floor(origin - 9); y <= Math.ceil(origin + 8); y++)
			for (let z = Math.floor(origin - 9); z <= Math.ceil(origin + 8); z++) {
				// Jitter can move a cell's midpoint by at most sqrt(3)/16;
				// eligibility adds at most 0.0625/4. Their sum is < 0.15,
				// so no eligible source can start outside this shell.
				const midpointNorm = Math.hypot(
					(x + 0.5 - origin) / 8,
					(y + 0.5 - origin) / 8,
					(z + 0.5 - origin) / 8,
				);
				if (Math.abs(midpointNorm - 1) > 0.15) continue;
				const cell: V3 = [x, y, z];
				const crater = smallCrater(cell, offset);
				const n = Math.hypot(...crater.centre);
				// Flooded small impacts no longer have relief: date only the
				// CPU candidates on the highlands. The shader also checks that
				// its own reconstructed source survives before painting rays.
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
	if (rayCells.length < 2) return { basins, rayCells: [], exhausted: "rays" };
	return { basins, rayCells, exhausted: null };
}

/** Shared by the live body builder and the bake-reading instrument. */
export function applyAirlessFeatures(
	uniforms: {
		basinCount: { value: number };
		basins: { value: { fromArray(values: number[]): unknown }[] };
		rayCount: { value: number };
		rayCells: { value: { fromArray(values: number[]): unknown }[] };
	},
	features: ReturnType<typeof airlessFeatures>,
) {
	uniforms.basinCount.value = features.basins.length;
	features.basins.forEach((basin, i) =>
		uniforms.basins.value[i].fromArray(basin),
	);
	uniforms.rayCount.value = features.rayCells.length;
	features.rayCells.forEach((cell, i) =>
		uniforms.rayCells.value[i].fromArray(cell),
	);
}
