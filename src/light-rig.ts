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
 * ## What the sky is a picture of, and what it is not
 *
 * A star and a floor. Deliberately **not** a nebula: what the backdrop is a
 * picture of is [#100](https://github.com/jcfischer/seelite/issues/100)'s
 * question, and baking a guess at it here would answer that node by accident
 * in a file it does not own. The seam is left where it is cheap to take: when
 * #100 lands, `envRadiance` gains the same haze term the drawn backdrop uses,
 * and the bake picks it up with no other change. Until then this is a
 * *lighting* environment rather than a picture — which is why nothing draws it.
 *
 * ## Baked in its own frame, and rotated to the world
 *
 * The star sits at `BAKE_STAR_DIR` in the bake, and the renderer sets
 * `Scene.environmentRotation` each frame to carry that onto the real star
 * direction. Rebaking instead would be a PMREM pass on a frame the player is
 * flying, for a direction that changes continuously; a rotation is a
 * quaternion.
 *
 * **The rotation is derived here rather than in the renderer**, and that is the
 * whole reason `envRotation` exists as a function instead of a line of
 * `main.ts`. Written there it was `setFromUnitVectors(BAKE_STAR_UNIT, STAR_DIR)`
 * — correct, and *indistinguishable from its own inverse* by anything this
 * repo could run: swapping those two arguments left `probe-light-rig.mjs`
 * green, because the inverse rotation lands the lobe 2θ from the star and θ was
 * small for the seed the probe flies. The direction of the one transform the
 * whole rig depends on then rested on argument order alone, restated as settled
 * in three files.
 *
 * As a function it has a property a headless test can hold and a swap breaks:
 * applying it to `BAKE_STAR_DIR` returns the direction it was given, for every
 * direction including the antiparallel one. `tests/light-rig.test.ts` sweeps
 * that; `probe-light-rig.mjs` still checks the end-to-end effect, because a
 * correct rotation applied to a bake that never reached the scene is also
 * green here.
 */

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
	 * What `quality` selects. #98 required this node to ship a low setting and
	 * to say what it drops.
	 *
	 * Low drops the image-based term and keeps everything else. The hemisphere
	 * costs exactly what the flat ambient it replaced cost — one more term in a
	 * loop that already runs — so dropping it would buy nothing and lose the
	 * gradient; the environment is the term with a per-fragment texture sample
	 * on every standard material in the frame, and a load-time PMREM pass.
	 */
	quality: {
		high: { environment: true, hemisphere: true, exposure: 1 },
		low: { environment: false, hemisphere: true, exposure: 1 },
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
 * `dir` is in the bake's frame, where the star is at `BAKE_STAR_DIR`. It need
 * not be normalised exactly — it is normalised here — but it must not be zero.
 */
export function envRadiance(
	dir: readonly [number, number, number],
	starColor: number,
): [number, number, number] {
	const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
	const cos = Math.max(
		0,
		(dir[0] * BAKE_STAR_DIR[0] +
			dir[1] * BAKE_STAR_DIR[1] +
			dir[2] * BAKE_STAR_DIR[2]) /
			l,
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
 */
export function equirectEnvironment(
	starColor: number,
	width = ENV_WIDTH,
	height = ENV_HEIGHT,
): EquirectEnvironment {
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
			const [r, g, b] = envRadiance([dx, dy, dz], starColor);
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
	const l = Math.hypot(starDir[0], starDir[1], starDir[2]);
	const to: [number, number, number] = [
		starDir[0] / l,
		starDir[1] / l,
		starDir[2] / l,
	];
	const from = BAKE_STAR_DIR;
	const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
	// Half-turn: build a unit vector perpendicular to `from` and rotate 180°
	// about it, which is the quaternion (axis, 0).
	if (dot < -1 + 1e-9) {
		// Cross with whichever world axis `from` is least parallel to, so the
		// perpendicular never degenerates — `view-placement.mjs` picks its frame
		// the same way and for the same reason.
		const away: [number, number, number] =
			Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
		const ax = from[1] * away[2] - from[2] * away[1];
		const ay = from[2] * away[0] - from[0] * away[2];
		const az = from[0] * away[1] - from[1] * away[0];
		const al = Math.hypot(ax, ay, az);
		return [ax / al, ay / al, az / al, 0];
	}
	const x = from[1] * to[2] - from[2] * to[1];
	const y = from[2] * to[0] - from[0] * to[2];
	const z = from[0] * to[1] - from[1] * to[0];
	const w = 1 + dot;
	const n = Math.hypot(x, y, z, w);
	return [x / n, y / n, z / n, w / n];
}
