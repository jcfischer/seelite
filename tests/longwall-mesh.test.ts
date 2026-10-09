/**
 * Longwall B, the authored miner (#803; node #815), as the game builds it.
 *
 * The procedural visual language (`ship-mesh.test.ts`, `ship-details.test.ts`)
 * skips an authored hull by `isAuthoredHull`; this file is what the model
 * owes instead. The envelope, the collision box, the vents and the muzzles
 * are the roster's rows, which read this model as they read every loft
 * (`hull.test.ts`, `collision.test.ts`, `vent-placement.test.ts`).
 *
 * Bun runs every file in one process, and `tests/setup/longwall-model.ts`
 * installs the shipped model before any of them; a row here that removes it
 * puts it back.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { HULL_SPECS } from "../src/hull";
import { disposeSubtree } from "../src/gpu-teardown";
import { EMISSIVE_CEILING } from "../src/light-rig";
import {
	HULL_REACH_KM,
	LONGWALL_NOZZLES_M,
	buildShipMesh,
	installLongwallModel,
	isAuthoredHull,
	isDriveBell,
	setShipDetail,
	updateShipVisuals,
} from "../src/ship-mesh";
import { ventThroats } from "../src/vent-plumes";
import { installShippedLongwall } from "./helpers/install-longwall";
import { decodeShippedGlb } from "./helpers/read-coriolis-glb";

const SHIPPED = "public/models/longwall-miner.glb";

afterEach(async () => {
	// Whatever a row did to the install, the next file gets the shipped model.
	await installShippedLongwall();
});

const meshesOf = (root: THREE.Object3D) => {
	const meshes: THREE.Mesh[] = [];
	root.traverse((o) => {
		if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
	});
	return meshes;
};

describe("miner/b is the shipped model, and only the shipped model", () => {
	test("the selected miner is the authored variant", () => {
		expect(HULL_SPECS.miner.variant).toBe("b");
		expect(isAuthoredHull("miner", "b")).toBe(true);
		// The only one: every other variant is a loft.
		expect(isAuthoredHull("miner", "a")).toBe(false);
		expect(isAuthoredHull("courier", "a")).toBe(false);
	});

	test("building it uninstalled throws rather than drawing a loft", () => {
		installLongwallModel(null);
		expect(() => buildShipMesh("miner", "b")).toThrow(/prepareLongwallModel/);
		// The lofts do not depend on it.
		expect(() => buildShipMesh("miner", "a")).not.toThrow();
	});

	test("it carries the approved model's mechanisms, stowed", async () => {
		const root = buildShipMesh("miner", "b").root;
		for (let i = 0; i < 4; i++)
			for (const part of [
				"body",
				"sleeve",
				"elbow",
				"lower",
				"lower-rod",
				"foot",
			])
				expect(root.getObjectByName(`anchor-${i}-${part}`)).toBeDefined();
		const feed = root.getObjectByName("feed") as THREE.Object3D;
		expect(feed.getObjectByName("rotor")).toBeDefined();
		// Stowed: the export's own pose, which is the study's stowed cutter
		// (`spikes/longwall-miner/kinematics.ts`, `MINING.stowedCutterZ`).
		const exported = await decodeShippedGlb(SHIPPED);
		const stowed = exported.getObjectByName("feed") as THREE.Object3D;
		expect(stowed.position.z).toBeCloseTo(36, 6);
		expect(feed.position.toArray()).toEqual(stowed.position.toArray());
		for (let i = 0; i < 4; i++) {
			const name = `anchor-${i}-foot`;
			expect(
				(root.getObjectByName(name) as THREE.Object3D).position.toArray(),
			).toEqual(
				(exported.getObjectByName(name) as THREE.Object3D).position.toArray(),
			);
		}
	});

	test("it is the export turned to the nose at -Z, in kilometres, centred", async () => {
		const root = buildShipMesh("miner", "b").root;
		root.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(root);
		const size = box.getSize(new THREE.Vector3()).multiplyScalar(1000);
		const centre = box.getCenter(new THREE.Vector3()).multiplyScalar(1000);
		// The export's own box, metres: 34 across, 18.8 up, 84.4 long.
		const exported = await decodeShippedGlb(SHIPPED);
		const source = new THREE.Box3()
			.setFromObject(exported)
			.getSize(new THREE.Vector3());
		expect(size.x).toBeCloseTo(source.x, 3);
		expect(size.y).toBeCloseTo(source.y, 3);
		expect(size.z).toBeCloseTo(source.z, 3);
		expect(size.z).toBeCloseTo(84.4, 1);
		// The ship's origin is the box's centre, so a berth that places the
		// origin places the box.
		for (const axis of ["x", "y", "z"] as const)
			expect(Math.abs(centre[axis])).toBeLessThan(0.001);
		expect(HULL_SPECS.miner.envCentre).toEqual({
			rightKm: 0,
			upKm: 0,
			foreKm: 0,
		});
		// The nose: the bridge's glazing is forward (-Z) of the drives' glow.
		const glazing = root.getObjectByName("hullbridge-glazing") as THREE.Mesh;
		const glass = new THREE.Box3().setFromObject(glazing);
		const glow = root.getObjectByName("longwall-port-exhaust") as THREE.Mesh;
		expect(glass.max.z).toBeLessThan(glow.position.z);
		// And its display reach is the box's furthest face from the origin.
		expect(
			Math.max(...box.max.toArray(), ...box.min.toArray().map(Math.abs)),
		).toBeCloseTo(HULL_REACH_KM.miner, 4);
	});
});

describe("the drives glow inside their own rings", () => {
	test("each glow is a disc in a bore the model leaves open", async () => {
		// Measured off the export, model metres: the ring material near each
		// drive's aft face stands at least `boreRadius` from the drive's axis,
		// and the glow fits inside that bore.
		const exported = await decodeShippedGlb(SHIPPED);
		exported.updateMatrixWorld(true);
		const v = new THREE.Vector3();
		for (const side of [-1, 1]) {
			let nearest = Number.POSITIVE_INFINITY;
			let lip = 0;
			for (const mesh of meshesOf(exported)) {
				const position = mesh.geometry.getAttribute("position");
				for (let i = 0; i < position.count; i++) {
					v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
					if (Math.sign(v.x) !== side || v.z > LONGWALL_NOZZLES_M.z + 0.1)
						continue;
					nearest = Math.min(
						nearest,
						Math.hypot(v.x - side * LONGWALL_NOZZLES_M.x, v.y),
					);
					lip = Math.min(lip, v.z);
				}
			}
			expect(nearest).toBeGreaterThan(LONGWALL_NOZZLES_M.boreRadius - 1e-4);
			expect(LONGWALL_NOZZLES_M.glowRadius).toBeLessThan(nearest);
			// The glow is recessed: the ring's lip stands aft of it.
			expect(lip).toBeLessThan(LONGWALL_NOZZLES_M.z - 0.5);
		}
	});

	test("two glows, aft-facing, read by the plumes and the engine dial", () => {
		const root = buildShipMesh("miner", "b").root;
		root.updateMatrixWorld(true);
		const bells = meshesOf(root).filter(isDriveBell);
		expect(bells.map((b) => b.name).sort()).toEqual([
			"longwall-port-exhaust",
			"longwall-starboard-exhaust",
		]);
		for (const bell of bells) {
			// The disc's front face looks aft (+Z): a pilot behind sees it lit.
			const normal = new THREE.Vector3(0, 0, 1).transformDirection(
				bell.matrixWorld,
			);
			expect(normal.z).toBeCloseTo(1, 6);
			// Port is -X in the ship's frame (`cross(nose, up)` is starboard).
			expect(Math.sign(bell.position.x)).toBe(
				bell.name.includes("port") ? -1 : 1,
			);
			const material = bell.material as THREE.MeshStandardMaterial;
			expect(material.emissiveIntensity).toBeLessThanOrEqual(EMISSIVE_CEILING);
		}
		// The main drive's plumes stand at the two glows.
		const main = ventThroats(root, "miner").filter((t) => t.family === "main");
		expect(main.map((t) => t.placed)).toEqual(["bell", "bell"]);
	});
});

describe("one template, shared by every miner", () => {
	test("two miners share every buffer, and disposing one frees none of them", () => {
		const first = buildShipMesh("miner", "b").root;
		const second = buildShipMesh("miner", "b").root;
		const geometries = (root: THREE.Object3D) =>
			meshesOf(root).map((m) => m.geometry);
		expect(geometries(first)).toEqual(geometries(second));
		const report = disposeSubtree(first);
		expect(report.freed.size).toBe(0);
		// The second still draws, and a third still builds.
		expect(geometries(second).every((g) => g.getAttribute("position"))).toBe(
			true,
		);
		expect(() => buildShipMesh("miner", "b")).not.toThrow();
	});

	test("its lamps sit at or under the exposure ceiling", () => {
		const root = buildShipMesh("miner", "b").root;
		let lamps = 0;
		for (const mesh of meshesOf(root)) {
			const material = mesh.material as THREE.MeshStandardMaterial;
			if (!material.emissive || material.emissive.getHex() === 0) continue;
			lamps += 1;
			expect(material.emissiveIntensity).toBeLessThanOrEqual(
				EMISSIVE_CEILING * 1.000001,
			);
		}
		expect(lamps).toBeGreaterThan(0);
	});

	test("the detail and quality gates answer it without generated detail", () => {
		const root = buildShipMesh("miner", "b").root;
		expect(() => setShipDetail(root, "reduced")).not.toThrow();
		expect(() => updateShipVisuals(root, 10, "low")).not.toThrow();
		expect(root.getObjectByName("ship-greebles-0")).toBeUndefined();
		expect(root.getObjectByName("nav-lights")).toBeDefined();
		// The nav lights' pixel-ratio hook survives the clone.
		const lights = root.getObjectByName("nav-lights") as THREE.Points;
		expect(lights.onBeforeRender).not.toBe(
			THREE.Object3D.prototype.onBeforeRender,
		);
	});
});
