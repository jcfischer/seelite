/**
 * Node #812: the authored O4 courier is the courier the game draws.
 *
 * The preload (`tests/setup-courier-hull.ts`) installs the shipped model, so
 * every other row reading the courier's mesh — its envelope (`hull.test.ts`),
 * its vent placement and shares (`vent-placement.test.ts`, `vents.test.ts`),
 * its collision box — already measures this hull. What is held here is what
 * only the integration owns: that the shipped file is the approved geometry,
 * how the study's frame is carried into the hull's, and the parts the game
 * needs that the study did not have.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { COURIER_LENGTH_INSET_KM } from "../src/courier-hull";
import { HULL_SPECS } from "../src/hull";
import { EMISSIVE_CEILING } from "../src/light-rig";
import {
	HULL_REACH_KM,
	buildShipMesh,
	isDriveBell,
	shipMuzzlesKm,
} from "../src/ship-mesh";
import {
	DEFAULT_HULL_FINISH,
	HULL_FINISH_IDS,
	setHullFinish,
} from "../src/ship-surface";
import { ventThroats } from "../src/vent-plumes";
import { decodeShippedGlb } from "./helpers/read-coriolis-glb";

const courier = () => {
	const root = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
	root.updateMatrixWorld(true);
	return root;
};

const meshesOf = (root: THREE.Object3D) => {
	const out: THREE.Mesh[] = [];
	root.traverse((o) => {
		if (o instanceof THREE.Mesh) out.push(o);
	});
	return out;
};

afterEach(() => setHullFinish(DEFAULT_HULL_FINISH));

describe("the shipped file is the approved study", () => {
	test("every mesh, its positions and its triangles, exactly", async () => {
		// The prepare script (`spikes/courier-hull/prepare-game-asset.mjs`)
		// only re-encodes: no simplification, no quantisation. Held against the
		// study export the principal approved, decoded through the same loader.
		const study = await decodeShippedGlb(
			"spikes/courier-hull/courier-hull.glb",
		);
		const shipped = await decodeShippedGlb("public/models/courier-hull.glb");
		const shape = (scene: THREE.Object3D) =>
			meshesOf(scene)
				.map((m) => {
					const position = m.geometry.getAttribute("position");
					const index = m.geometry.getIndex();
					// One triangle list per mesh, as positions: a reorder of the
					// vertex buffer moves indices but never what is drawn.
					const triangles: string[] = [];
					const count = index ? index.count : position.count;
					for (let i = 0; i < count; i += 3) {
						const corner = (k: number) => {
							const v = index ? index.getX(i + k) : i + k;
							return `${position.getX(v)},${position.getY(v)},${position.getZ(v)}`;
						};
						// Started at its least corner: re-encoding may rotate a
						// triangle's corners, which keeps its winding and its face.
						const c = [corner(0), corner(1), corner(2)];
						const first = c.indexOf([...c].sort()[0]);
						triangles.push(
							[c[first], c[(first + 1) % 3], c[(first + 2) % 3]].join("|"),
						);
					}
					return { name: m.name, triangles: triangles.sort() };
				})
				.sort((a, b) => a.name.localeCompare(b.name));
		const a = shape(study);
		const b = shape(shipped);
		expect(b.map((m) => m.name)).toEqual(a.map((m) => m.name));
		expect(b.length).toBe(36);
		expect(b.reduce((n, m) => n + m.triangles.length, 0)).toBe(353_954);
		for (let i = 0; i < a.length; i++)
			expect([a[i].name, b[i].triangles]).toEqual([a[i].name, a[i].triangles]);
	}, 60_000);
});

describe("the study's frame carried into the hull's", () => {
	test("one uniform scale, so the approved silhouette is kept", () => {
		const frame = courier().getObjectByName("courier-hull-frame");
		expect(frame).toBeDefined();
		const { x, y, z } = (frame as THREE.Object3D).scale;
		expect(y).toBe(x);
		expect(z).toBe(x);
	});

	test("the length is the roster's reference, and the scale is what holds it", () => {
		// Every hull's turn rate is solved against the courier's length
		// (`referenceHandling`), so the model fits the declared length rather
		// than the declaration following the model.
		expect(HULL_SPECS.courier.env.lengthKm).toBe(0.0575);
		const size = new THREE.Box3()
			.setFromObject(courier())
			.getSize(new THREE.Vector3());
		expect(size.z).toBeCloseTo(
			HULL_SPECS.courier.env.lengthKm - COURIER_LENGTH_INSET_KM,
			12,
		);
	});

	test("the box sits on envCentre: the collision box's frame is the old one", () => {
		const centre = new THREE.Box3()
			.setFromObject(courier())
			.getCenter(new THREE.Vector3());
		const c = HULL_SPECS.courier.envCentre;
		// Starboard +x, dorsal +y, forward −z.
		expect(centre.x).toBeCloseTo(c.rightKm, 12);
		expect(centre.y).toBeCloseTo(c.upKm, 12);
		expect(centre.z).toBeCloseTo(-c.foreKm, 12);
	});

	test("the nose is −z: the canopy is forward and above, the drives aft", () => {
		const root = courier();
		const canopy = new THREE.Box3()
			.setFromObject(root.getObjectByName("canopy-glass") as THREE.Object3D)
			.getCenter(new THREE.Vector3());
		const box = new THREE.Box3().setFromObject(root);
		const centre = box.getCenter(new THREE.Vector3());
		expect(canopy.z).toBeLessThan(centre.z);
		expect(canopy.y).toBeGreaterThan(centre.y);
		const bells = meshesOf(root).filter(isDriveBell);
		for (const bell of bells) {
			const at = new THREE.Box3()
				.setFromObject(bell)
				.getCenter(new THREE.Vector3());
			expect(at.z).toBeGreaterThan(centre.z + 0.4 * (box.max.z - centre.z));
		}
	});

	test("every vertex is inside the declared display reach", () => {
		let farthest = 0;
		const v = new THREE.Vector3();
		for (const mesh of meshesOf(courier())) {
			const position = mesh.geometry.getAttribute("position");
			for (let i = 0; i < position.count; i++)
				farthest = Math.max(
					farthest,
					v
						.fromBufferAttribute(position, i)
						.applyMatrix4(mesh.matrixWorld)
						.length(),
				);
		}
		expect(farthest).toBeLessThan(HULL_REACH_KM.courier);
	});

	test("no finish moves the envelope: a finish changes only the drive glow", () => {
		const boxes = HULL_FINISH_IDS.map((id) => {
			setHullFinish(id);
			return new THREE.Box3().setFromObject(courier());
		});
		for (const box of boxes) {
			expect(box.min.distanceTo(boxes[0].min)).toBeLessThan(1e-12);
			expect(box.max.distanceTo(boxes[0].max)).toBeLessThan(1e-12);
		}
	});
});

describe("what the game needs that the study did not carry", () => {
	test("two drive glows, one per nacelle, that the plumes and the throttle find", () => {
		for (const finish of HULL_FINISH_IDS) {
			setHullFinish(finish);
			const root = courier();
			const bells = meshesOf(root).filter(isDriveBell);
			expect([finish, bells.map((b) => b.name).sort()]).toEqual([
				finish,
				["courier-port-exhaust", "courier-starboard-exhaust"],
			]);
			const xs = bells.map(
				(b) =>
					new THREE.Box3().setFromObject(b).getCenter(new THREE.Vector3()).x,
			);
			// Port is the mesh's −x.
			const port = bells.findIndex((b) => b.name === "courier-port-exhaust");
			expect(xs[port]).toBeLessThan(0);
			expect(xs[1 - port]).toBeGreaterThan(0);
			const main = ventThroats(root, "courier").filter(
				(t) => t.family === "main",
			);
			expect(main.length).toBe(2);
			for (const throat of main) expect(throat.placed).toBe("bell");
		}
	});

	test("a bowl glow is wound outward, so the back-sided finish draws its far wall", () => {
		setHullFinish(DEFAULT_HULL_FINISH);
		const bell = meshesOf(courier()).find(isDriveBell) as THREE.Mesh;
		expect((bell.material as THREE.Material).side).toBe(THREE.BackSide);
		const geometry = bell.geometry;
		const position = geometry.getAttribute("position");
		const index = geometry.getIndex() as THREE.BufferAttribute;
		const a = new THREE.Vector3();
		const b = new THREE.Vector3();
		const c = new THREE.Vector3();
		let inward = 0;
		let faces = 0;
		for (let f = 0; f < index.count; f += 3) {
			a.fromBufferAttribute(position, index.getX(f));
			b.fromBufferAttribute(position, index.getX(f + 1));
			c.fromBufferAttribute(position, index.getX(f + 2));
			const n = b.clone().sub(a).cross(c.clone().sub(a));
			if (n.length() < 1e-9) continue;
			// The geometry is built about its own z axis; the mesh's position
			// carries it onto its nacelle.
			const radial = new THREE.Vector3(
				(a.x + b.x + c.x) / 3,
				(a.y + b.y + c.y) / 3,
				0,
			);
			if (radial.length() < 1e-6) continue;
			faces++;
			if (n.dot(radial) < 0) inward++;
		}
		expect(faces).toBeGreaterThan(0);
		expect(inward).toBe(0);
	});

	test("the study's fixture screens are unpowered, and no lamp is over white", () => {
		const root = courier();
		const screens = meshesOf(root).filter((m) =>
			m.name.startsWith("interior-screen-"),
		);
		expect(screens.map((s) => s.name).sort()).toEqual([
			"interior-screen-flight",
			"interior-screen-radar",
			"interior-screen-systems",
			"interior-screen-target",
		]);
		for (const screen of screens) {
			const material = screen.material as THREE.MeshBasicMaterial;
			expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
			expect(material.map).toBeNull();
			expect(material.color.getHex()).toBe(0x01090b);
		}
		for (const mesh of meshesOf(root)) {
			const material = mesh.material as THREE.MeshStandardMaterial;
			if (material.emissiveIntensity !== undefined)
				expect([
					mesh.name,
					material.emissiveIntensity <= EMISSIVE_CEILING,
				]).toEqual([mesh.name, true]);
		}
	});

	test("every courier draws the one loaded model", () => {
		const first = meshesOf(courier());
		const second = meshesOf(courier());
		expect(second.length).toBe(first.length);
		for (let i = 0; i < first.length; i++) {
			expect(second[i].geometry).toBe(first[i].geometry);
			expect(second[i].material).toBe(first[i].material);
		}
	});

	test("the one gun is on the nose, on metal", () => {
		const root = courier();
		const box = new THREE.Box3().setFromObject(root);
		const muzzles = shipMuzzlesKm("courier", HULL_SPECS.courier.variant);
		expect(muzzles.length).toBe(HULL_SPECS.courier.hardpoints);
		for (const m of muzzles) {
			// Forward of the box's centre, inside the box.
			expect(m.z).toBeLessThan(box.getCenter(new THREE.Vector3()).z);
			expect(box.containsPoint(new THREE.Vector3(m.x, m.y, m.z))).toBe(true);
		}
	});
});
