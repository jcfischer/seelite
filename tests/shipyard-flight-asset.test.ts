/**
 * Node #818: the three shipyard flight assets, before the game loads them.
 *
 * `spikes/shipyards/prepare-flight-asset.mjs` writes them losslessly from
 * `build_model.py --flight`. These rows read the shipped files through the
 * browser's loader (`decodeShippedGlb`) and hold what the export promised:
 * each file fits the host, the life capsule and its docking frame survive,
 * the display rear wall is gone, and no capsule triangle stands inside the
 * production slot (`STATION_GEOMETRY.shipyard`) anywhere along the throat.
 * Where the slot sits in the station, and the corridor in front of it, are
 * the integration's to hold, not this file's.
 */
import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import * as THREE from "three";
import { MAX_ASSET_BYTES } from "../scripts/check-dist-sizes.mjs";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { STATION_GEOMETRY } from "../src/station";

const ASSETS = ["gantry", "foundry", "slipway"].map(
	(name) => `src/models/shipyard-${name}.glb`,
);

/** The review studies drew 415 k to 1 021 k triangles; the flight exports
 *  about a fifth of that. A ceiling against the review density coming back,
 *  not a measured render budget. */
const TRIANGLE_CEILING = 250_000;

/** Capsule-local metres. The docking face is at +96 m and the coaming stands
 *  to +113 m; the throat's walls reach back to -26 m. */
const THROAT_Z = { min: -26, max: 120 };

/** Separating-axis test of a triangle against an axis-aligned box. */
function triangleHitsBox(
	tri: THREE.Vector3[],
	centre: THREE.Vector3,
	half: THREE.Vector3,
): boolean {
	const v = tri.map((p) => p.clone().sub(centre));
	const e = [
		v[1].clone().sub(v[0]),
		v[2].clone().sub(v[1]),
		v[0].clone().sub(v[2]),
	];
	const axes: THREE.Vector3[] = [
		new THREE.Vector3(1, 0, 0),
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(0, 0, 1),
		e[0].clone().cross(e[1]),
	];
	for (const edge of e)
		for (const unit of axes.slice(0, 3)) axes.push(unit.clone().cross(edge));
	for (const axis of axes) {
		if (axis.lengthSq() < 1e-18) continue;
		const p = v.map((q) => q.dot(axis));
		const r =
			half.x * Math.abs(axis.x) +
			half.y * Math.abs(axis.y) +
			half.z * Math.abs(axis.z);
		if (Math.min(...p) >= r || Math.max(...p) <= -r) return false;
	}
	return true;
}

describe("shipyard flight assets (#818)", () => {
	for (const path of ASSETS) {
		describe(path, async () => {
			const scene = await decodeShippedGlb(path);
			scene.updateMatrixWorld(true);
			const capsule = scene.getObjectByName("life-capsule");
			const meshes: THREE.Mesh[] = [];
			scene.traverse((o) => {
				if (o instanceof THREE.Mesh) meshes.push(o);
			});

			test("fits the host's per-asset limit", () => {
				expect(statSync(path).size).toBeLessThan(MAX_ASSET_BYTES);
			});

			test("stays under the triangle ceiling", () => {
				const triangles = meshes.reduce((sum, m) => {
					const g = m.geometry as THREE.BufferGeometry;
					return sum + (g.getIndex()?.count ?? 0) / 3;
				}, 0);
				expect(triangles).toBeGreaterThan(0);
				expect(triangles).toBeLessThan(TRIANGLE_CEILING);
			});

			test("keeps the life capsule and its docking frame", () => {
				expect(capsule).toBeDefined();
				const dock = scene.getObjectByName("docking-centre");
				expect(dock?.parent).toBe(capsule);
				// Slipway's capsule is tilted upright, which leaves float noise (2e-5 m).
				const [x, y, z] = dock!.position.toArray();
				expect(x).toBeCloseTo(0, 3);
				expect(y).toBeCloseTo(0, 3);
				expect(z).toBeCloseTo(96, 3);
			});

			test("draws no display rear wall", () => {
				expect(meshes.some((m) => m.name.includes("throat-back"))).toBe(false);
			});

			test("leaves the production slot clear through the throat", () => {
				const { widthKm, heightKm } = STATION_GEOMETRY.shipyard.aperture;
				const half = new THREE.Vector3(
					(widthKm * 1000) / 2,
					(heightKm * 1000) / 2,
					(THROAT_Z.max - THROAT_Z.min) / 2,
				);
				const centre = new THREE.Vector3(
					0,
					0,
					(THROAT_Z.max + THROAT_Z.min) / 2,
				);
				const toCapsule = new THREE.Matrix4()
					.copy(capsule!.matrixWorld)
					.invert();
				const inside: string[] = [];
				let checked = 0;
				for (const mesh of meshes) {
					let o: THREE.Object3D | null = mesh;
					while (o && o !== capsule) o = o.parent;
					if (!o) continue;
					const m = toCapsule.clone().multiply(mesh.matrixWorld);
					const g = mesh.geometry as THREE.BufferGeometry;
					const position = g.getAttribute("position");
					const index = g.getIndex()!;
					for (let i = 0; i < index.count; i += 3) {
						const tri = [0, 1, 2].map((k) =>
							new THREE.Vector3()
								.fromBufferAttribute(position, index.getX(i + k))
								.applyMatrix4(m),
						);
						checked++;
						if (triangleHitsBox(tri, centre, half)) {
							inside.push(mesh.name);
							break;
						}
					}
				}
				expect(checked).toBeGreaterThan(1000);
				expect(inside).toEqual([]);
			});

			// The drum is an octagon 220 m to its corners, so its plated faces
			// stand at ~204 m; the review studies hung their housings, vents and
			// bars 15-25 m off them. Along each face's centre line, the radial
			// spans of the triangles above the plates must join into one stack,
			// with no hole a mount could float in.
			test("rests the drum's side mounts on its faces", () => {
				const toCapsule = new THREE.Matrix4()
					.copy(capsule!.matrixWorld)
					.invert();
				const holes: number[] = [];
				for (let face = 0; face < 8; face++) {
					const angle = ((face + 1) * Math.PI) / 4;
					const n = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
					const spans: [number, number][] = [];
					for (const mesh of meshes) {
						let o: THREE.Object3D | null = mesh;
						while (o && o !== capsule) o = o.parent;
						if (!o) continue;
						const m = toCapsule.clone().multiply(mesh.matrixWorld);
						const g = mesh.geometry as THREE.BufferGeometry;
						const position = g.getAttribute("position");
						const index = g.getIndex()!;
						const v = new THREE.Vector3();
						for (let i = 0; i < index.count; i += 3) {
							const r: number[] = [];
							for (let k = 0; k < 3; k++) {
								v.fromBufferAttribute(position, index.getX(i + k)).applyMatrix4(
									m,
								);
								const t = -v.x * n.y + v.y * n.x;
								if (Math.abs(t) > 60 || Math.abs(v.z) > 75) break;
								r.push(v.x * n.x + v.y * n.y);
							}
							if (r.length === 3 && Math.max(...r) > 200)
								spans.push([Math.max(200, Math.min(...r)), Math.max(...r)]);
						}
					}
					spans.sort((a, b) => a[0] - b[0]);
					expect(spans[0][0]).toBeLessThan(205);
					let reach = spans[0][1];
					let hole = 0;
					for (const [lo, hi] of spans) {
						hole = Math.max(hole, lo - reach);
						reach = Math.max(reach, hi);
					}
					expect(reach).toBeGreaterThan(210);
					holes.push(hole);
				}
				expect(Math.max(...holes)).toBeLessThan(1);
			});
		});
	}
});
