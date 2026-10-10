import { expect, test } from "bun:test";
import * as THREE from "three";
import { InteriorLods, type LodRecord } from "./instanced-lod";
test("individual fittings move between instanced buckets, preserving transforms and population", () => {
	const material = new THREE.MeshBasicMaterial(),
		assets = new Map<string, THREE.Group>();
	for (const file of ["f.glb", "f-lod1.glb", "f-lod2.glb"]) {
		const g = new THREE.Group();
		g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material));
		assets.set(file, g);
	}
	const record: LodRecord = {
		full: { min: [-1, -1, -1], max: [1, 1, 1], triangles: 100 },
		levels: [
			{ file: "f-lod1.glb", maxRemovedDiameter: 0.2, triangles: 70 },
			{ file: "f-lod2.glb", maxRemovedDiameter: 0.3, triangles: 50 },
		],
	};
	const parent = new THREE.Group(),
		lod = new InteriorLods(assets, { f: record }, (m) => m);
	lod.add("f", new THREE.Matrix4().makeTranslation(0, 0, -10), parent);
	lod.add("f", new THREE.Matrix4().makeTranslation(0, 0, -500), parent);
	lod.flush();
	const camera = new THREE.PerspectiveCamera(90, 1, 1, 1000);
	camera.updateProjectionMatrix();
	expect(lod.update(camera, 2000)).toBe(true);
	expect(lod.stats().levels).toEqual([1, 0, 1]);
	expect(lod.stats().triangles).toBe(150);
	const meshes = parent.children as THREE.InstancedMesh[],
		matrix = new THREE.Matrix4();
	meshes[2].getMatrixAt(0, matrix);
	expect(matrix.elements[14]).toBe(-500);
	expect(lod.update(camera, 2000)).toBe(false);
	lod.setMode("1");
	lod.update(camera, 2000);
	expect(lod.stats().levels).toEqual([0, 2, 0]);
	expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(2);
	lod.setMode("auto");
	camera.position.z = -490;
	lod.update(camera, 2000);
	// The first fitting is now behind the camera: conservatively retain full.
	expect(lod.stats().levels).toEqual([2, 0, 0]);
	meshes[0].getMatrixAt(1, matrix);
	expect(matrix.elements[14]).toBe(-500);
	parent.visible = false;
	expect(lod.stats().triangles).toBe(0);
	parent.visible = true;
	lod.clear();
	expect(parent.children.length).toBe(0);
	expect(lod.stats().levels).toEqual([0, 0, 0]);
});
