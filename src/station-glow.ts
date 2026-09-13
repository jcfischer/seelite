/**
 * The glow a station's lights are seen by at range (#300).
 *
 * **Why this exists.** The principal's ruling on #300's first sheet was that
 * every light on a station was *"way too big"*: strobes 42 m across, window
 * panes 30 × 12 m, floods 156 m long, a welding arc 60 m across, on stations a
 * kilometre or three wide. The fittings are real-sized now — a strobe is 2 m,
 * a pane 3 × 1.5 m — and at docking range a real fitting is under a pixel: a
 * 3 m lamp on the shipyard at three silhouette radii is half a pixel on a
 * 1440 × 900 frame. Antialiasing is off by default, so geometry that small
 * either flickers or does not rasterise at all. A real light is seen at that
 * range by its glare, not by its housing, and this is the glare.
 *
 * **The ship already solved this, and this is its idiom.** `ship-mesh.ts`'s
 * nav lights are additive `THREE.Points` with `gl_PointSize` floored in
 * pixels. Three things differ here, and each is a constraint the ship's lights
 * never had:
 *
 * - **No white core.** The ship mixes 85% toward white at the centre so a
 *   saturated red crosses bloom. `probe-station-visuals.mjs` orders the three
 *   roles warm to cold by `R − B` over their own light pixels, and a white core
 *   drags every role toward zero. A station glow keeps its fixture's colour.
 * - **No bloom forcing.** The peak is the fixture's own drive, which
 *   `STATION_EMISSIVE_INTENSITIES` holds at or under `EMISSIVE_CEILING` — the
 *   exposure budget #199 enumerates. The glow is not allowed to be brighter
 *   than the fitting it belongs to.
 * - **Scale-invariant sizing.** A ship is always in the near layer, where view
 *   units are kilometres; a station moves between three layers and is drawn
 *   normalised to its core radius (`station-mesh.ts`). So the size is computed
 *   from the projected *ratio* of the fitting's own size to its distance, which
 *   is the same number in every layer and every scale, and floored in pixels of
 *   the target actually being drawn into.
 *
 * **Named like its fitting, and a child of it.** `probe-station-visuals.mjs`
 * hides a fixture by name, and a glow parented under the fitting is hidden with
 * it — so the per-fixture floor measures fitting and glare together, and the
 * detail band that hides a tagged fitting hides its glow for free. A glow is
 * never drawn at `outline` range, where a floor of a few pixels would put a
 * second star field round every distant station and change the outline
 * `probe-station.mjs` measures.
 *
 * **Not pickable.** `Points.raycast` answers within a threshold of one world
 * unit, and a station root is normalised to core radii, so a pickable glow
 * would stand in front of every surface on the station — the headless axis row
 * in `tests/station-visuals.test.ts` would read every fixture as hidden behind
 * some other fixture's glare.
 *
 * Imports only three and types, so `station-fixtures.ts` can use it without
 * the cycle `station-mesh.ts` would close. Not imported by `station-visuals.ts`,
 * which stays headless-pure.
 */
import * as THREE from "three";
import { shared } from "./gpu-teardown";

/**
 * How a class of light is drawn: the smallest it may be on screen, the largest,
 * and how many times the fitting's own projected size its glare spans.
 *
 * **The floors are pixels of the render target**, which is what `gl_PointSize`
 * is in, and they were raised once on measurement (#300). At 3.5 px for a point
 * and 3 for a flood, `probe-station-visuals.mjs` read the shipyard's strobes at
 * 2 px, its mouth ring at 1 and its floods at 2 from its approach, where a
 * 1.66 km frame puts the camera 5 km out. That probe reads a 560 × 400 canvas
 * downsampled from its viewport, so a 5 px floor at a 720 px viewport is about
 * 3 px there — enough to clear its luma threshold of 6 without a lamp reading
 * as a disc.
 *
 * **The caps are what stop the glare swallowing the fitting up close.** Past
 * the distance where `spread × projected size` exceeds the cap, the housing is
 * larger than its glow and the geometry is what you see.
 */
export const GLOW_CLASSES = Object.freeze({
	/** Strobes, beacons, the welding arc: point sources that have to be found. */
	point: Object.freeze({ minPx: 5, maxPx: 14, spread: 3 }),
	/** Floodlights and the flare's throats: a lit face, a little softer. */
	flood: Object.freeze({ minPx: 4, maxPx: 12, spread: 2.5 }),
	/** Window panes and approach lamps: many of them, so the smallest floor. */
	pane: Object.freeze({ minPx: 2, maxPx: 8, spread: 2 }),
} as const);

export type GlowClass = keyof typeof GLOW_CLASSES;

/**
 * The on-screen diameter a glow is drawn at, in render-target pixels — the
 * arithmetic the vertex shader does, in TypeScript so a headless test can hold
 * it.
 *
 * `sizeView` and `distanceView` are in the same view-space units, whatever
 * those are in the layer drawing it; only their ratio matters.
 * `projectionYY` is `projectionMatrix[1][1]` and `halfHeightPx` half the
 * target's height, so `sizeView / distanceView × projectionYY × halfHeightPx`
 * is the fitting's own projected size in pixels.
 */
export function glowPixelSize(
	sizeView: number,
	distanceView: number,
	projectionYY: number,
	halfHeightPx: number,
	glow: { minPx: number; maxPx: number; spread: number },
): number {
	const projected =
		(sizeView / Math.max(distanceView, 1e-9)) * projectionYY * halfHeightPx;
	return Math.min(glow.maxPx, Math.max(glow.minPx, projected * glow.spread));
}

const VERTEX = `
attribute float glowSize;
attribute float glowLift;
uniform float uHalfHeightPx;
uniform float uMinPx;
uniform float uMaxPx;
uniform float uSpread;
void main() {
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	// The model-view scale, so a size authored in the station's kilometres is
	// in the same units as the distance it is divided by.
	float scale = length(modelViewMatrix[0].xyz);
	float dist = max(length(mv.xyz), 1e-9);
	float projected = (glowSize * scale / dist) * projectionMatrix[1][1] * uHalfHeightPx;
	gl_PointSize = clamp(projected * uSpread, uMinPx, uMaxPx);
	// Lifted toward the eye by the fitting's own half-size, so the housing the
	// glow sits inside cannot occlude it from any direction — while structure
	// more than a fitting's width in front of it still does, which is the
	// occlusion that is real.
	mv.xyz -= normalize(mv.xyz) * min(glowLift * scale, dist * 0.5);
	gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = `
uniform vec3 uColor;
uniform float uIntensity;
void main() {
	float r = min(length(gl_PointCoord - 0.5) * 2.0, 1.0);
	float core = 1.0 - r;
	// A hot centre and a soft skirt, in the fixture's own colour: no mix toward
	// white, for the warmth ordering this module's docstring names.
	float falloff = core * core * (0.35 + 0.65 * core);
	float intensity = uIntensity * falloff;
	if (intensity <= 0.002) discard;
	gl_FragColor = vec4(uColor * intensity, 1.0);
}
`;

/**
 * A glow material in one fixture's colour at one intensity.
 *
 * `uIntensity` is the drive. A clock-driven fixture gets its own material and
 * `updateStationVisuals` writes it beside the fitting's `emissiveIntensity`; a
 * steady one — windows, floods — can take a `shared()` one per colour.
 */
export function glowMaterial(
	color: number,
	intensity: number,
	glowClass: GlowClass,
): THREE.ShaderMaterial {
	const cls = GLOW_CLASSES[glowClass];
	// Raw shader, so its colour is linear: a hex written for the sRGB pipeline
	// is converted rather than handed straight over, as the ship's lights do.
	const linear = new THREE.Color().setHex(color).convertSRGBToLinear();
	const material = new THREE.ShaderMaterial({
		uniforms: {
			uColor: { value: new THREE.Vector3(linear.r, linear.g, linear.b) },
			uIntensity: { value: intensity },
			uHalfHeightPx: { value: 360 },
			uMinPx: { value: cls.minPx },
			uMaxPx: { value: cls.maxPx },
			uSpread: { value: cls.spread },
		},
		vertexShader: VERTEX,
		fragmentShader: FRAGMENT,
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	material.name = `station-glow-${glowClass}`;
	return material;
}

/** A steady glow material, built once per colour and class and never mutated. */
const steadyCache = new Map<string, THREE.ShaderMaterial>();
export function steadyGlowMaterial(
	color: number,
	intensity: number,
	glowClass: GlowClass,
): THREE.ShaderMaterial {
	const key = `${color}:${intensity}:${glowClass}`;
	let material = steadyCache.get(key);
	if (!material) {
		material = shared(glowMaterial(color, intensity, glowClass));
		steadyCache.set(key, material);
	}
	return material;
}

const halfHeight = new THREE.Vector2();

/** Never hit by a ray: see the module docstring. */
function noRaycast() {}

/**
 * The glow for one fitting or one instanced run, as a child to add under it.
 *
 * `points` are in the **parent's** local frame — the fitting's own origin for a
 * single lamp, the instance positions for a run. `sizeKm` is the fitting's own
 * largest dimension and `liftKm` how far the glow stands toward the eye; both
 * are in the parent's units, which on a station are kilometres.
 */
export function glowPoints(
	name: string,
	points: readonly THREE.Vector3[],
	sizeKm: number,
	liftKm: number,
	material: THREE.ShaderMaterial,
): THREE.Points {
	const positions = new Float32Array(points.length * 3);
	points.forEach((p, i) => positions.set([p.x, p.y, p.z], i * 3));
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute(
		"glowSize",
		new THREE.BufferAttribute(new Float32Array(points.length).fill(sizeKm), 1),
	);
	geometry.setAttribute(
		"glowLift",
		new THREE.BufferAttribute(new Float32Array(points.length).fill(liftKm), 1),
	);
	const glow = new THREE.Points(geometry, material);
	glow.name = name;
	glow.userData.glow = true;
	glow.raycast = noRaycast;
	// The target's own height, read at draw time: this module has no renderer,
	// and the composer draws into its own targets rather than the canvas, so
	// the canvas size is the wrong number whenever the two differ.
	glow.onBeforeRender = (renderer) => {
		const target = renderer.getRenderTarget();
		const height = target
			? target.height
			: renderer.getDrawingBufferSize(halfHeight).y;
		material.uniforms.uHalfHeightPx.value = height / 2;
	};
	return glow;
}
