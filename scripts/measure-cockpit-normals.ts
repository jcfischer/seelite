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
import { COCKPIT_CREASE_DEG, smoothCockpitScene } from "../src/cockpit-model";
import {
	degBetween as deg,
	type PositionCopies,
	pairCopies,
} from "./lib/cockpit-normals";
import { decodeShippedGlb } from "./lib/shipped-glb";

const MODEL = "src/models/courier-cockpit.glb";

/** Throws on a figure that is not a number, so nothing garbage is transcribed. */
function finite(label: string, value: number): number {
	if (!Number.isFinite(value)) throw new Error(`${label} is ${value}`);
	return value;
}

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

/** A rewrite smaller than this is a normal left where it was. */
const TURNED_DEG = 1e-3;

function splitReading(copies: PositionCopies[], side: "before" | "after") {
	let below = 0;
	let above = 180;
	let smooth = 0;
	let stillSplit = 0;
	for (const p of copies) {
		const normals = p[side];
		if (normals.length < 2) continue;
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
		if (widest > TURNED_DEG) stillSplit++;
	}
	return {
		below: finite("below", below),
		above: finite("above", above),
		smooth,
		stillSplit,
	};
}

const exported = await decodeShippedGlb(MODEL);
const adopted = await decodeShippedGlb(MODEL);
const started = performance.now();
const rewritten = smoothCockpitScene(adopted);
const tookMs = performance.now() - started;
const copies = pairCopies(exported, adopted);

console.log(
	`crease ${COCKPIT_CREASE_DEG}°, ${rewritten} vertices rewritten by the adoption in ${tookMs.toFixed(1)} ms`,
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
const before = splitReading(copies, "before");
const after = splitReading(copies, "after");
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
 * beside its face) are joined and the hard side is kept. A vertex counts as
 * moved when its normal turned by more than `TURNED_DEG`, so the rows sum to
 * fewer than the rewritten total: a rewrite of copies that already agreed
 * moves nothing. The largest move is how far one normal turned.
 */
function movedReading() {
	type Tally = { inside: number; mixed: number };
	const byMesh = new Map<string, { count: Tally; largest: Tally }>();
	const count: Tally = { inside: 0, mixed: 0 };
	for (const p of copies) {
		const mixed = p.before.some((a) =>
			p.before.some((b) => deg(a, b) >= COCKPIT_CREASE_DEG),
		);
		const kind = mixed ? "mixed" : "inside";
		let row = byMesh.get(p.mesh);
		if (!row) {
			row = {
				count: { inside: 0, mixed: 0 },
				largest: { inside: 0, mixed: 0 },
			};
			byMesh.set(p.mesh, row);
		}
		p.after.forEach((now, n) => {
			const turned = deg(now, p.before[n]);
			if (turned <= TURNED_DEG) return;
			row.count[kind]++;
			count[kind]++;
			row.largest[kind] = Math.max(row.largest[kind], finite("turn", turned));
		});
	}
	const rows: string[] = [];
	for (const [mesh, row] of byMesh) {
		if (row.count.inside + row.count.mixed === 0) continue;
		rows.push(
			`  ${mesh}: ${row.count.inside} inside (largest turn ${row.largest.inside.toFixed(1)}°), ${row.count.mixed} at edges (largest turn ${row.largest.mixed.toFixed(1)}°)`,
		);
	}
	return { rows, total: count.inside + count.mixed };
}
const moved = movedReading();
console.log(
	`vertices moved (turned by more than ${TURNED_DEG}°): ${moved.total} of ${rewritten} rewritten, by mesh:`,
);
for (const row of moved.rows) console.log(row);
