/** Node #755: one-pose cap arms, original-field control, target angle and
 * deterministic pixels, on the ground's four fields and on the weather shell's
 * two (#756). The canonical horizon pairs are evidence for the principal's eye,
 * never an automated verdict about legibility. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gameUrl } from "./lib/game-url.mjs";
import { assertHorizonFacts } from "./lib/horizon-framing.mjs";
import {
	installViewFraming,
	startLoop,
	stopLoop,
} from "./lib/view-placement.mjs";
import { GAME_TIME_S, SEED, VIEWPORT, VIEWS } from "./lib/view-set.mjs";
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
		/**
		 * These rows measure the surface program, so the shells are out of frame.
		 * The weather shell is cap-driven too (#756) and has a rig of its own below;
		 * left in the picture its residual at 1.9999R — where the band's fade leaves
		 * a weight of 2e-4 on a coarse field — reads as the *ground* program failing
		 * to join the original, which is a verdict about the wrong layer.
		 */
		for (const o of visual.group.children)
			if (o.userData.shell) o.visible = false;
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

	/**
	 * Node #756: the same cap arms on the weather shell. The ground is hidden for
	 * these rows so its relief can neither mask a changed cloud field nor stand in
	 * for one — a cap pair whose only moving pixels are the surface's would prove
	 * nothing about the clouds it is named for.
	 */
	const cloudRig = await page.evaluate(async () => {
		const THREE = await import("/node_modules/.vite/deps/three.js");
		const { buildBodyVisual } = await import("/src/planet-surface.ts");
		const { appearanceFor } = await import("/src/planet-appearance.ts");
		const { CLOUD_FRAGMENT } = await import("/src/planet-shaders.ts");
		const { glslFunctionRange } = await import(
			"/scripts/lib/glsl-function.mjs"
		);
		const renderer = new THREE.WebGLRenderer();
		renderer.setSize(720, 450);
		const target = new THREE.WebGLRenderTarget(720, 450);
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(60, 720 / 450, 0.01, 100);
		/**
		 * Reconstruct the pre-#756 shell program from the shipped one: drop the two
		 * new helper definitions and revert the coherent arm's call. The uniform
		 * declarations and the two locals stay, because reverting only the call
		 * leaves them reading them; dead arithmetic moves no pixels. Every replace
		 * below reports whether it landed, since an inert base arm would make every
		 * parity row green by construction.
		 */
		const DETAIL_CALL =
			"cloudFieldFootprint(cloudMotion(p, time), cloudCover, seedOffset, cloudTestDir, cloudFootprint, cloudOctaveCap)";
		const BASE_CALL =
			"cloudField(cloudMotion(p, time), cloudCover, seedOffset, cloudTestDir)";
		let landed = 0;
		const base = (() => {
			let source = CLOUD_FRAGMENT;
			for (const name of [
				"cloudFieldFromInputsFootprint",
				"cloudFieldFootprint",
			]) {
				const { start, end } = glslFunctionRange(source, name);
				source = source.slice(0, start) + source.slice(end);
				landed++;
			}
			const reverted = source.replace(DETAIL_CALL, BASE_CALL);
			if (reverted === source)
				throw new Error("cloud base-arm revert missed the coherent call");
			landed++;
			return reverted;
		})();
		// Deliberate defects in the shipped arm. Each must move the pixels the
		// parity rows read, or those rows cannot see the defect they name.
		const zeroFaultSource = (() => {
			const marker = "if (weight <= 0.0) break;";
			const patched = CLOUD_FRAGMENT.replaceAll(
				marker,
				"if (weight <= 0.0) { s += 0.01; break; }",
			);
			if (patched === CLOUD_FRAGMENT)
				throw new Error("zero-weight defect missed its marker");
			return patched;
		})();
		const fadeFaultSource = (() => {
			const patched = CLOUD_FRAGMENT.replace(
				"smoothstep(1.6, 2.0, cameraR)",
				"smoothstep(1.6, 2.2, cameraR)",
			);
			if (patched === CLOUD_FRAGMENT)
				throw new Error("fade defect missed the shell's own band");
			return patched;
		})();
		/** Terran weather carries the band; a desert dust shell must not. */
		const terran = buildBodyVisual(
			appearanceFor("planet", "footprint-47", 1, false),
			new THREE.SphereGeometry(1, 96, 64),
		);
		const dustLook = appearanceFor("planet", "footprint-dust", 1.6, false);
		/**
		 * A desert carries 0.22 cover, which is thin enough that its alpha rounds to
		 * zero on an 8-bit target: every arm would read zero and the row below would
		 * pass with no dust on screen at all. The rig raises it so the comparison has
		 * pixels to discriminate, and the row prints the figure it measured (#94's
		 * rule: a check whose every arm can read zero is not a check).
		 */
		dustLook.cloudCover = 0.6;
		const dust = buildBodyVisual(dustLook, new THREE.SphereGeometry(1, 96, 64));
		const cloudShell = (visual) =>
			visual.group.children.find((o) => o.userData.shell === "cloud");
		const weather = new Map();
		for (const [name, visual] of [
			["terran", terran],
			["dust", dust],
		]) {
			const shell = cloudShell(visual);
			if (!shell) throw new Error(`${name} body has no weather shell`);
			// Only the weather is in the frame: no ground, no limb.
			visual.surfaceMesh.visible = false;
			for (const o of visual.group.children)
				if (o.userData.shell === "atmosphere") o.visible = false;
			scene.add(visual.group);
			weather.set(name, { visual, shell, material: shell.material });
		}
		const shown = (name) => {
			for (const [key, entry] of weather)
				entry.visual.group.visible = key === name;
		};
		const diff = (a, b) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
		const read = (name, cap, source) => {
			const { visual, material } = weather.get(name);
			shown(name);
			visual.uniforms.extraOctaveCap.value = cap;
			material.fragmentShader = source;
			material.needsUpdate = true;
			renderer.setRenderTarget(target);
			renderer.render(scene, camera);
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
		const results = [];
		for (const r of [1.2, 1.5, 1.9, 1.99, 2, 3, 20]) {
			camera.position.z = r;
			const zero = read("terran", 0, CLOUD_FRAGMENT);
			const high = read("terran", 6, CLOUD_FRAGMENT);
			const repeat = read("terran", 6, CLOUD_FRAGMENT);
			const original = read("terran", 0, base);
			results.push({
				r,
				changed: diff(zero, high),
				repeat: diff(high, repeat),
				base: diff(zero, original),
				highBase: diff(high, original),
				lit: high.filter((v, i) => i % 4 !== 3 && v > 0).length,
			});
		}
		camera.position.z = 1.2;
		const zeroFault = diff(
			read("terran", 0, base),
			read("terran", 0, zeroFaultSource),
		);
		camera.position.z = 2;
		const fadeFault = diff(
			read("terran", 0, base),
			read("terran", 6, fadeFaultSource),
		);
		camera.position.z = 1.2;
		const dustArm = {
			cover: dust.uniforms.cloudCover.value,
			changed: diff(read("dust", 6, CLOUD_FRAGMENT), read("dust", 0, base)),
			repeat: diff(
				read("dust", 6, CLOUD_FRAGMENT),
				read("dust", 6, CLOUD_FRAGMENT),
			),
			lit: read("dust", 6, CLOUD_FRAGMENT).filter(
				(v, i) => i % 4 !== 3 && v > 0,
			).length,
		};
		// The shell's angle follows the target it is drawn into, and its surface
		// sibling is half that size inside the band (#211).
		camera.position.z = 1.2;
		read("terran", 6, CLOUD_FRAGMENT);
		const fullAngle = terran.uniforms.cloudPixelAngle.value;
		target.setSize(360, 225);
		read("terran", 6, CLOUD_FRAGMENT);
		const halfAngle = terran.uniforms.cloudPixelAngle.value;
		const surfaceDrawn = terran.surfaceMesh.visible === false;
		for (const entry of weather.values()) entry.visual.dispose();
		target.dispose();
		renderer.dispose();
		return {
			results,
			dustArm,
			zeroFault,
			fadeFault,
			fullAngle,
			halfAngle,
			surfaceDrawn,
			landed,
		};
	});
	t.check(
		"the cloud base arm was reconstructed, not copied",
		cloudRig.landed === 3,
		`replacements applied: ${cloudRig.landed}`,
	);
	t.check(
		"the weather shell hides the ground it is measured against",
		cloudRig.surfaceDrawn,
	);
	for (const row of cloudRig.results) {
		t.check(
			`clouds: the footprint program at cap 0 matches the base program at ${row.r}R`,
			row.base === 0,
			JSON.stringify(row),
		);
		t.check(
			`clouds: a fixed pose repeats identically at ${row.r}R`,
			row.repeat === 0 && row.lit > 0,
			JSON.stringify(row),
		);
		t.check(
			`clouds: cap six ${row.r <= 1.99 ? "adds detail" : "joins the base program"} at ${row.r}R`,
			row.r <= 1.99 ? row.changed > 0 : row.highBase === 0,
			JSON.stringify(row),
		);
	}
	t.check(
		"clouds: the parity detector catches a zero-weight arithmetic defect",
		cloudRig.zeroFault > 0,
		`changed channels: ${cloudRig.zeroFault}`,
	);
	t.check(
		"clouds: the 2R detector catches a band reaching past 2R",
		cloudRig.fadeFault > 0,
		`changed channels: ${cloudRig.fadeFault}`,
	);
	t.check(
		"the desert dust shell keeps its field whatever the cap says",
		cloudRig.dustArm.changed === 0 &&
			cloudRig.dustArm.repeat === 0 &&
			cloudRig.dustArm.lit > 0,
		JSON.stringify(cloudRig.dustArm),
	);
	t.check(
		"the weather shell halves its pixel angle with its own target",
		cloudRig.halfAngle === 2 * cloudRig.fullAngle && cloudRig.fullAngle > 0,
		JSON.stringify({
			fullAngle: cloudRig.fullAngle,
			halfAngle: cloudRig.halfAngle,
		}),
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

	/**
	 * The shipped frame loop rather than the rig: at the last framing — the 1.2R
	 * boundary — a weather shell is on screen, so its own draw hook has run and the
	 * quality dial reaches it through the one uniform it shares with the ground.
	 */
	const live = await page.evaluate(() => {
		const g = window.__seelite;
		const shells = () =>
			[...g.bodyVisuals.values()].flatMap((v) =>
				v.group.children
					.filter((o) => o.userData.shell === "cloud")
					.map((o) => ({
						kind: v.surfaceClass(),
						cap: v.uniforms.extraOctaveCap.value,
						shared:
							o.material.uniforms.extraOctaveCap === v.uniforms.extraOctaveCap,
						angle: v.uniforms.cloudPixelAngle.value,
					})),
			);
		const arms = [];
		for (const quality of ["low", "high"]) {
			g.settings.set("quality", quality);
			g.render(0);
			g.render(0);
			arms.push(shells());
		}
		g.settings.set("quality", "high");
		return arms;
	});
	t.check(
		"every weather shell reads the body's quality cap through one uniform",
		live.flat().length > 0 && live.every((arm) => arm.every((s) => s.shared)),
		JSON.stringify(live[0]),
	);
	t.check(
		"Low quality leaves every weather shell's extra cap at zero",
		live[0].every((s) => s.cap === 0),
		JSON.stringify(live[0]),
	);
	t.check(
		"High quality puts six extra octaves on the terran shell it draws",
		live[1].some((s) => s.kind === "terran" && s.cap === 6) &&
			live[1].every((s) => s.cap === (s.kind === "terran" ? 6 : 0)),
		JSON.stringify(live[1]),
	);
	t.check(
		"a shell drawn in the live frame priced its own target pixel angle",
		live.flat().some((s) => s.angle > 0),
		JSON.stringify(live[1].map((s) => s.angle)),
	);
	await writeFile(
		join(out, "metrics.json"),
		JSON.stringify({ rig, cloudRig, live, captures }, null, 2),
	);
	await writeFile(
		join(out, "index.html"),
		`<!doctype html><meta charset="utf-8"><title>Terran footprint octaves</title><style>body{background:#17191d;color:#eee;font:16px system-ui}table{width:100%}td{width:50%}img{width:100%}</style><h1>Terran ground detail and clouds</h1><p>High quality, same pose. Left: cap 0 (base fields). Right: cap 6, which extends the ground's continent, mountain, moisture and cap-edge fields <em>and</em> the weather shell's broad and wisp fields (#755, #756). Cloud edges and wisps are the half only node #756 changes; judge them where the station's sky meets the horizon. Click a frame for full size. Principal approval pending.</p><table>${captures.map(({ name }) => `<tr><th colspan="2">${name}</th></tr><tr>${["before", "after"].map((arm) => `<td><a href="${name}-${arm}.png"><img src="${name}-${arm}.png"></a></td>`).join("")}</tr>`).join("")}</table>`,
	);
	console.log(`Review frames: ${out}/index.html`);
} finally {
	await browser.close();
}
t.exit();
