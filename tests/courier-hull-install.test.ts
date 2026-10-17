import { afterEach, expect, test } from "bun:test";
import * as THREE from "three";
import { HULL_SPECS } from "../src/hull";
import { buildDerelictMesh, disposeDerelict } from "../src/derelict-mesh";
import {
	authoredHullBuilder,
	buildShipMesh,
	installAuthoredHull,
	rebuildAuthoredStandIn,
} from "../src/ship-mesh";

const installed = authoredHullBuilder("courier");
afterEach(() => installAuthoredHull("courier", installed));

test("pre-install player and cached Traffic couriers rebuild once, retaining their roots and poses", () => {
	installAuthoredHull("courier", undefined);
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
	expect(rebuildAuthoredStandIn(player)).toBe(false);
	installAuthoredHull("courier", installed);
	for (const root of [player, traffic]) {
		expect(rebuildAuthoredStandIn(root)).toBe(true);
		expect(root.userData.authored).toBe(true);
		expect(root.getObjectByName("courier-hull-frame")).toBeDefined();
		const frame = root.children[0];
		expect(rebuildAuthoredStandIn(root)).toBe(false);
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
	expect(rebuildAuthoredStandIn(buildShipMesh("courier", "b").root)).toBe(
		false,
	);
	expect(rebuildAuthoredStandIn(buildShipMesh("interceptor", "a").root)).toBe(
		false,
	);
});

test("a cached courier wreck is rebuilt through its own dark builder", () => {
	installAuthoredHull("courier", undefined);
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
	installAuthoredHull("courier", installed);
	expect(
		rebuildAuthoredStandIn(
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
	installAuthoredHull("courier", undefined);
	const standIn = buildDerelictMesh("courier");
	expect(standIn.userData.torn).not.toBeNull();
	disposeDerelict(standIn);
});
