/**
 * The light rig, and the environment a reflection is a reflection *of*.
 *
 * #98 settled that this game is short on **depth and light** rather than on
 * grime, and #99 asked whether a flat ambient plus one fill is the whole rig.
 * It is not, and the reason is one line of state: `scene.environment` was unset
 * repo-wide. Station plating carries `metalness` per texel from
 * `station-visuals.ts`'s profiles (0.14–0.5 before the wear map cuts it) and a
 * hull sits at 0.08–0.1 (`ship-mesh.ts`), and metalness with no environment
 * *subtracts* diffuse and gives back only what the two direct lights reflect —
 * which on a rough plate at a grazing sun is very little, and nothing at all on
 * the side facing away. So the more metal a surface claimed to be, the deader
 * it rendered. (Not "nothing back", which is what this said first: a metal
 * still takes a direct specular lobe from the sun and the fill through the
 * BRDF. What it had no source for was the *indirect* term, which is the one
 * that carries an unlit face.) That is visible in the before sheet: the trade
 * station at three silhouette radii is a ring of flat grey facets with no
 * highlight anywhere on it, and its plating grid is not resolvable at all.
 *
 * Two terms replace the flat ambient, and they are different kinds of thing:
 *
 * - **A hemisphere**, aimed along the star. `AmbientLight` lifts black to grey
 *   with no gradient, and a flat-lit object has no edges; a `HemisphereLight`
 *   gives a top-to-bottom falloff for the same per-fragment cost. It is aimed
 *   at the star rather than at world up, because "up" means nothing in space —
 *   what the eye reads is that the star side is lifted and the far side is not.
 * - **An image-based term**, baked once at load. This is the change that makes
 *   `metalness` mean anything on every hull, station plate and cockpit surface
 *   at once, and it is a load-time bake with a per-fragment sample and no
 *   per-frame CPU term.
 *
 * ## Headless on purpose, like `backdrop.ts`
 *
 * Nothing here imports `three`. The model is arithmetic over directions and the
 * bake is a plain `Float32Array`, so `tests/light-rig.test.ts` can hold both.
 * `main.ts` wraps the buffer in a `DataTexture` and runs it through
 * `PMREMGenerator`, which is three lines and no decisions.
 *
 * ## What the sky is a picture of
 *
 * Node #433 (closing #100): the bake is the sky — a star, a haze from the
 * cluster's integrated light, and per-system gas — baked once per system in
 * the **world frame**. The same equirectangular image serves as both the drawn
 * backdrop (`scene.background`) and the reflection environment
 * (`scene.environment` via PMREM). There is no per-frame rotation: the star
 * lobe sits at whatever direction the star is at bake time, and the haze and
 * gas are fixed in the world frame. The direct sun and hemisphere lights still
 * track the star per-frame for direct illumination.
 *
 * `envRadiance` gained an optional `starDir` parameter so the star lobe can be
 * placed at any world-frame direction. `hazeRadiance` adds the cluster's
 * integrated glow, strongest toward the galactic core. `gasRadiance` adds
 * per-system procedural nebula colour from fBm noise on the unit sphere.
 *
 * `low` quality drops the haze and gas fill and keeps every point — the star
 * lobe and floor remain so reflections are not black, but the backdrop shows
 * only the point layers.
 *
 * ## `envRotation` — retired from the render path, kept for tests
 *
 * Before #433, the star sat at `BAKE_STAR_DIR` and `Scene.environmentRotation`
 * carried it onto the real star each frame. One shortest-arc quaternion cannot
 * carry a star *and* a band: keeping it would make every system's nebula happen
 * to pass near its own star. So `main.ts` no longer calls `envRotation` or sets
 * `environmentRotation`. The function stays exported because its headless tests
 * still hold the rotation's properties.
 */

import { shortestArc } from "./quat";
import { v3 } from "./vec3";

/** The bake's own star direction: +X, so `atan2(z, x)` puts it at u = 0.5 and
 *  `asin(y)` at v = 0.5 — the centre texel, which is what the buffer test pins. */
export const BAKE_STAR_DIR: readonly [number, number, number] = [1, 0, 0];

/**
 * The bake's resolution, and why it is this small.
 *
 * `PMREMGenerator` convolves this into a roughness chain, and the roughest
 * levels are the ones every station plate at 0.4–0.9 actually samples — so
 * resolution here buys sharpness only in the mirror-like tail that nothing in
 * the game has. 256×128 is two orders of magnitude cheaper than a skybox and
 * still oversamples the star core the halo carries.
 */
export const ENV_WIDTH = 256;
export const ENV_HEIGHT = 128;

/**
 * The brightest authored self-lit surface in working space.
 *
 * One ceiling for authored emissive intensities in the live scene. Intensity
 * alone cannot guarantee bloom — material colour and the composite luminance
 * threshold also participate — but keeping these values at or below white
 * prevents an individual authoring dial from forcing a halo by itself.
 */
export const EMISSIVE_CEILING = 1.0;

/**
 * The post-processing side of the same exposure budget.
 *
 * Threshold begins at the ceiling: ordinary lit paint and authored emissives
 * remain shaped by ACES, while only radiance above white contributes a halo.
 * The record is exposed through `window.__seelite.exposure`, so a browser probe
 * reads the figures the renderer uses instead of carrying a second copy.
 */
export const EXPOSURE = {
	emissiveCeiling: EMISSIVE_CEILING,
	bloom: {
		strength: 0.35,
		radius: 0.6,
		threshold: EMISSIVE_CEILING,
	},
} as const;

/**
 * The rig, in one place because the panel, the bake and the renderer all read
 * it and three copies drift.
 *
 * #199 keeps #99's directional roles but retunes every lighting term together:
 * the former sun/environment pair put a fully lit painted hull above the
 * display-space band even after ACES, while the camera-side fill still owns the
 * separate backlit-hull case.
 */
export const LIGHT_RIG = {
	/** Directional, because one light cannot serve two scenes at two scales;
	 *  `main.ts` has the argument. */
	/** Paired with `environmentIntensity`; see that field's measured sweep. */
	sun: { color: 0xfff0d8, intensity: 0.2 },
	/**
	 * The ambient replacement. Aimed along the star, so `sky` is the lift on the
	 * star side and `ground` the lift on the far side.
	 *
	 * #199 shifts illumination out of the two directional lights and into this broad
	 * gradient. That keeps a camera-facing hull readable across its facets
	 * without one shoulder owning the whole exposure range. Ground remains
	 * darker than sky, so the lift retains an edge-bearing gradient rather than
	 * becoming a flat ambient wash.
	 */
	hemisphere: { sky: 0xc0ccd8, ground: 0x8090a0, intensity: 6.85 },
	/** Camera-side, near layer only. Still off-axis, but close enough to the lens
	 * that the whole chase hull receives a readable base rather than one bright
	 * shoulder surrounded by black paint. */
	fill: {
		color: 0x9fb6d0,
		intensity: 0.18,
		direction: [-0.25, 0.35, 1] as const,
	},
	/**
	 * How hard the baked environment is applied, as `Scene.environmentIntensity`.
	 *
	 * #99 originally bracketed this at 2.2 by eye. #199 found that value and the
	 * 3.0 sun together drove `hull-chase` past white. The final rig lowers the
	 * sun, environment and fill together. The final masked, post-tone-map painted
	 * hull reads 154.03 of 255 across five same-build samples, with 0.00 spread;
	 * its lower quartile is 61.04 and median 85.37, so the band does not hide a
	 * mostly-black exterior behind one compliant highlight.
	 *
	 * That pixel band guards clipping; whether the lower-exposure scene still has
	 * the intended depth and legibility remains the canonical sheet's human gate.
	 */
	environmentIntensity: 0.15,
	/**
	 * What each lighting setting includes.
	 *
	 * **`ao` is not here**, and that is the one thing about this record worth
	 * knowing: #201's ambient occlusion is the player's own `ao` row in
	 * `settings.ts`. One term with two owners is the arrangement that once let
	 * the perf panel and the settings screen each apply half of `renderScale`.
	 *
	 * `shadows` is here because a shadow is what the star does to a surface
	 * another surface stands in front of — the light model — while ambient
	 * occlusion is a post pass. Not because of what either costs.
	 *
	 * The decision history, and the measurement that says this shadow is very
	 * nearly invisible at this rig, live on nodes #231 and #233 rather than in
	 * this comment.
	 */
	quality: {
		high: {
			environment: true,
			hemisphere: true,
			exposure: 1,
			shadows: true,
		},
		low: {
			environment: false,
			hemisphere: true,
			exposure: 1,
			shadows: false,
		},
	},
} as const;

/** The star core: a tight lobe, for the mirror-like tail of the roughness
 *  chain. Wide enough at this resolution to land on more than one texel, which
 *  is what stops PMREM's first mip from averaging it away entirely. */
const CORE_POWER = 1200;
const CORE_GAIN = 26;

/** The halo: what a rough plate actually reflects. This is the term that puts a
 *  gradient across a hull rather than a dot on it. */
const HALO_POWER = 3.5;
const HALO_GAIN = 0.42;

/**
 * The floor, everywhere, in linear RGB.
 *
 * Fixed rather than tinted by the star, because a red star does not make the
 * empty sky red — what it lights is what faces it, and that is the two terms
 * above. Dim enough that a surface facing away is dark and not black: the same
 * argument the flat ambient was added for, and the reason the test requires it
 * to be above zero.
 */
const DEEP_SKY: readonly [number, number, number] = [0.008, 0.011, 0.018];

// ---------------------------------------------------------------------------
// Haze: the cluster's integrated light, a smooth glow toward the galactic core
// ---------------------------------------------------------------------------

/** The haze term's cone power. Controls how tight the glow is toward the core.
 *  At 3, the half-power point is ~38° off the core bearing. */
const HAZE_POWER = 3;

/** Peak brightness of the directional haze term, per channel, at full
 *  strength. About 3× the DEEP_SKY floor — visible as a soft cone, not as a
 *  lamp. */
const HAZE_CONE_GAIN = 0.04;

/** The isotropic component of the haze, per channel. Present everywhere and
 *  independent of the core direction — the part of the cluster's light that
 *  has no preferred direction. */
const HAZE_BASE_GAIN = 0.006;

/** Cool blue-white tint for the haze, normalised. The cluster's integrated
 *  starlight is warmer than this, but the sky's contribution between the stars
 *  reads as deep space rather than as sunlight. */
const HAZE_TINT: readonly [number, number, number] = [0.65, 0.75, 1.0];

/** What the caller passes to place the haze in the bake. */
export interface HazeParams {
	/** Direction toward the galactic core from this system, in the system's
	 *  world frame. Unit vector. `null` at the core itself, where every
	 *  direction is away from it — the base term still draws. */
	coreBearing: readonly [number, number, number] | null;
	/** How directional the cluster's light is from here. 0 at the core (uniform
	 *  sky), rising toward 1 at the rim (most light from the core direction).
	 *  The node measured 2.17× total brightness variation, so this is a mild
	 *  anisotropy. */
	strength: number;
}

/**
 * The haze contribution at one direction.
 *
 * A smooth glow from the cluster's integrated starlight, strongest toward the
 * galactic core. The base provides a minimum everywhere; the cone adds a
 * directional term whose strength depends on the observer's position. A system
 * at the centre of the cluster sees almost no cone (uniform sky); a rim system
 * sees a bright core direction.
 */
export function hazeRadiance(
	dir: readonly [number, number, number],
	haze: HazeParams,
): [number, number, number] {
	let cone = 0;
	if (haze.coreBearing) {
		const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
		const cl =
			Math.hypot(
				haze.coreBearing[0],
				haze.coreBearing[1],
				haze.coreBearing[2],
			) || 1;
		const d =
			(dir[0] * haze.coreBearing[0] +
				dir[1] * haze.coreBearing[1] +
				dir[2] * haze.coreBearing[2]) /
			(l * cl);
		cone = HAZE_CONE_GAIN * haze.strength * Math.max(0, d) ** HAZE_POWER;
	}
	const base = HAZE_BASE_GAIN * (0.5 + 0.5 * haze.strength);
	return [
		(base + cone) * HAZE_TINT[0],
		(base + cone) * HAZE_TINT[1],
		(base + cone) * HAZE_TINT[2],
	];
}

// ---------------------------------------------------------------------------
// Gas: per-system procedural nebula, baked from fBm noise on the unit sphere
// ---------------------------------------------------------------------------

/** What the caller passes to colour the system's gas cloud. */
export interface GasParams {
	/** Linear RGB colour of the gas. Derived from the star class with variation. */
	color: readonly [number, number, number];
	/** Overall density 0..1. Controls how much gas is visible. */
	density: number;
	/** Integer seed for the noise permutation table. Drawn from `DOMAIN.GAS`. */
	seed: number;
}

/** Frequency of the noise on the unit sphere. 2.0 gives features ~90° wide,
 *  which reads as a nebula rather than as a gradient. */
const GAS_FREQUENCY = 2.0;

/** Peak brightness of a fully dense gas cloud, per channel. About 2× DEEP_SKY. */
const GAS_GAIN = 0.025;

// -- Noise primitives (headless, no imports) --

/** Integer avalanche — the same construction as `rng.ts`, duplicated here so
 *  the module stays a leaf. */
function ihash(x: number): number {
	let h = x >>> 0;
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return h >>> 0;
}

/** Hash three grid coordinates + seed to a float in [0, 1). */
function hash3(ix: number, iy: number, iz: number, seed: number): number {
	return (
		ihash(
			ihash(
				ihash((seed ^ Math.imul(ix, 0x9e3779b9)) >>> 0) ^
					((iy * 73856093) >>> 0),
			) ^
				((iz * 19349663) >>> 0),
		) / 0x100000000
	);
}

function lerp(a: number, b: number, t: number): number {
	return a + t * (b - a);
}

/** Smooth 3D value noise, returns [0, 1]. */
function noise3(x: number, y: number, z: number, seed: number): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const iz = Math.floor(z);
	const fx = x - ix;
	const fy = y - iy;
	const fz = z - iz;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const sz = fz * fz * (3 - 2 * fz);
	return lerp(
		lerp(
			lerp(hash3(ix, iy, iz, seed), hash3(ix + 1, iy, iz, seed), sx),
			lerp(hash3(ix, iy + 1, iz, seed), hash3(ix + 1, iy + 1, iz, seed), sx),
			sy,
		),
		lerp(
			lerp(hash3(ix, iy, iz + 1, seed), hash3(ix + 1, iy, iz + 1, seed), sx),
			lerp(
				hash3(ix, iy + 1, iz + 1, seed),
				hash3(ix + 1, iy + 1, iz + 1, seed),
				sx,
			),
			sy,
		),
		sz,
	);
}

/** Fractal Brownian Motion — 3 octaves, returns approximately [-0.875, 0.875]. */
function fbm3(x: number, y: number, z: number, seed: number): number {
	let value = 0;
	let amp = 0.5;
	let freq = 1;
	for (let i = 0; i < 3; i++) {
		value +=
			amp * (noise3(x * freq, y * freq, z * freq, seed + i * 137) * 2 - 1);
		amp *= 0.5;
		freq *= 2;
	}
	return value;
}

/**
 * The gas contribution at one direction.
 *
 * Procedural fBm noise on the unit sphere, coloured by the system's gas
 * parameters. Baked once per system — the noise is evaluated here and not
 * per frame. Only the positive half of the noise is drawn: negative lobes
 * are clamped to zero, so the gas is additive against the floor.
 */
export function gasRadiance(
	dir: readonly [number, number, number],
	gas: GasParams,
): [number, number, number] {
	if (gas.density <= 0) return [0, 0, 0];
	const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
	const nx = (dir[0] / l) * GAS_FREQUENCY;
	const ny = (dir[1] / l) * GAS_FREQUENCY;
	const nz = (dir[2] / l) * GAS_FREQUENCY;
	const n = fbm3(nx, ny, nz, gas.seed);
	const v = GAS_GAIN * gas.density * Math.max(0, n + 0.3);
	return [v * gas.color[0], v * gas.color[1], v * gas.color[2]];
}

// ---------------------------------------------------------------------------
// Star radiance
// ---------------------------------------------------------------------------

/** Hex to linear-ish 0..1 RGB. Not an sRGB decode: the tint is authored as a
 *  colour to look at, and the star terms multiply it by 26, so a transfer
 *  function here would be a second exposure knob fighting the first. */
function tintOf(hex: number): [number, number, number] {
	return [
		((hex >> 16) & 255) / 255,
		((hex >> 8) & 255) / 255,
		(hex & 255) / 255,
	];
}

/**
 * The radiance arriving from direction `dir`, for a star of colour `starColor`.
 *
 * When `starDir` is omitted it defaults to `BAKE_STAR_DIR`, which is the
 * pre-#433 behaviour — `dir` is then in the bake's own frame. When provided,
 * the star lobe is placed at `starDir` (a world-frame unit vector), and the
 * bake is authored in world space with no per-frame rotation.
 *
 * `dir` need not be normalised exactly — it is normalised here — but it must
 * not be zero.
 */
export function envRadiance(
	dir: readonly [number, number, number],
	starColor: number,
	starDir: readonly [number, number, number] = BAKE_STAR_DIR,
): [number, number, number] {
	const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
	const sl = Math.hypot(starDir[0], starDir[1], starDir[2]) || 1;
	const cos = Math.max(
		0,
		(dir[0] * starDir[0] + dir[1] * starDir[1] + dir[2] * starDir[2]) /
			(l * sl),
	);
	const star = CORE_GAIN * cos ** CORE_POWER + HALO_GAIN * cos ** HALO_POWER;
	const tint = tintOf(starColor);
	return [
		DEEP_SKY[0] + star * tint[0],
		DEEP_SKY[1] + star * tint[1],
		DEEP_SKY[2] + star * tint[2],
	];
}

/** What `equirectEnvironment` hands back: an RGBA float image and its shape. */
export interface EquirectEnvironment {
	/**
	 * RGBA, row-major from v = 0, `width * height * 4` floats.
	 *
	 * Pinned to a plain `ArrayBuffer` rather than left as the default
	 * `ArrayBufferLike`, because `DataTexture` will not take a view that might
	 * be over a `SharedArrayBuffer` — and the buffer this allocates never is.
	 */
	data: Float32Array<ArrayBuffer>;
	width: number;
	height: number;
}

/** Full sky bake parameters for the world-frame path (node #433). */
export interface SkyBakeParams {
	starColor: number;
	/** Star direction in the system's world frame. Unit vector. */
	starDir: readonly [number, number, number];
	/** Cluster haze. `null` to omit. */
	haze: HazeParams | null;
	/** Per-system gas. `null` to omit. */
	gas: GasParams | null;
	/** When false (the `low` quality setting), drops the haze and gas fill.
	 *  The star lobe and floor remain so reflections are not black. */
	includeHaze: boolean;
}

/**
 * The bake, as an equirectangular RGBA float image.
 *
 * Equirectangular rather than six cube faces because the mapping is one line
 * that `three` states in its own shader — `u = atan2(z, x) / 2π + 0.5`,
 * `v = asin(y) / π + 0.5` — against six faces each with their own axis
 * permutation and two of them flipped. The inverse is taken here, at texel
 * centres, so a texel's direction is the direction `three` will sample it for.
 *
 * Row 0 is v = 0, which is `y = -1`: a `DataTexture` uploads its first row at
 * the bottom of UV space. Getting that backwards mirrors the image through the
 * equator, which for a star on the equator is invisible — which is precisely
 * why the check that matters is a probe reading a lit hull rather than anything
 * in this file.
 *
 * Accepts either a plain `starColor` (pre-#433 path: star at `BAKE_STAR_DIR`,
 * no haze, no gas) or a full {@link SkyBakeParams} (world-frame path: star at
 * the caller's direction, with haze and gas).
 */
export function equirectEnvironment(
	paramsOrColor: number | SkyBakeParams,
	width = ENV_WIDTH,
	height = ENV_HEIGHT,
): EquirectEnvironment {
	const full = typeof paramsOrColor === "object";
	const starColor = full ? paramsOrColor.starColor : paramsOrColor;
	const starDir: readonly [number, number, number] = full
		? paramsOrColor.starDir
		: BAKE_STAR_DIR;
	const haze = full && paramsOrColor.includeHaze ? paramsOrColor.haze : null;
	const gas = full && paramsOrColor.includeHaze ? paramsOrColor.gas : null;

	const data = new Float32Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const v = (y + 0.5) / height;
		const lat = (v - 0.5) * Math.PI;
		const dy = Math.sin(lat);
		const ring = Math.cos(lat);
		for (let x = 0; x < width; x++) {
			const u = (x + 0.5) / width;
			const lon = (u - 0.5) * Math.PI * 2;
			const dz = Math.sin(lon) * ring;
			const dx = Math.cos(lon) * ring;
			const dir: [number, number, number] = [dx, dy, dz];
			const [sr, sg, sb] = envRadiance(dir, starColor, starDir);
			let r = sr;
			let g = sg;
			let b = sb;
			if (haze) {
				const [hr, hg, hb] = hazeRadiance(dir, haze);
				r += hr;
				g += hg;
				b += hb;
			}
			if (gas) {
				const [gr, gg, gb] = gasRadiance(dir, gas);
				r += gr;
				g += gg;
				b += gb;
			}
			const i = (y * width + x) * 4;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = 1;
		}
	}
	return { data, width, height };
}

/**
 * The quaternion that carries `BAKE_STAR_DIR` onto `starDir`, as `[x, y, z, w]`.
 *
 * The shortest arc, which is the same thing `THREE.Quaternion.setFromUnitVectors`
 * builds — reimplemented here rather than called there because `light-rig.ts`
 * imports no Three.js, and because a rotation that lives in the renderer is a
 * rotation nothing headless can check. See this file's header for what that
 * cost: the inverse rotation passed every check the repo had.
 *
 * `starDir` need not be normalised; it must not be zero.
 *
 * **The antiparallel case is the one worth reading.** When `starDir` is exactly
 * opposite the bake's axis there is no shortest arc — every half-turn about
 * every perpendicular axis is equally short — so an axis has to be *chosen*,
 * and `cross` is zero and cannot choose it. Any perpendicular is correct, since
 * the bake is rotationally symmetric about its own star axis and a half-turn
 * about any of them lands the lobe in the same place. Picking one arbitrarily
 * rather than leaving the branch out is the difference between a defined answer
 * and a NaN quaternion, which renders as an unlit scene rather than as an error.
 */
export function envRotation(
	starDir: readonly [number, number, number],
): [number, number, number, number] {
	// The arithmetic is `quat.ts`'s `shortestArc`, which #430 moved out of this
	// function rather than let a second copy of a 180°-safe shortest arc arrive in
	// the sky. What that changed, by how much, and what it costs in the sampled
	// environment are measured rather than described, by two rows in
	// `tests/light-rig.test.ts` — `the shared primitive returns the rotation this
	// function computed itself` and `near exact antiparallel the old arm misses the
	// star and the new one does not`. The refactor's history belongs in those rows
	// and in the commit that made it; a comment above a call is the wrong place for
	// a changelog, and the wrong place for numbers that can go stale.
	const q = shortestArc(
		v3(BAKE_STAR_DIR[0], BAKE_STAR_DIR[1], BAKE_STAR_DIR[2]),
		v3(starDir[0], starDir[1], starDir[2]),
	);
	// A star direction with no direction in it throws, where the old inline form
	// produced a quaternion of NaNs. That propagates: `main.ts` reads this back into
	// `ENV_EULER` and then into `scene.environmentRotation`, so a NaN here is a NaN
	// rotation applied to every direction the environment is sampled along — chrome
	// plating reading a direction that does not exist, with nothing printed.
	//
	// #430 did not leave it to this line to decide what happens in that case. The
	// one caller in the render path has the direction's length in hand and skips the
	// update when it is zero — a camera standing exactly on its own star has no
	// direction *to* the star, and last frame's aim is the answer for that frame.
	// So this is the tripwire for a second caller, and the row named below is why it
	// is a refusal rather than a comment about being careful.
	if (q === null)
		throw new Error("envRotation: the star direction carries no direction");
	return [q[0], q[1], q[2], q[3]];
}
