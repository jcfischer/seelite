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

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { HULL_SPECS } from "../src/hull";
import { buildDerelictMesh } from "../src/derelict-mesh";
import { disposeSubtree } from "../src/gpu-teardown";
import { EMISSIVE_CEILING } from "../src/light-rig";
import { markOcclusion } from "../src/occlusion-mesh";
import {
	HULL_REACH_KM,
	LONGWALL_NOZZLES_M,
	buildShipMesh,
	installLongwallModel,
	isAuthoredHull,
	isDriveBell,
	isLampMaterial,
	setShipDetail,
	updateShipVisuals,
} from "../src/ship-mesh";
import { ventThroats } from "../src/vent-plumes";
import { installShippedLongwall } from "./helpers/install-longwall";
import { decodeShippedGlb } from "./helpers/read-coriolis-glb";
import {
	type Surface,
	countBeyond,
	furthestFrom,
	surfaceGrid,
	trianglePoints,
	usedVertices,
} from "./helpers/surface-distance";

const SHIPPED = "public/models/longwall-miner.glb";
/** The shipped file as exported, decoded once: the rows only read it. */
const EXPORTED = await decodeShippedGlb(SHIPPED);

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

	test("building it uninstalled throws rather than drawing a loft", async () => {
		installLongwallModel(null);
		try {
			expect(() => buildShipMesh("miner", "b")).toThrow(/prepareLongwallModel/);
			// The lofts do not depend on it.
			expect(() => buildShipMesh("miner", "a")).not.toThrow();
		} finally {
			// The only row that changes the install puts the shipped model back,
			// so the next row and the next file build what the game draws.
			await installShippedLongwall();
		}
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
		const exported = EXPORTED;
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
		const exported = EXPORTED;
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
		const exported = EXPORTED;
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
		const shared = geometries(second);
		expect(geometries(first)).toHaveLength(shared.length);
		geometries(first).forEach((g, i) => expect(g).toBe(shared[i]));
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
		const lamps = meshesOf(root).filter(isLamp);
		for (const mesh of lamps)
			expect(
				(mesh.material as THREE.MeshStandardMaterial).emissiveIntensity,
			).toBeLessThanOrEqual(EMISSIVE_CEILING * 1.000001);
		expect(lamps.length).toBeGreaterThan(0);
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

/** Is a mesh under a group whose name matches? */
const under = (mesh: THREE.Object3D, name: RegExp) => {
	for (let o = mesh.parent; o; o = o.parent) if (name.test(o.name)) return true;
	return false;
};
const isLamp = (mesh: THREE.Mesh) =>
	isLampMaterial(mesh.material as THREE.Material);
const ANCHOR = /^anchor-\d/;
const CUTTER = /^(feed|rotor)$/;
/** Each hull paint's vertices further than 0.4 m from its own `reduced`
 *  copy, of all its vertices (`tests/helpers/surface-distance.ts`). */
const BEYOND_BY_PAINT = {
	"blue-grey-1": [0, 120],
	"dark-structure": [12_581, 178_148],
	"hose-rubber": [1_800, 1_800],
	"machined-alloy": [136_283, 144_744],
	"pale-steel-0": [769, 77_104],
	"recess-black": [720, 1_680],
	"service-ochre": [6_698, 79_322],
};
/** Drawn: visible, and so is every group above it up to the root. */
const drawn = (root: THREE.Object3D) =>
	meshesOf(root).filter((m) => {
		for (let o: THREE.Object3D | null = m; o && o !== root; o = o.parent)
			if (!o.visible) return false;
		return true;
	});
const triangles = (meshes: readonly THREE.Mesh[]) =>
	meshes.reduce((sum, m) => {
		const g = m.geometry;
		return sum + (g.index ?? g.getAttribute("position")).count / 3;
	}, 0);

describe("the static hull draws one mesh per material (node #815)", () => {
	test("the export's 19 hull meshes become 10, and the triangles do not move", async () => {
		const root = buildShipMesh("miner", "b").root;
		const hull = root.getObjectByName("hull") as THREE.Object3D;
		const meshes = meshesOf(hull);
		expect(meshes).toHaveLength(10);
		// Every opaque, unlit material is drawn once.
		const unlit = meshes.filter(
			(m) => !isLamp(m) && !(m.material as THREE.Material).transparent,
		);
		const materials = unlit.map((m) => m.material as THREE.Material);
		expect(new Set(materials).size).toBe(unlit.length);
		expect(unlit).toHaveLength(7);
		// The glazing and the lamps keep their own meshes.
		expect(root.getObjectByName("hullbridge-glazing")).toBeDefined();
		expect(meshes.filter(isLamp)).toHaveLength(2);
		// The same triangles as the export's hull group, nothing dropped.
		const exported = EXPORTED;
		const source = exported.getObjectByName("hull") as THREE.Object3D;
		expect(meshesOf(source)).toHaveLength(19);
		expect(triangles(meshes)).toBe(triangles(meshesOf(source)));
		// And in the same place: the batched hull's box is the export's, turned
		// and scaled into the game's frame.
		root.updateMatrixWorld(true);
		exported.updateMatrixWorld(true);
		const built = new THREE.Box3()
			.setFromObject(hull)
			.getSize(new THREE.Vector3())
			.multiplyScalar(1000);
		const before = new THREE.Box3()
			.setFromObject(source)
			.getSize(new THREE.Vector3());
		for (const axis of ["x", "y", "z"] as const)
			expect(built[axis]).toBeCloseTo(before[axis], 4);
	});
});

describe("the detail band sheds the mechanism at range (node #815)", () => {
	test("at full detail every mesh draws", () => {
		const root = buildShipMesh("miner", "b").root;
		updateShipVisuals(root, 0.5, "high");
		expect(drawn(root)).toHaveLength(meshesOf(root).length);
		expect(meshesOf(root)).toHaveLength(100);
		expect(triangles(meshesOf(root))).toBe(283_576);
	});

	test("reduced draws the hull simplified, hides the anchors' metal, and keeps every lamp and the cutter", () => {
		const root = buildShipMesh("miner", "b").root;
		// A fresh build carries no simplified hull either.
		expect(root.getObjectByName("longwall-reduced")).toBeUndefined();
		setShipDetail(root, "reduced");
		const reduced = root.getObjectByName("longwall-reduced") as THREE.Object3D;
		const stands = meshesOf(reduced);
		const paint = (m: THREE.Mesh) =>
			!isLamp(m) && !(m.material as THREE.Material).transparent;
		for (const mesh of meshesOf(root)) {
			if (stands.includes(mesh)) continue;
			const hidden =
				!isLamp(mesh) &&
				(under(mesh, ANCHOR) || (under(mesh, /^hull$/) && paint(mesh)));
			expect({ name: mesh.name, visible: mesh.visible }).toEqual({
				name: mesh.name,
				visible: !hidden,
			});
		}
		// One simplified mesh per opaque hull mesh, but the hoses: they simplify
		// to nothing at the target and draw nothing.
		const hull = root.getObjectByName("hull") as THREE.Object3D;
		const sources = meshesOf(hull).filter(paint);
		expect(sources).toHaveLength(7);
		expect(stands).toHaveLength(6);
		for (const stand of stands) {
			const source = sources.find((m) => `${m.name}-reduced` === stand.name);
			if (!source) throw new Error(`${stand.name} has no source`);
			// The source's own paint and vertex buffers; only the index is new.
			expect(stand.material).toBe(source.material);
			for (const [name, attribute] of Object.entries(
				source.geometry.attributes,
			))
				expect(stand.geometry.getAttribute(name)).toBe(attribute);
			expect(triangles([stand])).toBeLessThan(triangles([source]));
			expect(stand.castShadow).toBe(false);
		}
		expect(triangles(sources)).toBe(252_810);
		expect(triangles(stands)).toBe(5_756);
		expect(drawn(root)).toHaveLength(23);
		expect(triangles(drawn(root))).toBe(14_714);
		expect(root.getObjectByName("nav-lights")?.visible).toBe(true);
	});

	test("reduced moves the hull's surface by at most 1.83 m, sampled, and its hoses are the worst", () => {
		// Measured in space, point to nearest triangle in hull metres, because
		// `LONGWALL_REDUCED_ERROR_M` is a target in meshoptimizer's own metric
		// and promises no distance (sage round 6). Each figure is pinned: the
		// simplifier is a pinned version and deterministic, as the triangle
		// count above already relies on.
		const root = buildShipMesh("miner", "b").root;
		setShipDetail(root, "reduced");
		root.updateMatrixWorld(true);
		const hull = root.getObjectByName("hull") as THREE.Object3D;
		const toHull = hull.matrixWorld.clone().invert();
		const sources = meshesOf(hull).filter(
			(m) => !isLamp(m) && !(m.material as THREE.Material).transparent,
		);
		const stands = meshesOf(
			root.getObjectByName("longwall-reduced") as THREE.Object3D,
		);
		/** The meshes' triangles in hull metres, as one soup. A stand shares
		 *  its source's vertex buffer and stands where it does. */
		const inHull = (meshes: readonly THREE.Mesh[]): Surface => {
			const positions: number[] = [];
			const index: number[] = [];
			const v = new THREE.Vector3();
			for (const mesh of meshes) {
				const toFrame = new THREE.Matrix4().multiplyMatrices(
					toHull,
					mesh.matrixWorld,
				);
				const position = mesh.geometry.getAttribute("position");
				const base = positions.length / 3;
				for (let i = 0; i < position.count; i++) {
					v.fromBufferAttribute(position, i).applyMatrix4(toFrame);
					positions.push(v.x, v.y, v.z);
				}
				for (const i of mesh.geometry.index?.array ?? []) index.push(base + i);
			}
			return {
				positions: Float32Array.from(positions),
				index: Uint32Array.from(index),
			};
		};
		const model = inHull(sources);
		const drawnHull = inHull(stands);
		// Both directions are sampled, never exhaustive: a triangle's corners
		// and points a quarter (drawn) or a half (model) of the way along it.
		// The drawn surface lies within half a metre of the model's: a quarter
		// of a pixel at the band's near edge (2.2 m a pixel at 40 radii).
		expect(
			furthestFrom(surfaceGrid(model, 0.5), trianglePoints(drawnHull, 4), 0.6),
		).toBeCloseTo(0.5, 3);
		// The model's furthest sampled point lies 1.83 m from the drawn surface,
		// 0.83 of a pixel there and 4.6 times the target, and it is on the
		// hoses, which the reduced hull does not draw (the worst drawn paint,
		// the machined alloy, reads 1.37 m). Its vertices alone read 1.32 m:
		// 3,784 of the 482,918 lie further than 0.4 m, and 236 further than a
		// metre. Halving the step moves the sampled figure to 1.834.
		const drawnGrid = surfaceGrid(drawnHull, 1);
		expect(furthestFrom(drawnGrid, trianglePoints(model, 2), 2)).toBeCloseTo(
			1.8262,
			4,
		);
		const modelPoints = usedVertices(model);
		expect(modelPoints.length / 3).toBe(482_918);
		expect(furthestFrom(drawnGrid, modelPoints, 1.4)).toBeCloseTo(1.3235, 4);
		expect(countBeyond(drawnGrid, modelPoints, 0.4)).toBe(3_784);
		expect(countBeyond(drawnGrid, modelPoints, 1)).toBe(236);
		// Paint by paint the change is larger: of each paint's vertices, how
		// many lie further than 0.4 m from that paint's own reduced copy. Most
		// of the machined alloy is not drawn in its own paint past 40 radii,
		// and the hoses not at all.
		const byPaint = Object.fromEntries(
			sources.map((source) => {
				const points = usedVertices(inHull([source]));
				const stand = stands.find((m) => m.name === `${source.name}-reduced`);
				const beyond = stand
					? countBeyond(surfaceGrid(inHull([stand]), 1), points, 0.4)
					: points.length / 3;
				return [
					(source.material as THREE.Material).name,
					[beyond, points.length / 3],
				];
			}),
		);
		expect(byPaint).toEqual(BEYOND_BY_PAINT);
	}, 30_000);

	test("outline draws the hull as boxes, and keeps every lamp", () => {
		const root = buildShipMesh("miner", "b").root;
		// A fresh build carries no stand-in: muzzles, vent throats, the envelope
		// and the vent placement are all measured off one.
		expect(root.getObjectByName("longwall-outline")).toBeUndefined();
		setShipDetail(root, "outline");
		const outline = root.getObjectByName("longwall-outline") as THREE.Object3D;
		const stand = root.getObjectByName("longwall-outline-hull") as THREE.Mesh;
		for (const mesh of meshesOf(root)) {
			if (mesh === stand) continue;
			const hidden =
				!isLamp(mesh) &&
				(under(mesh, ANCHOR) || under(mesh, CUTTER) || under(mesh, /^hull$/));
			expect({ name: mesh.name, visible: mesh.visible }).toEqual({
				name: mesh.name,
				visible: !hidden,
			});
		}
		expect(outline.visible).toBe(true);
		// One box for each of the 17 unlit parts the export's hull drew.
		expect(triangles([stand])).toBe(17 * 12);
		expect(drawn(root)).toHaveLength(10);
		expect(triangles(drawn(root))).toBe(780);
		for (const side of ["port", "starboard"])
			expect(root.getObjectByName(`longwall-${side}-exhaust`)?.visible).toBe(
				true,
			);
		expect(root.getObjectByName("nav-lights")?.visible).toBe(true);
		// The boxes bound the parts, so they reach no further than the hull.
		root.updateMatrixWorld(true);
		const boxes = new THREE.Box3().setFromObject(stand);
		const hull = new THREE.Box3().setFromObject(
			root.getObjectByName("hull") as THREE.Object3D,
			true,
		);
		for (const axis of ["x", "y", "z"] as const) {
			expect(boxes.min[axis]).toBeGreaterThanOrEqual(hull.min[axis] - 1e-9);
			expect(boxes.max[axis]).toBeLessThanOrEqual(hull.max[axis] + 1e-9);
		}
		// Painted with the clone's own hull metal, the material on most of it.
		expect(stand.material).toBe(
			(root.getObjectByName("hull-dark-structure") as THREE.Mesh).material,
		);
		expect(stand.castShadow).toBe(false);
	});

	test("a wreck's outline takes the wreck's dark paint", () => {
		const wreck = buildDerelictMesh("miner");
		setShipDetail(wreck, "outline");
		const stand = wreck.getObjectByName("longwall-outline-hull") as THREE.Mesh;
		const paint = (wreck.getObjectByName("hull-dark-structure") as THREE.Mesh)
			.material;
		expect(stand.material).toBe(paint);
		setShipDetail(wreck, "reduced");
		expect(
			(wreck.getObjectByName("hull-dark-structure-reduced") as THREE.Mesh)
				.material,
		).toBe(paint);
		const live = buildShipMesh("miner", "b").root;
		expect(paint).not.toBe(
			(live.getObjectByName("hull-dark-structure") as THREE.Mesh).material,
		);
	});

	test("the band is distance, not quality, and it comes back", () => {
		const root = buildShipMesh("miner", "b").root;
		const reach = HULL_REACH_KM.miner;
		// Low quality at close range draws the whole model: the anchors and the
		// cutter are the approved design, not generated clutter.
		updateShipVisuals(root, reach * 10, "low");
		expect(drawn(root)).toHaveLength(100);
		updateShipVisuals(root, reach * 200, "high");
		expect(drawn(root)).toHaveLength(23);
		updateShipVisuals(root, reach * 1000, "high");
		expect(drawn(root)).toHaveLength(10);
		expect(root.getObjectByName("longwall-reduced")?.visible).toBe(false);
		// Back inside the band both stand-ins are kept, hidden, and the hull
		// draws.
		updateShipVisuals(root, reach * 10, "high");
		expect(meshesOf(root)).toHaveLength(107);
		expect(drawn(root)).toHaveLength(100);
		expect(root.getObjectByName("longwall-reduced")?.visible).toBe(false);
		expect(root.getObjectByName("longwall-outline")?.visible).toBe(false);
	});

	test("past full the metal casts no shadow, and casts again back inside (sage round 5)", () => {
		const root = buildShipMesh("miner", "b").root;
		// As the game marks a built hull, once, at full detail.
		markOcclusion(root);
		const casting = meshesOf(root).filter((m) => m.castShadow);
		const hullMetal = root.getObjectByName("hull-dark-structure") as THREE.Mesh;
		expect(casting).toContain(hullMetal);
		const cutter = meshesOf(root).find(
			(m) => !isLamp(m) && under(m, CUTTER),
		) as THREE.Mesh;
		expect(casting).toContain(cutter);
		const metal = (m: THREE.Mesh) => !isLamp(m);
		updateShipVisuals(root, HULL_REACH_KM.miner * 200, "high");
		// The cutter still draws at reduced, out of the shadow and AO passes.
		expect(cutter.visible).toBe(true);
		for (const mesh of meshesOf(root).filter(metal))
			expect({ name: mesh.name, cast: mesh.castShadow }).toEqual({
				name: mesh.name,
				cast: false,
			});
		updateShipVisuals(root, HULL_REACH_KM.miner * 1000, "high");
		for (const mesh of meshesOf(root).filter(metal))
			expect(mesh.castShadow).toBe(false);
		// Back at full, exactly what the marking set, and nothing more.
		updateShipVisuals(root, HULL_REACH_KM.miner * 10, "high");
		expect(meshesOf(root).filter((m) => m.castShadow)).toEqual(casting);
	});

	test("a clone's gate hides its own meshes, never the template's", () => {
		const far = buildShipMesh("miner", "b").root;
		setShipDetail(far, "outline");
		const near = buildShipMesh("miner", "b").root;
		expect(drawn(near)).toHaveLength(100);
		expect(near.getObjectByName("longwall-outline")).toBeUndefined();
	});
});
