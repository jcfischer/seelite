import { afterEach, expect, test } from "bun:test";
import * as THREE from "three";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { buildInteriorKit } from "../src/interior-kit";
import { planInterior, THEMES, overlaps } from "../src/interior-layout";
import { stationInterior } from "../src/station-interior";
import { STATION_GEOMETRY } from "../src/station";
import {
	buildStationInterior,
	installInteriorKitBuilder,
	refreshStationInteriorKit,
	NAMEPLATE_NAME,
} from "../src/station-interior-mesh";
import { disposeSubtree, shared } from "../src/gpu-teardown";
import records from "../src/interior-lod-records.json";
import type { InteriorLods } from "../src/interior-lod";
// Decode the actual shipping file; no synthetic fitting geometry in these rows.
await MeshoptDecoder.ready;
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const document = await io.read(
	new URL("../src/models/station-interiors.glb", import.meta.url).pathname,
);
const assets = new Map<string, THREE.Group>();
for (const scene of document.getRoot().listScenes()) {
	const convert = (node: any): THREE.Object3D => {
		const group = new THREE.Group();
		group.position.fromArray(node.getTranslation());
		group.quaternion.fromArray(node.getRotation());
		group.scale.fromArray(node.getScale());
		for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute(
				"position",
				new THREE.BufferAttribute(
					primitive.getAttribute("POSITION").getArray(),
					3,
				),
			);
			geometry.setIndex(
				new THREE.BufferAttribute(primitive.getIndices().getArray(), 1),
			);
			group.add(
				new THREE.Mesh(
					shared(geometry),
					shared(new THREE.MeshStandardMaterial()),
				),
			);
		}
		for (const child of node.listChildren()) group.add(convert(child));
		return group;
	};
	const group = new THREE.Group();
	for (const node of scene.listChildren()) group.add(convert(node));
	assets.set(scene.getExtras().interiorFile as string, group);
}
test("shipping scenes match the full and reduced triangle records", () => {
	expect(assets.size).toBe(46);
	for (const [name, record] of Object.entries(records))
		for (const [file, triangles] of [
			[name + ".glb", record.full.triangles],
			...record.levels.map((l) => [l.file, l.triangles]),
		]) {
			let count = 0;
			assets.get(file as string)!.traverse((o) => {
				if ((o as THREE.Mesh).isMesh)
					count += (o as THREE.Mesh).geometry.index!.count / 3;
			});
			expect(count).toBe(triangles as number);
		}
});
afterEach(() => installInteriorKitBuilder(null));
test("station kits default to per-fitting Auto and retain Full for close inspection", () => {
	const interior = stationInterior(
		"trade",
		STATION_GEOMETRY.trade.aperturePlaneKm,
		47,
	);
	for (const { id } of THEMES) {
		const camera = new THREE.PerspectiveCamera(60, 1.6, 0.01, 20000);
		camera.position.z = 2;
		const kit = buildInteriorKit(interior, 47, id, assets, records);
		const lod = kit.userData.interiorLods as InteriorLods;
		lod.update(camera, 900);
		const coarse = lod.stats();
		expect(coarse.mode).toBe("auto");
		expect(coarse.levels[1]).toBe(0);
		expect(coarse.levels[2]).toBeGreaterThan(0);
		// At this distant camera the removed fasteners fall below the pixel floor.
		expect(coarse.triangles).toBeLessThan(coarse.fullTriangles * 0.6);
		const population = coarse.levels.reduce((sum, n) => sum + n, 0);
		// Inspect a real berth at 15 m from its nearest surface using the game
		// near plane and display height. Its removed hardware is now resolvable.
		kit.updateMatrixWorld(true);
		const berth = kit.getObjectByName(
			"interior-lod-berth-2",
		) as THREE.InstancedMesh;
		const inspectedId = berth.userData.instanceIds[0];
		expect(typeof inspectedId).toBe("string");
		const transform = new THREE.Matrix4();
		berth.getMatrixAt(0, transform);
		transform.premultiply(berth.matrixWorld);
		const bounds = new THREE.Box3(
			new THREE.Vector3(...records.berth.full.min),
			new THREE.Vector3(...records.berth.full.max),
		).applyMatrix4(transform);
		const centre = bounds.getCenter(new THREE.Vector3());
		camera.position.set(centre.x, centre.y, bounds.max.z + 0.015);
		lod.update(camera, 900);
		const close = lod.stats();
		expect(close.levels[0]).toBeGreaterThan(coarse.levels[0]);
		const fullBerth = kit.getObjectByName(
			"interior-lod-berth-0",
		) as THREE.InstancedMesh;
		expect(fullBerth.userData.instanceIds).toContain(inspectedId);
		// Returning to the distant pose must repopulate the reduced buckets.
		camera.position.set(0, 0, 2);
		lod.update(camera, 900);
		expect(lod.stats().levels).toEqual(coarse.levels);
		lod.setMode("0");
		lod.update(camera, 900);
		const full = lod.stats();
		expect(full.mode).toBe("0");
		expect(full.levels[0]).toBeGreaterThan(0);
		expect(full.levels.slice(1)).toEqual([0, 0]);
		expect(full.triangles).toBe(full.fullTriangles);
		expect(full.levels[0]).toBe(population);
		lod.setMode("auto");
		lod.update(camera, 900);
		const auto = lod.stats();
		expect(auto.levels[1] + auto.levels[2]).toBeGreaterThan(0);
		expect(auto.triangles).toBeLessThan(full.triangles);
		expect(auto.levels.reduce((sum, n) => sum + n, 0)).toBe(full.levels[0]);
		disposeSubtree(kit);
	}
});
test("review metre and game kilometre assemblies have the same bounds at every detail level", () => {
	const interior = stationInterior(
		"trade",
		STATION_GEOMETRY.trade.aperturePlaneKm,
		47,
	);
	const game = buildInteriorKit(interior, 47, "civic", assets, records);
	const review = buildInteriorKit(interior, 47, "civic", assets, records, 0, 1);
	for (const mode of ["0", "1", "2"] as const) {
		for (const group of [game, review]) {
			const lod = group.userData.interiorLods as InteriorLods;
			lod.setMode(mode);
			lod.update(new THREE.PerspectiveCamera(), 900);
		}
		const gameBounds = new THREE.Box3().setFromObject(game);
		const reviewBounds = new THREE.Box3().setFromObject(review);
		for (const edge of ["min", "max"] as const)
			gameBounds[edge]
				.toArray()
				.forEach((v, i) =>
					expect(v).toBeCloseTo(reviewBounds[edge].toArray()[i] * 0.001, 7),
				);
		expect(game.userData.interiorLods.stats().levels).toEqual(
			review.userData.interiorLods.stats().levels,
		);
	}
	disposeSubtree(game);
	disposeSubtree(review);
});
test("berth identities follow real instanced pad transforms, without one draw per berth", () => {
	const interior = stationInterior(
		"trade",
		STATION_GEOMETRY.trade.aperturePlaneKm,
		47,
	);
	const kit = buildInteriorKit(interior, 47, "works", assets, records);
	const lod = kit.userData.interiorLods as InteriorLods;
	lod.setMode("0");
	lod.update(new THREE.PerspectiveCamera(60, 1.6, 0.01, 20000), 900);
	kit.updateMatrixWorld(true);
	const parts: THREE.InstancedMesh[] = [];
	kit.traverse((o) => {
		if (o.name === "interior-lod-berth-0") parts.push(o as THREE.InstancedMesh);
	});
	expect(parts.length).toBeGreaterThan(0);
	const transform = new THREE.Matrix4(),
		world = new THREE.Matrix4();
	for (const part of parts) {
		expect(part.count).toBe(interior.berths.length);
		expect(part.userData.instanceIds).toEqual(interior.berths.map((b) => b.id));
		expect(part.geometry.index!.count).toBeGreaterThan(0);
		for (let i = 0; i < part.count; i++) {
			const berth = interior.berths.find(
				(b) => b.id === part.userData.instanceIds[i],
			)!;
			part.getMatrixAt(i, transform);
			world.multiplyMatrices(part.matrixWorld, transform);
			const point = new THREE.Vector3().setFromMatrixPosition(world);
			const expected = [
				berth.face === "port"
					? -interior.halfAcrossKm
					: berth.face === "starboard"
						? interior.halfAcrossKm
						: 0,
				berth.face === "deck"
					? -interior.halfUpKm
					: berth.face === "overhead"
						? interior.halfUpKm
						: 0,
				berth.centre.axial,
			];
			point.toArray().forEach((v, n) => expect(v).toBeCloseTo(expected[n], 7));
		}
	}
	disposeSubtree(kit);
});
for (const role of ["trade", "shipyard"] as const)
	for (const theme of THEMES)
		test(`${role}/${theme.id}: exact sim catalogue, axial corridor and reserved fitting envelopes at every level`, () => {
			for (const seed of [0, 47, 205, 0xffffffff]) {
				const interior = stationInterior(
						role,
						STATION_GEOMETRY[role].aperturePlaneKm + 0.03,
						seed,
					),
					plan = planInterior(theme.id, role, seed, interior);
				expect(plan.berths.map((b) => b.centre.map((v) => v / 1000))).toEqual(
					interior.berths.map((b) => [
						b.centre.across,
						b.centre.up,
						b.centre.axial - interior.mouthAxialKm,
					]),
				);
				for (const f of plan.fittings) {
					expect(overlaps(f.bounds, plan.lane)).toBe(false);
					for (const b of plan.berths)
						expect(overlaps(f.bounds, b.bounds)).toBe(false);
				}
				const kit = buildInteriorKit(
					interior,
					seed,
					theme.id,
					assets,
					records,
					0.03,
				);
				expect(kit.scale.toArray()).toEqual([0.001, 0.001, 0.001]);
				expect(kit.position.z).toBe(interior.mouthAxialKm);
				const lod = kit.userData.interiorLods as InteriorLods;
				const camera = new THREE.PerspectiveCamera(60, 1.6, 0.01, 20000);
				camera.position.z = interior.mouthAxialKm + 0.2;
				for (const mode of ["0", "1", "2"] as const) {
					lod.setMode(mode);
					lod.update(camera, 900);
					kit.updateMatrixWorld(true);
					// Every drawn triangle is measured in kilometres, under the same root at
					// all levels. Checking the permanent lane catches a conversion or mount error.
					const lane = new THREE.Box3(
						new THREE.Vector3(
							-interior.laneHalfAcrossKm + 0.0005,
							-interior.laneHalfUpKm + 0.0005,
							interior.endAxialKm + 0.01,
						),
						new THREE.Vector3(
							interior.laneHalfAcrossKm - 0.0005,
							interior.laneHalfUpKm - 0.0005,
							interior.mouthAxialKm + 0.001,
						),
					);
					let hits = 0;
					const tri = new THREE.Triangle(),
						matrix = new THREE.Matrix4(),
						world = new THREE.Matrix4();
					kit.traverse((o) => {
						if (!(o as THREE.Mesh).isMesh || !o.visible) return;
						const mesh = o as THREE.Mesh,
							geometry = mesh.geometry,
							pos = geometry.getAttribute("position"),
							index = geometry.index!;
						const n = (mesh as THREE.InstancedMesh).isInstancedMesh
							? (mesh as THREE.InstancedMesh).count
							: 1;
						for (let i = 0; i < n; i++) {
							if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
								(mesh as THREE.InstancedMesh).getMatrixAt(i, matrix);
								world.multiplyMatrices(mesh.matrixWorld, matrix);
							} else world.copy(mesh.matrixWorld);
							// Broad-phase rejects entire fitting parts before testing triangles.
							geometry.computeBoundingBox();
							if (
								!lane.intersectsBox(
									geometry.boundingBox!.clone().applyMatrix4(world),
								)
							)
								continue;
							for (let t = 0; t < index.count; t += 3) {
								tri.a
									.fromBufferAttribute(pos, index.getX(t))
									.applyMatrix4(world);
								tri.b
									.fromBufferAttribute(pos, index.getX(t + 1))
									.applyMatrix4(world);
								tri.c
									.fromBufferAttribute(pos, index.getX(t + 2))
									.applyMatrix4(world);
								if (lane.intersectsTriangle(tri)) hits++;
							}
						}
					});
					expect({ role, theme: theme.id, seed, mode, hits }).toEqual({
						role,
						theme: theme.id,
						seed,
						mode,
						hits: 0,
					});
				}
				disposeSubtree(kit);
			}
		});
test("install replaces each bay once, retains painted nameplates, and leaves open decks alone", () => {
	const bay = stationInterior(
		"trade",
		STATION_GEOMETRY.trade.aperturePlaneKm,
		47,
	);
	const group = buildStationInterior("trade", bay, 0, 47);
	const plaque = group.getObjectByName(NAMEPLATE_NAME)!;
	const pad = buildStationInterior(
		"refinery",
		stationInterior("refinery", STATION_GEOMETRY.refinery.aperturePlaneKm),
	);
	const children = [...pad.children];
	const outpost = buildStationInterior(
		"outpost",
		stationInterior("outpost", STATION_GEOMETRY.outpost.aperturePlaneKm),
	);
	const outpostChildren = [...outpost.children];
	installInteriorKitBuilder((interior, seed, recess) =>
		buildInteriorKit(interior, seed, "works", assets, records, recess),
	);
	expect(refreshStationInteriorKit(group)).toBe(true);
	expect(refreshStationInteriorKit(group)).toBe(false);
	expect(group.getObjectByName(NAMEPLATE_NAME)).toBe(plaque);
	expect(group.getObjectByName("authored-interior")!.userData.theme).toBe(
		"works",
	);
	expect(refreshStationInteriorKit(pad)).toBe(false);
	expect(pad.children).toEqual(children);
	expect(refreshStationInteriorKit(outpost)).toBe(false);
	expect(outpost.children).toEqual(outpostChildren);
	disposeSubtree(outpost);
	disposeSubtree(group);
	disposeSubtree(pad);
});
