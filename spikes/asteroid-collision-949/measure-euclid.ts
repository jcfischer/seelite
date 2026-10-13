/**
 * Node #949: Euclidean fidelity of each proxy family against the drawn L0
 * surface. A proxy's surface is sampled along DIRS rays from the rock's
 * centre (every family here is star-shaped about it); each sample outside the
 * drawn solid contributes its exact distance to the L0 mesh (overshoot: empty
 * space that collides). Every drawn vertex of every level contributes its
 * distance outside the proxy, radially (undershoot).
 *
 *   bun run spikes/asteroid-collision-949/measure-euclid.ts
 */
import { buildHeightfield, dirOf, outermostExits, radiusAt, texel, type V3 } from "./heightfield";
import { indexMesh, meshDistance } from "./mesh-distance";
import { loadArchetypes } from "./proxy-fit";
const arch = await loadArchetypes();
const S = Number(process.env.SAMPLES ?? 80); // per cube face edge
const dirs: V3[] = [];
for (let f = 0; f < 6; f++) for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) dirs.push(dirOf(f, ((i + 0.5) / S) * 2 - 1, ((j + 0.5) / S) * 2 - 1));
const fib = (k: number): V3[] => Array.from({ length: k }, (_, i) => { const z = 1 - (2 * (i + 0.5)) / k, r = Math.sqrt(1 - z * z), t = i * Math.PI * (3 - Math.sqrt(5)); return [r * Math.cos(t), r * Math.sin(t), z]; });
const hullDirs = fib(3000);
type Family = { name: string; build: (tris: Float32Array) => (d: V3) => number };
const families: Family[] = [
	{ name: "hull", build: (tris) => {
		const pl = hullDirs.map((n) => { let m = -Infinity; for (let i = 0; i < tris.length; i += 3) m = Math.max(m, n[0] * tris[i] + n[1] * tris[i + 1] + n[2] * tris[i + 2]); return { n, m }; });
		return (d) => { let r = Infinity; for (const { n, m } of pl) { const c = n[0] * d[0] + n[1] * d[1] + n[2] * d[2]; if (c > 1e-9) r = Math.min(r, m / c); } return r; };
	} },
	...(process.env.FAMILIES === "sym" ? [] : [32, 48, 64].map((res) => ({ name: `hf${res}`, build: (tris: Float32Array) => { const h = buildHeightfield(tris, res, 0); return (d: V3) => radiusAt(h, d); } }))),
	// Symmetric: bilinear over exact texel-centre exits, no dilation, so it errs both ways.
	...(process.env.FAMILIES === "sym" ? [32, 64, 96] : []).map((res) => ({ name: `hs${res}`, build: (tris: Float32Array) => { const h = { res, r: outermostExits(tris, res) }; return (d: V3) => radiusAt(h, d); } })),
];
const truthRes = S;
console.log(`samples ${dirs.length} a proxy; overshoot and undershoot in fractions of the bound radius`);
const table: Record<string, number[][]> = {};
for (const a of arch) {
	const mi = indexMesh(a.levels[0]);
	const exits = outermostExits(a.levels[0], truthRes);
	for (const fam of families) {
		// LEVELS=all builds from every level: a coarse level can stand outside L0.
		const all = new Float32Array(a.levels.reduce((n, l) => n + l.length, 0));
		let off = 0;
		for (const l of a.levels) { all.set(l, off); off += l.length; }
		const r = fam.build(process.env.LEVELS === "all" ? all : a.levels[0]);
		let over = 0, overs: number[] = [], unders: number[] = [];
		dirs.forEach((d, k) => {
			const rr = r(d);
			unders.push(Math.max(0, exits[k] - rr));
			// Inside the drawn solid along this ray only below its outermost exit, and
			// overhang gaps are inside the proxy by design: count them as overshoot too.
			const p: V3 = [d[0] * rr, d[1] * rr, d[2] * rr];
			const outside = rr > exits[k] + 1e-6;
			const e = outside ? meshDistance(mi, p).d : 0;
			over = Math.max(over, e);
			overs.push(e);
		});
		overs.sort((x, y) => x - y);
		unders.sort((x, y) => x - y);
		console.log(`  ${a.name} ${fam.name}: L0 surface below the proxy, radial p99 ${unders[Math.floor(unders.length * 0.99)].toFixed(4)} p50 ${unders[Math.floor(unders.length * 0.5)].toFixed(4)}; overshoot p50 ${overs[Math.floor(overs.length * 0.5)].toFixed(4)}`);
		let under = 0;
		for (const tris of a.levels) for (let i = 0; i < tris.length; i += 3) {
			const p: V3 = [tris[i], tris[i + 1], tris[i + 2]];
			const l = Math.hypot(...p);
			under = Math.max(under, l - r([p[0] / l, p[1] / l, p[2] / l]));
		}
		let reach = 0; for (const d of dirs) reach = Math.max(reach, r(d));
		(table[fam.name] ??= []).push([over, overs[Math.floor(overs.length * 0.99)], under, reach]);
	}
}
for (const [name, rows] of Object.entries(table)) {
	const max = (k: number) => Math.max(...rows.map((r) => r[k]));
	console.log(`${name.padEnd(5)} overshoot max ${max(0).toFixed(4)} (25 m: ${(max(0) * 25).toFixed(1)} m, 400 m: ${(max(0) * 400).toFixed(1)} m), p99 max ${max(1).toFixed(4)}; drawn vertex outside max ${max(2).toFixed(4)}; reach max ${max(3).toFixed(3)}`);
	console.log(`      per archetype overshoot: ${rows.map((r) => r[0].toFixed(3)).join(" ")}`);
	console.log(`      per archetype vertex-outside: ${rows.map((r) => r[2].toFixed(3)).join(" ")}`);
}
