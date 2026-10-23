import { afterEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	AUTHORED_ALLOY_MATERIAL,
	AUTHORED_ALLOY_ROUGHNESS,
} from "../src/authored-hull";
import {
	AuthoredLevelMesh,
	LEVEL_REACHED_ERROR_KM,
	levelErrorKm,
} from "../src/authored-levels";
import { buildDerelictMesh, disposeDerelict } from "../src/derelict-mesh";
import { DETAIL_RADII } from "../src/detail-level";
import { disposeSubtree, isShared } from "../src/gpu-teardown";
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
	updateShipVisuals,
} from "../src/ship-mesh";
import { isLevelStandIn } from "../src/ship-detail";
import {
	DEFAULT_HULL_FINISH,
	HULL_FINISH_IDS,
	setHullFinish,
} from "../src/ship-surface";
import {
	INTERCEPTOR_FRAME_NAME,
	INTERCEPTOR_KM_PER_M,
	INTERCEPTOR_LEVEL_NAMES,
	INTERCEPTOR_NOZZLES_M,
} from "../src/interceptor-hull";
import { ventThroats } from "../src/vent-plumes";
import { meshStats } from "../scripts/lib/mesh-stats.mjs";
import {
	type Surface,
	countBeyond,
	surfaceGrid,
	trianglePoints,
} from "./helpers/surface-distance";

const REDUCED_TRIANGLES = 95_784;
const OUTLINE_TRIANGLES = 10_242;
const installed = authoredHullBuilder("interceptor");
const courierInstalled = authoredHullBuilder("courier");
afterEach(() => {
	setHullFinish(DEFAULT_HULL_FINISH);
	installAuthoredHull("interceptor", installed);
	installAuthoredHull("courier", courierInstalled);
});

const interceptor = () => {
	const root = buildShipMesh(
		"interceptor",
		HULL_SPECS.interceptor.variant,
	).root;
	root.updateMatrixWorld(true);
	return root;
};

const meshesOf = (root: THREE.Object3D) => {
	const out: THREE.Mesh[] = [];
	root.traverse((o) => {
		if (o instanceof THREE.Mesh && !isLevelStandIn(o)) out.push(o);
	});
	return out;
};

test("the preload installed the model: the selected interceptor is authored", () => {
	expect(installed).toBeDefined();
	expect(interceptor().userData.authored).toBe(true);
	expect(
		interceptor().getObjectByName(INTERCEPTOR_LEVEL_NAMES.full),
	).toBeDefined();
});

describe("the study's frame carried into the hull's", () => {
	test("1:1 and a half-turn about Y: a study metre is a metre", () => {
		const frame = interceptor().getObjectByName(
			INTERCEPTOR_FRAME_NAME,
		) as THREE.Object3D;
		expect(frame).toBeDefined();
		expect(frame.scale.toArray()).toEqual([
			INTERCEPTOR_KM_PER_M,
			INTERCEPTOR_KM_PER_M,
			INTERCEPTOR_KM_PER_M,
		]);
		expect(frame.rotation.y).toBe(Math.PI);
		const size = new THREE.Box3()
			.setFromObject(
				interceptor().getObjectByName(
					INTERCEPTOR_LEVEL_NAMES.full,
				) as THREE.Object3D,
			)
			.getSize(new THREE.Vector3());
		expect(size.z * 1000).toBeCloseTo(62.3085, 3);
		expect(size.x * 1000).toBeCloseTo(25.022, 3);
		expect(size.y * 1000).toBeCloseTo(25.0198, 3);
		const env = HULL_SPECS.interceptor.env;
		expect(size.z).toBeLessThanOrEqual(env.lengthKm);
		expect(size.x).toBeLessThanOrEqual(env.beamKm);
		expect(size.y).toBeLessThanOrEqual(env.heightKm);
	});

	test("the box sits on envCentre", () => {
		const centre = new THREE.Box3()
			.setFromObject(interceptor())
			.getCenter(new THREE.Vector3());
		const c = HULL_SPECS.interceptor.envCentre;
		expect(centre.x).toBeCloseTo(c.rightKm, 12);
		expect(centre.y).toBeCloseTo(c.upKm, 12);
		expect(centre.z).toBeCloseTo(-c.foreKm, 12);
	});

	test("the nose is −z: the canopy is forward and above, the drives aft", () => {
		const root = interceptor();
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
		for (const mesh of meshesOf(interceptor())) {
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
		expect(farthest).toBeLessThan(HULL_REACH_KM.interceptor);
		expect(HULL_REACH_KM.interceptor - farthest).toBeLessThan(0.0001);
	});

	test("no finish moves the envelope: a finish changes only the drive glow", () => {
		const boxes = HULL_FINISH_IDS.map((id) => {
			setHullFinish(id);
			return new THREE.Box3().setFromObject(interceptor());
		});
		for (const box of boxes) {
			expect(box.min.distanceTo(boxes[0].min)).toBeLessThan(1e-12);
			expect(box.max.distanceTo(boxes[0].max)).toBeLessThan(1e-12);
		}
	});
});

describe("what the game needs that the study did not carry", () => {
	test("four drive glows, one per engine, that the plumes and the throttle find", () => {
		for (const finish of HULL_FINISH_IDS) {
			setHullFinish(finish);
			const root = interceptor();
			const bells = meshesOf(root).filter(isDriveBell);
			expect([finish, bells.map((b) => b.name).sort()]).toEqual([
				finish,
				[
					"interceptor-dorsal-exhaust",
					"interceptor-keel-exhaust",
					"interceptor-port-exhaust",
					"interceptor-starboard-exhaust",
				],
			]);
			const at = (name: string) =>
				new THREE.Box3()
					.setFromObject(bells.find((b) => b.name === name) as THREE.Mesh)
					.getCenter(new THREE.Vector3());
			expect(at("interceptor-port-exhaust").x).toBeLessThan(0);
			expect(at("interceptor-starboard-exhaust").x).toBeGreaterThan(0);
			expect(at("interceptor-dorsal-exhaust").x).toBeCloseTo(0, 9);
			expect(at("interceptor-keel-exhaust").x).toBeCloseTo(0, 9);
			const box = new THREE.Box3().setFromObject(root);
			const middle = box.getCenter(new THREE.Vector3());
			expect(at("interceptor-dorsal-exhaust").y).toBeGreaterThan(middle.y);
			expect(at("interceptor-keel-exhaust").y).toBeLessThan(middle.y);
			for (const bell of bells) {
				expect(at(bell.name).z).toBeGreaterThan(
					middle.z + 0.4 * (box.max.z - middle.z),
				);
			}
			const main = ventThroats(root, "interceptor").filter(
				(t) => t.family === "main",
			);
			expect(main.length).toBe(4);
			for (const drive of main) expect(drive.placed).toBe("bell");
		}
	}, 60_000);

	test("each glow is in its engine's open mouth, 3 cm clear of every triangle", () => {
		const CLEAR_M = 0.03;
		for (const finish of HULL_FINISH_IDS) {
			setHullFinish(finish);
			const root = interceptor();
			const frame = root.getObjectByName(
				INTERCEPTOR_FRAME_NAME,
			) as THREE.Object3D;
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
				root.getObjectByName(INTERCEPTOR_LEVEL_NAMES.full) as THREE.Object3D,
			);
			const grid = surfaceGrid(soup(model), 0.5);
			const bells = meshesOf(root).filter(isDriveBell);
			expect(bells.length).toBe(4);
			for (const bell of bells) {
				const mount = INTERCEPTOR_NOZZLES_M.mounts.find(
					(m) => bell.name === `interceptor-${m.side}-exhaust`,
				) as { x: number; y: number };
				const points = trianglePoints(soup([bell]), 4);
				const n = points.length / 3;
				expect([finish, bell.name, countBeyond(grid, points, CLEAR_M)]).toEqual(
					[finish, bell.name, n],
				);
				for (let i = 0; i < n; i++) {
					const [x, y, z] = [
						points[3 * i],
						points[3 * i + 1],
						points[3 * i + 2],
					];
					expect(z).toBeLessThan(-29.6);
					expect(z).toBeGreaterThan(-31.1);
					expect(Math.hypot(x - mount.x, y - mount.y)).toBeLessThan(3.2);
				}
			}
		}
	}, 120_000);

	test("a bowl glow's faces wind outward, so the back-sided finish draws its far wall", () => {
		const bell = meshesOf(interceptor()).find(isDriveBell) as THREE.Mesh;
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
		for (const mesh of meshesOf(interceptor())) {
			const material = mesh.material as THREE.MeshStandardMaterial;
			if (material.emissiveIntensity !== undefined)
				expect([
					mesh.name,
					material.emissiveIntensity <= EMISSIVE_CEILING,
				]).toEqual([mesh.name, true]);
		}
	});

	test("the machined alloy is raised to the floor that stopped the bay flash (#843)", () => {
		const alloy = meshesOf(interceptor())
			.map((mesh) => mesh.material as THREE.MeshStandardMaterial)
			.filter((material) => material.name === AUTHORED_ALLOY_MATERIAL);
		expect(alloy.length).toBeGreaterThan(0);
		for (const material of alloy)
			expect(material.roughness).toBe(AUTHORED_ALLOY_ROUGHNESS);
	});

	test("every interceptor draws the one loaded model", () => {
		const first = meshesOf(interceptor());
		const second = meshesOf(interceptor());
		expect(second.length).toBe(first.length);
		for (let i = 0; i < first.length; i++) {
			expect(second[i].geometry).toBe(first[i].geometry);
			expect(second[i].material).toBe(first[i].material);
		}
	});

	test("the one gun is forward, on metal", () => {
		const root = interceptor();
		const box = new THREE.Box3().setFromObject(root);
		const size = box.getSize(new THREE.Vector3());
		const muzzles = shipMuzzlesKm(
			"interceptor",
			HULL_SPECS.interceptor.variant,
		);
		expect(muzzles.length).toBe(HULL_SPECS.interceptor.hardpoints);
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
	test("a pre-install interceptor is the loft, and is rebuilt once into the model", () => {
		installAuthoredHull("interceptor", undefined);
		const root = buildShipMesh(
			"interceptor",
			HULL_SPECS.interceptor.variant,
		).root;
		const scene = new THREE.Scene();
		scene.add(root);
		root.position.set(1, 2, 3);
		expect(root.userData.authored).not.toBe(true);
		expect(rebuildAuthoredStandIn(root)).toBe(false);
		installAuthoredHull("interceptor", installed);
		expect(rebuildAuthoredStandIn(root)).toBe(true);
		expect(root.userData.authored).toBe(true);
		expect(root.getObjectByName(INTERCEPTOR_FRAME_NAME)).toBeDefined();
		expect(rebuildAuthoredStandIn(root)).toBe(false);
		expect(root.parent).toBe(scene);
		expect(root.position.toArray()).toEqual([1, 2, 3]);
	});

	test("installing the interceptor leaves a courier stand-in alone, and the reverse", () => {
		installAuthoredHull("interceptor", undefined);
		installAuthoredHull("courier", undefined);
		const courier = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
		const standIn = buildShipMesh(
			"interceptor",
			HULL_SPECS.interceptor.variant,
		).root;
		installAuthoredHull("interceptor", installed);
		expect(rebuildAuthoredStandIn(courier)).toBe(false);
		installAuthoredHull("interceptor", undefined);
		installAuthoredHull("courier", courierInstalled);
		expect(rebuildAuthoredStandIn(standIn)).toBe(false);
		expect(rebuildAuthoredStandIn(courier)).toBe(true);
	});

	test("a cached interceptor wreck is rebuilt through its own dark builder", () => {
		installAuthoredHull("interceptor", undefined);
		const root = buildDerelictMesh("interceptor");
		installAuthoredHull("interceptor", installed);
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

describe("every Traffic interceptor is the model, so the detail band switches it", () => {
	const levelsOf = (root: THREE.Object3D) => {
		const frame = root.getObjectByName(
			INTERCEPTOR_FRAME_NAME,
		) as THREE.Object3D;
		const named = (name: string) =>
			frame.children.find((c) => c.name === name) as THREE.Object3D;
		return {
			full: named(INTERCEPTOR_LEVEL_NAMES.full),
			reduced: named(INTERCEPTOR_LEVEL_NAMES.reduced),
			outline: named(INTERCEPTOR_LEVEL_NAMES.outline),
		};
	};
	const reachKm = HULL_REACH_KM.interceptor;
	const drawn = (root: THREE.Object3D) =>
		Object.entries(levelsOf(root))
			.filter(([, o]) => o.visible)
			.map(([k]) => k);
	const triangles = (object: THREE.Object3D) => meshStats([object]).triangles;

	test("one level is drawn at a time, picked by the band and held through its hysteresis, both ways", () => {
		const root = interceptor();
		expect(drawn(root)).toEqual(["full"]);
		const at = (radii: number) => {
			updateShipVisuals(root, radii * reachKm, "high");
			return drawn(root);
		};
		expect(at(DETAIL_RADII.full * 1.02)).toEqual(["full"]);
		expect(at(DETAIL_RADII.full * 1.1)).toEqual(["reduced"]);
		expect(at(DETAIL_RADII.full * 1.02)).toEqual(["reduced"]);
		expect(at(DETAIL_RADII.reduced * 1.02)).toEqual(["reduced"]);
		expect(at(DETAIL_RADII.reduced * 1.1)).toEqual(["outline"]);
		expect(at(DETAIL_RADII.reduced * 1.02)).toEqual(["outline"]);
		expect(at(DETAIL_RADII.reduced * 0.9)).toEqual(["reduced"]);
		expect(at(DETAIL_RADII.full * 0.9)).toEqual(["full"]);
		updateShipVisuals(root, DETAIL_RADII.full * 0.5 * reachKm, "low");
		expect(drawn(root)).toEqual(["full"]);
	});

	test("each reduced level is lighter, keeps the hull, and stays inside the model's box", () => {
		const { full, reduced, outline } = levelsOf(interceptor());
		expect(triangles(full)).toBe(587_810);
		expect(triangles(reduced)).toBe(REDUCED_TRIANGLES);
		expect(triangles(outline)).toBe(OUTLINE_TRIANGLES);
		const model = new THREE.Box3().setFromObject(full);
		for (const level of [reduced, outline]) {
			const names: string[] = [];
			level.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				names.push(o.name);
				expect(o).toBeInstanceOf(AuthoredLevelMesh);
				expect(isLevelStandIn(o)).toBe(true);
			});
			for (const kept of ["dark-structure", "machined-alloy", "pale-steel-0"])
				expect([kept, names.includes(kept)]).toEqual([kept, true]);
			if (level === reduced) expect(names).toContain("canopy-glass");
			expect(model.containsBox(new THREE.Box3().setFromObject(level))).toBe(
				true,
			);
		}
	});

	test("the target is half a device pixel at each level's band edge, and the simplifier reached it", () => {
		const pixelAt = (radii: number) =>
			(2 * radii * reachKm * Math.tan(Math.PI / 6)) / 1800;
		expect(levelErrorKm("reduced", reachKm)).toBeCloseTo(
			pixelAt(DETAIL_RADII.full) / 2,
			15,
		);
		expect(levelErrorKm("outline", reachKm)).toBeCloseTo(
			pixelAt(DETAIL_RADII.reduced) / 2,
			15,
		);
		const { reduced, outline } = levelsOf(interceptor());
		const reachedKm = (o: THREE.Object3D) =>
			o.userData[LEVEL_REACHED_ERROR_KM] as number;
		for (const [level, object] of [
			["reduced", reduced],
			["outline", outline],
		] as const) {
			const reached = reachedKm(object);
			const target = levelErrorKm(level, reachKm);
			expect([level, Number.isFinite(reached)]).toEqual([level, true]);
			expect([level, reached <= target]).toEqual([level, true]);
			expect([level, reached > target / 10]).toEqual([level, true]);
		}
		expect(reachedKm(outline)).toBeGreaterThan(reachedKm(reduced));
	});

	test("a reduced level takes no ray, so the lights, guns and throats are placed on the model", () => {
		const root = interceptor();
		const { reduced, outline } = levelsOf(root);
		const caster = new THREE.Raycaster(
			new THREE.Vector3(0, 0.001, -1),
			new THREE.Vector3(0, 0, 1),
		);
		expect(caster.intersectObject(reduced, true)).toEqual([]);
		expect(caster.intersectObject(outline, true)).toEqual([]);
		expect(caster.intersectObject(root, true).length).toBeGreaterThan(0);
	});

	test("nav lights stand on the full model's metal", () => {
		const root = interceptor();
		const lights = root.getObjectByName("nav-lights") as THREE.Points;
		expect(lights).toBeDefined();
		const position = lights.geometry.getAttribute("position");
		expect(position.count).toBeGreaterThan(0);
		const full = levelsOf(root).full;
		const box = new THREE.Box3().setFromObject(full).expandByScalar(1e-6);
		const p = new THREE.Vector3();
		for (let i = 0; i < position.count; i++)
			expect(box.containsPoint(p.fromBufferAttribute(position, i))).toBe(true);
	});

	test("every interceptor shares the levels' geometry, and the glows stay outside them", () => {
		const a = levelsOf(interceptor());
		const b = levelsOf(interceptor());
		const geometries = (o: THREE.Object3D) => {
			const out: THREE.BufferGeometry[] = [];
			o.traverse((m) => {
				if (m instanceof THREE.Mesh) out.push(m.geometry);
			});
			return out;
		};
		for (const level of ["full", "reduced", "outline"] as const) {
			const mine = geometries(a[level]);
			const theirs = geometries(b[level]);
			expect(theirs.length).toBe(mine.length);
			for (let i = 0; i < mine.length; i++) expect(theirs[i]).toBe(mine[i]);
		}
		for (const level of Object.values(a))
			level.traverse((o) => {
				if (o instanceof THREE.Mesh) expect(isDriveBell(o)).toBe(false);
			});
	});

	test("many interceptors share one set of geometry, materials and textures, and disposing one breaks no other", () => {
		const ships = Array.from({ length: 8 }, () => interceptor());
		const resources = (root: THREE.Object3D) => {
			const geometries = new Set<THREE.BufferGeometry>();
			const materials = new Set<THREE.Material>();
			root.traverse((o) => {
				if (!(o instanceof THREE.Mesh) || isDriveBell(o)) return;
				geometries.add(o.geometry);
				for (const m of Array.isArray(o.material) ? o.material : [o.material])
					materials.add(m);
			});
			return { geometries, materials };
		};
		const first = resources(ships[0]);
		for (const ship of ships.slice(1)) {
			const next = resources(ship);
			expect([...next.geometries]).toEqual([...first.geometries]);
			expect([...next.materials]).toEqual([...first.materials]);
		}
		for (const geometry of first.geometries)
			expect(isShared(geometry)).toBe(true);
		for (const material of first.materials) {
			expect(isShared(material)).toBe(true);
			for (const value of Object.values(material))
				if (value instanceof THREE.Texture) expect(isShared(value)).toBe(true);
		}
		const freed: unknown[] = [];
		for (const resource of [...first.geometries, ...first.materials])
			resource.addEventListener("dispose", () => freed.push(resource));
		disposeSubtree(ships[0]);
		expect(freed).toEqual([]);
		for (const mesh of meshesOf(ships[1]))
			expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(0);
	});

	test("a wreck darkens every level", () => {
		const wreck = buildDerelictMesh("interceptor");
		const { full, reduced, outline } = levelsOf(wreck);
		const darkened = new Set<THREE.Material>();
		full.traverse((o) => {
			if (o instanceof THREE.Mesh) darkened.add(o.material as THREE.Material);
		});
		const live = new Set<THREE.Material>();
		levelsOf(interceptor()).full.traverse((o) => {
			if (o instanceof THREE.Mesh) live.add(o.material as THREE.Material);
		});
		for (const level of [reduced, outline])
			level.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				const material = o.material as THREE.Material;
				expect(darkened.has(material)).toBe(true);
				expect(live.has(material)).toBe(false);
			});
		disposeDerelict(wreck);
	});
});
