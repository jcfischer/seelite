/** Node #757. Raw float normal targets bypass lighting, sanitisation and bloom.
 * The legacy 0.0035 taps smooth ridged cusps and narrow coasts: require 95% of
 * relief pixels within 10 degrees, 99% within 16, and every pixel within 30 at
 * 2R. The spacing sweep below isolates that truncation (p95 8.97 -> 0.36 deg
 * on ANGLE Metal/M1 Pro). Steps below 0.0001 lose precision again. At 0.0001
 * require p95 < 0.5 degrees as an independent chain-rule check. Compare only
 * relief pixels, never oceans. Footprint weights are held fixed in both arms.
 * Paired scalar/vector accumulation differs by up to 6.2e-5 in this fixture;
 * height agreement is bounded at 1e-4 of its 0..1 range. No timing claim. */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? "http://localhost:5173",
);
const browser = await launchChromium();
const t = tally();
try {
	const page = await browser.newPage();
	t.watch(page);
	await page.goto(origin);
	const result = await page.evaluate(async () => {
		const THREE = await import("/node_modules/.vite/deps/three.js");
		const { buildBodyVisual } = await import("/src/planet-surface.ts");
		const { appearanceFor } = await import("/src/planet-appearance.ts");
		const { fragmentFor, TERRAN_GRADIENT_SPLICES } = await import(
			"/src/planet-shaders.ts"
		);
		const { makeSplicer } = await import("/src/shader-splice.ts");
		const renderer = new THREE.WebGLRenderer();
		renderer.setSize(640, 400);
		renderer.setClearColor(0, 0);
		if (!renderer.extensions.has("EXT_color_buffer_float"))
			throw new Error("raw normal readback needs EXT_color_buffer_float");
		const target = new THREE.WebGLRenderTarget(640, 400, {
			type: THREE.FloatType,
		});
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(60, 1.6, 0.01, 100);
		const body = buildBodyVisual(
			appearanceFor("planet", "footprint-47", 1, false),
			new THREE.SphereGeometry(1, 96, 64),
		);
		// Isolate the surface, excluding cloud/atmosphere geometry.
		scene.add(body.surfaceMesh);
		body.uniforms.cloudCover.value = 0;
		body.setDetailQuality("high");
		const material = body.surfaceMesh.material;
		const splice = (source, marker, replacement) =>
			makeSplicer("gradient probe").splice(
				"fragment",
				source,
				marker,
				replacement,
			);
		const output = "gl_FragColor = vec4(sane(col), 1.0);";
		const normalSource = (path) =>
			splice(
				fragmentFor("terran", path),
				output,
				"gl_FragColor = vec4(N, all(lessThan(abs(N), vec3(2.0))) && dot(N,N) > 0.99 ? 1.0 : -1.0);",
			);
		const read = (path, cap, source) => {
			body.setSurfacePath(path);
			body.uniforms.extraOctaveCap.value = cap;
			const callback = body.surfaceMesh.onBeforeRender;
			body.surfaceMesh.onBeforeRender = (...args) => {
				callback(...args);
				material.fragmentShader = source;
				material.needsUpdate = true;
			};
			renderer.setRenderTarget(target);
			renderer.render(scene, camera);
			body.surfaceMesh.onBeforeRender = callback;
			const pixels = new Float32Array(640 * 400 * 4);
			renderer.readRenderTargetPixels(target, 0, 0, 640, 400, pixels);
			return pixels;
		};
		const finite = (pixels) => {
			let drawn = 0,
				bad = 0;
			for (let i = 0; i < pixels.length; i += 4) {
				if (pixels[i + 3] === 0) continue;
				drawn++;
				if (
					pixels[i + 3] !== 1 ||
					![...pixels.slice(i, i + 4)].every(Number.isFinite)
				)
					bad++;
			}
			return { drawn, bad };
		};
		const changed = (a, b) =>
			a.reduce(
				(n, v, i) => n + (i % 4 !== 3 && Math.abs(v - b[i]) > 1e-4 ? 1 : 0),
				0,
			);
		const angles = (a, b, flat) => {
			const values = [];
			for (let i = 0; i < a.length; i += 4) {
				if (a[i + 3] !== 1 || b[i + 3] !== 1) continue;
				// Count only pixels that have relief in either arm; oceans cannot
				// inflate agreement by contributing a sea of identical normals.
				if (
					[0, 1, 2].every(
						(k) =>
							Math.abs(a[i + k] - flat[i + k]) < 1e-4 &&
							Math.abs(b[i + k] - flat[i + k]) < 1e-4,
					)
				)
					continue;
				const dot = [0, 1, 2].reduce((n, k) => n + a[i + k] * b[i + k], 0);
				const lengths =
					Math.hypot(...a.slice(i, i + 3)) * Math.hypot(...b.slice(i, i + 3));
				values.push(
					(Math.acos(Math.min(1, Math.max(-1, dot / lengths))) * 180) / Math.PI,
				);
			}
			values.sort((a, b) => a - b);
			return {
				n: values.length,
				p95: values[Math.floor(values.length * 0.95)],
				p99: values[Math.floor(values.length * 0.99)],
				max: values.at(-1),
			};
		};
		camera.position.z = 2;
		const analyticSource = normalSource("analytic-gradient");
		const fourSource = normalSource("four-tap");
		const analytic = read("analytic-gradient", 6, analyticSource);
		const four = read("four-tap", 6, fourSource);
		const flat = read("none", 6, normalSource("none"));
		const fineSource = splice(
			splice(fourSource, "float e = 0.0035;", "float e = 0.0001;"),
			"strength * (dt * t + db * b)",
			"strength * 35.0 * (dt * t + db * b)",
		);
		const fine = read("four-tap", 6, fineSource);
		const convergence = [];
		for (const e of [0.001, 0.00035, 0.0001, 0.000035]) {
			const source = splice(
				splice(fourSource, "float e = 0.0035;", `float e = ${e};`),
				"strength * (dt * t + db * b)",
				`strength * ${(0.0035 / e).toFixed(8)} * (dt * t + db * b)`,
			);
			convergence.push({
				e,
				...angles(analytic, read("four-tap", 6, source), flat),
			});
		}
		// A deliberately missing warp Jacobian must fail the fine-tap gate.
		const wrong = read(
			"analytic-gradient",
			6,
			splice(analyticSource, "0.85 * 1.4 *", "0.0 * 1.4 *"),
		);
		const far = {
			convergence,
			legacy: angles(analytic, four, flat),
			fine: angles(analytic, fine, flat),
			wrong: angles(wrong, fine, flat),
			finite: finite(analytic),
		};
		// Aim the close frame at an actual relief pixel from this same field.
		// A radial camera at +Z happens to see ocean in this seeded fixture.
		let peak = 0,
			at = 0;
		for (let i = 0; i < analytic.length; i += 4) {
			if (analytic[i + 3] !== 1) continue;
			const difference = [0, 1, 2].reduce(
				(n, k) => n + (analytic[i + k] - flat[i + k]) ** 2,
				0,
			);
			if (difference > peak) {
				peak = difference;
				at = i;
			}
		}
		camera.position
			.set(...flat.slice(at, at + 3))
			.normalize()
			.multiplyScalar(1.2);
		camera.lookAt(0, 0, 0);
		const zero = read("analytic-gradient", 0, analyticSource);
		const high = read("analytic-gradient", 6, analyticSource);
		const closeFlat = read("none", 6, normalSource("none"));
		const closeFine = read("four-tap", 6, fineSource);
		const missingExtendedRidge = read(
			"analytic-gradient",
			6,
			splice(
				analyticSource,
				"ridgedFootprintAndGradient(terrainCoordinates(p) * 11.0 + seedOffset, terrainFootprint * 11.0, terrainOctaveCap)",
				"ridgedFootprintAndGradient(terrainCoordinates(p) * 11.0 + seedOffset, terrainFootprint * 11.0, 0.0)",
			),
		);
		// Values must be the scalar field's own, before lighting or quantisation.
		const proofSource = splice(
			fragmentFor("terran", "analytic-gradient"),
			output,
			"gl_FragColor = vec4(abs(heightAndGradient(p).w - height(p)), 0.0, 0.0, 1.0);",
		);
		const valueError = read("analytic-gradient", 6, proofSource);
		let maxValueError = 0;
		for (let i = 0; i < valueError.length; i += 4)
			maxValueError = Math.max(maxValueError, valueError[i]);
		const close = {
			fine: angles(high, closeFine, closeFlat),
			missingExtendedRidge: angles(missingExtendedRidge, closeFine, closeFlat),
			finite: finite(high),
			extended: changed(zero, high),
			relief: changed(high, closeFlat),
			maxValueError,
		};
		body.dispose();
		target.dispose();
		renderer.dispose();
		return { far, close, splices: TERRAN_GRADIENT_SPLICES };
	});
	console.log(JSON.stringify(result));
	t.check(
		"analytic relief splice landed",
		Object.values(result.splices).every(Boolean),
	);
	t.check(
		"2R analytic normals are finite and cover the planet",
		result.far.finite.bad === 0 && result.far.finite.drawn > 10000,
	);
	t.check(
		"2R legacy four-tap agrees within 10 deg p95 / 16 deg p99 / 30 deg max over relief pixels",
		result.far.legacy.n > 1000 &&
			result.far.legacy.p95 < 10 &&
			result.far.legacy.p99 < 16 &&
			result.far.legacy.max < 30,
	);
	t.check(
		"2R fine differences agree within 0.5 deg p95",
		result.far.fine.n > 1000 && result.far.fine.p95 < 0.5,
	);
	t.check(
		"missing warp Jacobian is rejected by the fine comparison",
		result.far.wrong.p95 >= 0.5,
	);
	t.check(
		"1.2R extended normals are finite with relief",
		result.close.finite.bad === 0 &&
			result.close.finite.drawn > 10000 &&
			result.close.relief > 1000,
	);
	t.check(
		"1.2R footprint octaves change the relief normals",
		result.close.extended > 1000,
	);
	t.check(
		"1.2R extended gradient agrees with fine differences within 2 deg p95",
		result.close.fine.n > 1000 && result.close.fine.p95 < 2,
	);
	t.check(
		"omitting extended ridge octaves fails the close gradient comparison",
		result.close.missingExtendedRidge.p95 >= 2,
	);
	t.check(
		"1.2R differentiated and scalar height fields agree within 1e-4",
		Number.isFinite(result.close.maxValueError) &&
			result.close.maxValueError < 1e-4,
	);
} finally {
	await browser.close();
}
t.exit();
