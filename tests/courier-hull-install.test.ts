import { afterEach, expect, test } from "bun:test";
import * as THREE from "three";
import { HULL_SPECS } from "../src/hull";
import { buildDerelictMesh, disposeDerelict } from "../src/derelict-mesh";
import {
	authoredCourierBuilder,
	buildShipMesh,
	installAuthoredCourier,
	rebuildCourierStandIn,
} from "../src/ship-mesh";

const installed = authoredCourierBuilder();
afterEach(() => installAuthoredCourier(installed));

test("pre-install player and cached Traffic couriers rebuild once, retaining their roots and poses", () => {
	installAuthoredCourier(undefined);
	const player = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
	const traffic = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
	const scene = new THREE.Scene();
	scene.add(player);
	player.name = "ship";
	player.position.set(1, 2, 3);
	player.rotation.set(0.2, 0.4, 0.6);
	player.visible = false;
	traffic.scale.setScalar(0.001);
	player.updateMatrix();
	const pose = player.matrix.clone();
	const oldChildren = [...player.children];
	expect(player.userData.authored).not.toBe(true);
	expect(rebuildCourierStandIn(player)).toBe(false);
	installAuthoredCourier(installed);
	for (const root of [player, traffic]) {
		expect(rebuildCourierStandIn(root)).toBe(true);
		expect(root.userData.authored).toBe(true);
		expect(root.getObjectByName("courier-hull-frame")).toBeDefined();
		const frame = root.children[0];
		expect(rebuildCourierStandIn(root)).toBe(false);
		expect(root.children[0]).toBe(frame);
	}
	expect(oldChildren.every((child) => child.parent === null)).toBe(true);
	player.updateMatrix();
	expect(player.matrix.equals(pose)).toBe(true);
	expect(player.parent).toBe(scene);
	expect(player.name).toBe("ship");
	expect(player.visible).toBe(false);
	expect(traffic.parent).toBeNull();
	expect(traffic.scale.x).toBe(0.001);
	expect(rebuildCourierStandIn(buildShipMesh("courier", "b").root)).toBe(false);
	expect(rebuildCourierStandIn(buildShipMesh("interceptor", "a").root)).toBe(
		false,
	);
});

test("a cached courier wreck is rebuilt through its own dark builder", () => {
	installAuthoredCourier(undefined);
	const root = buildDerelictMesh("courier");
	const scene = new THREE.Scene();
	scene.add(root);
	const materials = new Set<THREE.Material>();
	root.traverse((object) => {
		if (object instanceof THREE.Mesh)
			for (const material of Array.isArray(object.material)
				? object.material
				: [object.material])
				materials.add(material);
	});
	const freed = new Set<THREE.Material>();
	for (const material of materials)
		material.addEventListener("dispose", () => freed.add(material));
	installAuthoredCourier(installed);
	expect(
		rebuildCourierStandIn(
			root,
			() => buildDerelictMesh("courier"),
			() => disposeDerelict(root),
		),
	).toBe(true);
	expect(root.userData.derelict).toBe(true);
	expect(root.userData.authored).toBe(true);
	expect(root.userData.torn).toBeNull();
	expect(root.parent).toBe(scene);
	expect(freed.size).toBe(materials.size);
	root.traverse((object) => {
		if (
			object instanceof THREE.Mesh &&
			object.material instanceof THREE.MeshStandardMaterial
		)
			expect(object.material.emissiveIntensity).toBe(0);
	});
	disposeDerelict(root);
	installAuthoredCourier(undefined);
	const standIn = buildDerelictMesh("courier");
	expect(standIn.userData.torn).not.toBeNull();
	disposeDerelict(standIn);
});
