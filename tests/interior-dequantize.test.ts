/**
 * The kit's dequantise runs in slices (node #818's gate): folded in one go it
 * held one frame for 75-92 ms of `probe-station-interior-kit`'s cold install.
 * The stepped fold must yield between meshes and give the same geometry as
 * the one-go fold.
 */
import { expect, test } from "bun:test";
import * as THREE from "three";
import {
	bakeQuantisedNodes,
	bakeQuantisedSteps,
} from "../src/interior-dequantize";
import { runInteriorSlices } from "../src/interior-install";

/** Three meshes on scaled, moved nodes, positions stored as normalised int16. */
function quantisedScene(): THREE.Group {
	const group = new THREE.Group();
	for (let n = 0; n < 3; n++) {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			"position",
			new THREE.BufferAttribute(
				new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, -32767]),
				3,
				true,
			),
		);
		const mesh = new THREE.Mesh(geometry);
		mesh.position.set(n, 2 * n, -n);
		mesh.scale.setScalar(n + 2);
		group.add(mesh);
	}
	return group;
}

function positions(root: THREE.Object3D): number[][] {
	const out: number[][] = [];
	root.traverse((o) => {
		if ((o as THREE.Mesh).isMesh)
			out.push([
				...((o as THREE.Mesh).geometry.getAttribute("position")
					.array as Float32Array),
			]);
	});
	return out;
}

test("the stepped fold yields between meshes and matches the one-go fold", async () => {
	const once = quantisedScene();
	bakeQuantisedNodes([once]);
	const stepped = quantisedScene();
	let yields = 0;
	await runInteriorSlices(bakeQuantisedSteps([stepped]), {
		budgetMs: 0,
		yieldFrame: async () => {
			yields++;
		},
	});
	expect(yields).toBeGreaterThanOrEqual(2);
	expect(positions(stepped)).toEqual(positions(once));
	expect(positions(once)[2].slice(0, 3)).toEqual([2, 4, -2]);
	stepped.traverse((o) => {
		if ((o as THREE.Mesh).isMesh)
			expect(o.position.toArray()).toEqual([0, 0, 0]);
	});
});
