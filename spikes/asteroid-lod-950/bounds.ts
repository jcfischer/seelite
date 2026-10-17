/** Node #950: every level of every shape lies inside the unit bound; and the game's buildAsteroid against its nominal radius. bun run spikes/asteroid-lod-950/bounds.ts */
import { LEVEL_DETAIL, shapeLevels } from "./field-render.ts";
import { buildAsteroid } from "../../src/station-surface.ts";
let worst = 0;
let n = 0;
for (const tag of [...Array.from({ length: 8 }, (_, i) => `arch-${i}`), ...Array.from({ length: 64 }, (_, i) => `rock-${i}`)]) {
	for (const g of shapeLevels(tag)) {
		const p = g.getAttribute("position");
		for (let i = 0; i < p.count; i++) worst = Math.max(worst, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
		n++;
	}
}
const tris = shapeLevels("arch-0").map((g) => g.index!.count / 3);
let nominal = 0;
for (let i = 0; i < 64; i++) {
	const p = buildAsteroid(1, `rock-${i}`).geometry.getAttribute("position");
	for (let j = 0; j < p.count; j++) nominal = Math.max(nominal, Math.hypot(p.getX(j), p.getY(j), p.getZ(j)));
}
console.log(`levels ${n} (details ${LEVEL_DETAIL.join("/")}, tris ${tris.join("/")}): max |v| ${worst.toFixed(8)} (bound 1)`);
console.log(`buildAsteroid(1, …) over 64 tags: max |v| ${nominal.toFixed(4)} — ${nominal > 1 ? "OUTSIDE" : "inside"} its nominal radius`);
if (worst > 1 + 1e-6) process.exit(1); // float32 positions
