import { afterAll, beforeAll, expect, test } from "bun:test";
import * as THREE from "three";
import {
	installShippedTrades,
	uninstallTrades,
} from "../scripts/lib/shipped-trades";
import { buildStationForm, setStationDetail } from "../src/station-mesh";
import { EXPOSURE } from "../src/light-rig";
import { AUTHORED_EXTERIOR_NAME } from "../src/station-visuals";

beforeAll(installShippedTrades);
afterAll(uninstallTrades);

test("Ring scale detail is separate from the approved baseline and hidden below full", () => {
	const station = buildStationForm("trade", "b", 0x888888, 7, 7);
	const detail: THREE.Mesh[] = [];
	let baselineTriangles = 0;
	station.root.getObjectByName("trade-b-model")!.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		if (o.name.startsWith("scale-detail")) detail.push(o);
		else
			baselineTriangles +=
				(o.geometry.index?.count ?? o.geometry.getAttribute("position").count) /
				3;
	});
	expect(baselineTriangles).toBe(102164);
	expect(detail.length).toBeGreaterThanOrEqual(7);
	for (const level of ["full", "reduced", "outline", "full"] as const) {
		setStationDetail(station, level);
		for (const part of detail) {
			expect(part.userData.minDetail).toBe("full");
			expect(station.accessories).toContain(part);
			expect(part.visible).toBe(level === "full");
		}
		expect(
			station.fixtures.filter(
				(f) => f.kind === "strobe-a" || f.kind === "strobe-b",
			),
		).toHaveLength(4);
	}
	station.dispose();
});

for (const form of ["b", "c", "d", "e"] as const)
	test(`trade/${form}: the ruled station key light reaches the compiled exterior shader`, () => {
		const station = buildStationForm("trade", form, 0x888888, 7, 7);
		let patched = 0;
		station.root.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			let parent: THREE.Object3D | null = o;
			while (parent && parent.name !== AUTHORED_EXTERIOR_NAME)
				parent = parent.parent;
			if (!parent) return;
			for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
				if (
					!(m instanceof THREE.MeshStandardMaterial) ||
					m.emissive.getHex() !== 0
				)
					continue;
				const shader = { ...THREE.ShaderLib.standard, uniforms: {} };
				m.onBeforeCompile(
					shader as THREE.WebGLProgramParametersWithUniforms,
					{} as THREE.WebGLRenderer,
				);
				expect(shader.fragmentShader).toContain("directLight.color *= 2.000;");
				expect(shader.fragmentShader).toContain(
					"irradiance += 0.600 * getHemisphereLightIrradiance",
				);
				expect(shader.fragmentShader).not.toContain(
					"#include <lights_fragment_begin>",
				);
				patched++;
			}
		});
		expect(patched).toBeGreaterThan(0);
		station.dispose();
	});

test("Ring red and green beacons cross the bloom threshold while its other lamps keep the ceiling", () => {
	const station = buildStationForm("trade", "b", 0x888888, 7, 7);
	const beacons = new Set<string>();
	station.root.getObjectByName("trade-b-model")!.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
			if (!(m instanceof THREE.MeshStandardMaterial)) continue;
			if (["navigation-red", "navigation-green"].includes(m.name)) {
				beacons.add(m.name);
				expect(
					(0.2126 * m.emissive.r +
						0.7152 * m.emissive.g +
						0.0722 * m.emissive.b) *
						m.emissiveIntensity,
				).toBeGreaterThan(EXPOSURE.bloom.threshold);
				expect(m.emissiveIntensity).toBeLessThanOrEqual(8);
			} else expect(m.emissiveIntensity).toBeLessThanOrEqual(1);
		}
	});
	expect([...beacons].sort()).toEqual(["navigation-green", "navigation-red"]);
	station.dispose();
});

test("the new Ring beacons do not dim its approved amber lamps and work floods", () => {
	const station = buildStationForm("trade", "b", 0x888888, 7, 7);
	const intensities = new Map<string, number>();
	station.root.getObjectByName("trade-b-model")!.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		for (const m of Array.isArray(o.material) ? o.material : [o.material])
			if (m instanceof THREE.MeshStandardMaterial)
				intensities.set(m.name, m.emissiveIntensity);
	});
	expect(intensities.get("amber-lamp")).toBe(1);
	expect(intensities.get("work-flood")).toBe(0.75);
	station.dispose();
});
