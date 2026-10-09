import { test } from "bun:test";
import * as THREE from "three";
import { buildShipMesh } from "../src/ship-mesh";
test("m", () => {
	for (const v of ["a","b","c"] as const) {
	const root = buildShipMesh("freighter", v).root;
	root.updateMatrixWorld(true);
	const b = new THREE.Box3().setFromObject(root);
	const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
	let tris = 0; root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.getAttribute("position").count) / 3; });
	console.log(v, "size m", s.toArray().map((x) => (x * 1000).toFixed(3)), "centre m", c.toArray().map((x) => (x * 1000).toFixed(3)), "far corner", (Math.max(...b.min.toArray().map(Math.abs), ...b.max.toArray().map(Math.abs))*1000).toFixed(2), "maxlen", (Math.hypot(Math.max(-b.min.x,b.max.x),Math.max(-b.min.y,b.max.y),Math.max(-b.min.z,b.max.z))*1000).toFixed(2), "tris", tris);
	}
});
