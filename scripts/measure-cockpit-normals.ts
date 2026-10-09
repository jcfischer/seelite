/**
 * Reprints the cockpit model's normals as exported and as the game adopts them
 * (node #839).
 *
 * The canopy struts showed their highlight as rectangles. Two readings, both
 * on the shipped GLB:
 *
 * 1. **The struts against their true surface.** For the support hoop and the
 *    oblique rib, each tube vertex's normal is compared with the tube's radial
 *    at that point. Flat shading puts a vertex normal at a corner half a facet
 *    off it — 9° on a 20-sided section, 15° on a 12-sided one — and smooth
 *    shading puts it near zero. The control points are `build_model.py`'s and
 *    are restated here only to find the tube; the spline is that file's.
 * 2. **The split angles the crease is chosen against.** Every pair of copies
 *    of one position, with the largest exported angle below the crease and the
 *    smallest above it, and how many positions whose faces all lie inside the
 *    crease still carry split normals.
 *
 *   bun scripts/measure-cockpit-normals.ts
 */
import * as THREE from "three";
import { COCKPIT_CREASE_DEG, smoothCockpitNormals } from "../src/cockpit-model";
import { decodeShippedGlb } from "./lib/shipped-glb";

const MODEL = "src/models/courier-cockpit.glb";

/** Throws on a figure that is not a number, so nothing garbage is transcribed. */
function finite(label: string, value: number): number {
	if (!Number.isFinite(value)) throw new Error(`${label} is ${value}`);
	return value;
}

const deg = (a: THREE.Vector3, b: THREE.Vector3) =>
	(Math.atan2(a.clone().cross(b).length(), a.dot(b)) * 180) / Math.PI;

/** `build_model.py`'s `curve_path` centre line: Catmull-Rom, 8 steps a span. */
function centreLine(points: number[][], steps = 8): THREE.Vector3[] {
	const v = points.map((p) => new THREE.Vector3(...p));
	const p = [v[0], ...v, v[v.length - 1]];
	const out: THREE.Vector3[] = [];
	for (let i = 1; i < p.length - 2; i++) {
		const [a, b, c, d] = p.slice(i - 1, i + 3);
		for (let j = 0; j < steps; j++) {
			const t = j / steps;
			out.push(
				new THREE.Vector3()
					.addScaledVector(b, 2)
					.addScaledVector(c.clone().sub(a), t)
					.addScaledVector(
						a
							.clone()
							.multiplyScalar(2)
							.addScaledVector(b, -5)
							.addScaledVector(c, 4)
							.sub(d),
						t * t,
					)
					.addScaledVector(
						b.clone().multiplyScalar(3).sub(a).addScaledVector(c, -3).add(d),
						t * t * t,
					)
					.multiplyScalar(0.5),
			);
		}
	}
	out.push(v[v.length - 1]);
	return out;
}

/** The two canopy struts on the right side (`s = 1`), as `build_model.py` sweeps them. */
const STRUTS = [
	{
		name: "support hoop",
		mesh: "weathered-blue-steel",
		sides: 20,
		radiusM: 0.17,
		points: [
			[1.95, -1.68, -3.78],
			[2.5, -1.4, -3.4],
			[2.5, -1.02, -3.02],
			[2.4, 0.18, -1.8],
			[1.7, 0.72, -0.3],
			[0.95, 0.82, 0.7],
		],
	},
	{
		name: "oblique rib",
		mesh: "graphite-housings",
		sides: 12,
		radiusM: 0.075,
		points: [
			[2.5, -1.4, -3.4],
			[3.05, -0.55, -2.55],
			[3.27, 0.05, -1.1],
			[3.15, 0.45, 0.4],
			[2.7, 0.64, 1.6],
		],
	},
];

const quantile = (sorted: number[], q: number) =>
	sorted[Math.floor(q * (sorted.length - 1))];

function strutReading(scene: THREE.Group, strut: (typeof STRUTS)[number]) {
	const line = centreLine(strut.points);
	const mesh = scene.getObjectByName(strut.mesh);
	if (!(mesh instanceof THREE.Mesh)) throw new Error(`no mesh ${strut.mesh}`);
	const position = mesh.geometry.getAttribute("position");
	const normal = mesh.geometry.getAttribute("normal");
	const q = new THREE.Vector3();
	const n = new THREE.Vector3();
	const segment = new THREE.Line3();
	const nearest = new THREE.Vector3();
	const best = new THREE.Vector3();
	const errors: number[] = [];
	for (let i = 0; i < position.count; i++) {
		q.fromBufferAttribute(position, i);
		let distance = Number.POSITIVE_INFINITY;
		for (let k = 0; k < line.length - 1; k++) {
			segment.set(line[k], line[k + 1]).closestPointToPoint(q, true, nearest);
			const d = nearest.distanceTo(q);
			if (d < distance) {
				distance = d;
				best.copy(nearest);
			}
		}
		// On the tube's wall, and clear of its end caps.
		if (Math.abs(distance - strut.radiusM) > 0.004) continue;
		const ends = [line[0], line[line.length - 1]];
		if (ends.some((e) => e.distanceTo(q) < strut.radiusM * 1.2)) continue;
		n.fromBufferAttribute(normal, i);
		errors.push(deg(n, q.clone().sub(best).normalize()));
	}
	errors.sort((a, b) => a - b);
	if (errors.length < 100)
		throw new Error(`${strut.name}: only ${errors.length} tube vertices found`);
	return {
		vertices: errors.length,
		median: finite(`${strut.name} median`, quantile(errors, 0.5)),
		p90: finite(`${strut.name} p90`, quantile(errors, 0.9)),
	};
}

function splitReading(scene: THREE.Group) {
	let below = 0;
	let above = 180;
	let smooth = 0;
	let stillSplit = 0;
	scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const position = o.geometry.getAttribute("position");
		const normal = o.geometry.getAttribute("normal");
		const groups = new Map<string, number[]>();
		for (let i = 0; i < position.count; i++) {
			const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
			const group = groups.get(key);
			if (group) group.push(i);
			else groups.set(key, [i]);
		}
		for (const ids of groups.values()) {
			if (ids.length < 2) continue;
			const normals = ids.map((i) =>
				new THREE.Vector3().fromBufferAttribute(normal, i),
			);
			let widest = 0;
			for (let a = 0; a < normals.length; a++)
				for (let b = a + 1; b < normals.length; b++) {
					const d = deg(normals[a], normals[b]);
					widest = Math.max(widest, d);
					if (d < COCKPIT_CREASE_DEG) below = Math.max(below, d);
					else above = Math.min(above, d);
				}
			if (widest >= COCKPIT_CREASE_DEG) continue;
			smooth++;
			if (widest > 1e-3) stillSplit++;
		}
	});
	return {
		below: finite("below", below),
		above: finite("above", above),
		smooth,
		stillSplit,
	};
}

const exported = await decodeShippedGlb(MODEL);
const adopted = await decodeShippedGlb(MODEL);
const touched = new Set<THREE.BufferGeometry>();
adopted.traverse((o) => {
	if (o instanceof THREE.Mesh) touched.add(o.geometry);
});
let moved = 0;
for (const geometry of touched) moved += smoothCockpitNormals(geometry);

console.log(
	`crease ${COCKPIT_CREASE_DEG}°, ${moved} vertices moved by the adoption`,
);
for (const strut of STRUTS)
	for (const [label, scene] of [
		["exported", exported],
		["adopted", adopted],
	] as const) {
		const r = strutReading(scene, strut);
		console.log(
			`${strut.name} (${strut.sides} sides), ${label}: normal vs true radial, median ${r.median.toFixed(2)}°, p90 ${r.p90.toFixed(2)}° over ${r.vertices} vertices`,
		);
	}
const before = splitReading(exported);
const after = splitReading(adopted);
console.log(
	`exported split angles: largest below the crease ${before.below.toFixed(2)}°, smallest above ${before.above.toFixed(2)}°`,
);
console.log(
	`positions whose faces all lie inside the crease: ${before.smooth}; still split, exported ${before.stillSplit}, adopted ${after.stillSplit}`,
);

/**
 * Where the moved vertices are. A position is *inside* when every exported
 * pair of its copies lies within the crease — a tube or a gently curved
 * surface — and *mixed* when at least one pair is at or past it: an edge,
 * where the copies inside the crease of each other (a chamfer's outer step
 * beside its face) are joined and the hard side is kept. The largest move is
 * how far one normal turned.
 */
function movedReading() {
	const rows: string[] = [];
	const exportedByName = new Map<string, THREE.Mesh>();
	exported.traverse((o) => {
		if (o instanceof THREE.Mesh) exportedByName.set(o.name, o);
	});
	adopted.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const raw = exportedByName.get(o.name);
		if (!raw) throw new Error(`no exported mesh ${o.name}`);
		const position = o.geometry.getAttribute("position");
		const was = raw.geometry.getAttribute("normal");
		const now = o.geometry.getAttribute("normal");
		const groups = new Map<string, number[]>();
		for (let i = 0; i < position.count; i++) {
			const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
			const group = groups.get(key);
			if (group) group.push(i);
			else groups.set(key, [i]);
		}
		const count = { inside: 0, mixed: 0 };
		const largest = { inside: 0, mixed: 0 };
		for (const ids of groups.values()) {
			const before = ids.map((i) =>
				new THREE.Vector3().fromBufferAttribute(was, i),
			);
			const mixed = before.some((a) =>
				before.some((b) => deg(a, b) >= COCKPIT_CREASE_DEG),
			);
			const kind = mixed ? "mixed" : "inside";
			ids.forEach((i, n) => {
				const turned = deg(
					new THREE.Vector3().fromBufferAttribute(now, i),
					before[n],
				);
				if (turned <= 1e-3) return;
				count[kind]++;
				largest[kind] = Math.max(largest[kind], finite("turn", turned));
			});
		}
		if (count.inside + count.mixed === 0) return;
		rows.push(
			`  ${o.name}: ${count.inside} inside (largest turn ${largest.inside.toFixed(1)}°), ${count.mixed} at edges (largest turn ${largest.mixed.toFixed(1)}°)`,
		);
	});
	return rows;
}
console.log("vertices moved, by mesh:");
for (const row of movedReading()) console.log(row);
