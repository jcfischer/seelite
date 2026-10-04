import { expect, test } from "bun:test";
import * as THREE from "three";
import { appearanceFor } from "../src/planet-appearance";
import { CLOUD_SHELL_RADIUS, CLOUD_MOTION_GLSL } from "../src/planet-clouds";
import { CLASS_GLSL } from "../src/planet-classes.glsl";
import {
	CLOUD_FRAGMENT,
	bakeFragmentFor,
	bakedFragmentFor,
	fragmentFor,
} from "../src/planet-shaders";
import { buildBodyVisual } from "../src/planet-surface";

test("terran albedo is independent of weather, light, and clock", () => {
	expect(CLASS_GLSL.terran).not.toMatch(/sunDir|cloudShadow|\btime\b/);
	for (const channel of ["normal", "albedo"] as const) {
		const shader = bakeFragmentFor("terran", channel);
		expect(shader).not.toMatch(/uniform vec3 sunDir|uniform float time/);
	}
	expect(bakeFragmentFor("terran", "albedo")).not.toContain(
		"float cloudField(",
	);
	expect(bakeFragmentFor("terran", "normal")).toContain(
		"cloudField(p, cloudCover, seedOffset, cloudTestDir)",
	);
});

test("weather moves by the same rotation in shell and both draw paths", () => {
	for (const shader of [
		CLOUD_FRAGMENT,
		fragmentFor("terran"),
		bakedFragmentFor("terran"),
	]) {
		expect(shader).toContain(CLOUD_MOTION_GLSL);
		expect(shader).toContain("cloudMotion(");
	}
	const baked = bakedFragmentFor("terran");
	expect(baked).toContain("textureCube(bakedNormal, cloudP).a");
	expect(baked).not.toMatch(/float fbm\d\(/);
	expect(fragmentFor("terran")).toContain(
		"cloudField(cloudP, cloudCover, seedOffset, cloudTestDir)",
	);
});

test("sun projection uses the same radius as the shell and the body's frame", () => {
	const look = appearanceFor("planet", "planet-47", 0.7, false);
	look.surface = "terran";
	look.cloudCover = 0.7;
	const visual = buildBodyVisual(look, new THREE.SphereGeometry(1, 8, 6));
	const parent = new THREE.Group();
	parent.rotation.set(0.6, -0.3, 0.8);
	parent.add(visual.group);
	const sun = new THREE.Vector3(0.4, 0.5, -0.6).normalize();
	visual.setSunDirection(sun, 0.01);
	const local = visual.uniforms.cloudSunDir.value as THREE.Vector3;
	expect(
		local
			.clone()
			.applyQuaternion(visual.group.getWorldQuaternion(new THREE.Quaternion()))
			.distanceTo(sun),
	).toBeLessThan(1e-6);
	const shell = visual.group.children.find(
		(o) => o.userData.shell === "cloud",
	) as THREE.Mesh<THREE.SphereGeometry>;
	expect(shell.geometry.parameters.radius).toBe(CLOUD_SHELL_RADIUS);
	expect(bakedFragmentFor("terran")).toContain(
		`const float CLOUD_RADIUS = ${CLOUD_SHELL_RADIUS.toFixed(4)}`,
	);
});
