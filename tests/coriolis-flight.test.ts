import { test, expect } from "bun:test";
import { EMISSIVE_CEILING, EXPOSURE } from "../src/light-rig";
import * as THREE from "three";
import { makeWorldAtSystem } from "../src/sim";
import {
	coriolisLightsChunk,
	createIndustrialCoriolisBuilder,
	isCoriolisBeacon,
} from "../src/coriolis-flight";
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
	).toEqual(new THREE.Color(1, 1, 1).multiplyScalar(2.3).getHex());
	expect(built.root.getObjectByName("beacon-coriolis-a")).toBeDefined(); // glossary-ignore: beacon
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

import {
	readCoriolisGlb,
	readShippedCoriolisBuilder,
} from "./helpers/read-coriolis-glb";
test("flight export removes the display tunnel and its end cap across the whole slot", async () => {
	const root = await readCoriolisGlb("coriolis-industrial-flight.glb");
	const detail = await readCoriolisGlb("coriolis-detail.glb");
	root.add(...detail.children);
	root.updateMatrixWorld(true);
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

test("installed Coriolis is the canonical station builder without a URL flag", async () => {
	// Pooling changes system 0's form. This row is about the installed
	// Coriolis, so use a generated system that draws it (node #747).
	const s = makeWorldAtSystem(42, 4).system.contents.stations.find(
		(s) => s.type === "trade",
	)!;
	expect(s?.formId).toBe("a");
	const template = await readCoriolisGlb("coriolis-industrial-flight.glb");
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

test("only exact Coriolis navigation material names receive the ruled exposure exception", () => {
	const template = new THREE.Group();
	const names = [
		"navigation-red",
		"navigation-green",
		"navigation-blue",
		"navigation-red-extra",
		"scale-detail-navigation-red",
		"maintenance-white",
		"habitation-amber",
	];
	const materials = names.map((name) => {
		const material = new THREE.MeshStandardMaterial({
			emissive: 0xffffff,
			emissiveIntensity: 5,
		});
		material.name = name;
		template.add(
			new THREE.Mesh(new THREE.BoxGeometry(800, 800, 800), material),
		);
		return material;
	});
	const station = createIndustrialCoriolisBuilder(template)(0, 0xffffff);
	for (const material of materials) {
		const navigation = ["navigation-red", "navigation-green"].includes(
			material.name,
		);
		expect(isCoriolisBeacon(material.name)).toBe(navigation);
		expect(material.emissiveIntensity).toBe(navigation ? 8 : EMISSIVE_CEILING);
	}
	station.dispose();
});

test("the shipped Coriolis exceeds the shared ceiling only on its two ruled navigation materials", async () => {
	const { build } = await readShippedCoriolisBuilder();
	const station = build(0, 0x9aa6b2);
	const materials = new Set<THREE.MeshStandardMaterial>();
	station.root.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		for (const material of Array.isArray(o.material)
			? o.material
			: [o.material])
			if (material instanceof THREE.MeshStandardMaterial)
				materials.add(material);
	});
	const exceptions: string[] = [];
	let ordinary = 0;
	for (const material of materials) {
		expect(Number.isFinite(material.emissiveIntensity)).toBe(true);
		expect(material.emissiveIntensity).toBeGreaterThanOrEqual(0);
		if (isCoriolisBeacon(material.name)) {
			exceptions.push(material.name);
			expect(material.emissiveIntensity).toBeCloseTo(4.8);
			expect(material.emissiveIntensity).toBeLessThanOrEqual(8);
		} else {
			ordinary++;
			expect([
				material.name,
				material.emissiveIntensity <= EMISSIVE_CEILING,
			]).toEqual([material.name, true]);
		}
	}
	expect(exceptions.sort()).toEqual(["navigation-green", "navigation-red"]);
	expect(ordinary).toBeGreaterThan(10);
	station.dispose();
});

import { setStationDetail, stationSilhouetteKm } from "../src/station-mesh";
import { resourcesOf, isShared, type Disposable } from "../src/gpu-teardown";
import {
	stationProxy,
	proxyReachKm,
	proxyContains,
	PROXY_VERTEX_TOLERANCE_KM,
} from "../src/station-proxy";
import {
	verticesOutsideProxy,
	openingOf,
	spinningOpeningPoints,
	extractVertices,
} from "./helpers/station-proxy-measure";

test("shipped flight asset and production bay obey collision, reach, detail and shared-resource contracts", async () => {
	const { template, build } = await readShippedCoriolisBuilder();
	const proxy = stationProxy("trade", "a", 0, 0)!;
	const opening = openingOf("trade", "a");
	expect(proxyReachKm(proxy)).toBeLessThanOrEqual(
		stationSilhouetteKm("trade", "a"),
	);
	expect(
		spinningOpeningPoints(opening).some((p) =>
			proxyContains(proxy.spinning, p.x, p.y, p.z, -1e-9),
		),
	).toBe(false);
	for (const seed of [0, 1, 7]) {
		const mesh = build(seed, 0x9aa6b2);
		const other = build(seed + 1, 0x9aa6b2);
		expect(
			verticesOutsideProxy(
				mesh,
				"trade",
				proxy,
				opening,
				PROXY_VERTEX_TOLERANCE_KM,
			),
		).toEqual([]);
		const vertices = extractVertices(mesh, "trade");
		expect(vertices.length).toBeGreaterThan(100_000);
		expect(
			vertices.reduce((max, { v }) => Math.max(max, v.length()), 0),
		).toBeLessThanOrEqual(stationSilhouetteKm("trade", "a"));
		const core = mesh.root.getObjectByName("core") as THREE.Mesh<
			THREE.BufferGeometry,
			THREE.MeshStandardMaterial
		>;
		expect(core).toBeDefined();
		const source = template.getObjectByName("ceramic-steel-0");
		expect(source).toBeInstanceOf(THREE.Mesh);
		if (
			!(source instanceof THREE.Mesh) ||
			!(source.material instanceof THREE.MeshStandardMaterial)
		)
			throw new Error("missing authored ceramic paint");
		expect(core.material.color).toEqual(
			source.material.color.clone().multiplyScalar(2.3),
		);
		expect(mesh.fixtures.filter((f) => f.kind === "chase")).toHaveLength(10);
		expect(mesh.nameplates).toHaveLength(2);
		expect(mesh.accessories.length).toBeGreaterThan(0);
		for (const level of ["outline", "reduced", "full"] as const) {
			setStationDetail(mesh, level);
			expect(core.visible).toBe(true);
			for (const accessory of mesh.accessories)
				expect(accessory.visible).toBe(
					accessory.userData.minDetail === "full"
						? level === "full"
						: level !== "outline",
				);
		}
		const stillLive = resourcesOf(other.root);
		const resources = resourcesOf(mesh.root);
		const freed = new Set<Disposable>();
		for (const resource of resources)
			resource.addEventListener("dispose", () => freed.add(resource));
		mesh.dispose();
		expect(freed.size).toBeGreaterThan(0);
		expect([...resources].filter(isShared).length).toBeGreaterThan(0);
		expect([...freed].some((r) => stillLive.has(r))).toBe(false);
		other.dispose();
	}
}, 30_000);

test("principal paint ruling retains authored warmth and contrast regardless of role colour", () => {
	const template = new THREE.Group();
	for (const [i, color] of [
		new THREE.Color(0.42, 0.43, 0.4),
		new THREE.Color(0.475, 0.48, 0.445),
	].entries()) {
		const material = new THREE.MeshStandardMaterial({ color });
		material.name = "ceramic-steel-" + i;
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(800, 800, 800), material);
		mesh.name = material.name;
		template.add(mesh);
	}
	const build = createIndustrialCoriolisBuilder(template);
	const first = build(0, 0x123456);
	const second = build(0, 0xff0000);
	for (const [i, source] of template.children.entries()) {
		if (!(source instanceof THREE.Mesh)) throw new Error("missing plate");
		const name = i === 0 ? "core" : source.name;
		for (const station of [first, second]) {
			const plate = station.root.getObjectByName(name);
			if (!(plate instanceof THREE.Mesh))
				throw new Error("missing built plate");
			expect(plate.material.color).toEqual(
				source.material.color.clone().multiplyScalar(2.3),
			);
		}
	}
	first.dispose();
	second.dispose();
});

test("Coriolis shader compiles with the ruled station-only key and ambient gains and fails closed on chunk drift", async () => {
	const { build } = await readShippedCoriolisBuilder();
	const station = build(0, 0x9aa6b2);
	let surfaces = 0;
	station.root
		.getObjectByName("industrial-coriolis-exterior")!
		.traverse((o) => {
			if (
				!(o instanceof THREE.Mesh) ||
				!(o.material instanceof THREE.MeshStandardMaterial) ||
				o.material.emissive.getHex() !== 0
			)
				return;
			const shader = { ...THREE.ShaderLib.standard, uniforms: {} };
			o.material.onBeforeCompile(
				shader as THREE.WebGLProgramParametersWithUniforms,
				{} as THREE.WebGLRenderer,
			);
			expect(shader.fragmentShader).not.toContain(
				"#include <lights_fragment_begin>",
			);
			expect(shader.fragmentShader).toContain("directLight.color *= 2.000;");
			expect(shader.fragmentShader).toContain(
				"irradiance += 0.600 * getHemisphereLightIrradiance",
			);
			expect(shader.fragmentShader).not.toContain("coriolisRim");
			expect(o.material.envMapIntensity).toBe(1);
			surfaces++;
		});
	expect(surfaces).toBeGreaterThan(10);
	for (const marker of [
		"getDirectionalLightInfo( directionalLight, directLight );",
		"irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );",
	]) {
		expect(() =>
			coriolisLightsChunk(
				THREE.ShaderChunk.lights_fragment_begin.replace(marker, ""),
			),
		).toThrow("Coriolis");
	}
	const unaffected = new THREE.MeshStandardMaterial();
	const shader = { ...THREE.ShaderLib.standard, uniforms: {} };
	unaffected.onBeforeCompile(
		shader as THREE.WebGLProgramParametersWithUniforms,
		{} as THREE.WebGLRenderer,
	);
	expect(shader.fragmentShader).toBe(THREE.ShaderLib.standard.fragmentShader);
	station.dispose();
	unaffected.dispose();
});

test("every added scale-detail mesh draws only at full; baseline geometry and gameplay fixtures remain", async () => {
	const {
		template,
		detail: detailScene,
		build,
	} = await readShippedCoriolisBuilder();
	const station = build(0, 0x9aa6b2);
	const detail: THREE.Mesh[] = [];
	const baseline: THREE.Mesh[] = [];
	const beacons = new Set<THREE.MeshStandardMaterial>();
	for (const [scene, list] of [
		[template, baseline],
		[detailScene, detail],
	] as const)
		scene.traverse((o) => {
			if (o instanceof THREE.Mesh) list.push(o);
		});
	expect(detail.every((o) => o.name.startsWith("scale-detail-"))).toBe(true);
	expect(baseline.some((o) => o.name.startsWith("scale-detail-"))).toBe(false);
	expect(detail.length).toBeGreaterThanOrEqual(7);
	const triangles = (meshes: THREE.Mesh[]) =>
		meshes.reduce(
			(n, o) =>
				n +
				(o.geometry.index?.count ?? o.geometry.getAttribute("position").count) /
					3,
			0,
		);
	expect(triangles(baseline)).toBe(139948);
	expect(triangles(detail)).toBeGreaterThan(300000);
	for (const level of ["full", "reduced", "outline"] as const) {
		setStationDetail(station, level);
		for (const mesh of detail) {
			const built = station.root.getObjectByName(mesh.name)!;
			expect(built.userData.minDetail).toBe("full");
			expect(built.visible).toBe(level === "full");
			expect(station.accessories.includes(built)).toBe(true);
		}
		expect(
			station.fixtures.filter(
				(f) => f.kind === "strobe-a" || f.kind === "strobe-b",
			),
		).toHaveLength(4);
	}
	station.root.traverse((o) => {
		if (
			!(o instanceof THREE.Mesh) ||
			!(o.material instanceof THREE.MeshStandardMaterial)
		)
			return;
		if (isCoriolisBeacon(o.material.name)) beacons.add(o.material);
	});
	expect([...beacons].map((m) => m.name).sort()).toEqual([
		"navigation-green",
		"navigation-red",
	]);
	for (const m of beacons) {
		expect(m.emissiveIntensity).toBeCloseTo(4.8);
		expect(
			(0.2126 * m.emissive.r + 0.7152 * m.emissive.g + 0.0722 * m.emissive.b) *
				m.emissiveIntensity,
		).toBeGreaterThan(EXPOSURE.bloom.threshold);
	}
	station.dispose();
});

import { updateStationVisuals } from "../src/station-mesh";
import { emissiveDivisor } from "../src/coriolis-flight";
import { readFileSync } from "node:fs";

const detailParts = (station: { root: THREE.Object3D }) => {
	const parts: THREE.Object3D[] = [];
	station.root.traverse((o) => {
		if (o.name.startsWith("scale-detail-")) parts.push(o);
	});
	return parts;
};

test("the scale detail loads only once a Coriolis draws at full, and reaches stations built before it", async () => {
	const template = await readCoriolisGlb("coriolis-industrial-flight.glb");
	const detail = await readCoriolisGlb("coriolis-detail.glb");
	let requests = 0;
	const build = createIndustrialCoriolisBuilder(template, () => requests++);
	const far = build(0, 0x9aa6b2);
	const near = build(1, 0x9aa6b2);
	const gone = build(2, 0x9aa6b2);
	expect(detailParts(far)).toEqual([]);
	expect(far.lateDetail?.attached).toBe(false);
	updateStationVisuals(far, 0, far.silhouetteKm * 1000, "high");
	expect(far.detail).not.toBe("full");
	expect(requests).toBe(0);
	updateStationVisuals(near, 0, near.silhouetteKm, "high");
	expect(near.detail).toBe("full");
	expect(requests).toBe(1);
	gone.dispose();
	build.addDetail(detail);
	expect(near.lateDetail?.attached).toBe(true);
	updateStationVisuals(near, 0, near.silhouetteKm, "high");
	expect(requests).toBe(1);
	expect(detailParts(gone)).toEqual([]);
	const later = build(3, 0x9aa6b2);
	for (const station of [far, near, later]) {
		const parts = detailParts(station);
		expect(parts.map((o) => o.name).sort()).toEqual(
			detail.children.map((o) => o.name).sort(),
		);
		for (const part of parts) {
			expect(station.accessories.includes(part)).toBe(true);
			expect(part.visible).toBe(station.detail === "full");
		}
	}
	const stillLive = resourcesOf(near.root);
	const freed = new Set<Disposable>();
	for (const resource of resourcesOf(far.root))
		resource.addEventListener("dispose", () => freed.add(resource));
	far.dispose();
	expect([...freed].some((r) => stillLive.has(r))).toBe(false);
	near.dispose();
	later.dispose();
});

test("the detail file shares the base file's materials, image and exposure", async () => {
	const template = await readCoriolisGlb("coriolis-industrial-flight.glb");
	const detail = await readCoriolisGlb("coriolis-detail.glb");
	const materials = (root: THREE.Object3D) => {
		const out = new Set<THREE.MeshStandardMaterial>();
		root.traverse((o) => {
			if (o instanceof THREE.Mesh) out.add(o.material);
		});
		return out;
	};
	expect(emissiveDivisor(materials(template))).toBe(
		emissiveDivisor([...materials(template), ...materials(detail)]),
	);
	const json = (file: string) => {
		const bytes = readFileSync(file);
		return JSON.parse(
			bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"),
		);
	};
	const base = json("src/models/coriolis.glb");
	const late = json("src/models/coriolis-detail.glb");
	expect(late.images ?? []).toEqual([]);
	const imageNames = base.images.map((i: { name: string }) => i.name);
	const named = late.materials.filter(
		(m: { extras?: { baseColorMap?: string } }) => m.extras?.baseColorMap,
	);
	expect(named.length).toBeGreaterThan(0);
	for (const m of named) expect(imageNames).toContain(m.extras.baseColorMap);
	const build = createIndustrialCoriolisBuilder(template);
	build.addDetail(detail);
	const station = build(0, 0x9aa6b2);
	const baseByName = new Map([...materials(template)].map((m) => [m.name, m]));
	for (const part of detailParts(station)) {
		const material = (part as THREE.Mesh)
			.material as THREE.MeshStandardMaterial;
		const shared = baseByName.get(material.name);
		if (shared) expect(material).toBe(shared);
		else expect(isShared(material)).toBe(true);
	}
	station.dispose();
});
