/**
 * Node #820: the authored Discovery / Voyager A is the voyager the game draws.
 *
 * The preload (`tests/setup/voyager-hull.ts`) installs the shipped model, so every
 * other row reading the voyager's mesh — its envelope (`hull.test.ts`), its vent
 * placement and shares (`vent-placement.test.ts`, `vents.test.ts`), its muzzle
 * — already measures this hull. What is held here is what only the
 * integration owns: the study's frame carried into the hull's at the roster
 * length, the parts the game adds, and the stand-in's replacement. That the
 * shipped file is the accepted study, turned, is `tests/discovery-asset.test.ts`'s.
 */
import { afterEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	AUTHORED_ALLOY_MATERIAL,
	AUTHORED_ALLOY_ROUGHNESS,
} from "../src/authored-hull";
import { buildDerelictMesh, disposeDerelict } from "../src/derelict-mesh";
import { HULL_SPECS } from "../src/hull";
import { EMISSIVE_CEILING } from "../src/light-rig";
import {
	HULL_REACH_KM,
	authoredHullBuilder,
	buildShipMesh,
	installAuthoredHull,
	isDriveBell,
	rebuildAuthoredStandIn,
	shipMuzzlesKm,
} from "../src/ship-mesh";
import { isLevelStandIn } from "../src/ship-detail";
import {
	DEFAULT_HULL_FINISH,
	HULL_FINISH_IDS,
	setHullFinish,
} from "../src/ship-surface";
import {
	VOYAGER_FRAME_NAME,
	VOYAGER_LENGTH_INSET_KM,
	VOYAGER_LEVEL_NAMES,
	VOYAGER_NOZZLES_M,
} from "../src/voyager-hull";
import { ventThroats } from "../src/vent-plumes";
import {
	type Surface,
	countBeyond,
	surfaceGrid,
	trianglePoints,
} from "./helpers/surface-distance";

const installed = authoredHullBuilder("voyager");
const courierInstalled = authoredHullBuilder("courier");
afterEach(() => {
	setHullFinish(DEFAULT_HULL_FINISH);
	installAuthoredHull("voyager", installed);
	installAuthoredHull("courier", courierInstalled);
});

const voyager = () => {
	const root = buildShipMesh("voyager", HULL_SPECS.voyager.variant).root;
	root.updateMatrixWorld(true);
	return root;
};

/** The approved model's meshes and the glows: a reduced level is drawn,
 *  never measured. */
const meshesOf = (root: THREE.Object3D) => {
	const out: THREE.Mesh[] = [];
	root.traverse((o) => {
		if (o instanceof THREE.Mesh && !isLevelStandIn(o)) out.push(o);
	});
	return out;
};

test("the preload installed the model: the selected voyager is authored", () => {
	expect(installed).toBeDefined();
	expect(voyager().userData.authored).toBe(true);
	expect(voyager().getObjectByName(VOYAGER_LEVEL_NAMES.full)).toBeDefined();
});

describe("the study's frame carried into the hull's", () => {
	test("scaled to the roster length and turned half a turn about Y", () => {
		const frame = voyager().getObjectByName(
			VOYAGER_FRAME_NAME,
		) as THREE.Object3D;
		expect(frame).toBeDefined();
		// The model's box in hull kilometres: one uniform scale (the accepted
		// silhouette is kept), landing inside the declared length by the inset, so
		// the box rounds up to the declared length and not past it
		// (`voyager-hull.ts`).
		const drawnLengthKm = new THREE.Box3()
			.setFromObject(
				voyager().getObjectByName(VOYAGER_LEVEL_NAMES.full) as THREE.Object3D,
			)
			.getSize(new THREE.Vector3()).z;
		const k = frame.scale.x;
		expect(frame.scale.toArray()).toEqual([k, k, k]);
		expect(drawnLengthKm).toBeCloseTo(
			HULL_SPECS.voyager.env.lengthKm - VOYAGER_LENGTH_INSET_KM,
			9,
		);
		// About 1.35 metres of hull per study metre: the study is 141.6 m, the
		// roster's voyager 191 m.
		expect(k * 1000).toBeGreaterThan(1.3);
		expect(k * 1000).toBeLessThan(1.4);
		expect(frame.rotation.y).toBe(Math.PI);
	});

	test("the box sits on envCentre", () => {
		const centre = new THREE.Box3()
			.setFromObject(voyager())
			.getCenter(new THREE.Vector3());
		const c = HULL_SPECS.voyager.envCentre;
		expect(centre.x).toBeCloseTo(c.rightKm, 12);
		expect(centre.y).toBeCloseTo(c.upKm, 12);
		expect(centre.z).toBeCloseTo(-c.foreKm, 12);
	});

	test("the nose is −z: the canopy is forward and above, the drives aft", () => {
		const root = voyager();
		const canopy = new THREE.Box3()
			.setFromObject(
				root.getObjectByName("sphere-canopy-glass") as THREE.Object3D,
			)
			.getCenter(new THREE.Vector3());
		const box = new THREE.Box3().setFromObject(root);
		const centre = box.getCenter(new THREE.Vector3());
		expect(canopy.z).toBeLessThan(centre.z);
		expect(canopy.y).toBeGreaterThan(centre.y);
		for (const bell of meshesOf(root).filter(isDriveBell)) {
			const at = new THREE.Box3()
				.setFromObject(bell)
				.getCenter(new THREE.Vector3());
			expect(at.z).toBeGreaterThan(centre.z + 0.4 * (box.max.z - centre.z));
		}
	});

	test("the display reach is the farthest vertex, rounded up to 0.1 m", () => {
		let farthest = 0;
		const v = new THREE.Vector3();
		for (const mesh of meshesOf(voyager())) {
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
		expect(farthest).toBeLessThan(HULL_REACH_KM.voyager);
		expect(HULL_REACH_KM.voyager - farthest).toBeLessThan(0.0001);
	});

	test("no finish moves the envelope: a finish changes only the drive glow", () => {
		const boxes = HULL_FINISH_IDS.map((id) => {
			setHullFinish(id);
			return new THREE.Box3().setFromObject(voyager());
		});
		for (const box of boxes) {
			expect(box.min.distanceTo(boxes[0].min)).toBeLessThan(1e-12);
			expect(box.max.distanceTo(boxes[0].max)).toBeLessThan(1e-12);
		}
	});
});

describe("what the game needs that the study did not carry", () => {
	test("three drive glows, one per bell, that the plumes and the throttle find", () => {
		for (const finish of HULL_FINISH_IDS) {
			setHullFinish(finish);
			const root = voyager();
			const bells = meshesOf(root).filter(isDriveBell);
			expect([finish, bells.map((b) => b.name).sort()]).toEqual([
				finish,
				[
					"voyager-keel-exhaust",
					"voyager-port-exhaust",
					"voyager-starboard-exhaust",
				],
			]);
			const at = (name: string) =>
				new THREE.Box3()
					.setFromObject(bells.find((b) => b.name === name) as THREE.Mesh)
					.getCenter(new THREE.Vector3());
			// Port is the mesh's −x; two bells stand above the axis and one below.
			expect(at("voyager-port-exhaust").x).toBeLessThan(0);
			expect(at("voyager-starboard-exhaust").x).toBeGreaterThan(0);
			expect(at("voyager-keel-exhaust").x).toBeCloseTo(0, 9);
			const box = new THREE.Box3().setFromObject(root);
			const middle = box.getCenter(new THREE.Vector3());
			expect(at("voyager-port-exhaust").y).toBeGreaterThan(middle.y);
			expect(at("voyager-keel-exhaust").y).toBeLessThan(middle.y);
			const main = ventThroats(root, "voyager").filter(
				(t) => t.family === "main",
			);
			expect(main.length).toBe(3);
			for (const drive of main) expect(drive.placed).toBe("bell");
		}
	}, 60_000);

	test("each glow is in its bell's open mouth, 3 cm clear of every triangle", () => {
		// Triangles, not vertices: the alloy rods lining the wall have vertices
		// only at their ends, so a vertex check passes a glow through them. In
		// the study's frame, metres, so the clearance reads in metres.
		const CLEAR_M = 0.03;
		for (const finish of HULL_FINISH_IDS) {
			setHullFinish(finish);
			const root = voyager();
			const frame = root.getObjectByName(VOYAGER_FRAME_NAME) as THREE.Object3D;
			const toStudy = frame.matrixWorld.clone().invert();
			const soup = (meshes: THREE.Mesh[]): Surface => {
				const positions: number[] = [];
				const index: number[] = [];
				const v = new THREE.Vector3();
				for (const mesh of meshes) {
					const toFrame = toStudy.clone().multiply(mesh.matrixWorld);
					const p = mesh.geometry.getAttribute("position");
					const base = positions.length / 3;
					for (let i = 0; i < p.count; i++)
						positions.push(
							...v.fromBufferAttribute(p, i).applyMatrix4(toFrame).toArray(),
						);
					const ix = mesh.geometry.getIndex();
					for (let i = 0; i < (ix ? ix.count : p.count); i++)
						index.push(base + (ix ? ix.getX(i) : i));
				}
				return { positions: new Float32Array(positions), index };
			};
			const model = meshesOf(
				root.getObjectByName(VOYAGER_LEVEL_NAMES.full) as THREE.Object3D,
			);
			const grid = surfaceGrid(soup(model), 0.5);
			const bells = meshesOf(root).filter(isDriveBell);
			expect(bells.length).toBe(3);
			for (const bell of bells) {
				const mount = VOYAGER_NOZZLES_M.mounts.find(
					(m) => bell.name === `voyager-${m.side}-exhaust`,
				) as { x: number; y: number };
				const points = trianglePoints(soup([bell]), 4);
				const n = points.length / 3;
				expect([finish, bell.name, countBeyond(grid, points, CLEAR_M)]).toEqual(
					[finish, bell.name, n],
				);
				// In the mouth: between the recess ring that closes it and the lip's
				// aft face, within the flared wall about its bell's axis.
				for (let i = 0; i < n; i++) {
					const [x, y, z] = [
						points[3 * i],
						points[3 * i + 1],
						points[3 * i + 2],
					];
					expect(z).toBeLessThan(-73.7);
					expect(z).toBeGreaterThan(-79.1);
					expect(Math.hypot(x - mount.x, y - mount.y)).toBeLessThan(2.1);
				}
			}
		}
	}, 120_000);

	test("a bowl glow's faces wind outward, so the back-sided finish draws its far wall", () => {
		const bell = meshesOf(voyager()).find(isDriveBell) as THREE.Mesh;
		expect((bell.material as THREE.Material).side).toBe(THREE.BackSide);
		const position = bell.geometry.getAttribute("position");
		const index = bell.geometry.getIndex() as THREE.BufferAttribute;
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

	test("no lamp is over white", () => {
		for (const mesh of meshesOf(voyager())) {
			const material = mesh.material as THREE.MeshStandardMaterial;
			if (material.emissiveIntensity !== undefined)
				expect([
					mesh.name,
					material.emissiveIntensity <= EMISSIVE_CEILING,
				]).toEqual([mesh.name, true]);
		}
	});

	test("the machined alloy is raised to the floor that stopped the bay flash (#843)", () => {
		// The study's alloy is 0.23, rougher-looking than nothing: below the
		// courier's 0.28 that flashed for one frame under a bay flood.
		const alloy = meshesOf(voyager())
			.map((mesh) => mesh.material as THREE.MeshStandardMaterial)
			.filter((material) => material.name === AUTHORED_ALLOY_MATERIAL);
		expect(alloy.length).toBeGreaterThan(0);
		for (const material of alloy)
			expect(material.roughness).toBe(AUTHORED_ALLOY_ROUGHNESS);
	});

	test("every voyager draws the one loaded model", () => {
		const first = meshesOf(voyager());
		const second = meshesOf(voyager());
		expect(second.length).toBe(first.length);
		for (let i = 0; i < first.length; i++) {
			expect(second[i].geometry).toBe(first[i].geometry);
			expect(second[i].material).toBe(first[i].material);
		}
	});

	test("the one gun is forward, on metal", () => {
		const root = voyager();
		const box = new THREE.Box3().setFromObject(root);
		const size = box.getSize(new THREE.Vector3());
		const muzzles = shipMuzzlesKm("voyager", HULL_SPECS.voyager.variant);
		expect(muzzles.length).toBe(HULL_SPECS.voyager.hardpoints);
		const caster = new THREE.Raycaster();
		for (const m of muzzles) {
			expect(m.z).toBeLessThan(box.getCenter(new THREE.Vector3()).z);
			expect(box.containsPoint(new THREE.Vector3(m.x, m.y, m.z))).toBe(true);
			caster.set(
				new THREE.Vector3(m.x, m.y, box.min.z - size.z),
				new THREE.Vector3(0, 0, 1),
			);
			const hit = caster.intersectObject(root, true).find((h) => h.face);
			expect(hit).toBeDefined();
			expect(Math.abs((hit as THREE.Intersection).point.z - m.z)).toBeLessThan(
				1e-6,
			);
		}
	});
});

describe("the loft stands in until the model installs (D3)", () => {
	test("a pre-install voyager is the loft, and is rebuilt once into the model", () => {
		installAuthoredHull("voyager", undefined);
		const root = buildShipMesh("voyager", HULL_SPECS.voyager.variant).root;
		const scene = new THREE.Scene();
		scene.add(root);
		root.position.set(1, 2, 3);
		expect(root.userData.authored).not.toBe(true);
		expect(rebuildAuthoredStandIn(root)).toBe(false);
		installAuthoredHull("voyager", installed);
		expect(rebuildAuthoredStandIn(root)).toBe(true);
		expect(root.userData.authored).toBe(true);
		expect(root.getObjectByName(VOYAGER_FRAME_NAME)).toBeDefined();
		expect(rebuildAuthoredStandIn(root)).toBe(false);
		expect(root.parent).toBe(scene);
		expect(root.position.toArray()).toEqual([1, 2, 3]);
	});

	test("installing the voyager leaves a courier stand-in alone, and the reverse", () => {
		installAuthoredHull("voyager", undefined);
		installAuthoredHull("courier", undefined);
		const courier = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
		const standIn = buildShipMesh("voyager", HULL_SPECS.voyager.variant).root;
		installAuthoredHull("voyager", installed);
		expect(rebuildAuthoredStandIn(courier)).toBe(false);
		installAuthoredHull("voyager", undefined);
		installAuthoredHull("courier", courierInstalled);
		expect(rebuildAuthoredStandIn(standIn)).toBe(false);
		expect(rebuildAuthoredStandIn(courier)).toBe(true);
	});

	test("a cached voyager wreck is rebuilt through its own dark builder", () => {
		installAuthoredHull("voyager", undefined);
		const root = buildDerelictMesh("voyager");
		installAuthoredHull("voyager", installed);
		expect(
			rebuildAuthoredStandIn(
				root,
				(id) => buildDerelictMesh(id),
				() => disposeDerelict(root),
			),
		).toBe(true);
		expect(root.userData.derelict).toBe(true);
		expect(root.userData.authored).toBe(true);
		root.traverse((object) => {
			if (
				object instanceof THREE.Mesh &&
				object.material instanceof THREE.MeshStandardMaterial
			)
				expect(object.material.emissiveIntensity).toBe(0);
		});
		disposeDerelict(root);
	});
});
