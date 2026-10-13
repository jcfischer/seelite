/** Node #950: level-0 counts over many stand points, not one. bun run spikes/asteroid-lod-950/sweep.ts */
import * as F from "../asteroid-fields-948/field-proto.ts";
import { THREE, buildFieldRenderer } from "./field-render.ts";
const R = new URL("../..", import.meta.url).pathname;
const { generateGalaxy } = await import(`${R}/src/galaxy.ts`);
const { generateContents } = await import(`${R}/src/system.ts`);
const record = generateGalaxy(0x5ee11e, 0).systems[173];
const rocks = F.rocks(record, F.chartedField(record, generateContents(record))!);
const PX = 1559; // 1440x900 @2, fov 60 (measure.mjs prints it)
let s = 950;
const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
for (const quality of ["high", "low"] as const) {
	const fr = buildFieldRenderer(rocks, { arm: "batch-k", k: 8, quality, shadows: false }, PX);
	const l0 = (cam: THREE.Vector3, t: number) => { fr.update(t, cam); fr.update(t + 1 / 60, cam); return fr.stats().perLevel[0]; };
	const inside: number[] = [];
	for (let i = 0; i < 500; i++) {
		// Uniform in the 24×12×6 ellipsoid, rejected if inside a rock's bound.
		let p: THREE.Vector3;
		do p = new THREE.Vector3((2 * rnd() - 1) * 24, (2 * rnd() - 1) * 12, (2 * rnd() - 1) * 6);
		while ((p.x / 24) ** 2 + (p.y / 12) ** 2 + (p.z / 6) ** 2 > 1 || rocks.some((r) => Math.hypot(r.anchor.x - p.x, r.anchor.y - p.y, r.anchor.z - p.z) < r.radiusKm + r.driftKm + 0.02));
		inside.push(l0(p, rnd() * 3600));
	}
	const big = [...rocks].sort((a, b) => b.radiusKm - a.radiusKm).slice(0, 10);
	const near: number[] = [];
	for (const r of big)
		for (const k of [1.2, 2, 3])
			for (let j = 0; j < 10; j++) {
				const t = rnd() * 3600;
				const at = F.rockLocal(r, t);
				const d = new THREE.Vector3(2 * rnd() - 1, 2 * rnd() - 1, 2 * rnd() - 1).normalize().multiplyScalar(k * r.radiusKm);
				near.push(l0(new THREE.Vector3(at.x + d.x, at.y + d.y, at.z + d.z), t));
			}
	console.log(`${quality}: L0 count, 500 random points inside: p50 ${pct(inside, 0.5)} p99 ${pct(inside, 0.99)} max ${Math.max(...inside)}; 300 points 1.2–3 radii from the 10 largest rocks: p50 ${pct(near, 0.5)} p99 ${pct(near, 0.99)} max ${Math.max(...near)}`);
}
