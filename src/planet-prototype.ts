/**
 * Visual study for node #54: what makes a body read as a *kind* of world.
 *
 * `?planet-prototype` shows every class at once, which is the only view that
 * answers the node's actual question — whether they read as distinct. Adding a
 * class name (`?planet-prototype=lava`) opens that one alone, draggable.
 *
 * **Disposable.** This is a reference the implementation task reads, not the
 * game renderer. What is *not* disposable is `planet-appearance.ts`: the class
 * ladder it computes is the contract this prototype is drawing, and the
 * implementation should keep it and throw this away.
 */
import * as THREE from "three";
import { CLASS_GLSL, RELIEF } from "./planet-classes.glsl";
import {
	LIGHT_GLSL,
	NOISE_GLSL,
	SURFACE_VERTEX,
	VARYINGS_GLSL,
} from "./planet-shaders";
import {
	type PlanetAppearance,
	type SurfaceClass,
	appearanceFor,
} from "./planet-appearance";

/**
 * `[id, warmth, giant, note]`, in ladder order: hottest rocky world to coldest,
 * then the giants, then a moon and a star. `warmth` is `a/a_hab` — the same
 * number the generator already has — and every row's class is whatever
 * `appearanceFor` returns for it, so the gallery cannot drift from the
 * classifier.
 */
const ROWS: [string, number, boolean, string][] = [
	["planet-0", 0.28, false, "a ≈ 0.3 a_hab"],
	["planet-1", 0.62, false, "a ≈ 0.6 a_hab"],
	["planet-2", 1.0, false, "a ≈ a_hab"],
	["planet-3", 1.6, false, "a ≈ 1.6 a_hab"],
	["planet-4", 3.4, false, "cold, and still rocky"],
	["planet-5", 3.0, true, "a > 2 a_hab"],
	// planet-7 rather than any ice giant: rings fall to three giants in eight,
	// and a gallery that exists to show what each class *can* look like should
	// draw the ring shader rather than leave it to chance on whichever id.
	["planet-7", 7.5, true, "a > 5 a_hab, ringed"],
];

interface GalleryEntry {
	kind: "star" | "planet" | "moon";
	id: string;
	warmth: number;
	giant: boolean;
	note: string;
}

const GALLERY: GalleryEntry[] = [
	...ROWS.map(([id, warmth, giant, note]) => ({
		kind: "planet" as const,
		id,
		warmth,
		giant,
		note,
	})),
	{
		kind: "moon",
		id: "planet-5-moon-0",
		warmth: 3.0,
		giant: false,
		note: "any orbit",
	},
	{ kind: "star", id: "star", warmth: 0, giant: false, note: "class G" },
];

/**
 * A rocky body past the desert rung is an ice world; a gas giant is at the same
 * distance. `system.ts` separates them with `isGasGiant`, and so does the
 * gallery — stated per entry rather than guessed from the orbit, because the
 * whole point is that one number does *not* decide it on its own.
 */
const describe = (entry: GalleryEntry) => {
	if (entry.kind === "star") return appearanceFor("star", entry.id);
	if (entry.kind === "moon")
		return appearanceFor("moon", entry.id, entry.warmth);
	return appearanceFor("planet", entry.id, entry.warmth, entry.giant);
};

const LABEL: Record<SurfaceClass, string> = {
	lava: "Lava — molten crust",
	venusian: "Venusian — closed deck",
	terran: "Terran — ocean and continent",
	desert: "Desert — oxidised regolith",
	ice: "Ice — frozen ocean",
	jovian: "Jovian — belts and a storm",
	iceGiant: "Ice giant — methane haze",
	airless: "Airless — cratered moon",
	star: "Star — photosphere",
};

/**
 * Assemble one class's fragment shader.
 *
 * The order is load-bearing: `reliefNormal` calls `height`, which the class body
 * defines *after* it, so a prototype declaration goes in between. GLSL allows
 * this and it is the only way to keep the relief code shared rather than pasted
 * into all six classes that use it.
 */
function fragmentFor(surface: SurfaceClass): string {
	return /* glsl */ `
precision highp float;
${VARYINGS_GLSL}
${NOISE_GLSL}
${LIGHT_GLSL}
float height(vec3 p);
${RELIEF}
${CLASS_GLSL[surface]}
void main() {
  vec3 p = normalize(vObjP);
  vec3 N = normalize(vWorldN);
  vec3 V = normalize(cameraPosition - vWorldP);

  vec3  albedo = vec3(0.5);
  vec3  emissive = vec3(0.0);
  float specPower = 0.0, specMask = 0.0;
  surface(p, albedo, N, emissive, specPower, specMask);

  vec3 col = shade(albedo, N, V);
  if (specPower > 0.0) col += sunColor * specular(N, V, specPower) * specMask;
  col += emissive;
  gl_FragColor = vec4(col, 1.0);
}
`;
}

/**
 * The shell around a body with air.
 *
 * Three things the old version got wrong. The rim was lit uniformly, so a
 * crescent planet wore a full halo and the terminator vanished into it — here
 * the glow is gated by the sun. There was no forward scattering, so the bright
 * arc that appears when you look *past* a planet at its star was missing. And
 * the colour was one uniform: a real limb reddens as the path length through it
 * grows, which is why the sunset term is separate.
 */
const ATMOSPHERE_FRAGMENT = /* glsl */ `
precision highp float;
${VARYINGS_GLSL}
uniform vec3  sunDir;
uniform vec3  atmoColor;
uniform float atmoStrength;
void main() {
  vec3 N = normalize(vWorldN);
  vec3 V = normalize(cameraPosition - vWorldP);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.2);
  // Only the lit limb glows, and it fades through the terminator rather than
  // stopping at it.
  float day = smoothstep(-0.45, 0.30, dot(N, sunDir));
  // Forward scattering: looking towards the star through the shell.
  float forward = pow(max(dot(V, -sunDir), 0.0), 5.0);
  // Longer path at grazing angles scatters out the blue first.
  vec3 sunset = mix(atmoColor, atmoColor * vec3(1.5, 0.75, 0.42), rim * 0.8);
  gl_FragColor = vec4(sunset * (0.55 + 2.2 * forward) * day,
                      rim * day * atmoStrength);
}
`;

/**
 * The weather shell, for the classes that have weather separate from the ground.
 *
 * Kept as its own mesh rather than a term in the surface shader for one reason:
 * clouds are at a different altitude, so they cast onto a different part of the
 * disc and they cross the terminator before the ground does. Painting them into
 * the surface loses both, and loses the parallax that sells the gap.
 */
const CLOUD_FRAGMENT = /* glsl */ `
precision highp float;
${VARYINGS_GLSL}
${NOISE_GLSL}
${LIGHT_GLSL}
uniform float time;
uniform float cloudCover;
uniform float seedOffset;
uniform vec3  cloudTint;
void main() {
  vec3 p = normalize(vObjP);
  // Two rates: the deck drifts and the detail shears across it, which reads as
  // one system moving rather than a texture sliding.
  vec3 slow = p + vec3(time * 0.0030, 0.0, 0.0) + seedOffset;
  vec3 fast = p + vec3(time * 0.0068, 0.0, time * 0.0011) + seedOffset;
  float broad = fbm4(warp(slow * 2.3, 1.1, 0.75));
  float wisp  = fbm5(fast * 8.5);

  // Weather is banded on a rotating world: wet at the equator, dry in the horse
  // latitudes, wet again at the polar front. Uniform coverage looks like fog.
  float lat = abs(p.y);
  float zonal = 0.58 + 0.42 * cos(lat * 8.2 + 0.4);

  float field = broad * 0.68 + wisp * 0.32;
  float mask = smoothstep(0.54 - cloudCover * 0.16, 0.56 + 0.10, field) * zonal;

  vec3 N = normalize(vWorldN);
  vec3 V = normalize(cameraPosition - vWorldP);
  // Same lighting as the ground, so the cloud terminator lines up with it.
  float lit = wrappedDiffuse(N);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.2);
  gl_FragColor = vec4(cloudTint * (lit * 1.30 * sunColor + 0.025),
                      clamp(mask, 0.0, 1.0) * (0.62 + 0.30 * rim));
}
`;

/** A ring plane: banded opacity, plus the planet's own shadow across it. */
const RING_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vRing;
varying vec3 vWorldP;
${NOISE_GLSL}
uniform vec3  sunDir;
uniform float innerR;
uniform float outerR;
uniform float seedOffset;
void main() {
  float r = length(vRing);
  if (r < innerR || r > outerR) discard;
  float t = (r - innerR) / (outerR - innerR);

  // Gaps are resonances, so they are narrow and sharp; the material between
  // them varies smoothly. One field for each.
  float grain = fbm4(vec3(t * 34.0 + seedOffset, 2.3, 7.1));
  float gap   = smoothstep(0.02, 0.0, abs(fbm3(vec3(t * 7.0 + seedOffset, 5.0, 1.0)) - 0.5));
  float density = grain * (1.0 - gap) * smoothstep(0.0, 0.10, t) * smoothstep(1.0, 0.86, t);

  // The planet sits at the origin of the ring's own frame, so anything whose
  // perpendicular distance from the sun line is under one radius is eclipsed.
  vec3 toBody = -vWorldP;
  float along = dot(toBody, sunDir);
  float perp  = length(toBody - sunDir * along);
  float shadow = (along < 0.0) ? 1.0 : smoothstep(0.94, 1.10, perp);

  vec3 ice = mix(vec3(0.30, 0.27, 0.23), vec3(0.55, 0.52, 0.47), grain);
  gl_FragColor = vec4(ice * (0.25 + 0.75 * shadow), density * 0.85);
}
`;

const RING_VERTEX = /* glsl */ `
varying vec2 vRing;
varying vec3 vWorldP;
void main() {
  vRing = position.xy;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldP = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** Sun 51 degrees off the view axis: far enough that every body has a
 *  terminator, near enough that the gallery is not half in shadow. The old
 *  prototype put it at 0 degrees, which is a camera flash — no terminator
 *  anywhere, and a specular blob in the middle of every disc. */
const SUN_DIRECTION = new THREE.Vector3(0.62, 0.3, 0.55).normalize();

interface Body {
	group: THREE.Group;
	uniforms: Record<string, THREE.IUniform>;
	surface: SurfaceClass;
}

/** The page's own chrome. A module constant so the mount reads as scene setup. */
const PROTOTYPE_CSS = `
#planet-prototype{position:fixed;inset:0;background:#01030a;color:#dceeff;
  font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;z-index:20}
#planet-prototype canvas{width:100%;height:100%;display:block}
.pp-head{position:fixed;top:14px;left:0;right:0;text-align:center;pointer-events:none}
.pp-head b{color:#f6c878;letter-spacing:.08em}
.pp-head p{margin:.35em 0 0;color:#8fa8bf}
.pp-caption{position:absolute;transform:translate(-50%,0);text-align:center;
  pointer-events:none;text-shadow:0 1px 4px #000;white-space:nowrap}
.pp-caption b{display:block;color:#e7f4ff}
.pp-caption span{color:#7f95ab;font-size:11px}
.pp-stats{position:fixed;bottom:16px;right:20px;color:#7f95ab;text-align:right}
.pp-stats b{color:#9fe8b0}`;

/**
 * Build one body: its surface, and whichever shells its class earns.
 *
 * Every shell shares the body's single uniform object, so the cloud deck, the
 * atmosphere and the rings all see the same sun and the same clock without any
 * of them being told about it separately.
 */
/** The cloud shell is the same radius on every body that has one, so it is one
 *  geometry rather than one per body. The atmosphere shell's radius varies with
 *  optical depth, so that one genuinely cannot be shared. */
const CLOUD_GEOMETRY = new THREE.SphereGeometry(1.014, 128, 84);

function buildBody(look: PlanetAppearance, sphere: THREE.SphereGeometry): Body {
	const uniforms: Record<string, THREE.IUniform> = {
		time: { value: 0 },
		sunDir: { value: SUN_DIRECTION },
		sunColor: { value: new THREE.Color(1.0, 0.97, 0.92) },
		// A thick atmosphere carries light well past the geometric terminator;
		// an airless body does not carry it at all.
		wrapAmount: { value: look.atmosphere * 0.32 },
		seedOffset: { value: (look.seed % 997) / 97 },
		warmth: { value: look.warmth },
		seaLevel: { value: look.seaLevel },
		starTint: { value: new THREE.Color(0xfff4ea) },
		atmoColor: { value: new THREE.Color(look.atmosphereColor) },
		atmoStrength: { value: look.atmosphere },
		cloudCover: { value: look.cloudCover },
		// Water cloud is neutral; a dust haze is the colour of the ground it
		// was lifted from.
		cloudTint: {
			value: new THREE.Color(look.surface === "desert" ? 0xb08a62 : 0xdfe8f0),
		},
		innerR: { value: 1.35 },
		outerR: { value: 2.3 },
	};

	const group = new THREE.Group();
	const planet = new THREE.Mesh(
		sphere,
		new THREE.ShaderMaterial({
			uniforms,
			vertexShader: SURFACE_VERTEX,
			fragmentShader: fragmentFor(look.surface),
		}),
	);
	group.add(planet);

	if (look.cloudCover > 0) {
		group.add(
			new THREE.Mesh(
				CLOUD_GEOMETRY,
				new THREE.ShaderMaterial({
					uniforms,
					transparent: true,
					depthWrite: false,
					vertexShader: SURFACE_VERTEX,
					fragmentShader: CLOUD_FRAGMENT,
				}),
			),
		);
	}
	if (look.atmosphere > 0) {
		// Back faces only, additively: the shell is a volume seen from outside,
		// and drawing its front faces would put a wash over the whole disc.
		group.add(
			new THREE.Mesh(
				new THREE.SphereGeometry(1.03 + look.atmosphere * 0.025, 96, 64),
				new THREE.ShaderMaterial({
					uniforms,
					transparent: true,
					depthWrite: false,
					side: THREE.BackSide,
					blending: THREE.AdditiveBlending,
					vertexShader: SURFACE_VERTEX,
					fragmentShader: ATMOSPHERE_FRAGMENT,
				}),
			),
		);
	}
	if (look.hasRings) {
		const ring = new THREE.Mesh(
			new THREE.PlaneGeometry(4.8, 4.8, 1, 1),
			new THREE.ShaderMaterial({
				uniforms,
				transparent: true,
				depthWrite: false,
				side: THREE.DoubleSide,
				vertexShader: RING_VERTEX,
				fragmentShader: RING_FRAGMENT,
			}),
		);
		ring.rotation.x = Math.PI / 2 - 0.32;
		group.add(ring);
	}
	if (look.surface === "star") {
		// A corona sprite rather than a shader shell: the glow is unbounded and
		// a sphere would cut it off at a radius the star does not have.
		const corona = new THREE.Sprite(
			new THREE.SpriteMaterial({
				color: 0xffd9a8,
				transparent: true,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				opacity: 0.55,
				map: coronaTexture(),
			}),
		);
		corona.scale.setScalar(5.2);
		group.add(corona);
	}

	group.rotation.z = 0.18;
	return { group, uniforms, surface: look.surface };
}

/**
 * Drag-to-rotate.
 *
 * Returns the live angles rather than taking a callback: the render loop reads
 * them every frame anyway, and a probe needs to write them, so one mutable
 * object is both the output and the handle.
 */
function installDragControls(canvas: HTMLCanvasElement) {
	const view = { spin: 0, tilt: 0 };
	let dragging = false;
	let lastX = 0;
	let lastY = 0;
	canvas.style.cursor = "grab";
	canvas.addEventListener("pointerdown", (event) => {
		dragging = true;
		lastX = event.clientX;
		lastY = event.clientY;
		canvas.setPointerCapture(event.pointerId);
	});
	canvas.addEventListener("pointermove", (event) => {
		if (!dragging) return;
		view.spin += (event.clientX - lastX) * 0.007;
		view.tilt = THREE.MathUtils.clamp(
			view.tilt + (event.clientY - lastY) * 0.007,
			-1.2,
			1.2,
		);
		lastX = event.clientX;
		lastY = event.clientY;
	});
	canvas.addEventListener("pointerup", () => {
		dragging = false;
	});
	return view;
}

/**
 * Rec. 709 relative luminance, on raw framebuffer bytes.
 *
 * Published on the probe handle so the probe does not carry its own copy: the
 * `sd` returned by `samplePatches` is computed with these coefficients, and a
 * probe comparing that deviation against luminances of its own would be
 * comparing two different quantities the moment either side changed.
 */
export const LUMA_COEFFICIENTS: [number, number, number] = [
	0.2126, 0.7152, 0.0722,
];
const luma = (r: number, g: number, b: number) =>
	LUMA_COEFFICIENTS[0] * r +
	LUMA_COEFFICIENTS[1] * g +
	LUMA_COEFFICIENTS[2] * b;

/** Rolling mean, used for both the on-screen readout and the probe handle. */
const mean = (values: number[]) =>
	values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

/** Scratch vectors, module-level and reused. Projecting nine captions per stats
 *  tick and five vectors per sampled patch made garbage proportional to how hard
 *  the page was being measured. */
const scratchSize = new THREE.Vector2();
const scratchCentre = new THREE.Vector3();
const scratchAxis = new THREE.Vector3();
const scratchEdge = new THREE.Vector3();

/** Header, per-body captions, and the stats readout. DOM only. */
function buildChrome(
	root: HTMLElement,
	shown: GalleryEntry[],
	looks: PlanetAppearance[],
	single: boolean,
) {
	const head = document.createElement("div");
	head.className = "pp-head";
	head.innerHTML = single
		? `<b>${LABEL[looks[0].surface].toUpperCase()}</b><p>Drag to rotate. Sun is 51° off the view axis, so the terminator is real.</p>`
		: "<b>PLANET CLASS GALLERY — NODE 54</b><p>Class is read off <code>a/a_hab</code>, the orbit ratio the generator already computes. The seed only picks continents, craters and storms <em>within</em> a class.</p>";
	root.append(head);

	// Captions are DOM, projected from each body's world position every frame:
	// text in the scene would need a font atlas, and this prototype exists to
	// judge surfaces, not typography.
	const captions = shown.map((entry, i) => {
		const el = document.createElement("div");
		el.className = "pp-caption";
		el.innerHTML = `<b>${LABEL[looks[i].surface]}</b><span>${entry.note}</span>`;
		root.append(el);
		return el;
	});

	const stats = document.createElement("div");
	stats.className = "pp-stats";
	root.append(stats);
	return { head, captions, stats };
}

/**
 * Publish `window.__seelitePlanets` — everything `probe-planets.mjs` reads.
 *
 * Out of the mount because it is a self-contained surface over the renderer,
 * the camera and the body list, and because keeping the measurement code in one
 * place is what makes it reviewable as measurement rather than as scene setup.
 */
function installProbeSurface(ctx: {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	bodies: Body[];
	looks: PlanetAppearance[];
	frameStats: { meanMs: () => number; count: () => number };
	view: { spin: number; tilt: number };
}) {
	const { renderer, scene, camera, bodies, looks, frameStats, view } = ctx;

	/**
	 * One body's screen centre and radius, in drawing-buffer pixels.
	 *
	 * The radius is measured along **both** axes rather than measured on x and
	 * reused: NDC is square while the buffer usually is not, so one radius in
	 * pixels is a different NDC span horizontally and vertically. Getting this
	 * wrong tilts every sampled bearing on a non-square viewport, which is
	 * exactly the case a probe running at some other resolution would hit.
	 */
	const discOf = (index: number) => {
		const buffer = renderer.getDrawingBufferSize(scratchSize);
		const origin = bodies[index].group.position;
		const centre = scratchCentre.copy(origin).project(camera);
		const cx = centre.x;
		const cy = centre.y;
		scratchAxis.setFromMatrixColumn(camera.matrixWorld, 0);
		const edgeX = scratchEdge.copy(origin).add(scratchAxis).project(camera).x;
		scratchAxis.setFromMatrixColumn(camera.matrixWorld, 1);
		const edgeY = scratchEdge.copy(origin).add(scratchAxis).project(camera).y;
		return {
			bufferX: buffer.x,
			bufferY: buffer.y,
			x: (cx * 0.5 + 0.5) * buffer.x,
			y: (cy * 0.5 + 0.5) * buffer.y,
			// Pixels per unit sphere radius, per axis.
			radiusX: Math.abs(edgeX - cx) * 0.5 * buffer.x,
			radiusY: Math.abs(edgeY - cy) * 0.5 * buffer.y,
		};
	};

	/**
	 * Read many patches on one body's disc — mean colour, and how much each
	 * varies — from a **single** rendered frame.
	 *
	 * `u` and `v` are offsets from the body's centre in units of its own screen
	 * radius, so a probe can say "three quarters of a radius towards the sun"
	 * without knowing the framing. Positive `u` is screen-right, positive `v` is
	 * screen-up.
	 *
	 * `sd` is the standard deviation of luminance inside the patch, and it is
	 * here because mean colour alone does not answer "do these two worlds look
	 * different". Two classes can share a mean and differ entirely in structure —
	 * bands against smooth haze — and a distinctness check with no texture term
	 * would have nothing to say about it.
	 *
	 * Batched rather than one call per patch: the render is the expensive part,
	 * and the sea-level sweep reads ~37 patches at each of five sea levels. One
	 * render per *set* is four full renders instead of about 185.
	 */
	const samplePatches = (
		index: number,
		cells: [number, number][],
		halfFrac: number,
	) => {
		// The render happens here, immediately before the reads: the default
		// framebuffer is not preserved between frames, so a `readPixels` in any
		// other task returns whatever the compositor left behind.
		renderer.render(scene, camera);
		const gl = renderer.getContext();
		const disc = discOf(index);
		const half = Math.max(2, Math.round(halfFrac * disc.radiusX));

		return cells.map(([u, v]) => {
			const cx = Math.round(disc.x + u * disc.radiusX);
			// readPixels counts rows from the bottom, and so does NDC y.
			const cy = Math.round(disc.y + v * disc.radiusY);
			// Clamp to the buffer. WebGL zero-fills anything outside it, which
			// would silently darken the mean and inflate the deviation rather than
			// failing — the worst way for a measurement to be wrong.
			const x0 = Math.max(0, cx - half);
			const y0 = Math.max(0, cy - half);
			const x1 = Math.min(disc.bufferX, cx + half);
			const y1 = Math.min(disc.bufferY, cy + half);
			const w = Math.max(0, x1 - x0);
			const h = Math.max(0, y1 - y0);
			if (w === 0 || h === 0)
				return { rgb: [0, 0, 0] as [number, number, number], sd: 0, pixels: 0 };

			const pixels = new Uint8Array(w * h * 4);
			gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			let r = 0;
			let g = 0;
			let b = 0;
			let lumaSum = 0;
			let lumaSq = 0;
			const n = w * h;
			for (let i = 0; i < pixels.length; i += 4) {
				r += pixels[i];
				g += pixels[i + 1];
				b += pixels[i + 2];
				const y = luma(pixels[i], pixels[i + 1], pixels[i + 2]);
				lumaSum += y;
				lumaSq += y * y;
			}
			const patchMean = lumaSum / n;
			return {
				rgb: [r / n, g / n, b / n] as [number, number, number],
				sd: Math.sqrt(Math.max(0, lumaSq / n - patchMean * patchMean)),
				pixels: n,
			};
		});
	};

	/**
	 * The render cost of one frame, with the display's cadence taken out of it.
	 *
	 * A mean of `requestAnimationFrame` deltas cannot report anything faster than
	 * the refresh interval, so on a 60 Hz display it bottoms out at 16.7 ms
	 * whatever the shaders cost — a measure of the monitor, not of the work. This
	 * renders back to back outside that cadence instead.
	 *
	 * **The fence is a readPixels, not finish().** gl.finish() is specified to
	 * block until the queue drains, but through a headless browser's GPU queue
	 * it returns immediately, and the loop then measures the time to
	 * *enqueue* nine shaders, which is approximately zero. readPixels has to hand
	 * back real bytes, so it cannot return before the frame has been rasterised.
	 * Measured: finish() reported 0.0 ms against an observed 76.9 ms rAF cadence
	 * for the same scene.
	 */
	const measureRenderMs = (samples = 20) => {
		const gl = renderer.getContext();
		const fence = new Uint8Array(4);
		const sync = () =>
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, fence);
		// One warm-up render, so shader compilation and buffer upload are not
		// charged to the first sample.
		renderer.render(scene, camera);
		sync();
		const started = performance.now();
		for (let i = 0; i < samples; i++) {
			renderer.render(scene, camera);
			// Per iteration rather than once at the end: the driver is free to
			// pipeline a batch of identical frames, and a single trailing fence
			// would measure the last one plus whatever overlapped.
			sync();
		}
		return (performance.now() - started) / samples;
	};

	(window as unknown as Record<string, unknown>).__seelitePlanets = {
		classes: bodies.map((b) => b.surface),
		// The very coefficients `samplePatches` uses for `sd`. Handed over as
		// numbers rather than as a function so the probe can apply them
		// synchronously in its own loops, while this file stays the one place
		// they are written down.
		lumaCoefficients: LUMA_COEFFICIENTS,
		// How far light wraps past the geometric terminator, and the optical depth
		// of the shell around each body. The terminator check reads the second:
		// how sharp a terminator *should* be is a property of the atmosphere, not
		// a constant.
		wrapAmount: bodies.map((b) => b.uniforms.wrapAmount.value as number),
		atmosphere: looks.map((look) => look.atmosphere),
		seaLevel: looks.map((look) => look.seaLevel),
		cloudCover: looks.map((look) => look.cloudCover),
		// The display cadence. Reported *next to* measureRenderMs, never instead
		// of it — see the note there.
		meanFrameMs: frameStats.meanMs,
		frameCount: frameStats.count,
		samplePatches,
		/** One patch. The batch form is the primitive; this is the convenience. */
		samplePatch: (index: number, u: number, v: number, halfFrac: number) =>
			samplePatches(index, [[u, v]], halfFrac)[0],
		measureRenderMs,
		bufferSize: () => {
			const size = renderer.getDrawingBufferSize(scratchSize);
			return [size.x, size.y];
		},
		/**
		 * Override one body's sea level.
		 *
		 * Here so a probe can show that sea level *controls* the flooded fraction
		 * rather than asserting it does. Display-only, like everything else on
		 * this handle — the classifier is untouched.
		 */
		setSeaLevel: (index: number, level: number) => {
			bodies[index].uniforms.seaLevel.value = level;
		},
		setView: (spin: number, tilt: number) => {
			view.spin = spin;
			view.tilt = tilt;
		},
	};
}

export function mountPlanetPrototype(): void {
	const query = new URLSearchParams(location.search).get("planet-prototype");
	const single = GALLERY.find((entry) => describe(entry).surface === query);
	// A typo silently falling back to the gallery is a bad way to spend five
	// minutes wondering why `?planet-prototype=terrain` shows nine planets.
	if (query && !single) {
		console.warn(
			`planet-prototype: no class named "${query}". Valid: ${GALLERY.map(
				(entry) => describe(entry).surface,
			).join(", ")}`,
		);
	}

	const root = document.createElement("section");
	root.id = "planet-prototype";
	document.body.append(root);
	const style = document.createElement("style");
	style.textContent = PROTOTYPE_CSS;
	document.head.append(style);

	const renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	// The lava world and the star are authored above 1.0 so a bloom pass has
	// something to catch; without a tone map they would clip to flat white.
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.15;
	root.append(renderer.domElement);

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
	const shown = single ? [single] : GALLERY;
	// Classified once. `describe` is pure, so five call sites were only waste —
	// but five call sites are also five places to drift if its arguments change.
	const looks = shown.map(describe);
	const columns = single ? 1 : 3;
	const rows = Math.ceil(shown.length / columns);
	const SPACING = 2.7;

	const sphere = new THREE.SphereGeometry(1, 144, 96);

	const bodies: Body[] = looks.map((look, i) => {
		const body = buildBody(look, sphere);
		if (!single) {
			body.group.position.set(
				((i % columns) - (columns - 1) / 2) * SPACING,
				((rows - 1) / 2 - Math.floor(i / columns)) * SPACING - 0.15,
				0,
			);
		}
		scene.add(body.group);
		return body;
	});

	camera.position.z = single ? 3.1 : 12.6;

	const { captions, stats } = buildChrome(root, shown, looks, Boolean(single));

	const view = installDragControls(renderer.domElement);

	const resize = () => {
		renderer.setSize(innerWidth, innerHeight);
		camera.aspect = innerWidth / innerHeight;
		camera.updateProjectionMatrix();
	};
	addEventListener("resize", resize);
	resize();

	// A rolling mean over the last 60 frames. Node 54 asks for a performance
	// budget, and a budget needs a number measured on the worst case — which is
	// the gallery, nine shaders on screen at once.
	const frames: number[] = [];
	// Seeded off-view so the first frame writes the rotations once.
	let lastSpin = Number.NaN;
	let lastTilt = Number.NaN;
	let last = performance.now();
	const clock = new THREE.Clock();
	let frameCount = 0;

	const loop = () => {
		const now = performance.now();
		frames.push(now - last);
		if (frames.length > 60) frames.shift();
		last = now;
		frameCount++;

		const elapsed = clock.getElapsedTime();
		// Rotations only when the view actually moved: each write dirties a matrix
		// on nine groups, and the view is static except while someone is dragging.
		// `time` is the only uniform that genuinely varies every frame.
		const moved = view.spin !== lastSpin || view.tilt !== lastTilt;
		for (const body of bodies) {
			body.uniforms.time.value = elapsed;
			if (moved) {
				body.group.rotation.y = view.spin;
				body.group.rotation.x = view.tilt;
			}
		}
		lastSpin = view.spin;
		lastTilt = view.tilt;
		renderer.render(scene, camera);

		if (frameCount % 15 === 0) {
			const size = renderer.getSize(scratchSize);
			stats.innerHTML = `<b>${mean(frames).toFixed(1)} ms</b> / frame &nbsp; ${bodies.length} ${bodies.length === 1 ? "body" : "bodies"} &nbsp; ${size.x}×${size.y}`;
			for (let i = 0; i < captions.length; i++) {
				const world = scratchCentre
					.copy(bodies[i].group.position)
					.project(camera);
				captions[i].style.left = `${((world.x + 1) / 2) * size.x}px`;
				captions[i].style.top =
					`${((1 - world.y) / 2) * size.y + (single ? 330 : 156)}px`;
			}
		}
		requestAnimationFrame(loop);
	};
	loop();

	installProbeSurface({
		renderer,
		scene,
		camera,
		bodies,
		looks,
		frameStats: { meanMs: () => mean(frames), count: () => frameCount },
		view,
	});
}

/** A radial falloff, drawn once into a canvas. No asset, no request. */
function coronaTexture(): THREE.Texture {
	const size = 128;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no 2d context for the corona");
	const gradient = ctx.createRadialGradient(
		size / 2,
		size / 2,
		size * 0.16,
		size / 2,
		size / 2,
		size / 2,
	);
	gradient.addColorStop(0, "rgba(255,235,200,0.95)");
	gradient.addColorStop(0.25, "rgba(255,190,120,0.30)");
	gradient.addColorStop(0.6, "rgba(255,150,80,0.06)");
	gradient.addColorStop(1, "rgba(255,140,70,0)");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, size, size);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}
