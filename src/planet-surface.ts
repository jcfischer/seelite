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
import type { ReliefPath } from "./planet-shaders";
import { disposeSubtree, shared } from "./gpu-teardown";

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
		farSphere ??= shared(
			new THREE.SphereGeometry(1, FAR_SPHERE_SEGMENTS, FAR_SPHERE_RINGS),
		);
		return farSphere;
	}
	// Approach takes the fine sphere with near. The budget measures the two
	// separately, but a body in the approach layer is one being flown at — that
	// is what the layer is for — so its limb is exactly as visible as a near
	// body's, and a coarser sphere there would be a facet nobody asked to save.
	nearSphere ??= shared(
		new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_RINGS),
	);
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
	 * The fragment program this body's surface is drawn with (#207).
	 *
	 * A **recompile**, so the caller is expected to have decided that the band
	 * genuinely changed — `reliefPathFor`'s hysteresis is what makes that true
	 * of a body sitting on a threshold. Returns whether anything moved, so the
	 * frame loop can leave the tracking to this and a probe can tell a no-op
	 * from a switch.
	 *
	 * Through the handle rather than through `userData`, because `main.ts`
	 * reaching into a mesh's bag to find a closure is how the perf panel has to
	 * do it — the panel walks a scene and has no handles — and the frame loop
	 * has the handle already.
	 */
	setReliefPath(path: ReliefPath): boolean;
	/**
	 * The frame loop's door: set the band's choice **unless this body is pinned**.
	 *
	 * The two doors are the `applyOcclusion` pattern (`main.ts`), and the reason
	 * is the same one that file gives: an instrument naming an arm must not have
	 * the frame loop overwrite it. Any external write — the perf panel's relief
	 * cycle, `setSurfaceAndRelief`, `setAblation` — goes through
	 * `setReliefPath`, which pins; the selector goes through this, which yields.
	 *
	 * Per body rather than per game, so nothing has to hand a `Game` handle to a
	 * function that walks scenes.
	 */
	applyReliefBand(path: ReliefPath): boolean;
	/** Hand this body back to the bands. The perf panel's restore key. */
	unpinRelief(): void;
	/** Whether an external caller has taken this body's path. */
	reliefPinned(): boolean;
	/** What it is drawn with now, so the frame loop needs no parallel map. */
	reliefPath(): ReliefPath;
	/**
	 * Free everything this body owns, and nothing it shares.
	 *
	 * `redrawBodyAs` calls it on every class swap, which is a probe path. **The
	 * game calls it too, since #187**: a jump tears the old system's bodies down
	 * before the new system's are built, which is the path this method was left
	 * here in anticipation of while it had no caller at all.
	 *
	 * Its docstring used to end by saying that whether it frees what it names is
	 * *not asserted anywhere*, because nothing here reads GPU allocations back.
	 * That is still true of the *allocations* — no tier in this repo can ask the
	 * driver for a byte count.
	 *
	 * **What `tests/gpu-teardown.test.ts` asserts, stated at the strength it
	 * actually holds**, because sage round 2 caught this comment selling a
	 * fixture's coverage as a real body's:
	 *
	 * - **Named-resource completeness on a scene-shaped fixture** — every
	 *   resource of a hand-built subtree is freed. A fixture, so it proves the
	 *   walker reaches every *kind* of attachment a material can hang a texture
	 *   on, not that it reaches everything a
	 *   generated body has.
	 * - **Texture completeness on the real bodies**, by a rule the test writes
	 *   itself rather than importing, since `resourcesOf` and `disposeSubtree`
	 *   share one traversal by design and a cross-check built from either is
	 *   that rule agreeing with itself. Only the star has a texture to cover —
	 *   its corona — because every other class is a `ShaderMaterial` whose bands
	 *   are computed rather than sampled (#59). The corpus carries the vacuity
	 *   guard for that reason; asserting it per class would fail `terran` for
	 *   being right.
	 * - **Disjointness from a second, still-drawn body of the same class.** This
	 *   is the failure that does not throw — a teardown that took the shared unit
	 *   sphere would render the next system blank.
	 *
	 * What is *not* asserted: that a generated body has no resource the walker
	 * cannot reach at all. One traversal is a deliberate choice, so nothing in
	 * this repo enumerates a body's resources independently of the code under
	 * test, and the star's corona is the only real resource named.
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
	cloudGeometry ??= shared(new THREE.SphereGeometry(1.014, 128, 84));
	return cloudGeometry;
};
let shellGeometry: THREE.SphereGeometry | undefined;
const atmosphereShell = () => {
	shellGeometry ??= shared(
		new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_RINGS),
	);
	return shellGeometry;
};

/** The ring plane is the same for every body that has one — the bands are
 *  drawn by the shader from `innerR`/`outerR`, not by the geometry — so it is
 *  shared like the shells rather than built per body and then leaked. */
let ringGeometry: THREE.PlaneGeometry | undefined;
const ringPlane = () => {
	ringGeometry ??= shared(new THREE.PlaneGeometry(4.8, 4.8, 1, 1));
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
// Keyed by class *and* relief path: the path is a #define, so the two produce
// different programs and one cache slot per class would hand back the wrong one.
const fragmentCache = new Map<string, string>();
const cachedFragment = (
	surface: SurfaceClass,
	relief: ReliefPath = "four-tap",
): string => {
	const key = `${surface}:${relief}`;
	const hit = fragmentCache.get(key);
	if (hit !== undefined) return hit;
	const source = fragmentFor(surface, relief);
	fragmentCache.set(key, source);
	return source;
};

export function buildBodyVisual(
	look: PlanetAppearance,
	sphere: THREE.BufferGeometry,
	opts: BodyVisualOptions = {},
): BodyVisual {
	/**
	 * The ablation switches live on the perf panel, not on the query string.
	 *
	 * There were five — `?perf=noatmo`, `noclouds`, `noshells`, `norelief`,
	 * `flat` — and they are gone. They came first, the live switches replaced
	 * them for the actual measuring, and the justification left for keeping
	 * them was "a starting state is useful when a page is opened by a script".
	 * There is no such caller: the only page-opening scripts here are probes, and
	 * a probe must not mount the panel — its key listener would see the probe's
	 * own keystrokes. `check-launcher-wiring.mjs` refuses the literal flag in a
	 * probe's source, which catches the way that would happen without making it
	 * impossible. Either way the flags were kept for a use nobody has.
	 *
	 * `?perf` alone still mounts the panel, and every one of those states is a
	 * keypress there — `noshells` being the two that have no single key.
	 */

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
		// 0 normally; 1 drops the normal perturbation, 2 drops the surface noise
		// entirely. Read by every class through `RELIEF`.
		perfAblate: { value: 0 },
		// The A/B switch AIRLESS reads, set live from the perf panel's `o` key.
		// An earlier version offered `?crater=differenced` and a reload instead,
		// which `perf-panel.ts` argues against in its own rationale: a reload
		// puts the ship somewhere else, so two readings taken from two positions
		// measure the positions as much as the terms. Two comments in one branch
		// cannot recommend opposite methods.
		craterSlow: { value: 0 },
		warmth: { value: look.warmth },
		seaLevel: { value: look.seaLevel },
		starTint: { value: photosphereTint(opts.starTint ?? 0xfff4ea) },
		atmoColor: { value: new THREE.Color(look.atmosphereColor) },
		atmoStrength: { value: look.atmosphere },
		// Set below, once the shell's scale is known.
		atmoInnerRatio: { value: 1 },
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
	// The relief path is compiled in, like the class, so switching it is a
	// shader swap. Kept beside the class so one swap can carry both.
	planet.userData.reliefPath = "four-tap" as ReliefPath;
	/**
	 * Whether something outside the frame loop has taken this body's path (#207).
	 *
	 * The tag lives on the mesh rather than on a handle because the perf panel
	 * reaches these through a scene walk and has no handle — so a pin set from
	 * the panel and a pin set from the frame loop's own door have to be the same
	 * bit, or the two would disagree about who owns the path.
	 */
	planet.userData.reliefPinned = false;
	/**
	 * Swap the program, and nothing else. The half both doors share.
	 *
	 * Separated from the pin because the frame loop and the perf panel need the
	 * *same* swap and the *opposite* answer about ownership: an external write
	 * takes the body off #207's bands, and the bands' own write must not.
	 */
	const swapReliefProgram = (next: ReliefPath) => {
		if (look.surface === "star") return;
		if (planet.userData.reliefPath === next) return;
		const material = planet.material as THREE.ShaderMaterial;
		material.fragmentShader = cachedFragment(
			planet.userData.surfaceClass,
			next,
		);
		material.needsUpdate = true;
		planet.userData.reliefPath = next;
	};
	planet.userData.setReliefPath = (next: ReliefPath) => {
		// A write through this door is an external one — the perf panel's cycle,
		// `setSurfaceAndRelief`, `setAblation` — so it takes the body off #207's
		// bands. The frame loop uses `BodyVisual.applyReliefBand`, which shares
		// the swap above and leaves the pin alone.
		planet.userData.reliefPinned = true;
		swapReliefProgram(next);
	};
	planet.userData.setSurfaceClass = (next: SurfaceClass) => {
		// A star keeps its own shader. It is not a planet surface, it is the
		// brightest thing in the frame and therefore what the bloom pass is
		// mostly working on, and drawing it as a desert would change the one
		// term the panel is trying to hold still while another is measured.
		if (look.surface === "star") return;
		const material = planet.material as THREE.ShaderMaterial;
		material.fragmentShader = cachedFragment(next, planet.userData.reliefPath);
		material.needsUpdate = true;
		planet.userData.surfaceClass = next;
	};
	group.add(planet);

	if (look.cloudCover > 0) {
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
	if (look.atmosphere > 0) {
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
		// Thicker than the 1.03 + 0.025a it was. A shell that hugs the surface
		// leaves the exponential falloff no room to fall off in, so the haze had
		// to be steep to fit — and steep is the thing being fixed. The glow
		// fades well inside the new silhouette, so a thicker shell does not read
		// as a bigger planet.
		const shellScale = 1.06 + look.atmosphere * 0.05;
		shell.scale.setScalar(shellScale);
		// The surface is the unit sphere and the shell is that scaled, so the
		// fraction of the shell the solid body fills is one over the scale. The
		// atmosphere shader needs it to know where its chord is cut off.
		uniforms.atmoInnerRatio.value = 1 / shellScale;
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
		// three.js gives every `Sprite` in the process one module-scope quad.
		// It is not this star's to free, and a teardown that took it would pull
		// the geometry out from under every other sprite in the game (#187).
		shared(corona.geometry);
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
		setReliefPath(path) {
			// **The pin is taken even when the path did not change.** An instrument
			// asking for the path a body already has is still asking to hold it
			// there, and returning early before the pin would leave the frame loop
			// free to move it on the next frame — which is the whole failure this
			// exists to prevent, arriving through the one case that looks free.
			planet.userData.reliefPinned = true;
			const was = planet.userData.reliefPath;
			swapReliefProgram(path);
			// A star refuses the swap, so the answer is read back rather than
			// assumed: a caller told "yes, it changed" about a body that ignored it
			// would keep asking on every frame for ever.
			return planet.userData.reliefPath !== was;
		},
		applyReliefBand(path) {
			if (planet.userData.reliefPinned) return false;
			const was = planet.userData.reliefPath;
			swapReliefProgram(path);
			return planet.userData.reliefPath !== was;
		},
		unpinRelief() {
			planet.userData.reliefPinned = false;
		},
		reliefPinned() {
			return planet.userData.reliefPinned === true;
		},
		reliefPath() {
			return planet.userData.reliefPath as ReliefPath;
		},
		dispose() {
			// **One walker, shared with the station teardown** (#187). The loop
			// this replaces made two claims it could not keep: that a hand-listed
			// `material.map` reaches every texture a material samples — a
			// `ShaderMaterial` hangs its textures off `uniforms`, and every
			// surface, shell and ring here is one — and that geometry is
			// untouchable because "every one is shared", which was prose rather
			// than a property. The sharing is declared at each construction with
			// `shared()` now, and `tests/gpu-teardown.test.ts` asserts that what
			// this frees is disjoint from what a second live body is holding.
			//
			// The corona's texture is still the case that makes the texture pass
			// load-bearing: it is drawn per star into a canvas, and
			// `Material.dispose()` does not free a map, so a star disposed
			// without it leaves a 128×128 texture on the GPU.
			disposeSubtree(group);
		},
	};
}
