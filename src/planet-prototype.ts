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
import { type SurfaceClass, appearanceFor } from "./planet-appearance";

/**
 * The gallery, in ladder order: hottest rocky world to coldest, then the giants,
 * then a moon and a star. `warmth` is `a/a_hab` — the same number the generator
 * already has — and every entry here is the class `appearanceFor` returns for
 * that number, so the gallery cannot drift from the classifier.
 */
const GALLERY = [
	{
		kind: "planet",
		id: "planet-0",
		warmth: 0.28,
		giant: false,
		note: "a \u2248 0.3 a_hab",
	},
	{
		kind: "planet",
		id: "planet-1",
		warmth: 0.62,
		giant: false,
		note: "a \u2248 0.6 a_hab",
	},
	{
		kind: "planet",
		id: "planet-2",
		warmth: 1.0,
		giant: false,
		note: "a \u2248 a_hab",
	},
	{
		kind: "planet",
		id: "planet-3",
		warmth: 1.6,
		giant: false,
		note: "a \u2248 1.6 a_hab",
	},
	{
		kind: "planet",
		id: "planet-4",
		warmth: 3.4,
		giant: false,
		note: "cold, and still rocky",
	},
	{
		kind: "planet",
		id: "planet-5",
		warmth: 3.0,
		giant: true,
		note: "a > 2 a_hab",
	},
	{
		kind: "planet",
		id: "planet-9",
		warmth: 7.5,
		giant: true,
		note: "a > 5 a_hab",
	},
	{
		kind: "moon",
		id: "planet-5-moon-0",
		warmth: 3.0,
		giant: false,
		note: "any orbit",
	},
	{ kind: "star", id: "star", warmth: 0, giant: false, note: "class G" },
] as const;

/**
 * A rocky body past the desert rung is an ice world; a gas giant is at the same
 * distance. `system.ts` separates them with `isGasGiant`, and so does the
 * gallery \u2014 stated per entry rather than guessed from the orbit, because the
 * whole point is that one number does *not* decide it on its own.
 */
const describe = (entry: (typeof GALLERY)[number]) =>
	appearanceFor(entry.kind, entry.id, entry.warmth, {
		isGasGiant: entry.giant,
	});

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

export function mountPlanetPrototype(): void {
	const query = new URLSearchParams(location.search).get("planet-prototype");
	const single = GALLERY.find((entry) => describe(entry).surface === query);

	const root = document.createElement("section");
	root.id = "planet-prototype";
	document.body.append(root);
	const style = document.createElement("style");
	style.textContent = `
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
	const columns = single ? 1 : 3;
	const rows = Math.ceil(shown.length / columns);
	const SPACING = 2.7;

	const sphere = new THREE.SphereGeometry(1, 144, 96);
	const bodies: Body[] = [];

	for (let i = 0; i < shown.length; i++) {
		const entry = shown[i];
		const look = describe(entry);
		const uniforms: Record<string, THREE.IUniform> = {
			time: { value: 0 },
			sunDir: { value: SUN_DIRECTION },
			sunColor: { value: new THREE.Color(1.0, 0.97, 0.92) },
			// A thick atmosphere carries light well past the geometric terminator;
			// an airless body does not carry it at all.
			wrapAmount: { value: look.atmosphere * 0.32 },
			seedOffset: { value: (look.seed % 997) / 97 },
			warmth: { value: look.warmth },
			seaLevel: { value: look.oceanFraction },
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
					new THREE.SphereGeometry(1.014, 128, 84),
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

		if (!single) {
			group.position.set(
				((i % columns) - (columns - 1) / 2) * SPACING,
				((rows - 1) / 2 - Math.floor(i / columns)) * SPACING - 0.15,
				0,
			);
		}
		group.rotation.z = 0.18;
		scene.add(group);
		bodies.push({ group, uniforms, surface: look.surface });
	}

	camera.position.z = single ? 3.1 : 12.6;

	const head = document.createElement("div");
	head.className = "pp-head";
	head.innerHTML = single
		? `<b>${LABEL[describe(single).surface].toUpperCase()}</b><p>Drag to rotate. Sun is 51° off the view axis, so the terminator is real.</p>`
		: "<b>PLANET CLASS GALLERY — NODE 54</b><p>Class is read off <code>a/a_hab</code>, the orbit ratio the generator already computes. The seed only picks continents, craters and storms <em>within</em> a class.</p>";
	root.append(head);

	// Captions are DOM, projected from each body's world position every frame:
	// text in the scene would need a font atlas, and this prototype exists to
	// judge surfaces, not typography.
	const captions = shown.map((entry) => {
		const el = document.createElement("div");
		el.className = "pp-caption";
		const look = describe(entry);
		el.innerHTML = `<b>${LABEL[look.surface]}</b><span>${entry.note}</span>`;
		root.append(el);
		return el;
	});

	const stats = document.createElement("div");
	stats.className = "pp-stats";
	root.append(stats);

	let dragging = false;
	let lastX = 0;
	let lastY = 0;
	let spinY = 0;
	let tiltX = 0;
	renderer.domElement.style.cursor = "grab";
	renderer.domElement.addEventListener("pointerdown", (event) => {
		dragging = true;
		lastX = event.clientX;
		lastY = event.clientY;
		renderer.domElement.setPointerCapture(event.pointerId);
	});
	renderer.domElement.addEventListener("pointermove", (event) => {
		if (!dragging) return;
		spinY += (event.clientX - lastX) * 0.007;
		tiltX = THREE.MathUtils.clamp(
			tiltX + (event.clientY - lastY) * 0.007,
			-1.2,
			1.2,
		);
		lastX = event.clientX;
		lastY = event.clientY;
	});
	renderer.domElement.addEventListener("pointerup", () => {
		dragging = false;
	});

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
		for (const body of bodies) {
			body.uniforms.time.value = elapsed;
			body.group.rotation.y = spinY;
			body.group.rotation.x = tiltX;
		}
		renderer.render(scene, camera);

		if (frameCount % 15 === 0) {
			const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
			const size = renderer.getSize(new THREE.Vector2());
			stats.innerHTML = `<b>${mean.toFixed(1)} ms</b> / frame &nbsp; ${bodies.length} ${bodies.length === 1 ? "body" : "bodies"} &nbsp; ${size.x}×${size.y}`;
			for (let i = 0; i < captions.length; i++) {
				const world = bodies[i].group.position.clone().project(camera);
				captions[i].style.left = `${((world.x + 1) / 2) * size.x}px`;
				captions[i].style.top =
					`${((1 - world.y) / 2) * size.y + (single ? 330 : 156)}px`;
			}
		}
		requestAnimationFrame(loop);
	};
	loop();

	/**
	 * Read the mean colour of a patch on one body's disc.
	 *
	 * `u` and `v` are offsets from the body's centre in units of its own screen
	 * radius, so a probe can say "half a radius towards the sun" without knowing
	 * the framing. Positive `u` is screen-right and positive `v` is screen-up.
	 *
	 * The render happens here, immediately before the read: the default
	 * framebuffer is not preserved between frames, so a `readPixels` in any other
	 * task returns whatever the compositor left behind.
	 */
	const samplePatch = (
		index: number,
		u: number,
		v: number,
		halfFrac: number,
	) => {
		renderer.render(scene, camera);
		const gl = renderer.getContext();
		const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
		const centre = bodies[index].group.position.clone().project(camera);
		const right = new THREE.Vector3()
			.setFromMatrixColumn(camera.matrixWorld, 0)
			.multiplyScalar(1);
		const edge = bodies[index].group.position
			.clone()
			.add(right)
			.project(camera);
		const radiusNdc = Math.abs(edge.x - centre.x);
		const px = ((centre.x + u * radiusNdc) * 0.5 + 0.5) * buffer.x;
		// readPixels counts from the bottom, and NDC y already does too.
		const aspect = buffer.x / buffer.y;
		const py = ((centre.y + v * radiusNdc * aspect) * 0.5 + 0.5) * buffer.y;
		const half = Math.max(2, Math.round(radiusNdc * halfFrac * 0.5 * buffer.x));
		const size = half * 2;
		const pixels = new Uint8Array(size * size * 4);
		gl.readPixels(
			Math.round(px) - half,
			Math.round(py) - half,
			size,
			size,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			pixels,
		);
		let r = 0;
		let g = 0;
		let b = 0;
		for (let i = 0; i < pixels.length; i += 4) {
			r += pixels[i];
			g += pixels[i + 1];
			b += pixels[i + 2];
		}
		const n = size * size;
		return [r / n, g / n, b / n];
	};

	// Probe surface. `meanFrameMs` is the measured budget; `classes` lets the
	// probe assert that every ladder rung actually reached the screen; and
	// `samplePatch` is how it checks that they look different from each other.
	(window as unknown as Record<string, unknown>).__seelitePlanets = {
		classes: bodies.map((b) => b.surface),
		cloudCover: shown.map((entry) => describe(entry).cloudCover),
		oceanFraction: shown.map((entry) => describe(entry).oceanFraction),
		meanFrameMs: () =>
			frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0,
		frameCount: () => frameCount,
		samplePatch,
		setView: (spin: number, tilt: number) => {
			spinY = spin;
			tiltX = tilt;
		},
	};
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
