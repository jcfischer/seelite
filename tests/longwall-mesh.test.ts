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
import {
	AuthoredLevelMesh,
	LEVEL_REACHED_ERROR_KM,
	halfPixelKm,
	levelErrorKm,
} from "../src/authored-levels";
import { DETAIL_RADII } from "../src/detail-level";
import { isLevelStandIn } from "../src/ship-detail";
import {
	HULL_REACH_KM,
	LONGWALL_LEVEL_NAMES,
	LONGWALL_MEDIUM_RADII,
	LONGWALL_NOZZLES_M,
	buildShipMesh,
	installLongwallModel,
	isAuthoredHull,
	isDriveBell,
	isHullPaint,
	isLampMaterial,
	setShipDetail,
	updateShipVisuals,
} from "../src/ship-mesh";
import { ventThroats } from "../src/vent-plumes";
import { installShippedLongwall } from "../scripts/lib/install-longwall";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import {
	type Surface,
	countBeyond,
	furthestFrom,
	surfaceGrid,
	trianglePoints,
	usedVertices,
} from "./helpers/surface-distance";

const SHIPPED = "src/models/longwall-miner.glb";
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

	test("an install that throws leaves the previous one whole (sage round 8)", () => {
		// A scene with no `hull` group fails the prepare partway.
		expect(() => installLongwallModel(new THREE.Group())).toThrow(/hull group/);
		const root = buildShipMesh("miner", "b").root;
		for (const name of Object.values(LONGWALL_LEVEL_NAMES))
			expect(
				meshesOf(root.children.find((c) => c.name === name) as THREE.Object3D)
					.length,
			).toBeGreaterThan(0);
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

const isLamp = (mesh: THREE.Mesh) =>
	isLampMaterial(mesh.material as THREE.Material);
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
const painted = (m: THREE.Mesh) => isHullPaint(m.material as THREE.Material);
/** The meshes' vertices' box in `frame`'s own coordinates, vertex by vertex
 *  rather than through each geometry's box, so a rotation cannot pad it. */
const boxIn = (frame: THREE.Object3D, meshes: readonly THREE.Mesh[]) => {
	const toFrame = frame.matrixWorld.clone().invert();
	const box = new THREE.Box3();
	const v = new THREE.Vector3();
	for (const mesh of meshes) {
		const matrix = new THREE.Matrix4().multiplyMatrices(
			toFrame,
			mesh.matrixWorld,
		);
		const position = mesh.geometry.getAttribute("position");
		for (let i = 0; i < position.count; i++)
			box.expandByPoint(
				v.fromBufferAttribute(position, i).applyMatrix4(matrix),
			);
	}
	return box;
};
const expectSameBox = (built: THREE.Box3, before: THREE.Box3) => {
	for (const axis of ["x", "y", "z"] as const) {
		expect(built.min[axis]).toBeCloseTo(before.min[axis], 4);
		expect(built.max[axis]).toBeCloseTo(before.max[axis], 4);
	}
};

describe("the static hull draws one mesh per material (node #815)", () => {
	test("the export's 19 hull meshes become 10, and the triangles do not move", async () => {
		const root = buildShipMesh("miner", "b").root;
		const hull = root.getObjectByName("hull") as THREE.Object3D;
		const meshes = meshesOf(hull);
		expect(meshes).toHaveLength(10);
		// Every opaque, unlit material is drawn once.
		const unlit = meshes.filter(painted);
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
		// And in the same place: each side's box in its own `hull` group's
		// frame, which is the export's metres on both, corner for corner —
		// a batch that baked a wrong translation moves a corner (sage round 8).
		root.updateMatrixWorld(true);
		exported.updateMatrixWorld(true);
		expectSameBox(boxIn(hull, meshes), boxIn(source, meshesOf(source)));
	});
});

describe("each stowed anchor draws one mesh per material (node #815)", () => {
	test("an anchor's 20 meshes become 6, its parts stay named, and its triangles do not move", () => {
		const root = buildShipMesh("miner", "b").root;
		const exported = EXPORTED;
		root.updateMatrixWorld(true);
		exported.updateMatrixWorld(true);
		const parts = ["body", "sleeve", "elbow", "lower", "lower-rod", "foot"];
		for (let i = 0; i < 4; i++) {
			const anchor = root.getObjectByName(`anchor-${i}`) as THREE.Object3D;
			const batches = meshesOf(anchor);
			// One mesh per paint, each drawn once.
			expect(batches).toHaveLength(5);
			expect(batches.every(painted)).toBe(true);
			expect(new Set(batches.map((m) => m.material)).size).toBe(5);
			// The six part groups stay, named, holding the foot's lamp alone.
			const left = parts.flatMap((part) =>
				meshesOf(root.getObjectByName(`anchor-${i}-${part}`) as THREE.Object3D),
			);
			expect(left.map((m) => m.name)).toEqual([`anchor-${i}-footamber-lamp`]);
			// The same painted triangles as the export's six parts, in the same
			// place in the frame both sides' anchors hang from.
			const source = parts.flatMap((part) =>
				meshesOf(
					exported.getObjectByName(`anchor-${i}-${part}`) as THREE.Object3D,
				).filter(painted),
			);
			expect(source).toHaveLength(19);
			expect(triangles(batches)).toBe(triangles(source));
			expectSameBox(
				boxIn(anchor.parent as THREE.Object3D, batches),
				boxIn(source[0].parent?.parent as THREE.Object3D, source),
			);
		}
	});
});

describe("every Traffic miner is the model, so the detail band switches it (node #815)", () => {
	const levelsOf = (root: THREE.Object3D) => {
		const named = (name: string) =>
			root.children.find((c) => c.name === name) as THREE.Object3D;
		return {
			full: named(LONGWALL_LEVEL_NAMES.full),
			reduced: named(LONGWALL_LEVEL_NAMES.reduced),
			outline: named(LONGWALL_LEVEL_NAMES.outline),
		};
	};
	const shown = (root: THREE.Object3D) =>
		Object.entries(levelsOf(root))
			.filter(([, o]) => o.visible)
			.map(([k]) => k);
	const reach = HULL_REACH_KM.miner;

	test("the player's own miner draws the model near, and every other miner the medium level", () => {
		const own = buildShipMesh("miner", "b").root;
		const traffic = buildShipMesh("miner", "b").root;
		updateShipVisuals(own, reach * 3.5, "high", true);
		updateShipVisuals(traffic, reach * 3.5, "high");
		expect(shown(own)).toEqual(["full"]);
		expect(shown(traffic)).toEqual(["reduced"]);
		// The whole model, and what a miner at a berth now draws instead.
		expect(drawn(own)).toHaveLength(44);
		expect(triangles(drawn(own))).toBe(283_576);
		expect(drawn(traffic)).toHaveLength(44);
		expect(triangles(drawn(traffic))).toBe(22_778);
		// However near: inside a bay, a hull length away.
		updateShipVisuals(traffic, reach, "high");
		expect(shown(traffic)).toEqual(["reduced"]);
		// The quality row gates generated clutter; it does not pick a level.
		updateShipVisuals(own, reach * 10, "low", true);
		expect(shown(own)).toEqual(["full"]);
	});

	test("both are the band past its first edge, held through its hysteresis", () => {
		for (const own of [true, false]) {
			const root = buildShipMesh("miner", "b").root;
			const at = (radii: number) => {
				updateShipVisuals(root, radii * reach, "high", own);
				return shown(root);
			};
			const near = own ? "full" : "reduced";
			expect(at(DETAIL_RADII.full * 1.02)).toEqual([near]);
			expect(at(DETAIL_RADII.full * 1.1)).toEqual(["reduced"]);
			expect(at(DETAIL_RADII.full * 1.02)).toEqual(["reduced"]);
			expect(at(DETAIL_RADII.reduced * 1.1)).toEqual(["outline"]);
			expect(drawn(root)).toHaveLength(10);
			expect(triangles(drawn(root))).toBe(592);
			expect(at(DETAIL_RADII.full * 0.9)).toEqual([near]);
		}
	});

	test("each level is lighter, keeps every lamp whole, and stays inside the model's box", () => {
		const root = buildShipMesh("miner", "b").root;
		root.updateMatrixWorld(true);
		const { full, reduced, outline } = levelsOf(root);
		expect(triangles(meshesOf(full))).toBe(283_528);
		// Pinned, because the receipt quotes them and the simplifier is
		// deterministic: a change to the reduction is a red row rather than a
		// silent re-weighting of every miner in the game.
		expect(triangles(meshesOf(reduced))).toBe(22_730);
		expect(triangles(meshesOf(outline))).toBe(544);
		const lamps = meshesOf(full).filter(isLamp);
		expect(lamps.length).toBeGreaterThan(0);
		const model = new THREE.Box3().setFromObject(full);
		for (const level of [reduced, outline]) {
			for (const mesh of meshesOf(level)) {
				expect(mesh).toBeInstanceOf(AuthoredLevelMesh);
				expect(isLevelStandIn(mesh)).toBe(true);
			}
			// Every lamp draws at every level, its geometry the model's own.
			const kept = meshesOf(level).filter(isLamp);
			expect(kept.map((m) => m.geometry)).toEqual(lamps.map((m) => m.geometry));
			expect(model.containsBox(new THREE.Box3().setFromObject(level))).toBe(
				true,
			);
		}
	});

	test("the targets are half a device pixel at 10 reaches and at the second edge", () => {
		// 60° on a 1800-pixel frame: one pixel at d is 2 d tan 30° / 1800.
		const pixelAt = (radii: number) =>
			(2 * radii * reach * Math.tan(Math.PI / 6)) / 1800;
		expect(LONGWALL_MEDIUM_RADII).toBe(10);
		expect(halfPixelKm(LONGWALL_MEDIUM_RADII, reach)).toBeCloseTo(
			pixelAt(10) / 2,
			15,
		);
		expect(levelErrorKm("outline", reach)).toBeCloseTo(
			pixelAt(DETAIL_RADII.reduced) / 2,
			15,
		);
		// About 0.14 m and 5.4 m of hull.
		expect(halfPixelKm(LONGWALL_MEDIUM_RADII, reach) * 1000).toBeCloseTo(
			0.135,
			3,
		);
		expect(levelErrorKm("outline", reach) * 1000).toBeCloseTo(5.414, 3);
	});

	test("each level's reported error is inside its target, and not trivially", () => {
		// The simplifier's own metric, carried into kilometres of hull: this
		// catches a target passed in the wrong units, and bounds nothing.
		const { reduced, outline } = levelsOf(buildShipMesh("miner", "b").root);
		const reachedKm = (o: THREE.Object3D) =>
			o.userData[LEVEL_REACHED_ERROR_KM] as number;
		for (const [object, target] of [
			[reduced, halfPixelKm(LONGWALL_MEDIUM_RADII, reach)],
			[outline, levelErrorKm("outline", reach)],
		] as const) {
			const reached = reachedKm(object);
			expect([object.name, reached <= target]).toEqual([object.name, true]);
			expect([object.name, reached > target / 10]).toEqual([object.name, true]);
		}
		expect(reachedKm(outline)).toBeGreaterThan(reachedKm(reduced));
	});

	test("a level takes no ray, so the lights, guns and throats are placed on the model", () => {
		const root = buildShipMesh("miner", "b").root;
		root.updateMatrixWorld(true);
		const { reduced, outline } = levelsOf(root);
		const caster = new THREE.Raycaster(
			new THREE.Vector3(0, 0, -1),
			new THREE.Vector3(0, 0, 1),
		);
		expect(caster.intersectObject(reduced, true)).toEqual([]);
		expect(caster.intersectObject(outline, true)).toEqual([]);
		expect(caster.intersectObject(root, true).length).toBeGreaterThan(0);
	});

	test("the medium level moves the hull's painted surface by little, sampled", () => {
		// Measured in space, point to nearest triangle in hull metres, because
		// the target is the simplifier's own metric and promises no distance
		// (sage round 6). Pinned: the simplifier is a pinned version and
		// deterministic, as the triangle counts already rely on.
		const root = buildShipMesh("miner", "b").root;
		root.updateMatrixWorld(true);
		const { full, reduced } = levelsOf(root);
		const hullOf = (level: THREE.Object3D) =>
			level.getObjectByName("hull") as THREE.Object3D;
		const toHull = hullOf(full).matrixWorld.clone().invert();
		const sources = meshesOf(hullOf(full)).filter(painted);
		const stands = meshesOf(hullOf(reduced)).filter(painted);
		/** The meshes' triangles in hull metres, as one soup. */
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
		// The drawn surface lies within 0.23 m of the model's.
		expect(
			furthestFrom(surfaceGrid(model, 0.5), trianglePoints(drawnHull, 4), 0.6),
		).toBeCloseTo(0.2283, 4);
		// The model's furthest sampled point lies 0.99 m from the drawn
		// surface: 7.3 times the target, which is the simplifier's metric and
		// no bound. At 2.4 reaches, a bay neighbour 100 m off, that is about
		// 9 px at its worst; how the medium level reads there is the
		// principal's to judge in flight (ruling of 2026-10-09).
		const drawnGrid = surfaceGrid(drawnHull, 1);
		expect(furthestFrom(drawnGrid, trianglePoints(model, 2), 2)).toBeCloseTo(
			0.992,
			3,
		);
		// Of the model's vertices, how many lie further than the target.
		const modelPoints = usedVertices(model);
		expect(modelPoints.length / 3).toBe(482_918);
		expect(countBeyond(drawnGrid, modelPoints, 0.135)).toBe(83_855);
	}, 60_000);

	test("a wreck darkens every level", () => {
		const wreck = buildDerelictMesh("miner");
		const { full, reduced, outline } = levelsOf(wreck);
		const paint = (full.getObjectByName("hull-dark-structure") as THREE.Mesh)
			.material;
		for (const level of [reduced, outline])
			expect(
				(level.getObjectByName("hull-dark-structure") as THREE.Mesh).material,
			).toBe(paint);
		const live = buildShipMesh("miner", "b").root;
		expect(paint).not.toBe(
			(live.getObjectByName("hull-dark-structure") as THREE.Mesh).material,
		);
	});

	test("a clone's band hides its own levels, never the template's", () => {
		const far = buildShipMesh("miner", "b").root;
		setShipDetail(far, "outline");
		const near = buildShipMesh("miner", "b").root;
		expect(shown(near)).toEqual(["full"]);
		expect(drawn(near)).toHaveLength(44);
	});
});
