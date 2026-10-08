import { test, expect } from "bun:test";
import * as THREE from "three";
import { makeWorldAtSystem } from "../src/sim";
import { createIndustrialStationBuilder } from "../src/coriolis-flight";
import { STATION_GEOMETRY } from "../src/station";

test("industrial exterior and seeded production bay share one kilometre spinner", () => {
	const template = new THREE.Group();
	template.name = "industrial-coriolis-exterior";
	const cube = new THREE.Mesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshStandardMaterial(),
	);
	template.add(cube);
	const build = createIndustrialStationBuilder(template);
	const s = makeWorldAtSystem(42, 0).system.contents.stations.find(
		(s) => s.type === "trade",
	)!;
	const built = build(s, 0xffffff);
	const exterior = built.spinner.getObjectByName(
		"industrial-coriolis-exterior",
	)!;
	const bay = built.spinner.getObjectByName("station-interior")!;
	expect(exterior).toBeDefined();
	expect(bay).toBeDefined();
	bay.traverse((o) => {
		if (o.name === "interior-shell" || o.name === "interior-rail")
			expect(o.position.z + o.scale.z / 2).toBeLessThan(0.4035);
	});

	bay.traverse((o) => {
		if (o.name === "interior-bulkhead" || o.name === "interior-lane-edge")
			expect(o.position.z).toBeLessThan(0.4035);
	});

	expect(exterior.scale.x).toBe(0.001);
	expect(built.root.getObjectByName("km")!.scale.x).toBe(
		1 / STATION_GEOMETRY.trade.coreRadiusKm,
	);
	expect(built.nameplates.length).toBeGreaterThan(0);
	built.spinner.rotation.z = 1.2;
	built.root.updateMatrixWorld(true);
	expect(bay.parent).toBe(built.spinner);
	expect(exterior.parent).toBe(built.spinner);
	built.dispose();
	const second = build(s, 0xffffff);
	expect(second.spinner.children.length).toBe(2);
	second.dispose();
});
test("other station forms retain their existing builder", () => {
	const s = makeWorldAtSystem(42, 0).system.contents.stations.find(
		(s) => s.type === "refinery",
	)!;
	const built = createIndustrialStationBuilder(new THREE.Group())(s, 0xffffff);
	expect(built.type).toBe("refinery");
	expect(
		built.root.getObjectByName("industrial-coriolis-exterior"),
	).toBeUndefined();
	built.dispose();
});

import { readCoriolisGlb } from "./helpers/read-coriolis-glb";
test("flight export removes the display tunnel and its end cap across the whole slot", () => {
	const root = readCoriolisGlb("coriolis-industrial-flight.glb");
	for (const x of [-0.0599, 0, 0.0599])
		for (const y of [-0.0349, 0, 0.0349]) {
			const hit = new THREE.Raycaster(
				new THREE.Vector3(x, y, 0.55),
				new THREE.Vector3(0, 0, -1),
			).intersectObject(root, true)[0];
			expect(hit).toBeDefined();
			expect(hit.point.z).toBeLessThan(-0.35);
		}
});
