/**
 * Node #956: D2 re-measured on the pieces (#949's measure-euclid method).
 * Colliding empty space: each sampled direction's proxy surface point that
 * lies outside the drawn L0 solid, by its exact distance to the L0 mesh.
 * Arms in one run: the ruled bilinear field (the #949 figure) and the pieces'
 * envelope. Drawn surface outside cannot grow: the envelope is ≥ the field (P2).
 *
 *   bun run spikes/asteroid-sweep-956/measure-fit.ts
 */
import { dirOf, outermostExits, radiusAt, rayExit, type V3 } from "../asteroid-collision-949/heightfield";
import { indexMesh, meshDistance } from "../asteroid-collision-949/mesh-distance";
import { loadArchetypes } from "../asteroid-collision-949/proxy-fit";
import { buildPieces, envelopeAt } from "./pieces";
import { v3 } from "../../src/vec3";
const arch = await loadArchetypes();
const S = Number(process.env.SAMPLES ?? 80);
const dirs: V3[] = [];
for (let f = 0; f < 6; f++) for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) dirs.push(dirOf(f, ((i + 0.5) / S) * 2 - 1, ((j + 0.5) / S) * 2 - 1));
const rows: Record<string, number[][]> = { field: [], pieces: [] };
/** Where the pieces stand farthest above the field (P2's grid): the 38,400 directions may miss them. */
const peak: number[] = [];
for (const a of arch) {
	const all = new Float32Array(a.levels.reduce((n, l) => n + l.length, 0));
	let off = 0;
	for (const l of a.levels) { all.set(l, off); off += l.length; }
	const h = { res: 64, r: outermostExits(all, 64) };
	const rp = buildPieces(h);
	const mi = indexMesh(a.levels[0]);
	const exits = outermostExits(a.levels[0], S);
	const arms: [string, (d: V3) => number][] = [["field", (d) => radiusAt(h, d)], ["pieces", (d) => envelopeAt(rp, h, v3(d[0], d[1], d[2]))]];
	for (const [name, r] of arms) {
		const overs: number[] = [];
		dirs.forEach((d, k) => {
			const rr = r(d);
			overs.push(rr > exits[k] + 1e-6 ? meshDistance(mi, [d[0] * rr, d[1] * rr, d[2] * rr]).d : 0);
		});
		overs.sort((x, y) => x - y);
		rows[name].push([overs[overs.length - 1], overs[Math.floor(overs.length * 0.99)]]);
	}
	{
		const ex: { d: V3; e: number }[] = [];
		for (let f = 0; f < 6; f++) for (let j = 0; j < 150; j++) for (let i = 0; i < 150; i++) {
			const d = dirOf(f, ((i + 0.37) / 150) * 2 - 1, ((j + 0.61) / 150) * 2 - 1);
			ex.push({ d, e: envelopeAt(rp, h, v3(d[0], d[1], d[2])) - radiusAt(h, d) });
		}
		ex.sort((x, y) => y.e - x.e);
		let worst = 0;
		const allTris = Array.from({ length: a.levels[0].length / 9 }, (_, i) => i);
		for (const { d } of ex.slice(0, 50)) {
			const rr = envelopeAt(rp, h, v3(d[0], d[1], d[2]));
			// Empty space only where the point is outside the drawn solid along its ray.
			if (rr > rayExit(a.levels[0], allTris, d) + 1e-6) worst = Math.max(worst, meshDistance(mi, [d[0] * rr, d[1] * rr, d[2] * rr]).d);
		}
		peak.push(worst);
	}
	console.log(`${a.name.padEnd(18)} field max ${rows.field.at(-1)![0].toFixed(4)} p99 ${rows.field.at(-1)![1].toFixed(4)} | pieces max ${rows.pieces.at(-1)![0].toFixed(4)} p99 ${rows.pieces.at(-1)![1].toFixed(4)} | inflation max ${Math.max(...rp.inflate).toFixed(4)} | at the 50 largest excesses: empty space max ${peak.at(-1)!.toFixed(4)}`);
}
console.log(`pieces at the 50 largest envelope excesses per rock: colliding empty space max ${Math.max(...peak).toFixed(4)} R`);
for (const [name, rs] of Object.entries(rows)) console.log(`${name}: colliding empty space max ${Math.max(...rs.map((r) => r[0])).toFixed(4)} R, p99 max ${Math.max(...rs.map((r) => r[1])).toFixed(4)} R`);
