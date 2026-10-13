/**
 * Node #949: the heightfield's errors as Euclidean distances, both ways.
 * The heightfield is triangulated (each texel quad between centres → two
 * triangles; faces stitched through their shared edge samples by
 * construction of the cube map's direction set) and indexed with
 * `mesh-distance.ts`.
 *
 * - drawn outside: every drawn vertex of every level that lies outside the
 *   proxy, by its exact distance to the proxy surface.
 * - colliding empty space: proxy vertices outside the drawn L0 solid, by
 *   their exact distance to the L0 mesh (from `measure-euclid.ts`).
 *
 *   bun run spikes/asteroid-collision-949/measure-outside.ts
 */
import { dirOf, outermostExits, radiusAt, texel, type Heightfield, type V3 } from "./heightfield";
import { indexMesh, meshDistance } from "./mesh-distance";
import { loadArchetypes } from "./proxy-fit";

/** The heightfield as a closed-ish triangle soup: the surface at a fine
 *  direction lattice, bilinear between texel centres as `radiusAt` reads it. */
function triangulate(h: Heightfield, k: number): Float32Array {
	const out: number[] = [];
	const p = (f: number, i: number, j: number): V3 => {
		const d = dirOf(f, (i / k) * 2 - 1, (j / k) * 2 - 1);
		const r = radiusAt(h, d);
		return [d[0] * r, d[1] * r, d[2] * r];
	};
	for (let f = 0; f < 6; f++)
		for (let j = 0; j < k; j++)
			for (let i = 0; i < k; i++) {
				const a = p(f, i, j), b = p(f, i + 1, j), c = p(f, i + 1, j + 1), d = p(f, i, j + 1);
				out.push(...a, ...b, ...c, ...a, ...c, ...d);
			}
	return new Float32Array(out);
}
const arch = await loadArchetypes();
const RES = (process.env.RES ?? "32,64").split(",").map(Number);
for (const res of RES) {
	const rows: { name: string; out: number; out99: number; n: number }[] = [];
	for (const a of arch) {
		const all = new Float32Array(a.levels.reduce((n, l) => n + l.length, 0));
		let off = 0;
		for (const l of a.levels) { all.set(l, off); off += l.length; }
		const h: Heightfield = { res, r: outermostExits(all, res) };
		const mesh = indexMesh(triangulate(h, res * 2));
		const outs: number[] = [];
		for (const tris of a.levels)
			for (let i = 0; i < tris.length; i += 3) {
				const v: V3 = [tris[i], tris[i + 1], tris[i + 2]];
				const l = Math.hypot(...v);
				if (l <= radiusAt(h, [v[0] / l, v[1] / l, v[2] / l])) continue;
				outs.push(meshDistance(mesh, v).d);
			}
		outs.sort((x, y) => x - y);
		rows.push({ name: a.name, out: outs.at(-1) ?? 0, out99: outs[Math.floor(outs.length * 0.99)] ?? 0, n: outs.length });
	}
	const max = Math.max(...rows.map((r) => r.out));
	const max99 = Math.max(...rows.map((r) => r.out99));
	console.log(`hs${res}: drawn vertex outside the proxy, Euclidean: max ${max.toFixed(4)} R (25 m: ${(max * 25).toFixed(2)} m, 600 m: ${(max * 600).toFixed(1)} m); p99 of outside vertices max ${max99.toFixed(4)} R (600 m: ${(max99 * 600).toFixed(1)} m)`);
	console.log(`  per archetype max: ${rows.map((r) => r.out.toFixed(4)).join(" ")}`);
	console.log(`  outside vertices per archetype: ${rows.map((r) => r.n).join(" ")} (of ~${(arch[0].levels.reduce((n, l) => n + l.length, 0) / 3).toFixed(0)})`);
}
