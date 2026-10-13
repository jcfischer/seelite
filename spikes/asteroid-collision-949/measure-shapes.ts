/**
 * Node #949: how closely candidate proxy families follow each archetype's
 * drawn L0 solid, in unit-bound space. bun run spikes/asteroid-collision-949/measure-shapes.ts
 *
 * - hull: one convex hull (approximated by 2,000 support planes, so a hair
 *   larger than the true hull — conservative).
 * - dop26: the 26 support planes of the axes, face and edge diagonals.
 * - radial: is the solid star-shaped from its centre (one crossing per ray)?
 * - l2: how far the L2 level's surface stands from L0's (the coarse mesh as a proxy).
 * Overshoot = the farthest grid cell inside the proxy and outside the solid,
 * by its distance to the solid; one grid cell (n = 96) of error.
 */
import { centreOf, loadArchetypes, voxelise, type V3 } from "./proxy-fit";
const N = 96;
const arch = await loadArchetypes();
const fib = (k: number): V3[] => Array.from({ length: k }, (_, i) => {
	const z = 1 - (2 * (i + 0.5)) / k, r = Math.sqrt(1 - z * z), t = i * Math.PI * (3 - Math.sqrt(5));
	return [r * Math.cos(t), r * Math.sin(t), z];
});
const dop26: V3[] = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) { const l = Math.hypot(x, y, z); dop26.push([x / l, y / l, z / l]); }
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function planes(tris: Float32Array, dirs: V3[]) {
	return dirs.map((d) => { let m = -Infinity; for (let i = 0; i < tris.length; i += 3) m = Math.max(m, d[0] * tris[i] + d[1] * tris[i + 1] + d[2] * tris[i + 2]); return { d, m }; });
}
function over(g: ReturnType<typeof voxelise>, inside: (p: V3) => boolean) {
	let o = 0, inP = 0, empty = 0;
	for (let c = 0; c < g.solid.length; c++) { const p = centreOf(g, c); if (!inside(p)) continue; inP++; if (!g.solid[c]) { empty++; o = Math.max(o, g.edt[c]); } }
	return { o: o + (g.h * Math.sqrt(3)) / 2, share: empty / inP };
}
/** Rays from the solid's centroid: share with more than one exit. */
function radial(g: ReturnType<typeof voxelise>) {
	let cx = 0, cy = 0, cz = 0, n = 0;
	for (let c = 0; c < g.solid.length; c++) if (g.solid[c]) { const p = centreOf(g, c); cx += p[0]; cy += p[1]; cz += p[2]; n++; }
	const o: V3 = [cx / n, cy / n, cz / n];
	let multi = 0; const dirs = fib(4000);
	for (const d of dirs) {
		let exits = 0, prev = 1;
		for (let s = 0; s < 2.0; s += g.h / 3) {
			const p: V3 = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s];
			const i = Math.floor((p[0] + 1) / g.h), j = Math.floor((p[1] + 1) / g.h), k = Math.floor((p[2] + 1) / g.h);
			const cur = i < 0 || j < 0 || k < 0 || i >= g.n || j >= g.n || k >= g.n ? 0 : g.solid[(k * g.n + j) * g.n + i];
			if (prev && !cur) exits++;
			prev = cur;
		}
		if (exits > 1) multi++;
	}
	return multi / dirs.length;
}
/** Each L2 vertex's distance to the L0 solid boundary, by grid. */
function l2dev(g: ReturnType<typeof voxelise>, l2: Float32Array, l0g: ReturnType<typeof voxelise>) {
	let worst = 0;
	for (let i = 0; i < l2.length; i += 3) {
		const ix = Math.min(g.n - 1, Math.max(0, Math.floor((l2[i] + 1) / g.h)));
		const iy = Math.min(g.n - 1, Math.max(0, Math.floor((l2[i + 1] + 1) / g.h)));
		const iz = Math.min(g.n - 1, Math.max(0, Math.floor((l2[i + 2] + 1) / g.h)));
		worst = Math.max(worst, l0g.edt[(iz * g.n + iy) * g.n + ix]);
	}
	return worst + g.h;
}
const f = (x: number) => x.toFixed(3);
console.log("archetype            hull.o hull%  dop26.o dop% multiExit%  l2out");
const sum = { h: 0, d: 0 };
const rows: number[][] = [];
for (const a of arch) {
	const g = voxelise(a.levels[0], N);
	const hp = planes(a.levels[0], fib(2000)), dp = planes(a.levels[0], dop26);
	const h = over(g, (p) => hp.every(({ d, m }) => dot(p, d) <= m));
	const d = over(g, (p) => dp.every(({ d, m }) => dot(p, d) <= m));
	const r = radial(g);
	const l = l2dev(g, a.levels[2], g);
	rows.push([h.o, d.o, r, l]);
	console.log(`${a.name.padEnd(20)} ${f(h.o)} ${(h.share * 100).toFixed(1).padStart(5)} ${f(d.o).padStart(7)} ${(d.share * 100).toFixed(1).padStart(5)} ${(r * 100).toFixed(1).padStart(9)} ${f(l).padStart(6)}`);
}
const max = (k: number) => Math.max(...rows.map((r) => r[k]));
console.log(`max: hull ${f(max(0))} dop26 ${f(max(1))} multiExit ${(max(2) * 100).toFixed(1)}% l2out ${f(max(3))}`);
