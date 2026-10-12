/**
 * Node #818: the three shipyard flight assets, before the game loads them.
 *
 * `spikes/shipyards/prepare-flight-asset.mjs` writes them losslessly from
 * `build_model.py --flight`. These rows read the shipped files through the
 * browser's loader (`decodeShippedGlb`) and hold what the export promised, in
 * the life capsule's own frame (metres, +z the docking approach):
 *
 * - the file fits the host and the review density has not come back;
 * - the capsule carries its docking frame and the two marks the game aligns
 *   by: `aperture-plane`, which the game puts on the sim's plane, and
 *   `hub-face`, the wall the slot is cut in, where the bay's mouth wall is
 *   drawn. Since the principal's 5 m collision rule (2026-10-12) they are one
 *   place, so the sim's bay opens where the drawn one does; the coaming
 *   funnel stands in front of it;
 * - the production slot is clear from the hub face out through the funnel;
 * - the sim's bay (`stationInterior("shipyard")`) fits inside the drum and no
 *   drum geometry stands in it;
 * - the drum is attached: the yard's bearing meets its rear face;
 * - its side mounts rest on its faces.
 */
import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import * as THREE from "three";
import { MAX_ASSET_BYTES } from "../scripts/check-dist-sizes.mjs";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { STATION_GEOMETRY } from "../src/station";
import { stationInterior } from "../src/station-interior";

const ASSETS = ["gantry", "foundry", "slipway"].map(
	(name) => `src/models/shipyard-${name}.glb`,
);

/** The review studies drew 415 k to 1 021 k triangles; the flight exports
 *  about a fifth of that. A ceiling against the review density coming back,
 *  not a measured render budget. */
const TRIANGLE_CEILING = 250_000;

const GEOMETRY = STATION_GEOMETRY.shipyard;
const BAY = stationInterior("shipyard", GEOMETRY.aperturePlaneKm);
const BAY_DEPTH_M = (BAY.mouthAxialKm - BAY.endAxialKm) * 1000;

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

/** A box from its min and max corners. */
function box(min: [number, number, number], max: [number, number, number]) {
	const lo = new THREE.Vector3(...min);
	const hi = new THREE.Vector3(...max);
	return {
		centre: lo.clone().add(hi).multiplyScalar(0.5),
		half: hi.clone().sub(lo).multiplyScalar(0.5),
	};
}

type Triangles = { mesh: string; tri: THREE.Vector3[] }[];

describe("shipyard flight assets (#818)", () => {
	for (const path of ASSETS) {
		describe(path, async () => {
			const scene = await decodeShippedGlb(path);
			scene.updateMatrixWorld(true);
			const capsule = scene.getObjectByName("life-capsule")!;
			const toCapsule = new THREE.Matrix4().copy(capsule.matrixWorld).invert();
			const meshes: THREE.Mesh[] = [];
			scene.traverse((o) => {
				if (o instanceof THREE.Mesh) meshes.push(o);
			});
			const onCapsule = (o: THREE.Object3D) => {
				for (let p: THREE.Object3D | null = o; p; p = p.parent)
					if (p === capsule) return true;
				return false;
			};
			/** Every triangle, in the capsule's frame, split by owner. */
			const drum: Triangles = [];
			const yard: Triangles = [];
			for (const mesh of meshes) {
				const m = toCapsule.clone().multiply(mesh.matrixWorld);
				const g = mesh.geometry as THREE.BufferGeometry;
				const position = g.getAttribute("position");
				const index = g.getIndex()!;
				const into = onCapsule(mesh) ? drum : yard;
				for (let i = 0; i < index.count; i += 3)
					into.push({
						mesh: mesh.name,
						tri: [0, 1, 2].map((k) =>
							new THREE.Vector3()
								.fromBufferAttribute(position, index.getX(i + k))
								.applyMatrix4(m),
						),
					});
			}
			const mark = (name: string) => {
				const node = scene.getObjectByName(name);
				return node
					? node.getWorldPosition(new THREE.Vector3()).applyMatrix4(toCapsule)
					: undefined;
			};
			const plane = mark("aperture-plane");
			const face = mark("hub-face");
			// The approved barrel, and its mounts, are centred 96 m behind the
			// docking frame; the forward growth moves both together.
			const barrelZ = (mark("docking-centre")?.z ?? Number.NaN) - 96;
			const drumZ = drum.flatMap((t) => t.tri.map((v) => v.z));
			const front = Math.max(...drumZ);
			const rear = Math.min(...drumZ);
			const hits = (tris: Triangles, b: ReturnType<typeof box>) => [
				...new Set(
					tris
						.filter((t) => triangleHitsBox(t.tri, b.centre, b.half))
						.map((t) => t.mesh),
				),
			];

			test("fits the host's per-asset limit", () => {
				expect(statSync(path).size).toBeLessThan(MAX_ASSET_BYTES);
			});

			test("stays under the triangle ceiling", () => {
				const triangles = drum.length + yard.length;
				expect(triangles).toBeGreaterThan(0);
				expect(triangles).toBeLessThan(TRIANGLE_CEILING);
			});

			test("marks its aperture plane and hub face on the drum axis", () => {
				expect(plane).toBeDefined();
				expect(face).toBeDefined();
				for (const p of [plane!, face!]) {
					expect(Math.abs(p.x)).toBeLessThan(1e-3);
					expect(Math.abs(p.y)).toBeLessThan(1e-3);
				}
				// The slot is cut in the hub face, and the sim's plane is there.
				expect(Math.abs(plane!.z - face!.z)).toBeLessThan(0.01);
				// The coaming funnel stands proud of it, as the approved front does.
				expect(front - plane!.z).toBeGreaterThan(20);
				const dock = scene.getObjectByName("docking-centre");
				expect(dock?.parent).toBe(capsule);
			});

			test("keeps the production slot clear from the hub face out through the funnel", () => {
				const half = [
					(GEOMETRY.aperture.widthKm * 1000) / 2,
					(GEOMETRY.aperture.heightKm * 1000) / 2,
				];
				const slot = box(
					[-half[0], -half[1], face!.z - 1],
					[half[0], half[1], plane!.z + 50],
				);
				expect(drum.length).toBeGreaterThan(1000);
				expect(hits(drum, slot)).toEqual([]);
			});

			test("holds the sim's whole bay inside the drum, with nothing standing in it", () => {
				// The bay runs from the plane back; the game recesses its mouth
				// wall to the hub face, so the room proper starts there.
				const end = plane!.z - BAY_DEPTH_M;
				expect(rear).toBeLessThan(end - 5);
				const room = box(
					[-BAY.halfAcrossKm * 1000, -BAY.halfUpKm * 1000, end],
					[BAY.halfAcrossKm * 1000, BAY.halfUpKm * 1000, face!.z - 1],
				);
				expect(hits(drum, room)).toEqual([]);
			});

			test("draws no display rear wall", () => {
				expect(meshes.some((m) => m.name.includes("throat-back"))).toBe(false);
			});

			// The parked run (151b56b) moved each yard aft and left its drum
			// floating; the principal's ruling is that every drum stays attached.
			test("attaches the drum to the yard at its rear face", () => {
				const bearing = box([-60, -60, rear - 25], [60, 60, rear + 1]);
				expect(hits(yard, bearing).length).toBeGreaterThan(0);
			});

			// The drum is an octagon 220 m to its corners, so its plated faces
			// stand at ~204 m; the review studies hung their housings, vents and
			// bars 15-25 m off them. Along each face's centre line, the radial
			// spans of the triangles above the plates must join into one stack,
			// with no hole a mount could float in.
			test("rests the drum's side mounts on its faces", () => {
				const holes: number[] = [];
				for (let face = 0; face < 8; face++) {
					const angle = ((face + 1) * Math.PI) / 4;
					const n = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
					const spans: [number, number][] = [];
					for (const { tri } of drum) {
						const r: number[] = [];
						for (const v of tri) {
							const t = -v.x * n.y + v.y * n.x;
							if (Math.abs(t) > 60 || Math.abs(v.z - barrelZ) > 75) break;
							r.push(v.x * n.x + v.y * n.y);
						}
						if (r.length === 3 && Math.max(...r) > 200)
							spans.push([Math.max(200, Math.min(...r)), Math.max(...r)]);
					}
					spans.sort((a, b) => a[0] - b[0]);
					expect(spans.length).toBeGreaterThan(0);
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
