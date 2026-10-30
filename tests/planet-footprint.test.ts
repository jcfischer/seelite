import { expect, test } from "bun:test";
import * as THREE from "three";
import ts from "typescript";
import { glslFunctionRange } from "../scripts/lib/glsl-function.mjs";
import { appearanceFor } from "../src/planet-appearance";
import { CLASS_GLSL } from "../src/planet-classes.glsl";
import { planetDetailCap, targetPixelAngle } from "../src/planet-footprint";
import {
	NOISE_GLSL,
	bakeFragmentFor,
	fragmentFor,
} from "../src/planet-shaders";
import { buildBodyVisual } from "../src/planet-surface";
import { useHalfResolution } from "../src/planet-half-res";
import {
	BAKE_FACE_SIZES,
	bakeFacePxFor,
	projectedRadiusPx,
	surfacePathFor,
} from "../src/relief-bands";
import { isMassive, layerFor, massiveLayerFor, scaleFor } from "../src/units";
import type { Body } from "../src/sim";
import { renderStatementSlice } from "./lib/game-methods";

test("quality maps to the interim cap, with other classes staying at zero", () => {
	expect(planetDetailCap("low", "terran")).toBe(0);
	expect(planetDetailCap("high", "terran")).toBe(6);
	for (const kind of Object.keys(CLASS_GLSL)) {
		if (kind !== "terran")
			expect(planetDetailCap("high", kind as keyof typeof CLASS_GLSL)).toBe(0);
	}
});

test("pixel angle follows target height and the camera projection", () => {
	const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100);
	const full = targetPixelAngle(camera.projectionMatrix.elements[5], 900);
	expect(full).toBeCloseTo((2 * Math.tan(Math.PI / 6)) / 900, 15);
	expect(targetPixelAngle(camera.projectionMatrix.elements[5], 450)).toBe(
		full * 2,
	);
});

test("live terran extends exactly its four fields, leaving warp and bakes alone", () => {
	const source = fragmentFor("terran", "screen-space");
	for (const call of [
		"fbm5Footprint(warp(terrainCoordinates(p) * 1.15 + seedOffset, 1.4, 0.85), terrainFootprint * 1.15, terrainOctaveCap)",
		"ridgedFootprint(terrainCoordinates(p) * 11.0 + seedOffset, terrainFootprint * 11.0, terrainOctaveCap)",
		"fbm4Footprint(terrainCoordinates(p) * 2.1 + 53.0 + seedOffset, terrainFootprint * 2.1, terrainOctaveCap)",
		"fbm3Footprint(terrainCoordinates(p) * 4.0 + 7.0, terrainFootprint * 4.0, terrainOctaveCap)",
	])
		expect(source).toContain(call);
	expect(bakeFragmentFor("terran", "albedo")).toContain(CLASS_GLSL.terran);
	expect(source).toContain("fbm3(p * freq + 11.0)");
	expect(source).toContain("1.0 - smoothstep(1.6, 2.0, cameraR)");
	expect(source).toContain(
		"distance(cameraPosition, vWorldP) * surfacePixelAngle",
	);
	expect(source).toContain("max(abs(dot(V, N)), 0.1)");
	expect(fragmentFor("terran", "screen-space", false)).toContain(
		CLASS_GLSL.terran,
	);
});

test("zero extension preserves the original accumulation arithmetic", () => {
	for (const name of ["fbm3", "fbm4", "fbm5", "ridged"]) {
		// Keep the original accumulation and division in the footprint function.
		// A separate early return changed screen-space normals on ANGLE Metal.
		expect(scalarFunction(`${name}Footprint`)).not.toContain(
			`return ${name}(p)`,
		);
	}
	expect(NOISE_GLSL).toContain(
		"float weight = clamp(extra - float(i), 0.0, 1.0)",
	);
	expect(NOISE_GLSL).toContain("if (weight <= 0.0) break;");
});

// Run the emitted scalar arithmetic with a scalar coordinate and deterministic
// noise stub. GLSL's vector multiply/add applies this recurrence per component;
// the browser probe separately executes the actual three-dimensional field.
function scalarFunction(name: string): string {
	const { start, end } = glslFunctionRange(NOISE_GLSL, name);
	return NOISE_GLSL.slice(start, end)
		.replace(/float\(i\)/g, "i")
		.replace(
			/float (\w+)\(([^)]*)\)/,
			(_, fn, args) =>
				`function ${fn}(${args.replace(/(?:float|vec3) /g, "")})`,
		)
		.replace(/\b(?:float|int) /g, "let ");
}

test("GLSL function ranges include nested blocks and refuse malformed helpers", () => {
	const fn = "float f(float p) { if (p > 0.0) { return p; } return 0.0; }";
	const source = `// prefix\n${fn}\nfloat other() { return 1.0; }`;
	const { start, end } = glslFunctionRange(source, "f");
	expect(source.slice(start, end)).toBe(fn);
	expect(() => glslFunctionRange(source, "absent")).toThrow("missing");
	expect(() => glslFunctionRange("float f(float p)", "f")).toThrow("missing");
	expect(() =>
		glslFunctionRange("float f(float p) { if (true) { }", "f"),
	).toThrow("unclosed");
});

test("emitted helpers normalise a fractional last octave and obey the cap", () => {
	for (const name of ["fbm3", "fbm4", "fbm5", "ridged"]) {
		const ridge = name === "ridged";
		const count = ridge ? 4 : Number(name.slice(3));
		const lac = ridge ? 2.07 : 2.03;
		const offset = ridge ? 9.2 : 17.1;
		const noise = (p: number) => 0.5 + Math.sin(p) * 0.25;
		const run = new Function(
			"vnoise",
			`
const {log, max, pow, abs} = Math;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
${scalarFunction(name)}
${scalarFunction(`${name}Footprint`)}
return [${name}, ${name}Footprint];`,
		)(noise) as [
			(p: number) => number,
			(p: number, footprint: number, cap: number) => number,
		];
		for (const requested of [0, 0.5, 1, 2.5, 6, 9]) {
			const footprint = 0.5 / lac ** (count + requested);
			let p = 0.37,
				sum = 0,
				norm = 0;
			const extra = Math.min(6, requested);
			for (let i = 0; i < count + Math.ceil(extra); i++) {
				const weight = 0.5 ** (i + 1) * Math.min(1, count + extra - i);
				const value = ridge ? 1 - Math.abs(2 * noise(p) - 1) : noise(p);
				sum += weight * value;
				norm += weight;
				p = p * lac + offset;
			}
			expect(run[1](0.37, footprint, 6)).toBeCloseTo(sum / norm, 14);
			expect(run[1](0.37, footprint, 0)).toBe(run[0](0.37));
		}
		expect(run[1](0.37, 1, 6)).toBe(run[0](0.37));
		for (let p = -30; p < 30; p += 0.37) {
			expect(run[1](p, 1e-5, 0)).toBe(run[0](p));
			expect(run[1](p, 1, 6)).toBe(run[0](p));
		}
	}
});

test("draw callback reads the actual target and exposes all landed splices", () => {
	const body = buildBodyVisual(
		appearanceFor("planet", "footprint-47", 1, false),
		new THREE.SphereGeometry(),
	);
	body.setDetailQuality("low");
	expect(body.uniforms.extraOctaveCap.value).toBe(0);
	body.setDetailQuality("high");
	expect(body.uniforms.extraOctaveCap.value).toBe(6);
	const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100);
	let target: { height: number } | null = { height: 450 };
	const renderer = {
		getRenderTarget: () => target,
		getDrawingBufferSize: (v: THREE.Vector2) => v.set(1440, 900),
	} as unknown as THREE.WebGLRenderer;
	const draw = () =>
		body.surfaceMesh.onBeforeRender(
			renderer,
			new THREE.Scene(),
			camera,
			body.surfaceMesh.geometry,
			body.surfaceMesh.material,
			null as never,
		);
	draw();
	const half = body.uniforms.surfacePixelAngle.value;
	expect(body.surfaceMesh.material.fragmentShader).toContain(
		"terrainOctaveCap =",
	);
	camera.position.z = 2;
	draw();
	expect(body.surfaceMesh.material.fragmentShader).toBe(
		fragmentFor("terran", "four-tap", false),
	);
	camera.position.z = 1.2;
	body.setDetailQuality("low");
	draw();
	expect(body.surfaceMesh.material.fragmentShader).toBe(
		fragmentFor("terran", "four-tap", false),
	);
	target = null;
	draw();
	expect(body.uniforms.surfacePixelAngle.value).toBe(half / 2);
	const splices = body.surfaceMesh.userData.footprintSplices;
	expect(Object.keys(splices)).toHaveLength(4);
	expect(Object.values(splices).every((hit) => hit === true)).toBe(true);
});

test("warm-up can compile the footprint variant without pinning or moving the body", () => {
	const body = buildBodyVisual(
		appearanceFor("planet", "footprint-47", 1, false),
		new THREE.SphereGeometry(),
	);
	const base = body.surfaceMesh.material.fragmentShader;
	const undo = body.prewarmFootprint();
	expect(undo).not.toBeNull();
	expect(body.surfaceMesh.material.fragmentShader).toContain(
		"terrainOctaveCap =",
	);
	expect(body.surfaceMesh.userData.surfacePinned).toBe(false);
	undo?.();
	expect(body.surfaceMesh.material.fragmentShader).toBe(base);
	body.setSurfaceClass("desert");
	expect(body.prewarmFootprint()).toBeNull();
});

function renderBodyQualityEvents(transform = (source: string) => source) {
	const bindings = {
		ORIGIN: { x: 0, y: 0, z: 0 },
		SUN_DIR: new THREE.Vector3(),
		camPos: { x: 0, y: 0, z: 0 },
		isMassive,
		layerFor,
		massiveLayerFor,
		scaleFor,
		projectedRadiusPx,
		useHalfResolution,
		bakeFacePxFor,
		BAKE_FACE_SIZES,
		surfacePathFor,
	};
	const js = ts.transpileModule(
		renderStatementSlice("star", "this.world.system.bodies"),
		{ compilerOptions: { target: ts.ScriptTarget.ES2022 } },
	).outputText;
	const update = new Function(...Object.keys(bindings), transform(js));
	const bodies = [
		{ id: "first", kind: "planet", pos: { x: 2, y: 0, z: 0 }, radiusKm: 1 },
		{ id: "second", kind: "moon", pos: { x: 3, y: 0, z: 0 }, radiusKm: 1 },
	] satisfies Pick<Body, "id" | "kind" | "pos" | "radiusKm">[];
	const events: string[] = [];
	const visuals = bodies.map((body) => {
		const visual = buildBodyVisual(
			body.kind === "planet"
				? appearanceFor("planet", "footprint-47", 1, false)
				: appearanceFor("moon", "footprint-47", 1),
			new THREE.SphereGeometry(),
		);
		const setQuality = visual.setDetailQuality;
		visual.setDetailQuality = (quality) => {
			events.push(`${body.id}:quality:${quality}`);
			setQuality(quality);
		};
		const applyBand = visual.applySurfaceBand;
		visual.applySurfaceBand = (band) => {
			events.push(`${body.id}:band:${visual.uniforms.extraOctaveCap.value}`);
			return applyBand(band);
		};
		return visual;
	});
	const subject = {
		world: { system: { bodies }, gameTime: 0 },
		settings: { value: { quality: "low" } },
		meshes: new Map(bodies.map((body) => [body.id, new THREE.Group()])),
		layers: new Map(bodies.map((body) => [body.id, "approach"])),
		bodyVisuals: new Map(bodies.map((body, i) => [body.id, visuals[i]])),
		stationVisuals: new Map(),
		bakeFacePx: new Map(bodies.map((body) => [body.id, BAKE_FACE_SIZES[0]])),
		focalPx: 780,
	};
	const frames: string[][] = [];
	for (const quality of ["low", "high", "low"]) {
		subject.settings.value.quality = quality;
		events.length = 0;
		update.call(subject, ...Object.values(bindings));
		frames.push([...events]);
	}
	return frames;
}

const expectedQualityEvents = ["low", "high", "low"].map((quality) => [
	`first:quality:${quality}`,
	`first:band:${quality === "high" ? 6 : 0}`,
	`second:quality:${quality}`,
	"second:band:0",
]);

test("live render body loop applies current quality to every visual before its surface band", () => {
	expect(renderBodyQualityEvents()).toEqual(expectedQualityEvents);
});

const qualityCall = "visual.setDetailQuality(this.settings.value.quality);";

test.each([
	[
		"after band selection",
		(source: string) => {
			const anchor = "const station = this.stationVisuals.get(body.id);";
			expect(source).toContain(qualityCall);
			expect(source).toContain(anchor);
			return source
				.replace(qualityCall, "")
				.replace(anchor, `${qualityCall}\n${anchor}`);
		},
	],
	[
		"in dead code",
		(source: string) => {
			expect(source).toContain(qualityCall);
			return source.replace(qualityCall, `if (false) { ${qualityCall} }`);
		},
	],
	[
		"for only one body",
		(source: string) => {
			expect(source).toContain(qualityCall);
			return source.replace(
				qualityCall,
				`if (body.id === "first") { ${qualityCall} }`,
			);
		},
	],
] satisfies [string, (source: string) => string][])(
	"quality ordering check rejects a call %s",
	(_, transform) => {
		expect(renderBodyQualityEvents(transform)).not.toEqual(
			expectedQualityEvents,
		);
	},
);
