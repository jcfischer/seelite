import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { STATION_GEOMETRY } from "../src/station";
import { STATION_FORMS } from "../src/station-mesh";

// Read the shipped GLB vertex buffers, including node transforms. These tests
// measure the exported mesh, not a second description of the generator.
const file = readFileSync(
	new URL("../public/spikes/coriolis/coriolis-industrial.glb", import.meta.url),
);
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
const binaryStart = 20 + jsonLength + 8;
function attribute(index: number): Float32Array | Uint32Array | Uint16Array {
	const a = gltf.accessors[index];
	const view = gltf.bufferViews[a.bufferView];
	const offset = binaryStart + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
	const count = a.count * (a.type === "VEC3" ? 3 : 1);
	const data = file.buffer.slice(
		file.byteOffset + offset,
		file.byteOffset + offset + count * (a.componentType === 5123 ? 2 : 4),
	);
	return a.componentType === 5126
		? new Float32Array(data)
		: a.componentType === 5123
			? new Uint16Array(data)
			: new Uint32Array(data);
}
const root = new THREE.Group();
function node(index: number, parent: THREE.Object3D) {
	const n = gltf.nodes[index];
	const group = new THREE.Group();
	if (n.matrix) group.applyMatrix4(new THREE.Matrix4().fromArray(n.matrix));
	else {
		if (n.translation) group.position.fromArray(n.translation);
		if (n.rotation) group.quaternion.fromArray(n.rotation);
		if (n.scale) group.scale.fromArray(n.scale);
	}
	parent.add(group);
	if (n.mesh !== undefined)
		for (const p of gltf.meshes[n.mesh].primitives) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute(
				"position",
				new THREE.BufferAttribute(attribute(p.attributes.POSITION), 3),
			);
			if (p.indices !== undefined)
				geometry.setIndex(new THREE.BufferAttribute(attribute(p.indices), 1));
			group.add(
				new THREE.Mesh(
					geometry,
					new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
				),
			);
		}
	for (const child of n.children ?? []) node(child, group);
}
for (const n of gltf.scenes[gltf.scene ?? 0].nodes) node(n, root);
root.scale.setScalar(0.001);
root.updateMatrixWorld(true);

describe("Coriolis spike export", () => {
	test("all actual vertices remain within the declared Coriolis display reach", () => {
		const reach = STATION_FORMS.trade.find((f) => f.id === "a")!.reachKm;
		const point = new THREE.Vector3();
		let max = 0;
		root.traverse((o) => {
			if (o instanceof THREE.Mesh) {
				const p = o.geometry.getAttribute("position");
				for (let i = 0; i < p.count; i++) {
					point.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
					max = Math.max(max, point.length());
				}
			}
		});
		expect(max).toBeGreaterThan(0.5);
		expect(max).toBeLessThanOrEqual(reach);
	});
	test("the entire production slot and initial throat are open, from either side of each surface", () => {
		const { aperture, aperturePlaneKm } = STATION_GEOMETRY.trade;
		for (const u of [-0.499, 0, 0.499])
			for (const v of [-0.499, 0, 0.499]) {
				const ray = new THREE.Raycaster(
					new THREE.Vector3(
						u * aperture.widthKm,
						v * aperture.heightKm,
						aperturePlaneKm + 0.12,
					),
					new THREE.Vector3(0, 0, -1),
				);
				const first = ray.intersectObject(root, true)[0];
				expect(first).toBeDefined();
				expect(first.point.z).toBeLessThan(aperturePlaneKm - 0.085);
			}
	});
	test("the mouth has physical walls outside its aperture", () => {
		const { aperture, aperturePlaneKm } = STATION_GEOMETRY.trade;
		for (const [x, y] of [
			[aperture.widthKm / 2 + 0.004, 0],
			[-aperture.widthKm / 2 - 0.004, 0],
			[0, aperture.heightKm / 2 + 0.004],
			[0, -aperture.heightKm / 2 - 0.004],
		]) {
			const hit = new THREE.Raycaster(
				new THREE.Vector3(x, y, 0.55),
				new THREE.Vector3(0, 0, -1),
			).intersectObject(root, true)[0];
			expect(hit).toBeDefined();
			expect(hit.point.z).toBeGreaterThan(aperturePlaneKm - 0.03);
		}
	});
});
