/**
 * The drawn relay lies inside its hit sphere (node #43, sage round 1): the
 * sim declares the form's figures and the sphere, the mesh reads them, and
 * this rebuilds the mesh to check — the way `tests/hull.test.ts` rebuilds a
 * hull to check its envelope. Both conditions, because the knocked-over dish
 * moves.
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { RELAY_HEIGHT_KM, RELAY_HIT_RADIUS_KM } from "../src/pirate-relay";
import { buildRelayMesh } from "../src/relay-mesh";

const farthestCorner = (root: THREE.Object3D): number => {
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	let far = 0;
	for (const x of [box.min.x, box.max.x])
		for (const y of [box.min.y, box.max.y])
			for (const z of [box.min.z, box.max.z])
				far = Math.max(far, Math.hypot(x, y, z));
	return far;
};

describe("the relay mesh", () => {
	test("is built with its midpoint on the root", () => {
		const { root } = buildRelayMesh();
		root.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(root);
		expect(box.max.y).toBeCloseTo(RELAY_HEIGHT_KM / 2, 3);
		expect(box.min.y).toBeGreaterThanOrEqual(-RELAY_HEIGHT_KM / 2 - 0.005);
	});

	test("lies inside the hit sphere, lit and as a wreck", () => {
		const mesh = buildRelayMesh();
		for (const condition of ["operational", "destroyed"] as const) {
			mesh.setCondition(condition);
			expect(farthestCorner(mesh.root)).toBeLessThanOrEqual(
				RELAY_HIT_RADIUS_KM,
			);
		}
	});

	test("the sphere is not slack: the form reaches most of it", () => {
		const { root } = buildRelayMesh();
		expect(farthestCorner(root)).toBeGreaterThan(RELAY_HIT_RADIUS_KM * 0.8);
	});
});
