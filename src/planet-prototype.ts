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
import {
	appearanceFor,
	type PlanetAppearance,
	type SurfaceClass,
} from "./planet-appearance";
import { type BodyVisual, buildBodyVisual } from "./planet-surface";

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
	bodies: BodyVisual[];
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
		/**
		 * Hide rings and coronae on every body.
		 *
		 * For measurements that are about the surface. The alternative — noting in
		 * a comment that the ice giant's terminator reading includes its ring —
		 * documents a contaminated number rather than taking the contamination
		 * out, and a ringed ice giant with an unlit surface would still pass.
		 */
		setDecorVisible: (visible: boolean) => {
			for (const body of bodies)
				for (const child of body.group.children)
					if (child.name === "decor") child.visible = visible;
		},
		/**
		 * Point every body at a rotation, **immediately**.
		 *
		 * Writing `view` alone would leave the rotation to the next rAF, while
		 * `samplePatches` renders directly — so a probe that sets a rotation and
		 * samples in two back-to-back round trips could read the previous one, and
		 * the distinctness signature's "three rotations" would silently collapse
		 * to fewer without any check going red.
		 */
		setView: (spin: number, tilt: number) => {
			view.spin = spin;
			view.tilt = tilt;
			for (const body of bodies) {
				body.group.rotation.y = spin;
				body.group.rotation.x = tilt;
			}
		},
	};
}

/**
 * Mount the study. **One-shot**: this registers a `resize` listener and an
 * unbounded `requestAnimationFrame` loop, and builds per-body geometry and
 * materials it never disposes. Calling it twice leaks both. That is fine for a
 * page whose whole job is to be looked at and closed, and it is stated so the
 * next reader does not mistake it for a component.
 */
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

	const bodies: BodyVisual[] = looks.map((look, i) => {
		// The gallery has no star, so the default light direction stands.
		const body = buildBodyVisual(look, sphere);
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
