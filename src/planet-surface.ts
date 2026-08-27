/**
 * The drawn form of one celestial body: its surface, and whichever shells its
 * class earns.
 *
 * **Display only, and the boundary is the point.** Nothing here reads a
 * position back out of an `Object3D` and nothing here decides what a body *is*
 * — `planet-appearance.ts` classifies, `system.ts` generates, and this module
 * draws. It is the durable home of what `?planet-prototype` established in
 * #54: the gallery is disposable, the way a body is built is not.
 *
 * **Everything is authored on a unit sphere.** The renderer sizes a body with
 * `mesh.scale = radiusKm × layerFactor` (`units.ts`), so a shell at 1.014 radii
 * stays at 1.014 radii in the far, approach and near layers alike, and the
 * handoff is a scale assignment rather than a geometry rebuild. Hand back
 * kilometres here and every body is drawn `radiusKm` times too large.
 *
 * The one thing that is *not* scale-invariant is a position, which is why the
 * sun arrives as a **direction**: the star is 1.5·10⁸ km away in sim space and
 * 1,500 units away in the far layer, and only the unit vector between them
 * means the same thing in both.
 */

import * as THREE from "three";
import type { PlanetAppearance, SurfaceClass } from "./planet-appearance";
import {
	ATMOSPHERE_FRAGMENT,
	CLOUD_FRAGMENT,
	RING_FRAGMENT,
	RING_VERTEX,
	SURFACE_VERTEX,
	fragmentFor,
} from "./planet-shaders";

/**
 * The tessellation a body and its shells share, and the reason it is exported.
 *
 * A surface drawn at fewer segments than the atmosphere around it is a polygon
 * inside a smooth shell, which at the near layer is an 11° facet on the limb —
 * so the two numbers are one invariant, not two settings. `main.ts` builds the
 * surface sphere and this module builds the shells, so the constant lives here
 * and is imported rather than restated with a comment tying them together.
 *
 * `SPHERE_SEGMENTS` is what a body drawn close needs. The far layer gets
 * `FAR_SPHERE_SEGMENTS` on the same handoff that already re-parents it: 12× the
 * vertices buys nothing on a disc a few pixels across.
 */
const SPHERE_SEGMENTS = 96;
const SPHERE_RINGS = 64;
const FAR_SPHERE_SEGMENTS = 32;
const FAR_SPHERE_RINGS = 16;

/**
 * The surface spheres, one per detail tier, built on first use and shared by
 * every body.
 *
 * Exported as *geometry* rather than as segment counts, and `setLayer` takes
 * a **layer** rather than a `BufferGeometry`, so the invariant above is the
 * module's shape instead of its prose: a caller selects near or far and cannot
 * hand a body a tessellation the shells were not built to match.
 */
let nearSphere: THREE.SphereGeometry | undefined;
let farSphere: THREE.SphereGeometry | undefined;
export const surfaceSphere = (layer: "near" | "approach" | "far") => {
	if (layer === "far") {
		farSphere ??= new THREE.SphereGeometry(
			1,
			FAR_SPHERE_SEGMENTS,
			FAR_SPHERE_RINGS,
		);
		return farSphere;
	}
	// Approach takes the fine sphere with near. The budget measures the two
	// separately, but a body in the approach layer is one being flown at — that
	// is what the layer is for — so its limb is exactly as visible as a near
	// body's, and a coarser sphere there would be a facet nobody asked to save.
	nearSphere ??= new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_RINGS);
	return nearSphere;
};

/**
 * The luminance every photosphere is exposed at, whatever colour the star is.
 *
 * The star shader multiplies its tint by up to 1.52 — `0.55 + 0.62 · bright`,
 * then `1.30` — which was tuned in the gallery against one warm tint. Read in
 * **linear** space, which is where the shader works, `STAR_CLASSES`' colours
 * run from 0.54 at `0xffb26b` to 0.94 at `0xf8f7ff`, so that gain lands very
 * differently across the ladder:
 *
 * - A **saturated** tint clips one channel and not the others. The red pins,
 *   green and blue do not, and the granulation survives in what is left. That
 *   is the star the gallery was tuned on, and it reads.
 * - A **neutral** tint clips all three together, at which point the disc is
 *   flat white. Measured on `?seed=15`, whose star is `0xf8f7ff`: a mean of 235
 *   with a granulation spread of 2.8, against 199 and 4.5 for a warm one — the
 *   difference between a lamp and a star, and a defect a screenshot shows
 *   instantly and a spread-only check does not. **Those two figures describe
 *   the build before this constant existed and cannot be re-derived from the
 *   tree**, because nothing ships a way to disable the normalisation — the same
 *   caveat the crater-band figures carry. What is checked on every run is the
 *   property they were evidence for: the disc has granulation, and the bloom
 *   pass is not where it comes from.
 *
 * So the tint carries **hue, not exposure**. That is the honest division: a
 * star's apparent brightness on screen is already a rendering choice rather
 * than a measurement, the tone curve is not a photometer, and what reads as
 * class is the colour. The light a star *casts* is untouched — `sunColor` is a
 * different question, and a hot star lighting its worlds more brightly than a
 * cool one is right.
 *
 * 0.55 puts the peak at 1.52 × 0.55 ≈ 0.84, under the knee for a neutral tint,
 * and leaves the warm end almost where it already was — the fix pulls the
 * bright classes down to a working exposure rather than pushing every class up
 * to one.
 */
export const PHOTOSPHERE_LUMA = 0.55;

/** Rec. 709, the coefficients `probe-planet-surfaces.mjs` measures with. */
const lumaOf = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** A star's colour at the one exposure every photosphere is drawn at. */
function photosphereTint(hex: number): THREE.Color {
	const colour = new THREE.Color(hex);
	const luma = lumaOf(colour);
	// Black has no hue to preserve and no exposure to normalise to; no star class
	// carries it, and dividing by its luma would be a division by zero rather
	// than a dark star.
	return luma > 0 ? colour.multiplyScalar(PHOTOSPHERE_LUMA / luma) : colour;
}

/**
 * Where the light comes from when the caller does not say.
 *
 * 51 degrees off the view axis: far enough that every body has a terminator,
 * near enough that a gallery is not half in shadow. The live renderer always
 * says, because its star has a real position; the prototype does not, because
 * it has no star.
 */
export const DEFAULT_SUN_DIRECTION = new THREE.Vector3(
	0.62,
	0.3,
	0.55,
).normalize();

export interface BodyVisualOptions {
	/** Unit vector from the body towards its star. Defaults to
	 *  `DEFAULT_SUN_DIRECTION`; the live renderer updates it every frame,
	 *  because bodies orbit. */
	sunDir?: THREE.Vector3;
	/** The star's own colour, for the light it casts on everything else. */
	sunColor?: number;
	/** The star's colour as its *own* photosphere, which is a different question
	 *  from the light it casts and is read only by the star class. Normalised to
	 *  `PHOTOSPHERE_LUMA` before it reaches the shader — see there. */
	starTint?: number;
}

export interface BodyVisual {
	/** Add this to a layer's scene, and scale it by `radiusKm × layerFactor`. */
	group: THREE.Group;
	/** Shared by the surface and every shell, so the cloud deck, the atmosphere
	 *  and the rings all see the same sun and the same clock without any of them
	 *  being told about it separately. */
	uniforms: Record<string, THREE.IUniform>;
	surface: SurfaceClass;
	/** Unit vector from the body towards its star, in any frame — it is a
	 *  direction, so every frame agrees about it. */
	setSunDirection(direction: THREE.Vector3): void;
	/** The world clock, seconds. Drives cloud drift and stellar granulation;
	 *  every other class ignores it. */
	setTime(seconds: number): void;
	/**
	 * Swap the surface tessellation for the layer the body is now in.
	 *
	 * A **layer**, not a geometry: the surface and the shells around it are one
	 * tessellation invariant, and a signature taking a `BufferGeometry` would
	 * leave that as documentation. Through the handle rather than by reaching
	 * into `group.children[0]`, because which child the surface is belongs here
	 * and a caller that knew it would break silently the first time a shell was
	 * added before the surface. Only the surface: the shells are one geometry
	 * each, drawn at a few pixels in the far layer whichever they use.
	 */
	setLayer(layer: "near" | "approach" | "far"): void;
	/**
	 * Free the per-body materials and the star's corona texture.
	 *
	 * `redrawBodyAs` calls it on every class swap, which is a probe path rather
	 * than a gameplay one. **Nothing in the game does**, and that is a fact
	 * about the renderer rather than an oversight: `buildBodies` runs once, at
	 * construction, because there is no path that changes the system a game is
	 * in — hyperspace is not built. It exists rather than being absent so the
	 * node that adds that path has something to call instead of a leak to find.
	 *
	 * Whether it frees what it names is **not asserted anywhere** — nothing here
	 * reads GPU allocations back — so read it as written with care, not as
	 * verified.
	 */
	dispose(): void;
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

/**
 * The cloud shell is the same radius on every body that has one, so it is one
 * geometry rather than one per body. The atmosphere shell's radius varies with
 * optical depth, so that one genuinely cannot be shared as a *radius* — but it
 * can be shared as a unit sphere scaled per body, which is what it is, rather
 * than one tessellation per distinct value of the ladder.
 *
 * Built on first use rather than at module evaluation. The prototype imported
 * this module only under `?planet-prototype`; the game imports it on the boot
 * path, and a system whose bodies have neither weather nor air would otherwise
 * pay ~17k vertices of construction for two meshes nothing adds.
 */
let cloudGeometry: THREE.SphereGeometry | undefined;
const cloudShell = () => {
	cloudGeometry ??= new THREE.SphereGeometry(1.014, 128, 84);
	return cloudGeometry;
};
let shellGeometry: THREE.SphereGeometry | undefined;
const atmosphereShell = () => {
	shellGeometry ??= new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_RINGS);
	return shellGeometry;
};

/** The ring plane is the same for every body that has one — the bands are
 *  drawn by the shader from `innerR`/`outerR`, not by the geometry — so it is
 *  shared like the shells rather than built per body and then leaked. */
let ringGeometry: THREE.PlaneGeometry | undefined;
const ringPlane = () => {
	ringGeometry ??= new THREE.PlaneGeometry(4.8, 4.8, 1, 1);
	return ringGeometry;
};

/**
 * `fragmentFor`, memoised by class.
 *
 * Three moons of one class assembled three identical shader sources and
 * compiled three identical programs, and `buildBodies` runs over every body on
 * the boot path — which is time the loading screen pays. Three keys its program
 * cache on the source string, so handing it the same string twice is what makes
 * two bodies share one compiled program; the materials stay per body, because
 * the uniforms do.
 */
const fragmentCache = new Map<SurfaceClass, string>();
const cachedFragment = (surface: SurfaceClass): string => {
	const hit = fragmentCache.get(surface);
	if (hit !== undefined) return hit;
	const source = fragmentFor(surface);
	fragmentCache.set(surface, source);
	return source;
};

export function buildBodyVisual(
	look: PlanetAppearance,
	sphere: THREE.BufferGeometry,
	opts: BodyVisualOptions = {},
): BodyVisual {
	/**
	 * Ablation switches, for attributing a frame cost rather than guessing at it.
	 *
	 * A planet filling the screen costs its surface shader, a cloud shell, an
	 * atmosphere shell and a full-screen bloom pass, and the only honest way to
	 * learn which dominates is to remove one at a time and read the meter.
	 * #59 could not: its runner has no GPU, and it recorded that what its
	 * figures licensed was "no saving was demonstrated here", not "no saving
	 * exists". These are the levers that let a GPU answer it.
	 *
	 *   ?perf=noatmo    no atmosphere shell
	 *   ?perf=noclouds  no cloud shell
	 *   ?perf=noshells  neither
	 *   ?perf=norelief  surface keeps its albedo, loses its normal perturbation
	 *   ?perf=flat      surface is a plain lit sphere, no noise at all
	 *
	 * They are diagnostic and change what is drawn, so nothing reads them by
	 * default and no probe asserts through them.
	 */
	const perf = new URLSearchParams(window.location.search).get("perf") ?? "";
	const noClouds = perf === "noclouds" || perf === "noshells";
	const noAtmo = perf === "noatmo" || perf === "noshells";

	const uniforms: Record<string, THREE.IUniform> = {
		time: { value: 0 },
		// A direction, not a position, so it is the same vector at every render
		// scale — which is what lets one uniform serve the far, approach and near
		// layers without a per-layer copy.
		sunDir: { value: (opts.sunDir ?? DEFAULT_SUN_DIRECTION).clone() },
		sunColor: { value: new THREE.Color(opts.sunColor ?? 0xfff7eb) },
		// A thick atmosphere carries light well past the geometric terminator;
		// an airless body does not carry it at all.
		wrapAmount: { value: look.atmosphere * 0.32 },
		seedOffset: { value: (look.seed % 997) / 97 },
		// The A/B switch AIRLESS reads. Query-gated so the two crater paths can
		// be compared on one machine by reloading, which is the measurement
		// #59 could not take — its runner had no GPU, and it said so.
		// 0 normally; 1 drops the normal perturbation, 2 drops the surface noise
		// entirely. Read by every class through `RELIEF`.
		// 0 = four-tap central differences, 1 = one tap plus screen-space
		// derivatives. See `reliefNormal` in `planet-classes.glsl.ts` for what
		// each costs and what the second gives up.
		reliefMode: { value: 0 },
		perfAblate: {
			value: perf === "flat" ? 2 : perf === "norelief" ? 1 : 0,
		},
		craterSlow: {
			value:
				new URLSearchParams(window.location.search).get("crater") ===
				"differenced"
					? 1
					: 0,
		},
		warmth: { value: look.warmth },
		seaLevel: { value: look.seaLevel },
		starTint: { value: photosphereTint(opts.starTint ?? 0xfff4ea) },
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
			fragmentShader: cachedFragment(look.surface),
			// `reliefNormal`'s screen-space path calls `dFdx`/`dFdy`. In GLSL ES
			// 1.00 those are an extension, and three used to need
			// `extensions.derivatives` — the flag is gone since r152 because a
			// WebGL2 context has them as core, which is the context three asks
			// for. Named here because the next reader will look for the flag.
		}),
	);
	// Tagged with its class and a way to change it, for the perf panel's class
	// cycle. The class is *compiled in* — `cachedFragment` picks one branch of
	// `CLASS_GLSL` and the rest never reaches the GPU — so switching it is a
	// shader swap and a recompile, not a uniform. That is why this is a closure
	// on the material rather than a value the panel can set: the panel should
	// not have to know that.
	planet.userData.surfaceClass = look.surface;
	planet.userData.setSurfaceClass = (next: SurfaceClass) => {
		// A star keeps its own shader. It is not a planet surface, it is the
		// brightest thing in the frame and therefore what the bloom pass is
		// mostly working on, and drawing it as a desert would change the one
		// term the panel is trying to hold still while another is measured.
		if (look.surface === "star") return;
		const material = planet.material as THREE.ShaderMaterial;
		material.fragmentShader = cachedFragment(next);
		material.needsUpdate = true;
		planet.userData.surfaceClass = next;
	};
	group.add(planet);

	if (look.cloudCover > 0 && !noClouds) {
		// Tagged so `perf-panel.ts` can find it by walking the scene. A tag on
		// the object beats a registry of meshes, which would have to be kept in
		// step with a world that regenerates on every jump.
		const clouds = new THREE.Mesh(
			cloudShell(),
			new THREE.ShaderMaterial({
				uniforms,
				transparent: true,
				depthWrite: false,
				vertexShader: SURFACE_VERTEX,
				fragmentShader: CLOUD_FRAGMENT,
			}),
		);
		clouds.userData.shell = "cloud";
		group.add(clouds);
	}
	if (look.atmosphere > 0 && !noAtmo) {
		// Back faces only, additively: the shell is a volume seen from outside,
		// and drawing its front faces would put a wash over the whole disc.
		const shell = new THREE.Mesh(
			atmosphereShell(),
			new THREE.ShaderMaterial({
				uniforms,
				transparent: true,
				depthWrite: false,
				side: THREE.BackSide,
				blending: THREE.AdditiveBlending,
				vertexShader: SURFACE_VERTEX,
				fragmentShader: ATMOSPHERE_FRAGMENT,
			}),
		);
		// A thicker shell stands further off the surface. On the shared unit
		// geometry that is a scale rather than its own tessellation.
		shell.scale.setScalar(1.03 + look.atmosphere * 0.025);
		shell.userData.shell = "atmosphere";
		group.add(shell);
	}
	if (look.hasRings) {
		const ring = new THREE.Mesh(
			ringPlane(),
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
		// Named so a probe can hide it: a ring crosses the disc and is lit by the
		// sun whatever the planet behind it is doing, so any measurement *of the
		// surface* has to be able to take it out of the frame.
		ring.name = "decor";
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
		corona.name = "decor";
		group.add(corona);
	}

	// A fixed axial tilt, so a sphere lit from the side reads as a rotating
	// body rather than as a ball. Per-body tilt would be a generator question —
	// the axis decides seasons — and nothing in the sim has an axis yet.
	group.rotation.z = 0.18;

	return {
		group,
		uniforms,
		surface: look.surface,
		setSunDirection(direction) {
			(uniforms.sunDir.value as THREE.Vector3).copy(direction);
		},
		setTime(seconds) {
			uniforms.time.value = seconds;
		},
		setLayer(layer) {
			planet.geometry = surfaceSphere(layer);
		},
		dispose() {
			// One pass over the children, which includes the surface mesh — an
			// explicit `surfaceMaterial.dispose()` beside this loop disposed it
			// twice.
			//
			// Geometry is deliberately not touched: every one a body draws with —
			// the surface sphere handed in, the two shells, the ring plane — is
			// shared across bodies and outlives any of them. That was not true of
			// the ring, which was built per body and would have leaked here; it is
			// shared now, which is the fix rather than a special case in this loop.
			for (const child of group.children) {
				if (!(child instanceof THREE.Mesh || child instanceof THREE.Sprite))
					continue;
				const material = child.material as THREE.Material & {
					map?: THREE.Texture | null;
				};
				// The corona's texture is drawn per star into a canvas, and
				// `Material.dispose()` does not free a map — so a star disposed
				// without this leaves a 128×128 texture on the GPU.
				material.map?.dispose();
				material.dispose();
			}
		},
	};
}
