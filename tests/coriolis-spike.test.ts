import { readCoriolisGlb } from "./helpers/read-coriolis-glb";
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { STATION_GEOMETRY } from "../src/station";
import { STATION_FORMS } from "../src/station-mesh";

const root = readCoriolisGlb("coriolis-industrial.glb");

describe("Coriolis spike export", () => {
	test("all actual vertices remain within the declared Coriolis display reach", () => {
		const reach = STATION_FORMS.trade.find((f) => f.id === "a")!.reachKm;
		const point = new THREE.Vector3();
		let max = 0;
		root.traverse((o) => {
			if (o instanceof THREE.Mesh) {
				const p = o.geometry.getAttribute("position");
				for (let i = 0; i < p.count; i++) {
					point.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
					max = Math.max(max, point.length());
				}
			}
		});
		expect(max).toBeGreaterThan(0.5);
		expect(max).toBeLessThanOrEqual(reach);
	});
	test("the entire production slot and initial throat are open, from either side of each surface", () => {
		const { aperture, aperturePlaneKm } = STATION_GEOMETRY.trade;
		for (const u of [-0.499, 0, 0.499])
			for (const v of [-0.499, 0, 0.499]) {
				const ray = new THREE.Raycaster(
					new THREE.Vector3(
						u * aperture.widthKm,
						v * aperture.heightKm,
						aperturePlaneKm + 0.12,
					),
					new THREE.Vector3(0, 0, -1),
				);
				const first = ray.intersectObject(root, true)[0];
				expect(first).toBeDefined();
				expect(first.point.z).toBeLessThan(aperturePlaneKm - 0.085);
			}
	});
	test("the mouth has physical walls outside its aperture", () => {
		const { aperture, aperturePlaneKm } = STATION_GEOMETRY.trade;
		for (const [x, y] of [
			[aperture.widthKm / 2 + 0.004, 0],
			[-aperture.widthKm / 2 - 0.004, 0],
			[0, aperture.heightKm / 2 + 0.004],
			[0, -aperture.heightKm / 2 - 0.004],
		]) {
			const hit = new THREE.Raycaster(
				new THREE.Vector3(x, y, 0.55),
				new THREE.Vector3(0, 0, -1),
			).intersectObject(root, true)[0];
			expect(hit).toBeDefined();
			expect(hit.point.z).toBeGreaterThan(aperturePlaneKm - 0.03);
		}
	});
});
