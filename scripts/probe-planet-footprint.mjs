/** Node #755: one-pose cap arms, original-field control, target angle and
 * deterministic pixels. The canonical horizon pairs are evidence for the
 * principal's eye, never an automated verdict about legibility. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gameUrl } from "./lib/game-url.mjs";
import { VIEWS, VIEWPORT, GAME_TIME_S, SEED } from "./lib/view-set.mjs";
import {
	installViewFraming,
	startLoop,
	stopLoop,
} from "./lib/view-placement.mjs";
import { assertHorizonFacts } from "./lib/horizon-framing.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? "http://localhost:5173",
);
// Eye evidence uses the canonical headed hardware lane. The explicit CPU
// portability lane can still run its numeric checks without a display.
const browser = await launchChromium({
	headless: process.env.SEELITE_PROBE_RENDERER !== "hardware",
});
const t = tally();
const out = "view-set/footprint-octaves";
await mkdir(out, { recursive: true });
try {
	const page = await browser.newPage({ viewport: VIEWPORT });
	t.watch(page);
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: SEED }));
	await bootedGame(page);
	await stopLoop(page);
	const caps = await page.evaluate(() => {
		const g = window.__seelite;
		const result = [];
		for (const quality of ["low", "high"]) {
			g.settings.set("quality", quality);
			g.render(0);
			result.push(
				[...g.bodyVisuals.values()].map((v) => ({
					kind: v.surfaceClass(),
					cap: v.uniforms.extraOctaveCap.value,
					splices: v.surfaceMesh.userData.footprintSplices,
				})),
			);
		}
		return result;
	});
	t.check(
		"Low sets every body's extra cap to zero",
		caps[0].every((v) => v.cap === 0),
	);
	t.check(
		"High sets terran to six and all other classes to zero",
		caps[1].some((v) => v.kind === "terran") &&
			caps[1].every((v) => v.cap === (v.kind === "terran" ? 6 : 0)),
	);
	t.check(
		"all four terran field splices landed",
		caps[1]
			.filter((v) => v.kind === "terran")
			.every(
				(v) =>
					Object.keys(v.splices).length === 4 &&
					Object.values(v.splices).every(Boolean),
			),
	);

	// Exercise shipped materials in an isolated, fixed-pose render as well as
	// the game below. This avoids composer dither/bake readiness masking a
	// changed base field, and proves a no-extra footprint with a nonzero cap.
	const rig = await page.evaluate(async () => {
		const THREE = await import("/node_modules/.vite/deps/three.js");
		const { buildBodyVisual } = await import("/src/planet-surface.ts");
		const { appearanceFor } = await import("/src/planet-appearance.ts");
		const { fragmentFor, NOISE_GLSL } = await import("/src/planet-shaders.ts");
		const { CLASS_GLSL } = await import("/src/planet-classes.glsl.ts");
		const { glslFunctionRange } = await import(
			"/scripts/lib/glsl-function.mjs"
		);
		const renderer = new THREE.WebGLRenderer();
		renderer.setSize(720, 450);
		const target = new THREE.WebGLRenderTarget(720, 450);
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(60, 720 / 450, 0.01, 100);
		const visual = buildBodyVisual(
			appearanceFor("planet", "footprint-47", 1, false),
			new THREE.SphereGeometry(1, 96, 64),
		);
		scene.add(visual.group);
		visual.setSurfacePath("screen-space");
		const material = visual.surfaceMesh.material;
		const base = fragmentFor("terran", "screen-space", false);
		const footprint = fragmentFor("terran", "screen-space", true);
		// Force source after the shipped selector: cap zero and distant High
		// normally pick the base program, which would make this comparison inert.
		const read = (cap, source) => {
			visual.uniforms.extraOctaveCap.value = cap;
			const draw = visual.surfaceMesh.onBeforeRender;
			visual.surfaceMesh.onBeforeRender = (...args) => {
				draw(...args);
				if (source && material.fragmentShader !== source) {
					material.fragmentShader = source;
					material.needsUpdate = true;
				}
			};
			renderer.setRenderTarget(target);
			renderer.render(scene, camera);
			visual.surfaceMesh.onBeforeRender = draw;
			const pixels = new Uint8Array(target.width * target.height * 4);
			renderer.readRenderTargetPixels(
				target,
				0,
				0,
				target.width,
				target.height,
				pixels,
			);
			return pixels;
		};
		const diff = (a, b) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
		const results = [];
		for (const r of [1.2, 1.5, 1.9, 1.99, 1.9999, 2, 3, 20]) {
			camera.position.z = r;
			const zero = read(0, footprint),
				high = read(6, footprint),
				repeat = read(6, footprint),
				original = read(0, base);
			results.push({
				r,
				changed: diff(zero, high),
				repeat: diff(high, repeat),
				base: diff(zero, original),
				highBase: diff(high, original),
				lit: high.filter((v, i) => i % 4 !== 3 && v > 0).length,
			});
		}
		// Deliberate defects must move the pixels these gates read. A regression
		// to selecting the base program for both arms would miss both defects.
		camera.position.z = 1.2;
		const zeroFault = diff(
			read(0, base),
			read(
				0,
				footprint.replaceAll(
					"if (weight <= 0.0) break;",
					"if (weight <= 0.0) { s += 0.01; break; }",
				),
			),
		);
		camera.position.z = 2;
		const fadeFault = diff(
			read(0, base),
			read(
				6,
				footprint.replace(
					"smoothstep(1.6, 2.0, cameraR)",
					"smoothstep(1.6, 2.2, cameraR)",
				),
			),
		);
		// Reconstruct the previous shared source by removing only the four new,
		// unreachable helper definitions. Every other class must reproduce it.
		const withoutFootprint = (source) => {
			for (const name of ["fbm3", "fbm4", "fbm5", "ridged"]) {
				const { start, end } = glslFunctionRange(source, `${name}Footprint`);
				source = source.slice(0, start) + source.slice(end);
			}
			return source;
		};
		const classes = [];
		camera.position.z = 1.2;
		for (const kind of Object.keys(CLASS_GLSL)) {
			visual.setSurfaceClass(kind);
			visual.setSurfacePath(kind === "airless" ? "four-tap" : "screen-space");
			const source = fragmentFor(kind, visual.reliefPath(), false);
			const now = read(0, source),
				old = read(0, withoutFootprint(source));
			classes.push({ kind, changed: diff(now, old) });
		}
		visual.setSurfaceClass("terran");
		visual.setSurfacePath("screen-space");
		camera.position.z = 1.2;
		renderer.setRenderTarget(target);
		renderer.render(scene, camera);
		const fullAngle = visual.uniforms.surfacePixelAngle.value;
		target.setSize(360, 225);
		renderer.render(scene, camera);
		const halfAngle = visual.uniforms.surfacePixelAngle.value;
		// Compare helper returns in one shader before lighting, derivatives or
		// framebuffer quantisation can conceal a change to their arithmetic.
		const proof = new THREE.ShaderMaterial({
			vertexShader: "void main() { gl_Position = vec4(position, 1.0); }",
			fragmentShader: `precision highp float; ${NOISE_GLSL}
void main() {
  vec3 p = vec3(gl_FragCoord.xy * 0.173, 17.3);
  vec4 base = vec4(fbm3(p), fbm4(p), fbm5(p), ridged(p));
  vec4 coarse = vec4(fbm3Footprint(p, 1.0, 6.0), fbm4Footprint(p, 1.0, 6.0), fbm5Footprint(p, 1.0, 6.0), ridgedFootprint(p, 1.0, 6.0));
  vec4 zero = vec4(fbm3Footprint(p, 1e-5, 0.0), fbm4Footprint(p, 1e-5, 0.0), fbm5Footprint(p, 1e-5, 0.0), ridgedFootprint(p, 1e-5, 0.0));
  gl_FragColor = vec4(equal(base, coarse)) * vec4(equal(base, zero));
}`,
		});
		const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), proof);
		const proofScene = new THREE.Scene();
		proofScene.add(plane);
		const tiny = new THREE.WebGLRenderTarget(8, 8);
		renderer.setRenderTarget(tiny);
		renderer.render(proofScene, camera);
		const proofPixels = new Uint8Array(8 * 8 * 4);
		renderer.readRenderTargetPixels(tiny, 0, 0, 8, 8, proofPixels);
		const coarse = proofPixels.filter((v) => v !== 255).length;
		plane.geometry.dispose();
		proof.dispose();
		target.dispose();
		tiny.dispose();
		visual.dispose();
		renderer.dispose();
		return {
			results,
			classes,
			coarse,
			fullAngle,
			halfAngle,
			zeroFault,
			fadeFault,
		};
	});
	for (const row of rig.classes)
		t.check(
			`${row.kind}: shared helpers preserve original pixels at cap zero`,
			row.changed === 0,
			JSON.stringify(row),
		);
	for (const row of rig.results) {
		t.check(
			`forced footprint program at cap 0 matches original pixels at ${row.r}R`,
			row.base === 0,
			JSON.stringify(row),
		);
		t.check(
			`fixed seed repeats identically at ${row.r}R`,
			row.repeat === 0 && row.lit > 0,
		);
		t.check(
			`forced High ${row.r <= 1.99 ? "adds detail" : "joins original pixels"} at ${row.r}R`,
			row.r <= 1.99 ? row.changed > 0 : row.highBase === 0,
			JSON.stringify(row),
		);
	}
	t.check(
		"parity detector catches a zero-weight arithmetic defect",
		rig.zeroFault > 0,
		`changed channels: ${rig.zeroFault}`,
	);
	t.check(
		"2R detector catches a fade continuing past 2R",
		rig.fadeFault > 0,
		`changed channels: ${rig.fadeFault}`,
	);
	t.check(
		"coarse footprint with cap six equals original fields",
		rig.coarse === 0,
	);
	t.check(
		"half target uses twice the full-target pixel angle",
		rig.halfAngle === 2 * rig.fullAngle,
	);

	const captures = [];
	for (const name of [
		"planet-fill",
		"planet-terminator",
		"station-horizon",
		"planet-boundary",
	]) {
		const shot = VIEWS.find((v) => v.name === name).shot;
		await startLoop(page);
		await page.evaluate(async (time) => {
			window.__restoreHorizon?.();
			await window.__startClockAt(time);
		}, GAME_TIME_S);
		if (shot.kind === "horizon")
			assertHorizonFacts(
				await page.evaluate((s) => window.__horizonView(s), shot),
				shot,
			);
		else
			await page.evaluate(
				(s) => window.__sunOffset(s.body, s.radii, s.sunAngleDeg),
				shot,
			);
		await stopLoop(page);
		const pair = await page.evaluate(() => {
			const g = window.__seelite;
			const saved = [...g.bodyVisuals.values()].map((v) => [
				v,
				v.setDetailQuality,
			]);
			const draw = (cap) => {
				for (const [v] of saved)
					v.setDetailQuality = () => {
						v.uniforms.extraOctaveCap.value =
							v.surfaceClass() === "terran" ? cap : 0;
					};
				g.render(0);
				const canvas = document.createElement("canvas");
				canvas.width = g.renderer.domElement.width;
				canvas.height = g.renderer.domElement.height;
				const ctx = canvas.getContext("2d");
				ctx.drawImage(g.renderer.domElement, 0, 0);
				return {
					image: canvas.toDataURL("image/png").split(",")[1],
					pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
				};
			};
			try {
				// Warm the bake/surface selector before reading any of the arms.
				for (let i = 0; i < 24; i++) {
					g.stepBakes();
					g.render(0);
				}
				const zero = draw(0),
					control = draw(0),
					high = draw(6),
					repeat = draw(6);
				const delta = (a, b) =>
					a.pixels.reduce((n, v, i) => n + Math.abs(v - b.pixels[i]), 0) /
					a.pixels.length;
				return {
					before: zero.image,
					after: high.image,
					delta: delta(zero, high),
					noise: Math.max(delta(zero, control), delta(high, repeat)),
				};
			} finally {
				for (const [v, fn] of saved) v.setDetailQuality = fn;
			}
		});
		await writeFile(
			join(out, `${name}-before.png`),
			Buffer.from(pair.before, "base64"),
		);
		await writeFile(
			join(out, `${name}-after.png`),
			Buffer.from(pair.after, "base64"),
		);
		const metrics = { name, delta: pair.delta, noise: pair.noise };
		captures.push(metrics);
		t.check(
			`${name} cap pair ${shot.kind === "horizon" ? "clears" : "stays within"} same-build noise`,
			shot.kind === "horizon"
				? pair.delta > pair.noise
				: pair.delta <= pair.noise,
			JSON.stringify(metrics),
		);
	}
	await writeFile(
		join(out, "metrics.json"),
		JSON.stringify({ rig, captures }, null, 2),
	);
	await writeFile(
		join(out, "index.html"),
		`<!doctype html><meta charset="utf-8"><title>Terran footprint octaves</title><style>body{background:#17191d;color:#eee;font:16px system-ui}table{width:100%}td{width:50%}img{width:100%}</style><h1>Terran ground detail</h1><p>High quality, same pose. Left: cap 0 (base fields). Right: cap 6. Click a frame for full size. Principal approval pending.</p><table>${captures.map(({ name }) => `<tr><th colspan="2">${name}</th></tr><tr>${["before", "after"].map((arm) => `<td><a href="${name}-${arm}.png"><img src="${name}-${arm}.png"></a></td>`).join("")}</tr>`).join("")}</table>`,
	);
	console.log(`Review frames: ${out}/index.html`);
} finally {
	await browser.close();
}
t.exit();
