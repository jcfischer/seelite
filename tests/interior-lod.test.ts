import { test, expect } from "bun:test";
import * as THREE from "three";
import { InteriorLods, type LodRecord } from "../src/interior-lod";
import { selectLod } from "../src/interior-lod-policy";
test("station transform, kilometre scale and drawing resolution govern individual LODs", () => {
	const assets = new Map<string, THREE.Group>();
	for (const file of ["f.glb", "f-lod1.glb", "f-lod2.glb"]) {
		const g = new THREE.Group();
		g.add(
			new THREE.Mesh(
				new THREE.BoxGeometry(2, 2, 2),
				new THREE.MeshBasicMaterial(),
			),
		);
		assets.set(file, g);
	}
	const record: LodRecord = {
		full: { min: [-1, -1, -1], max: [1, 1, 1], triangles: 100 },
		levels: [
			{ file: "f-lod1.glb", maxRemovedDiameter: 0.2, triangles: 70 },
			{ file: "f-lod2.glb", maxRemovedDiameter: 0.3, triangles: 50 },
		],
	};
	const station = new THREE.Group(),
		parent = new THREE.Group();
	station.add(parent);
	parent.scale.setScalar(0.001);
	station.position.z = -0.5;
	const lod = new InteriorLods(assets, { f: record }, (m) => m);
	lod.add("f", new THREE.Matrix4(), parent);
	lod.flush();
	const camera = new THREE.PerspectiveCamera(90, 1, 0.0001, 1000);
	lod.update(camera, 2000);
	expect(lod.stats().levels).toEqual([0, 0, 1]);
	expect(lod.update(camera, 2000)).toBe(false);
	station.position.z = -0.01;
	expect(lod.update(camera, 2000)).toBe(true);
	expect(lod.stats().levels).toEqual([1, 0, 0]);
	station.position.z = -0.5;
	lod.update(camera, 2000);
	lod.update(camera, 8000);
	expect(lod.stats().levels).toEqual([1, 0, 0]);
	station.rotation.y = Math.PI;
	station.position.z = 0.5;
	lod.update(camera, 2000);
	expect(lod.stats().levels).toEqual([1, 0, 0]);
	lod.setMode("2");
	lod.update(camera, 2000);
	const mesh = parent.children[2] as THREE.InstancedMesh;
	const matrix = new THREE.Matrix4();
	mesh.getMatrixAt(0, matrix);
	expect(matrix.elements).toEqual(new THREE.Matrix4().elements);
	lod.clear();
	expect(parent.children).toHaveLength(0);
});
test("removed-detail hysteresis retains coarse until its release threshold", () => {
	expect(selectLod(0, 250, 1000, [0.2, 0.3])).toBe(1);
	expect(selectLod(2, 250, 1000, [0.2, 0.3])).toBe(2);
	expect(selectLod(2, 249, 1000, [0.2, 0.3])).toBe(1);
	expect(selectLod(2, 0, 1000, [0.2, 0.3])).toBe(0);
});

test("sliced batches retain conservative bounds for every transformed instance and later subset", () => {
	const assets = new Map<string, THREE.Group>();
	for (const file of ["f.glb", "f-lod1.glb", "f-lod2.glb"]) {
		const g = new THREE.Group();
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(2, 4, 6),
			new THREE.MeshBasicMaterial(),
		);
		mesh.position.set(3, 5, 7);
		mesh.rotation.x = 0.7;
		g.add(mesh);
		assets.set(file, g);
	}
	const record: LodRecord = {
		full: { min: [-3, -3, -3], max: [3, 3, 3], triangles: 12 },
		levels: [
			{ file: "f-lod1.glb", maxRemovedDiameter: 0.2, triangles: 12 },
			{ file: "f-lod2.glb", maxRemovedDiameter: 0.3, triangles: 12 },
		],
	};
	const parent = new THREE.Group();
	const lod = new InteriorLods(assets, { f: record }, (m) => m);
	for (const x of [-40, 40])
		lod.add("f", new THREE.Matrix4().makeTranslation(x, 0, -100), parent);
	expect([...lod.flushSteps()]).toHaveLength(3);
	const camera = new THREE.PerspectiveCamera();
	for (const mode of ["0", "1", "2"] as const) {
		lod.setMode(mode);
		lod.update(camera, 900);
		for (const child of parent.children) {
			const mesh = child as THREE.InstancedMesh;
			for (let i = 0; i < mesh.count; i++) {
				const matrix = new THREE.Matrix4();
				mesh.getMatrixAt(i, matrix);
				const positions = mesh.geometry.getAttribute("position");
				for (let v = 0; v < positions.count; v++) {
					const point = new THREE.Vector3()
						.fromBufferAttribute(positions, v)
						.applyMatrix4(matrix);
					expect(mesh.boundingBox!.containsPoint(point)).toBe(true);
					expect(mesh.boundingSphere!.containsPoint(point)).toBe(true);
				}
			}
		}
	}
	lod.clear();
});
