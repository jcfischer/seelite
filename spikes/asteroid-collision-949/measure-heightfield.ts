/**
 * Node #949: radial heightfield fidelity per resolution, measured radially
 * against an exact ray-cast of the drawn L0 surface at a finer direction grid
 * (TRUTH texels a face) than any proxy uses. Radial error bounds the
 * Euclidean one from above.
 *
 * overshoot = proxy radius − drawn outermost exit (colliding empty space over
 * craters and steep walls); undershoot = the reverse (drawn surface outside
 * the proxy). Overhangs — rays with a second exit — are filled by
 * construction and counted apart.
 *
 *   bun run spikes/asteroid-collision-949/measure-heightfield.ts
 */
import { buildHeightfield, dirOf, outermostExits, radiusAt, texel } from "./heightfield";
import { loadArchetypes, type V3 } from "./proxy-fit";
const arch = await loadArchetypes();
const RES = (process.env.RES ?? "16,32,48,64").split(",").map(Number);
const TRUTH = Number(process.env.TRUTH ?? 192);
const truths = arch.map((a) => outermostExits(a.levels[0], TRUTH));
for (const res of RES) {
	const rows: number[][] = [];
	arch.forEach((a, ai) => {
		const h = buildHeightfield(a.levels[0], res, 0);
		let over = 0, overSum = 0, n = 0, under = 0, p99: number[] = [];
		for (let f = 0; f < 6; f++)
			for (let j = 0; j < TRUTH; j++)
				for (let i = 0; i < TRUTH; i++) {
					const d = dirOf(f, ((i + 0.5) / TRUTH) * 2 - 1, ((j + 0.5) / TRUTH) * 2 - 1);
					const t = truths[ai][texel(TRUTH, f, i, j)];
					const e = radiusAt(h, d) - t;
					over = Math.max(over, e);
					under = Math.max(under, -e);
					overSum += Math.max(0, e);
					p99.push(e);
					n++;
				}
		p99.sort((x, y) => x - y);
		// Every drawn vertex of every level, radially.
		let vOut = 0;
		for (const tris of a.levels) for (let i = 0; i < tris.length; i += 3) {
			const p: V3 = [tris[i], tris[i + 1], tris[i + 2]];
			const l = Math.hypot(...p);
			vOut = Math.max(vOut, l - radiusAt(h, [p[0] / l, p[1] / l, p[2] / l]));
		}
		rows.push([over, overSum / n, p99[Math.floor(n * 0.99)], under, vOut]);
	});
	const max = (k: number) => Math.max(...rows.map((r) => r[k]));
	const f = (x: number) => x.toFixed(4);
	console.log(`res ${res}: ${6 * res * res} texels, ${((6 * res * res * 2) / 1024).toFixed(0)} KB an archetype at 16 bits`);
	console.log(`  overshoot max ${f(max(0))}, p99 max ${f(max(2))}, mean max ${f(max(1))}; drawn surface outside (sampled rays) max ${f(max(3))}; drawn vertex outside max ${f(max(4))}`);
	console.log(`  per archetype max overshoot: ${rows.map((r) => r[0].toFixed(3)).join(" ")}`);
	console.log(`  per archetype p99 overshoot: ${rows.map((r) => r[2].toFixed(3)).join(" ")}`);
}
