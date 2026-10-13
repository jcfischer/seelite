import * as THREE from "three";
import { decodeShippedGlb } from "../../scripts/lib/shipped-glb";
const ROCKS = process.env.ROCKS_GLB ?? "../seelite-953/spikes/asteroid-rocks-953/runtime/asteroids.glb";
const scene = await decodeShippedGlb(ROCKS);
scene.updateMatrixWorld(true);
scene.traverse((o) => {
	if (!(o instanceof THREE.Mesh) || !o.name.endsWith("_L0")) return;
	const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
	const p = g.getAttribute("position");
	// edge manifoldness on welded positions
	const key = (i: number) => `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;
	const idx = g.index!;
	const edges = new Map<string, number>();
	for (let t = 0; t < idx.count; t += 3) for (let e = 0; e < 3; e++) {
		const a = key(idx.getX(t + e)), b = key(idx.getX(t + ((e + 1) % 3)));
		const k = a < b ? a + "|" + b : b + "|" + a;
		edges.set(k, (edges.get(k) ?? 0) + 1);
	}
	let open = 0; for (const n of edges.values()) if (n !== 2) open++;
	g.computeBoundingBox();
	const s = new THREE.Vector3(); g.boundingBox!.getSize(s);
	console.log(o.name, "tris", idx.count / 3, "non-2 edges", open, "bbox", s.toArray().map((x) => x.toFixed(2)).join("x"));
});
