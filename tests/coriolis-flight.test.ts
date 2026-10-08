import { test, expect } from "bun:test";
import * as THREE from "three";
import { makeWorldAtSystem } from "../src/sim";
import { createIndustrialCoriolisBuilder } from "../src/coriolis-flight";
import { buildStationMesh, installCoriolisBuilder } from "../src/station-mesh";
import { STATION_GEOMETRY } from "../src/station";

test("industrial exterior and seeded production bay share one kilometre spinner", () => {
	const template = new THREE.Group();
	template.name = "industrial-coriolis-exterior";
	const cube = new THREE.Mesh(
		new THREE.BoxGeometry(800, 800, 800),
		new THREE.MeshStandardMaterial(),
	);
	cube.name = "ceramic-steel-0";
	template.add(cube);
	const build = createIndustrialCoriolisBuilder(template);
	const s = makeWorldAtSystem(42, 0).system.contents.stations.find(
		(s) => s.type === "trade",
	)!;
	const built = build(s.berthSeed, 0x9aa6b2);
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
	// The imported collar owns the inner slot walls and ends at the sim plane.
	// A light must not claim either of those planes (the browser flicker regression).
	let bars = 0;
	built.root.traverse((o) => {
		if (o.name !== "aperture-light" || !(o instanceof THREE.Mesh)) return;
		const dims = (o.geometry as THREE.BoxGeometry).parameters;
		if (o.position.x === 0)
			expect(Math.abs(o.position.y) - dims.height / 2).toBeGreaterThan(
				STATION_GEOMETRY.trade.aperture.heightKm / 2,
			);
		else
			expect(Math.abs(o.position.x) - dims.width / 2).toBeGreaterThan(
				STATION_GEOMETRY.trade.aperture.widthKm / 2,
			);
		expect(o.position.z + dims.depth / 2).toBeGreaterThan(
			STATION_GEOMETRY.trade.aperturePlaneKm + 0.001,
		);
		bars++;
	});
	expect(bars).toBe(4);
	expect(built.nameplates.length).toBe(2);
	expect(built.fixtures.some((f) => f.kind === "strobe-a")).toBe(true);
	expect(built.fixtures.some((f) => f.kind === "strobe-b")).toBe(true);
	expect(built.fixtures.filter((f) => f.kind === "chase")).toHaveLength(10);
	built.spinner.rotation.z = 1.2;
	built.root.updateMatrixWorld(true);
	expect(bay.parent?.name).toBe("aperture");
	expect(bay.parent?.parent).toBe(built.spinner);
	expect(
		(
			built.root.getObjectByName("core") as THREE.Mesh<
				THREE.BufferGeometry,
				THREE.MeshStandardMaterial
			>
		).material.color.getHex(),
	).toBe(0x9aa6b2);
	expect(built.root.getObjectByName("beacon-coriolis-a")).toBeDefined();
	expect(exterior.parent).toBe(built.spinner);
	built.dispose();
	const second = build(s.berthSeed, 0x9aa6b2);
	expect(
		second.spinner.getObjectByName("industrial-coriolis-exterior"),
	).toBeDefined();
	second.dispose();
});
test("other station forms retain their existing builder", () => {
	const s = makeWorldAtSystem(42, 0).system.contents.stations.find(
		(s) => s.type === "refinery",
	)!;
	const built = buildStationMesh(s, 0xffffff);
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

test("installed Coriolis is the canonical station builder without a URL flag", () => {
	const s = makeWorldAtSystem(42, 0).system.contents.stations.find(
		(s) => s.type === "trade" && s.formId === "a",
	)!;
	const template = new THREE.Group();
	template.add(
		new THREE.Mesh(
			new THREE.BoxGeometry(800, 800, 800),
			new THREE.MeshStandardMaterial(),
		),
	);
	const build = createIndustrialCoriolisBuilder(template);
	installCoriolisBuilder(build);
	try {
		const station = buildStationMesh(s, 0xffffff);
		expect(
			station.root.getObjectByName("industrial-coriolis-exterior"),
		).toBeDefined();
		station.dispose();
	} finally {
		installCoriolisBuilder(null);
	}
});

test("imported lights obey the live emissive ceiling while retaining their relative strengths", () => {
	const template = new THREE.Group();
	const brightest = new THREE.MeshStandardMaterial({
		emissive: 0xffffff,
		emissiveIntensity: 5,
	});
	const warm = new THREE.MeshStandardMaterial({
		emissive: 0xffaa22,
		emissiveIntensity: 4,
	});
	template.add(new THREE.Mesh(new THREE.BoxGeometry(800, 800, 800), brightest));
	template.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), warm));
	const build = createIndustrialCoriolisBuilder(template);
	const station = build(0, 0x9aa6b2);
	expect(brightest.emissiveIntensity).toBe(1);
	expect(warm.emissiveIntensity).toBe(0.8);
	station.dispose();
});
