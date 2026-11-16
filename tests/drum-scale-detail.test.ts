import { afterAll, beforeAll, expect, test } from "bun:test";
import * as THREE from "three";
import {
	installShippedTrades,
	uninstallTrades,
} from "../scripts/lib/shipped-trades";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { buildStationForm, setStationDetail } from "../src/station-mesh";
import { STATION_GEOMETRY } from "../src/station";
import { forEachWorldVertex } from "./helpers/world-triangles";

beforeAll(installShippedTrades);
afterAll(uninstallTrades);

test("Drum fittings hide below full while the plate backing stays hull", () => {
	const station = buildStationForm("trade", "c", 0x888888, 7, 7);
	const detail: THREE.Mesh[] = [];
	const backing: THREE.Mesh[] = [];
	station.root.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		if (o.name.startsWith("scale-detail")) detail.push(o);
		if (o.name.includes("plate-backing")) backing.push(o);
	});
	expect(detail.length).toBeGreaterThanOrEqual(8);
	expect(backing).toHaveLength(1);
	for (const level of ["full", "reduced", "outline", "full"] as const) {
		setStationDetail(station, level);
		for (const part of detail) {
			expect(part.userData.minDetail).toBe("full");
			expect(station.accessories).toContain(part);
			expect(part.visible).toBe(level === "full");
		}
		for (const part of backing) {
			expect(part.visible).toBe(true);
			expect(station.accessories).not.toContain(part);
			expect(part.userData.minDetail).toBeUndefined();
		}
	}
	expect(station.silhouetteKm).toBe(0.7);
	let reach = 0;
	forEachWorldVertex(station.root, (v) => {
		reach = Math.max(reach, v.length() * 0.6);
	});
	expect(reach).toBeCloseTo(0.6870291114647181, 9);
	station.dispose();
});

test("the four original Drum window bands sit on the entry face", async () => {
	const root = await decodeShippedGlb("src/models/trade-drum.glb");
	root.updateMatrixWorld(true);
	const faceZ = STATION_GEOMETRY.trade.aperturePlaneKm * 1000 - 485 + 451.8;
	const black: THREE.Object3D[] = [];
	root.traverse((o) => {
		if (
			o instanceof THREE.Mesh &&
			(o.material as THREE.Material).name === "recess-black" &&
			!o.name.includes("plate-backing")
		)
			black.push(o);
	});
	for (const k of [1, 3, 5, 7]) {
		const theta = (k * Math.PI) / 4;
		const ray = new THREE.Raycaster(
			new THREE.Vector3(
				180 * Math.cos(theta),
				180 * Math.sin(theta),
				faceZ + 50,
			),
			new THREE.Vector3(0, 0, -1),
		);
		const hit = ray.intersectObjects(black)[0];
		expect(hit).toBeDefined();
		expect(Math.abs(hit!.point.z - faceZ - 4)).toBeLessThan(0.01);
	}
});
