/**
 * #130: authored machinery regions, hull emissives, and the ship detail band.
 *
 * The rendered judgement belongs to the headed view set. These rows own the
 * structural promises a picture cannot prove: every current variant declares a
 * zone on plated metal, the fill is deterministic and inside the silhouette,
 * the light inventory is complete, and quality never removes an emissive.
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { DETAIL_RADII, detailLevel } from "../src/detail-level";
import { DOMAIN } from "../src/domains";
import { HULL_IDS, HULL_VARIANT_IDS, type HullId } from "../src/hull";
import { uvUnitsOf } from "../src/loft";
import { buildShipDetails } from "../src/ship-detail";
import {
	HABITABLE_HULLS,
	SHIP_DETAIL_PLANS,
	SHIP_QUALITY,
	buildShipMesh,
	isAuthoredHull,
	setShipDetail,
	updateShipVisuals,
} from "../src/ship-mesh";
import { useProceduralHulls } from "./helpers/procedural-hulls";

useProceduralHulls();

// Generated detail only: the authored Longwall B (node #815) carries its own
// machinery and lamps, and `tests/longwall-mesh.test.ts` holds what it owes.
const variants = HULL_IDS.flatMap((id) =>
	HULL_VARIANT_IDS.map((variant) => ({ id, variant })),
).filter(({ id, variant }) => !isAuthoredHull(id, variant));

const meshesNamed = (root: THREE.Object3D, prefix: string) => {
	const found: THREE.Object3D[] = [];
	root.traverse((object) => {
		if (object.name.startsWith(prefix)) found.push(object);
	});
	return found;
};

const reach = (objects: readonly THREE.Object3D[]) => {
	const box = new THREE.Box3();
	for (const object of objects)
		box.union(new THREE.Box3().setFromObject(object));
	return Math.max(
		...box.min.toArray().map(Math.abs),
		...box.max.toArray().map(Math.abs),
	);
};

describe("authored ship machinery regions", () => {
	test("every current variant declares named zones on plated parts", () => {
		expect(variants).toHaveLength(34);
		for (const { id, variant } of variants) {
			const plan = SHIP_DETAIL_PLANS[id][variant];
			expect(plan.zones.length).toBeGreaterThan(0);
			expect(new Set(plan.zones.map((zone) => zone.name)).size).toBe(
				plan.zones.length,
			);
			const root = buildShipMesh(id, variant).root;
			for (const zone of plan.zones) {
				const target = root.getObjectByName(zone.part) as
					| THREE.Mesh
					| undefined;
				expect(target).toBeDefined();
				// `add()` found kilometre UVs and `plateUVs()` changed the marker to
				// `plate`; an excluded canopy, bell or exhaust never reaches this state.
				expect(uvUnitsOf(target?.geometry as THREE.BufferGeometry)).toBe(
					"plate",
				);
			}
		}
	});

	test("the fill has its own stable domain and is deterministic", () => {
		expect(DOMAIN.SHIP_GREEBLES).toBeGreaterThan(DOMAIN.CARRIER_NAME);
		expect(new Set(Object.values(DOMAIN)).size).toBe(
			Object.keys(DOMAIN).length,
		);
		for (const { id, variant } of variants) {
			const matrices = () => {
				const root = buildShipMesh(id, variant).root;
				return meshesNamed(root, "ship-greebles-").flatMap((object) => {
					const mesh = object as THREE.InstancedMesh;
					const matrix = new THREE.Matrix4();
					return Array.from({ length: mesh.count }, (_, i) => {
						mesh.getMatrixAt(i, matrix);
						return matrix.toArray();
					});
				});
			};
			expect(matrices()).toEqual(matrices());
		}
	});

	test("generated clutter is smaller than the base hull's maximum reach", () => {
		for (const { id, variant } of variants) {
			const root = buildShipMesh(id, variant).root;
			const clutter = meshesNamed(root, "ship-greebles-");
			const structure = root.children.filter(
				(object) =>
					!object.name.startsWith("ship-greebles") &&
					object.name !== "ship-strip" &&
					object.name !== "ship-windows" &&
					object.name !== "nav-lights",
			);
			expect([id, variant, clutter.length]).toEqual([id, variant, 3]);
			expect([id, variant, reach(clutter) < reach(structure)]).toEqual([
				id,
				variant,
				true,
			]);
		}
	});
});

describe("ship emissive inventory", () => {
	test("multiple machinery zones still add one hull-wide emissive set", () => {
		const root = buildShipMesh("freighter", "a").root;
		buildShipDetails(
			root,
			"freighter",
			"a",
			{
				zones: [
					{
						name: "test-forward",
						part: "freighter-fuselage",
						surface: "dorsal",
						from: 0.38,
						to: 0.5,
						count: 1,
					},
					{
						name: "test-aft",
						part: "freighter-fuselage",
						surface: "dorsal",
						from: 0.55,
						to: 0.7,
						count: 1,
					},
				],
			},
			root.userData.shipSilhouetteKm as number,
		);
		expect(meshesNamed(root, "ship-strip")).toHaveLength(4);
		expect(meshesNamed(root, "ship-windows")).toHaveLength(2);
	});

	test("Derrick's paired rails touch the plated gantry hull", () => {
		const root = buildShipMesh("freighter", "a").root;
		const target = root.getObjectByName("freighter-fuselage") as THREE.Mesh;
		for (const object of meshesNamed(root, "ship-strip")) {
			const strip = object as THREE.Mesh;
			const hit = new THREE.Raycaster(
				strip.position,
				new THREE.Vector3(0, -1, 0),
			).intersectObject(target, false)[0];
			expect(hit).toBeDefined();
			// The centre-to-surface distance must be no larger than half the rail's
			// normal thickness. Anything larger leaves a visible air gap.
			expect(strip.position.distanceTo(hit.point)).toBeLessThanOrEqual(
				strip.scale.z / 2 + 1e-9,
			);
		}
	});

	test("every variant has paired strips and navigation lights; only inhabited hulls have windows", () => {
		const inhabited = new Set<HullId>(HABITABLE_HULLS);
		expect([...inhabited]).toEqual(["freighter", "carrier", "dreadnought"]);
		for (const { id, variant } of variants) {
			const root = buildShipMesh(id, variant).root;
			expect(root.getObjectByName("nav-lights")).toBeDefined();
			if (isAuthoredHull(id, variant)) continue;
			expect([id, variant, meshesNamed(root, "ship-strip").length]).toEqual([
				id,
				variant,
				2,
			]);
			expect(root.getObjectByName("nav-lights")).toBeDefined();
			expect([id, variant, meshesNamed(root, "ship-windows").length]).toEqual([
				id,
				variant,
				inhabited.has(id) ? 1 : 0,
			]);
		}
	});

	test("low quality drops every greeble and keeps every emissive", () => {
		expect(SHIP_QUALITY).toEqual({
			high: { greebles: true },
			low: { greebles: false },
		});
		for (const { id, variant } of variants) {
			const root = buildShipMesh(id, variant).root;
			setShipDetail(root, "full");
			updateShipVisuals(root, 0, "low");
			expect(
				meshesNamed(root, "ship-greebles-").every((object) => !object.visible),
			).toBe(true);
			for (const object of [
				...meshesNamed(root, "ship-strip"),
				...meshesNamed(root, "ship-windows"),
				root.getObjectByName("nav-lights") as THREE.Object3D,
			])
				expect([id, variant, object.name, object.visible]).toEqual([
					id,
					variant,
					object.name,
					true,
				]);
		}
	});
});

describe("one directional detail band serves stations and ships", () => {
	test("the shared state machine holds a level through the hysteresis edge", () => {
		expect(detailLevel(undefined, DETAIL_RADII.full)).toBe("full");
		expect(detailLevel(undefined, DETAIL_RADII.full + 1)).toBe("reduced");
		expect(detailLevel("full", DETAIL_RADII.full * 1.02)).toBe("full");
		expect(detailLevel(undefined, DETAIL_RADII.reduced + 1)).toBe("outline");
	});

	test("ship clutter leaves the draw before it becomes a one-pixel tax", () => {
		const root = buildShipMesh("courier", "a").root;
		updateShipVisuals(root, 0, "high");
		expect(meshesNamed(root, "ship-greebles-").every((o) => o.visible)).toBe(
			true,
		);
		updateShipVisuals(root, 10, "high");
		expect(meshesNamed(root, "ship-greebles-").every((o) => !o.visible)).toBe(
			true,
		);
		for (const object of [
			...meshesNamed(root, "ship-strip"),
			root.getObjectByName("nav-lights") as THREE.Object3D,
		])
			expect(object.visible).toBe(true);
	});
});
