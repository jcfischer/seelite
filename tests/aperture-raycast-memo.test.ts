import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildStationForm } from "../src/station-mesh";
import { bayBand, crossings } from "./helpers/aperture-opening";

const GREY = 0x888888;

function withBlocker() {
	const { root } = buildStationForm("trade", "a", GREY, 0, 0);
	const band = bayBand(root);
	const blocker = new THREE.Mesh(
		new THREE.PlaneGeometry(2, 2),
		new THREE.MeshBasicMaterial(),
	);
	blocker.name = "memo-blocker";
	blocker.position.z = band.max.z - 0.01;
	root.add(blocker);
	root.updateMatrixWorld(true);
	return { root, blocker };
}

function unremembered(root: THREE.Object3D): THREE.Object3D {
	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh)
			mesh.geometry = mesh.geometry.clone();
	});
	return root;
}

const blockerDepth = (root: THREE.Object3D) =>
	crossings(root, "trade").find((c) => c.name === "memo-blocker")?.pastMouthKm;

describe("crossings remembers raycasts only while every input is unchanged", () => {
	test("a remembered cast is the cast made again on fresh geometry", () => {
		const { root } = withBlocker();
		const first = crossings(root, "trade");
		expect(first.some((c) => c.name === "memo-blocker")).toBe(true);
		expect(crossings(root, "trade")).toEqual(first);
		expect(crossings(unremembered(root), "trade")).toEqual(first);
	});

	test("an edited geometry and a moved mesh are cast again", () => {
		const { root, blocker } = withBlocker();
		const before = blockerDepth(root);
		blocker.geometry.translate(0, 0, -0.01);
		const edited = blockerDepth(root);
		expect(edited).toBeDefined();
		expect(edited).not.toBe(before);
		expect(crossings(root, "trade")).toEqual(
			crossings(unremembered(root), "trade"),
		);
		blocker.position.z -= 0.01;
		root.updateMatrixWorld(true);
		const moved = blockerDepth(root);
		expect(moved).not.toBe(edited);
		expect(crossings(root, "trade")).toEqual(
			crossings(unremembered(root), "trade"),
		);
	});

	test("the meshes answer raycasts as before once crossings returns", () => {
		const { root, blocker } = withBlocker();
		crossings(root, "trade");
		expect(Object.hasOwn(blocker, "raycast")).toBe(false);
		expect(blocker.raycast).toBe(THREE.Mesh.prototype.raycast);
	});
});
