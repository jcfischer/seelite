/**
 * Node #949: what a box-against-heightfield contact costs per rock per tick,
 * as a lower bound on a swept version (a sweep repeats it per advancement
 * step). bun run spikes/asteroid-collision-949/bench.ts
 *
 * Two halves: the hull box's surface samples against the rock's radius (box
 * into rock), and the rock's surface texels inside the box (rock into box).
 */
import { radialDistance, dirOf, texel } from "./heightfield";
import { loadArchetypes, type V3 } from "./proxy-fit";
import { outermostExits } from "./heightfield";
import { HULL_SPECS } from "../../src/hull";
const arch = await loadArchetypes();
const res = 64;
const h = { res, r: outermostExits(arch[0].levels[0], res) };
const env = HULL_SPECS.miner.env;
const half: V3 = [env.beamKm / 2, env.heightKm / 2, env.lengthKm / 2];
// Box surface samples: a 5×3×9 lattice on the faces.
const samples: V3[] = [];
for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) for (let k = -4; k <= 4; k++)
	if (Math.abs(i) === 2 || Math.abs(j) === 1 || Math.abs(k) === 4) samples.push([(i / 2) * half[0], j * half[1], (k / 4) * half[2]]);
const surface: V3[] = [];
for (let f = 0; f < 6; f++) for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
	const d = dirOf(f, ((i + 0.5) / res) * 2 - 1, ((j + 0.5) / res) * 2 - 1);
	const r = h.r[texel(res, f, i, j)];
	surface.push([d[0] * r, d[1] * r, d[2] * r]);
}
for (const R of [0.025, 0.1, 0.4]) {
	// The ship's box beside the rock: centre at 1.05 R + half a length.
	const c: V3 = [0, 0, R * 1.05 + half[2]];
	const N = 2000;
	let hits = 0;
	const t0 = performance.now();
	for (let n = 0; n < N; n++) {
		for (const s of samples) if (radialDistance(h, [(c[0] + s[0]) / R, (c[1] + s[1]) / R, (c[2] + s[2]) / R]) <= 0) hits++;
		// Rock texels inside the box: a real build culls by the box's angular
		// footprint; the full scan is the small-rock worst case.
		const cull = Math.hypot(...half) / R;
		for (const p of surface) {
			const q: V3 = [p[0] - c[0] / R, p[1] - c[1] / R, p[2] - c[2] / R];
			if (Math.abs(q[2]) > cull) continue;
			if (Math.abs(q[0]) * R <= half[0] && Math.abs(q[1]) * R <= half[1] && Math.abs(q[2]) * R <= half[2]) hits++;
		}
	}
	const us = ((performance.now() - t0) / N) * 1000;
	console.log(`R ${(R * 1000).toFixed(0)} m: ${samples.length} box samples + ${surface.length} texels scanned: ${us.toFixed(1)} µs a test (${hits} hits)`);
}
