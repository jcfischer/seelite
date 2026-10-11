/**
 * Node #814: the authored Bollard O4 is the tug the game draws.
 *
 * The preload (`tests/setup/tug-hull.ts`) installs the shipped model, so every
 * other row reading the tug's mesh — its envelope (`hull.test.ts`), its vent
 * placement and shares (`vent-placement.test.ts`, `vents.test.ts`), its muzzle
 * — already measures this hull. What is held here is what only the
 * integration owns: the study's frame carried into the hull's at 1:1, the
 * parts the game adds, and the stand-in's replacement. That the shipped file
 * is the approved study is `tests/bollard-asset.test.ts`'s.
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
	TUG_FRAME_NAME,
	TUG_KM_PER_M,
	TUG_LEVEL_NAMES,
	TUG_NOZZLES_M,
} from "../src/tug-hull";
import { ventThroats } from "../src/vent-plumes";
import {
	type Surface,
	countBeyond,
	surfaceGrid,
	trianglePoints,
} from "./helpers/surface-distance";

const installed = authoredHullBuilder("tug");
const courierInstalled = authoredHullBuilder("courier");
afterEach(() => {
	setHullFinish(DEFAULT_HULL_FINISH);
	installAuthoredHull("tug", installed);
	installAuthoredHull("courier", courierInstalled);
});

const tug = () => {
	const root = buildShipMesh("tug", HULL_SPECS.tug.variant).root;
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

test("the preload installed the model: the selected tug is authored", () => {
	expect(installed).toBeDefined();
	expect(tug().userData.authored).toBe(true);
	expect(tug().getObjectByName(TUG_LEVEL_NAMES.full)).toBeDefined();
});

describe("the study's frame carried into the hull's", () => {
	test("1:1 and a half-turn about Y: a study metre is a metre", () => {
		const frame = tug().getObjectByName(TUG_FRAME_NAME) as THREE.Object3D;
		expect(frame).toBeDefined();
		expect(frame.scale.toArray()).toEqual([
			TUG_KM_PER_M,
			TUG_KM_PER_M,
			TUG_KM_PER_M,
		]);
		expect(TUG_KM_PER_M).toBe(0.001);
		expect(frame.rotation.y).toBe(Math.PI);
	});

	test("the box sits on envCentre", () => {
		const centre = new THREE.Box3()
			.setFromObject(tug())
			.getCenter(new THREE.Vector3());
		const c = HULL_SPECS.tug.envCentre;
		expect(centre.x).toBeCloseTo(c.rightKm, 12);
		expect(centre.y).toBeCloseTo(c.upKm, 12);
		expect(centre.z).toBeCloseTo(-c.foreKm, 12);
	});

	test("the nose is −z: the canopy is forward and above, the drives aft", () => {
		const root = tug();
		const canopy = new THREE.Box3()
			.setFromObject(root.getObjectByName("canopy-glass") as THREE.Object3D)
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
		for (const mesh of meshesOf(tug())) {
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
		expect(farthest).toBeLessThan(HULL_REACH_KM.tug);
		expect(HULL_REACH_KM.tug - farthest).toBeLessThan(0.0001);
	});

	test("no finish moves the envelope: a finish changes only the drive glow", () => {
		const boxes = HULL_FINISH_IDS.map((id) => {
			setHullFinish(id);
			return new THREE.Box3().setFromObject(tug());
		});
		for (const box of boxes) {
			expect(box.min.distanceTo(boxes[0].min)).toBeLessThan(1e-12);
			expect(box.max.distanceTo(boxes[0].max)).toBeLessThan(1e-12);
		}
	});
});

describe("what the game needs that the study did not carry", () => {
	test("two drive glows, one per engine, that the plumes and the throttle find", () => {
		for (const finish of HULL_FINISH_IDS) {
			setHullFinish(finish);
			const root = tug();
			const bells = meshesOf(root).filter(isDriveBell);
			expect([finish, bells.map((b) => b.name).sort()]).toEqual([
				finish,
				["tug-port-exhaust", "tug-starboard-exhaust"],
			]);
			const port = bells.find((b) => b.name === "tug-port-exhaust");
			const starboard = bells.find((b) => b.name === "tug-starboard-exhaust");
			const x = (m?: THREE.Mesh) =>
				new THREE.Box3()
					.setFromObject(m as THREE.Mesh)
					.getCenter(new THREE.Vector3()).x;
			// Port is the mesh's −x.
			expect(x(port)).toBeLessThan(0);
			expect(x(starboard)).toBeGreaterThan(0);
			const main = ventThroats(root, "tug").filter((t) => t.family === "main");
			expect(main.length).toBe(2);
			for (const drive of main) expect(drive.placed).toBe("bell");
		}
	}, 60_000);

	test("each glow is in its engine's open mouth, 3 cm clear of every triangle", () => {
		// Triangles, not vertices: the alloy rods lining the wall have vertices
		// only at their ends, so a vertex check passes a glow through them. In
		// the study's frame, metres, so the clearance reads in metres.
		const CLEAR_M = 0.03;
		for (const finish of HULL_FINISH_IDS) {
			setHullFinish(finish);
			const root = tug();
			const frame = root.getObjectByName(TUG_FRAME_NAME) as THREE.Object3D;
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
				root.getObjectByName(TUG_LEVEL_NAMES.full) as THREE.Object3D,
			);
			const grid = surfaceGrid(soup(model), 0.5);
			const bells = meshesOf(root).filter(isDriveBell);
			expect(bells.length).toBe(2);
			for (const bell of bells) {
				const points = trianglePoints(soup([bell]), 4);
				const n = points.length / 3;
				expect([finish, bell.name, countBeyond(grid, points, CLEAR_M)]).toEqual(
					[finish, bell.name, n],
				);
				// In the mouth: between the cap that closes it and the lip's aft
				// face, within the mouth's wall about its engine's axis.
				for (let i = 0; i < n; i++) {
					const [x, y, z] = [
						points[3 * i],
						points[3 * i + 1],
						points[3 * i + 2],
					];
					expect(z).toBeLessThan(-26.0);
					expect(z).toBeGreaterThan(-28.1);
					expect(Math.hypot(Math.abs(x) - TUG_NOZZLES_M.x, y)).toBeLessThan(
						3.4,
					);
				}
			}
		}
	}, 120_000);

	test("a bowl glow's faces wind outward, so the back-sided finish draws its far wall", () => {
		const bell = meshesOf(tug()).find(isDriveBell) as THREE.Mesh;
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
		for (const mesh of meshesOf(tug())) {
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
		const alloy = meshesOf(tug())
			.map((mesh) => mesh.material as THREE.MeshStandardMaterial)
			.filter((material) => material.name === AUTHORED_ALLOY_MATERIAL);
		expect(alloy.length).toBeGreaterThan(0);
		for (const material of alloy)
			expect(material.roughness).toBe(AUTHORED_ALLOY_ROUGHNESS);
	});

	test("every tug draws the one loaded model", () => {
		const first = meshesOf(tug());
		const second = meshesOf(tug());
		expect(second.length).toBe(first.length);
		for (let i = 0; i < first.length; i++) {
			expect(second[i].geometry).toBe(first[i].geometry);
			expect(second[i].material).toBe(first[i].material);
		}
	});

	test("the one gun is forward, on metal", () => {
		const root = tug();
		const box = new THREE.Box3().setFromObject(root);
		const size = box.getSize(new THREE.Vector3());
		const muzzles = shipMuzzlesKm("tug", HULL_SPECS.tug.variant);
		expect(muzzles.length).toBe(HULL_SPECS.tug.hardpoints);
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
	test("a pre-install tug is the loft, and is rebuilt once into the model", () => {
		installAuthoredHull("tug", undefined);
		const root = buildShipMesh("tug", HULL_SPECS.tug.variant).root;
		const scene = new THREE.Scene();
		scene.add(root);
		root.position.set(1, 2, 3);
		expect(root.userData.authored).not.toBe(true);
		expect(rebuildAuthoredStandIn(root)).toBe(false);
		installAuthoredHull("tug", installed);
		expect(rebuildAuthoredStandIn(root)).toBe(true);
		expect(root.userData.authored).toBe(true);
		expect(root.getObjectByName(TUG_FRAME_NAME)).toBeDefined();
		expect(rebuildAuthoredStandIn(root)).toBe(false);
		expect(root.parent).toBe(scene);
		expect(root.position.toArray()).toEqual([1, 2, 3]);
	});

	test("installing the tug leaves a courier stand-in alone, and the reverse", () => {
		installAuthoredHull("tug", undefined);
		installAuthoredHull("courier", undefined);
		const courier = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
		const standIn = buildShipMesh("tug", HULL_SPECS.tug.variant).root;
		installAuthoredHull("tug", installed);
		expect(rebuildAuthoredStandIn(courier)).toBe(false);
		installAuthoredHull("tug", undefined);
		installAuthoredHull("courier", courierInstalled);
		expect(rebuildAuthoredStandIn(standIn)).toBe(false);
		expect(rebuildAuthoredStandIn(courier)).toBe(true);
	});

	test("a cached tug wreck is rebuilt through its own dark builder", () => {
		installAuthoredHull("tug", undefined);
		const root = buildDerelictMesh("tug");
		installAuthoredHull("tug", installed);
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
