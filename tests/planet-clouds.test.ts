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

test("dust haze retains the pre-node two-scale field and opacity", () => {
	// Pin the pre-node dust contract (d6d6133), including its moving inputs.
	// A terran-only cirrus or opacity change must not spill into this branch.
	const dust = CLOUD_FRAGMENT.split("} else {")[1]?.split("\n  }")[0];
	expect(dust).toBeDefined();
	expect(dust).toContain("vec3(time * 0.0030, 0.0, 0.0)");
	expect(dust).toContain("vec3(time * 0.0068, 0.0, time * 0.0011)");
	expect(dust).toContain("fbm4(warp(slow * 2.3, 1.1, 0.75))");
	expect(dust).toContain("fbm5(fast * 8.5)");
	expect(dust).toContain("broad * 0.68 + wisp * 0.32");
	expect(dust).toContain("0.58 + 0.42 * cos(lat * 8.2 + 0.4)");
	expect(dust).toContain(
		"smoothstep(0.54 - cloudCover * 0.16, 0.56 + 0.10, field) * zonal",
	);
	expect(dust).not.toMatch(/cirrusDomain\(|cloudField\w*\(|fbm3\(/);
	expect(CLOUD_FRAGMENT).toContain(
		"cloudCoherent > 0.5 ? (0.48 + 0.22 * rim) : (0.62 + 0.30 * rim)",
	);
});

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
	expect(fragmentFor("terran")).toMatch(
		/if \(cloudCoverageReady > 0\.5\)[\s\S]*textureCube\(cloudCoverage, cloudP\)\.a;\s*else[\s\S]*cloudField\(/,
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
