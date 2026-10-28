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

const blockerDepth = (root: THREE.Object3D) =>
	crossings(root, "trade", true).find((c) => c.name === "memo-blocker")
		?.pastMouthKm;

describe("crossings remembers raycasts only while every input is unchanged", () => {
	test("a remembered cast is the cast made again on fresh geometry", () => {
		const { root } = withBlocker();
		const first = crossings(root, "trade", true);
		expect(first.some((c) => c.name === "memo-blocker")).toBe(true);
		expect(crossings(root, "trade", true)).toEqual(first);
		expect(crossings(root, "trade")).toEqual(first);
	});

	test("an edited geometry and a moved mesh are cast again", () => {
		const { root, blocker } = withBlocker();
		const before = blockerDepth(root);
		blocker.geometry.translate(0, 0, -0.01);
		const edited = blockerDepth(root);
		expect(edited).toBeDefined();
		expect(edited).not.toBe(before);
		expect(crossings(root, "trade", true)).toEqual(crossings(root, "trade"));
		blocker.position.z -= 0.01;
		root.updateMatrixWorld(true);
		const moved = blockerDepth(root);
		expect(moved).not.toBe(edited);
		expect(crossings(root, "trade", true)).toEqual(crossings(root, "trade"));
	});

	test("meshes answer raycasts as before once crossings returns", () => {
		const { root, blocker } = withBlocker();
		const cast = THREE.Mesh.prototype.raycast;
		crossings(root, "trade", true);
		expect(THREE.Mesh.prototype.raycast).toBe(cast);
		expect(Object.hasOwn(blocker, "raycast")).toBe(false);
	});

	test("an instanced part's casts are remembered per instance and still answer for it", () => {
		const { root } = withBlocker();
		const band = bayBand(root);
		const instanced = new THREE.InstancedMesh(
			new THREE.PlaneGeometry(2, 2),
			new THREE.MeshBasicMaterial(),
			2,
		);
		instanced.name = "memo-instanced";
		instanced.setMatrixAt(
			0,
			new THREE.Matrix4().makeTranslation(0, 0, band.max.z - 0.02),
		);
		instanced.setMatrixAt(
			1,
			new THREE.Matrix4().makeTranslation(0, 0, band.max.z - 0.03),
		);
		root.add(instanced);
		root.updateMatrixWorld(true);
		const original = THREE.Mesh.prototype.raycast;
		let casts = 0;
		THREE.Mesh.prototype.raycast = function (raycaster, intersects) {
			casts++;
			original.call(this, raycaster, intersects);
		};
		const measure = () => {
			casts = 0;
			const remembered = crossings(root, "trade", true);
			const castsMade = casts;
			return { remembered, castsMade };
		};
		const depthIn = (found: ReturnType<typeof crossings>) =>
			found.find((c) => c.name === "memo-instanced")?.pastMouthKm;
		try {
			const first = measure();
			expect(first.castsMade).toBeGreaterThan(0);
			expect(depthIn(first.remembered)).toBeDefined();
			expect(first.remembered).toEqual(crossings(root, "trade"));
			const again = measure();
			expect(again.castsMade).toBe(0);
			expect(again.remembered).toEqual(first.remembered);
			instanced.setMatrixAt(
				0,
				new THREE.Matrix4().makeTranslation(0, 0, band.max.z - 0.025),
			);
			instanced.instanceMatrix.needsUpdate = true;
			const moved = measure();
			expect(moved.castsMade).toBeGreaterThan(0);
			expect(depthIn(moved.remembered)).not.toBe(depthIn(first.remembered));
			expect(moved.remembered).toEqual(crossings(root, "trade"));
		} finally {
			THREE.Mesh.prototype.raycast = original;
		}
	});
});
