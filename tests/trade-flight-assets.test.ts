import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { STATION_GEOMETRY } from "../src/station";
import { stationInterior } from "../src/station-interior";
import { forEachWorldTriangle } from "./helpers/world-triangles";

describe("trade flight exports, node #1033", () => {
	for (const name of ["ring", "drum", "wheel"]) {
		test(`${name}: shipping loader preserves the frame and clears the bay`, async () => {
			const file = `src/models/trade-${name}.glb`;
			expect(statSync(file).size).toBeLessThan(25_000_000);
			const root = await decodeShippedGlb(file);
			root.updateMatrixWorld(true);
			const mark = root.getObjectByName("aperture-plane");
			expect(mark).toBeDefined();
			const geometry = STATION_GEOMETRY.trade;
			const plane = geometry.aperturePlaneKm * 1000;
			expect(
				mark!
					.getWorldPosition(new THREE.Vector3())
					.distanceTo(new THREE.Vector3(0, 0, plane)),
			).toBeLessThan(0.01);
			const bay = stationInterior("trade", geometry.aperturePlaneKm, 7);
			const box = new THREE.Box3(
				new THREE.Vector3(
					-bay.halfAcrossKm * 1000 + 0.1,
					-bay.halfUpKm * 1000 + 0.1,
					bay.endAxialKm * 1000 + 0.1,
				),
				new THREE.Vector3(
					bay.halfAcrossKm * 1000 - 0.1,
					bay.halfUpKm * 1000 - 0.1,
					plane - 40.1,
				),
			);
			const throat = new THREE.Box3(
				new THREE.Vector3(-59.9, -34.9, plane - 40),
				new THREE.Vector3(59.9, 34.9, plane + 3000),
			);
			const radius =
				Math.hypot(geometry.aperture.widthKm, geometry.aperture.heightKm) * 500;
			const approach = new THREE.Box3(
				new THREE.Vector3(-radius + 0.1, -radius + 0.1, plane + 0.1),
				new THREE.Vector3(radius - 0.1, radius - 0.1, plane + 3000),
			);
			let intrusions = 0;
			let triangles = 0;
			let approachIntrusions = 0;
			forEachWorldTriangle(root, (triangle) => {
				if (
					box.intersectsTriangle(triangle) ||
					throat.intersectsTriangle(triangle)
				)
					intrusions++;
				if (approach.intersectsTriangle(triangle)) approachIntrusions++;
				triangles++;
			});
			expect(triangles).toBeGreaterThan(1000);
			expect(intrusions).toBe(0);
			expect(approachIntrusions).toBe(0);
			root.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				for (const m of Array.isArray(o.material) ? o.material : [o.material])
					m.side = THREE.DoubleSide;
			});
			const ray = new THREE.Raycaster(
				new THREE.Vector3(150, 0, plane + 50),
				new THREE.Vector3(0, 0, -1),
			);
			for (const [x, y] of [
				[64, 0],
				[0, 39],
			]) {
				ray.set(
					new THREE.Vector3(x, y, plane + 10),
					new THREE.Vector3(0, 0, -1),
				);
				const support = ray.intersectObject(root, true)[0];
				expect(support).toBeDefined();
				expect(Math.abs(support!.point.z - plane)).toBeLessThan(0.01);
			}
			ray.set(
				new THREE.Vector3(150, 0, plane + 50),
				new THREE.Vector3(0, 0, -1),
			);
			expect(
				ray
					.intersectObject(root, true)
					.some((hit) => hit.point.z > plane - 40 && hit.point.z < plane),
			).toBe(true);
			if (name !== "drum") {
				ray.set(
					new THREE.Vector3(0, 0, plane - 41),
					new THREE.Vector3(0, 0, -1),
				);
				const rear = ray.intersectObject(root, true)[0];
				expect(rear).toBeDefined();
				expect(rear!.point.z).toBeLessThan(bay.endAxialKm * 1000);
				expect(rear!.point.z).toBeGreaterThan(bay.endAxialKm * 1000 - 10);
			}
		});
	}
});
