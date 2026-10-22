/**
 * Node #947: how far a candidate level lies from the shipped yard, sampled in
 * both directions: https://github.com/jcfischer/seelite/issues/947
 * Method and results: docs/receipts/node-947-shipyard-lod-policy.md
 *
 *   bun scripts/measure-shipyard-level-error.ts [form ...]   (SAMPLES=40000)
 */
import * as THREE from "three";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { halfPixelKm } from "../src/authored-levels";
import { stationSilhouetteKm } from "../src/station-mesh";
import { decodeShippedGlb } from "./lib/shipped-glb";
import { reducedYard } from "./lib/shipyard-levels";

const SAMPLES = Number(process.env.SAMPLES ?? 40_000);
const CAP_M = 400;
const CELL_M = 25;
const NAMES = { a: "gantry", b: "foundry", c: "slipway" } as const;
const LEVELS = [
	{ name: "lod1", radii: 40, pixels: 0.5 },
	{ name: "lod2", radii: 400, pixels: 0.5 },
	{ name: "lodc", radii: 40, pixels: 2 },
];

type Tri = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
];

function triangles(root: THREE.Object3D): Tri[] {
	root.updateMatrixWorld(true);
	const out: Tri[] = [];
	const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
	root.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const position = o.geometry.getAttribute("position");
		const index = o.geometry.getIndex();
		const count = index ? index.count : position.count;
		for (let i = 0; i < count; i += 3) {
			for (let k = 0; k < 3; k++) {
				const at = index ? index.getX(i + k) : i + k;
				v[k].fromBufferAttribute(position, at).applyMatrix4(o.matrixWorld);
			}
			out.push([
				v[0].x,
				v[0].y,
				v[0].z,
				v[1].x,
				v[1].y,
				v[1].z,
				v[2].x,
				v[2].y,
				v[2].z,
			]);
		}
	});
	return out;
}

function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function sample(tris: readonly Tri[], n: number, seed: number) {
	const area = new Float64Array(tris.length);
	let total = 0;
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	for (let i = 0; i < tris.length; i++) {
		const t = tris[i];
		a.set(t[3] - t[0], t[4] - t[1], t[5] - t[2]);
		b.set(t[6] - t[0], t[7] - t[1], t[8] - t[2]);
		total += 0.5 * a.cross(b).length();
		area[i] = total;
	}
	const rand = rng(seed);
	const out: THREE.Vector3[] = [];
	for (let s = 0; s < n; s++) {
		const target = rand() * total;
		let lo = 0;
		let hi = tris.length - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (area[mid] < target) lo = mid + 1;
			else hi = mid;
		}
		const t = tris[lo];
		let u = rand();
		let w = rand();
		if (u + w > 1) {
			u = 1 - u;
			w = 1 - w;
		}
		out.push(
			new THREE.Vector3(
				t[0] + u * (t[3] - t[0]) + w * (t[6] - t[0]),
				t[1] + u * (t[4] - t[1]) + w * (t[7] - t[1]),
				t[2] + u * (t[5] - t[2]) + w * (t[8] - t[2]),
			),
		);
	}
	return out;
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

function grid(tris: readonly Tri[]) {
	const cells = new Map<string, number[]>();
	for (let i = 0; i < tris.length; i++) {
		const t = tris[i];
		const lo = [0, 1, 2].map((k) =>
			Math.floor(Math.min(t[k], t[3 + k], t[6 + k]) / CELL_M),
		);
		const hi = [0, 1, 2].map((k) =>
			Math.floor(Math.max(t[k], t[3 + k], t[6 + k]) / CELL_M),
		);
		for (let x = lo[0]; x <= hi[0]; x++)
			for (let y = lo[1]; y <= hi[1]; y++)
				for (let z = lo[2]; z <= hi[2]; z++) {
					const k = key(x, y, z);
					const list = cells.get(k);
					if (list) list.push(i);
					else cells.set(k, [i]);
				}
	}
	return cells;
}

const closest = new THREE.Triangle();
const target = new THREE.Vector3();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();

function distance(
	p: THREE.Vector3,
	tris: readonly Tri[],
	cells: Map<string, number[]>,
): number {
	const cx = Math.floor(p.x / CELL_M);
	const cy = Math.floor(p.y / CELL_M);
	const cz = Math.floor(p.z / CELL_M);
	let best = Infinity;
	const seen = new Set<number>();
	for (let ring = 0; ring * CELL_M <= CAP_M + CELL_M; ring++) {
		for (let x = cx - ring; x <= cx + ring; x++)
			for (let y = cy - ring; y <= cy + ring; y++)
				for (let z = cz - ring; z <= cz + ring; z++) {
					if (
						Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !==
						ring
					)
						continue;
					const list = cells.get(key(x, y, z));
					if (!list) continue;
					for (const i of list) {
						if (seen.has(i)) continue;
						seen.add(i);
						const t = tris[i];
						A.set(t[0], t[1], t[2]);
						B.set(t[3], t[4], t[5]);
						C.set(t[6], t[7], t[8]);
						closest.set(A, B, C).closestPointToPoint(p, target);
						best = Math.min(best, target.distanceTo(p));
					}
				}
		if (best <= ring * CELL_M) break;
	}
	return best;
}

function summarise(distances: number[], targetM: number) {
	const finite = distances.filter(Number.isFinite).sort((x, y) => x - y);
	const q = (f: number) =>
		finite.length
			? finite[Math.min(finite.length - 1, Math.floor(f * finite.length))]
			: NaN;
	const over = distances.filter((d) => d > targetM).length;
	return {
		p50: q(0.5),
		p99: q(0.99),
		max: finite.length ? finite[finite.length - 1] : NaN,
		over,
		beyond: distances.length - finite.length,
	};
}

await MeshoptSimplifier.ready;
const forms = (
	process.argv.slice(2).length ? process.argv.slice(2) : ["a", "b", "c"]
) as (keyof typeof NAMES)[];
console.log(
	`  ${SAMPLES} area-weighted samples per direction, seed 947, grid ${CELL_M} m, searched to ${CAP_M} m`,
);
console.log(
	"  form level  target m  reached m  triangles   model→level p50 / p99 / max m (over target)   level→model p50 / p99 / max m (over target)  beyond cap",
);
for (const form of forms) {
	const scene = await decodeShippedGlb(
		`src/models/shipyard-${NAMES[form]}.glb`,
	);
	const full = triangles(scene);
	const fullGrid = grid(full);
	const fromFull = sample(full, SAMPLES, 947);
	for (const level of LEVELS) {
		const targetM =
			halfPixelKm(level.radii, stationSilhouetteKm("shipyard", form)) *
			1000 *
			(level.pixels / 0.5);
		const reduced = reducedYard(scene, targetM, level.name);
		const tris = triangles(reduced);
		const levelGrid = grid(tris);
		const a = summarise(
			fromFull.map((p) => distance(p, tris, levelGrid)),
			targetM,
		);
		const b = summarise(
			sample(tris, SAMPLES, 948).map((p) => distance(p, full, fullGrid)),
			targetM,
		);
		const f = (x: number) => x.toFixed(1);
		console.log(
			`  ${form}    ${level.name.padEnd(5)} ${f(targetM).padStart(8)} ${f(reduced.userData.yardLevelReachedErrorM).padStart(10)} ${String(tris.length).padStart(10)}   ${f(a.p50)} / ${f(a.p99)} / ${f(a.max)} (${a.over})   ${f(b.p50)} / ${f(b.p99)} / ${f(b.max)} (${b.over})   ${a.beyond}+${b.beyond}`,
		);
	}
}
