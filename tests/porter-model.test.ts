/**
 * Node #813: the authored O2 Porter is `freighter/b`, in the game's frame.
 *
 * The frame is the claim a picture cannot settle: a mesh frame is nose −Z and
 * starboard +X (`cross(nose, up)`), and the model was authored nose +Z with
 * its cassettes at +X. A half turn about Y draws the approved object, which
 * puts the cassettes to **port**; a mirror would keep the spike's word
 * "starboard" and draw a chirality nobody approved. These rows hold the turn.
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { HULL_SPECS } from "../src/hull";
import {
	authoredPorterReady,
	buildShipMesh,
	installAuthoredPorter,
	isAuthoredHull,
	rebuildAuthoredStandIn,
} from "../src/ship-mesh";
import { PORTER_KM_PER_M } from "../src/porter-model";

const boxOf = (root: THREE.Object3D, name: string) => {
	const object = root.getObjectByName(name);
	if (!object) throw new Error(`no ${name}`);
	return new THREE.Box3().setFromObject(object);
};

describe("the Porter is the authored model", () => {
	const root = buildShipMesh("freighter", "b").root;
	root.updateMatrixWorld(true);

	test("freighter/b is drawn from the installed template, and is the flown variant", () => {
		expect(authoredPorterReady()).toBe(true);
		expect(isAuthoredHull("freighter", "b")).toBe(true);
		expect(HULL_SPECS.freighter.variant).toBe("b");
		expect(root.getObjectByName("porter-model")).toBeDefined();
		expect(root.getObjectByName("command-shell")).toBeDefined();
	});

	test("the nose is −Z: the canopy is in the forward half", () => {
		const hull = new THREE.Box3().setFromObject(root);
		const canopy = boxOf(root, "canopy-glass");
		const middle = (hull.min.z + hull.max.z) / 2;
		expect(canopy.max.z).toBeLessThan(middle);
		// And it is the bow end: the canopy is closer to min z than to max z.
		expect(canopy.min.z - hull.min.z).toBeLessThan(hull.max.z - canopy.max.z);
	});

	test("the three cassettes are to port of the command keel, as approved", () => {
		const keel = boxOf(root, "command-shell");
		for (const name of ["cargo-1", "cargo-2", "cargo-3"]) {
			const cassette = boxOf(root, name);
			// Port is −X in a mesh frame.
			expect([name, cassette.max.x < keel.min.x]).toEqual([name, true]);
		}
	});

	test("a turn, not a mirror: the model's frame keeps its handedness", () => {
		const model = root.getObjectByName("porter-model") as THREE.Object3D;
		expect(model.matrixWorld.determinant()).toBeGreaterThan(0);
		expect(model.scale.x).toBe(PORTER_KM_PER_M);
	});

	test("every Porter shares the template's geometry rather than copying it", () => {
		const other = buildShipMesh("freighter", "b").root;
		const a = root.getObjectByName("command-shell") as THREE.Mesh;
		const b = other.getObjectByName("command-shell") as THREE.Mesh;
		expect(a).not.toBe(b);
		expect(a.geometry).toBe(b.geometry);
	});

	test("without the template the procedural Porter stands in until installation", () => {
		// A clone of a built Porter's model is the template again: same
		// transform, and the geometry is shared rather than copied.
		const template = (
			root.getObjectByName("porter-model") as THREE.Object3D
		).clone(true);
		installAuthoredPorter(null);
		let standIn: THREE.Group;
		try {
			standIn = buildShipMesh("freighter", "b").root;
			standIn.position.set(1, 2, 3);
			expect(rebuildAuthoredStandIn(standIn)).toBe(false);
			expect(standIn.userData.authored).not.toBe(true);
			expect(standIn.getObjectByName("freighter-fuselage")).toBeDefined();
		} finally {
			installAuthoredPorter(template);
		}
		expect(rebuildAuthoredStandIn(standIn!)).toBe(true);
		expect(standIn!.userData.authored).toBe(true);
		expect(standIn!.position.toArray()).toEqual([1, 2, 3]);
		expect(rebuildAuthoredStandIn(standIn!)).toBe(false);
		expect(standIn!.getObjectByName("cargo-1")).toBeDefined();
	});
});
