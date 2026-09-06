/**
 * The farthest vertex from a station's centre, kilometres — the measurement
 * `station-mesh.test.ts` guards #28's budget with, shared by
 * `station-visuals.test.ts` (a mesh whose detail level has been changed under
 * it) and `station-finish.test.ts` (a mesh whose finish has). One copy, so
 * the two suites cannot drift into measuring two different outlines.
 *
 * Instanced copies live in `instanceMatrix` rather than in the graph, so they
 * are walked explicitly or the window grid and every #202 fixture is measured
 * at the origin.
 */
import * as THREE from "three";
import { STATION_GEOMETRY, type StationType } from "../../src/station";

export function reachKm(root: THREE.Object3D, type: StationType): number {
	root.updateMatrixWorld(true);
	let maxSq = 0;
	const v = new THREE.Vector3();
	const instance = new THREE.Matrix4();
	// An explicit stack rather than `traverse`, because the two behave
	// differently at the point this measurement rests on: returning early from
	// a `traverse` callback skips that node and **still visits its children**,
	// so a hidden group with drawn-looking descendants would have been
	// measured. That holds today only because every tagged accessory happens
	// to be a leaf, which is not something this assertion should depend on.
	const stack: THREE.Object3D[] = [root];
	while (stack.length) {
		const object = stack.pop() as THREE.Object3D;
		// Hidden parts are not drawn, so neither they nor anything under them is
		// part of the outline. This is what lets an assertion on it be an
		// equality rather than a tolerance.
		if (!object.visible) continue;
		for (const child of object.children) stack.push(child);
		const mesh = object as THREE.Mesh;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position) continue;
		const instanced = object as THREE.InstancedMesh;
		const count = instanced.isInstancedMesh ? instanced.count : 1;
		for (let n = 0; n < count; n++) {
			if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance);
			else instance.identity();
			for (let i = 0; i < position.count; i++) {
				v.fromBufferAttribute(position as THREE.BufferAttribute, i);
				v.applyMatrix4(instance);
				mesh.localToWorld(v);
				maxSq = Math.max(maxSq, v.lengthSq());
			}
		}
	}
	return Math.sqrt(maxSq) * STATION_GEOMETRY[type].coreRadiusKm;
}
