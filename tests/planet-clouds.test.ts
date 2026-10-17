import { expect, test } from "bun:test";
import * as THREE from "three";
import { glslFunctionRange } from "../scripts/lib/glsl-function.mjs";
import { appearanceFor } from "../src/planet-appearance";
import { CLOUD_SHELL_RADIUS, CLOUD_MOTION_GLSL } from "../src/planet-clouds";
import { CLASS_GLSL } from "../src/planet-classes.glsl";
import { targetPixelAngle } from "../src/planet-footprint";
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
	// Node #756's scope is terran weather. The dust arm keeps its own two fixed
	// scales, so it must not reach the footprint helper at all.
	expect(dust).not.toMatch(/Footprint/);
	expect(CLOUD_FRAGMENT).toContain(
		"cloudCoherent > 0.5 ? (0.48 + 0.22 * rim) : (0.62 + 0.30 * rim)",
	);
});

/**
 * Node #720 D9 / node #756: the live terran shell extends `broad` and `wisp` by
 * footprint, the way the ground's four fields do (#755). These rows are the
 * test seam the node names — shader-source assertions that the helper is the one
 * being called, per field, at that field's own frequency.
 */
test("terran broad and wisp extend octaves by footprint; cirrus and the cap band do not", () => {
	const coherent = CLOUD_FRAGMENT.split("if (cloudCoherent > 0.5) {")[1]?.split(
		"} else {",
	)[0];
	expect(coherent).toBeDefined();
	expect(coherent).toContain(
		"cloudFieldFootprint(cloudMotion(p, time), cloudCover, seedOffset, cloudTestDir, cloudFootprint, cloudOctaveCap)",
	);
	// The two fields that adopt detail, each scaled by its own frequency so the
	// footprint is stated in the units the helper's base octaves sample at.
	expect(CLOUD_FRAGMENT).toContain(
		"fbm4Footprint(warp(broadP * 2.3, 1.1, 0.75), footprint * 2.3, cap)",
	);
	expect(CLOUD_FRAGMENT).toContain(
		"fbm5Footprint(wispP * 8.5, footprint * 8.5, cap)",
	);
	// Cirrus and the domain warp keep their octave counts, as on the ground.
	expect(CLOUD_FRAGMENT).toContain("float cirrus = fbm3(cirrusP * 1.2);");
	// The band is the ground's: full inside 1.6R, gone by 2R, and in *body*
	// radii even though this geometry stands at the shell's radius. A fade in
	// shell radii would still be adding octaves at 2R and move every distant
	// view out of its control noise.
	expect(CLOUD_FRAGMENT).toContain(
		"const float CLOUD_SHELL_R = " + CLOUD_SHELL_RADIUS.toFixed(4) + ";",
	);
	expect(coherent).toContain(
		"distance(cameraPosition, vCenter) / (vRadius / CLOUD_SHELL_R)",
	);
	expect(coherent).toContain("1.0 - smoothstep(1.6, 2.0, cameraR)");
	expect(coherent).toContain(
		"distance(cameraPosition, vWorldP) * cloudPixelAngle",
	);
	expect(coherent).toContain("max(abs(dot(V, N)), 0.1)");
});

/**
 * The two field bodies must be one template. A weight, threshold or zonal term
 * that drifted into only one of them would make the close-detail band a
 * different planet from the one the coverage cube bakes, silently, because both
 * arms shade plausibly.
 */
test("the footprint weather field differs from the base field only in broad and wisp", () => {
	const cases: [string, string, [string, string][]][] = [
		[
			"cloudFieldFromInputs",
			"cloudFieldFromInputsFootprint",
			[
				[", float footprint, float cap)", ")"],
				[
					"fbm4Footprint(warp(broadP * 2.3, 1.1, 0.75), footprint * 2.3, cap)",
					"fbm4(warp(broadP * 2.3, 1.1, 0.75))",
				],
				[
					"fbm5Footprint(wispP * 8.5, footprint * 8.5, cap)",
					"fbm5(wispP * 8.5)",
				],
			],
		],
		[
			"cloudField",
			"cloudFieldFootprint",
			[
				[", float footprint, float cap)", ")"],
				[", footprint, cap)", ")"],
				["cloudFieldFromInputsFootprint(", "cloudFieldFromInputs("],
			],
		],
	];
	for (const [base, detail, replacements] of cases) {
		const emitted = (name: string) => {
			const { start, end } = glslFunctionRange(CLOUD_FRAGMENT, name);
			return CLOUD_FRAGMENT.slice(start, end);
		};
		let normalised = emitted(detail).replace(
			`float ${detail}(`,
			`float ${base}(`,
		);
		for (const [from, to] of replacements) {
			const before = normalised;
			normalised = normalised.replace(from, to);
			// A replacement that missed would turn this row into a comparison of the
			// footprint field with itself, which is green by construction.
			expect(normalised).not.toBe(before);
		}
		expect(normalised).toBe(emitted(base));
	}
});

test("the cloud shadow and the coverage bake keep the base field and the cube", () => {
	// #720 D4: the ground-shadow stays on the baked coverage cube, and the
	// procedural fallback beside it stays on the base field, so a bake and the
	// live shell cannot disagree about where the weather is.
	for (const source of [
		fragmentFor("terran"),
		bakeFragmentFor("terran", "normal"),
	]) {
		expect(source).not.toContain("cloudFieldFootprint");
		expect(source).not.toContain("cloudPixelAngle");
		expect(source).toContain("fbm4(warp(broadP * 2.3, 1.1, 0.75))");
		expect(source).toContain("fbm5(wispP * 8.5)");
	}
	expect(fragmentFor("terran")).toMatch(
		/cloudCoverageReady > 0\.5[\s\S]*textureCube\(cloudCoverage, cloudP\)\.a;/,
	);
});

test("the weather shell reads its own draw target and the shared quality cap", () => {
	const look = appearanceFor("planet", "cloud-47", 1, false);
	expect(look.surface).toBe("terran");
	const visual = buildBodyVisual(look, new THREE.SphereGeometry(1, 8, 6));
	const shell = visual.group.children.find(
		(o) => o.userData.shell === "cloud",
	) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
	// One quality dial, not a second one (#720 D10).
	expect(shell.material.uniforms.extraOctaveCap).toBe(
		visual.uniforms.extraOctaveCap,
	);
	visual.setDetailQuality("low");
	expect(shell.material.uniforms.extraOctaveCap.value).toBe(0);
	visual.setDetailQuality("high");
	expect(shell.material.uniforms.extraOctaveCap.value).toBe(6);
	/**
	 * #720 D9: the footprint comes from the shell's **own** target. The surface
	 * draws into a half-size buffer inside the band (#211) while the shells stay
	 * in the ordinary pass, so a shell that borrowed the ground's angle would
	 * price two octaves it does not need.
	 */
	const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100);
	let target: { height: number } | null = { height: 450 };
	const renderer = {
		getRenderTarget: () => target,
		getDrawingBufferSize: (v: THREE.Vector2) => v.set(1440, 900),
	} as unknown as THREE.WebGLRenderer;
	const draw = () =>
		shell.onBeforeRender(
			renderer,
			new THREE.Scene(),
			camera,
			shell.geometry,
			shell.material,
			null as never,
		);
	draw();
	expect(shell.material.uniforms.cloudPixelAngle.value).toBe(
		targetPixelAngle(camera.projectionMatrix.elements[5], 450),
	);
	target = { height: 900 };
	draw();
	expect(shell.material.uniforms.cloudPixelAngle.value).toBe(
		targetPixelAngle(camera.projectionMatrix.elements[5], 900),
	);
	target = null;
	draw();
	expect(shell.material.uniforms.cloudPixelAngle.value).toBe(
		targetPixelAngle(camera.projectionMatrix.elements[5], 900),
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
