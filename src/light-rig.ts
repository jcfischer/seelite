/**
 * The light rig, and the environment a reflection is a reflection *of*.
 *
 * #98 settled that this game is short on **depth and light** rather than on
 * grime, and #99 asked whether a flat ambient plus one fill is the whole rig.
 * It is not, and the reason is one line of state: `scene.environment` was unset
 * repo-wide. Station plating carries `metalness` per texel from
 * `station-visuals.ts`'s profiles (0.14–0.5 before the wear map cuts it) and a
 * hull sits at 0.08–0.1 (`ship-mesh.ts`), and metalness with no environment
 * *subtracts* diffuse and adds nothing back — so the more metal a surface
 * claimed to be, the deader it rendered. That is visible in the before sheet:
 * the trade station at three silhouette radii is a ring of flat grey facets
 * with no highlight anywhere on it, and its plating grid is not resolvable at
 * all.
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
 * That rotation is also the one thing no test in this file can check — see the
 * header of `tests/light-rig.test.ts`. A bake sampled back-to-front puts the
 * reflection on the side *away* from the star, which looks wrong and measures
 * perfectly; `probe-light-rig.mjs` reads the pixels either side of a lit hull
 * and requires the star side to be brighter, which is false on a flipped bake
 * and equally false on no bake at all.
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
 * The rig, in one place because the panel, the bake and the renderer all read
 * it and three copies drift.
 *
 * The sun and the fill are carried over unchanged from the rig they replace,
 * and that is deliberate rather than incidental: the fill's docstring in
 * `main.ts` records the measurement that produced it — with the star behind the
 * ship the hull rendered as a black cutout — and #99's brief was to add depth,
 * not to re-open a fix.
 */
export const LIGHT_RIG = {
	/** Directional, because one light cannot serve two scenes at two scales;
	 *  `main.ts` has the argument. */
	sun: { color: 0xfff0d8, intensity: 3.0 },
	/**
	 * The ambient replacement. Aimed along the star, so `sky` is the lift on the
	 * star side and `ground` the lift on the far side.
	 *
	 * Together these sit close to the `0x223044` at 0.6 they replace in total
	 * energy, and spend it as a gradient instead of a wash. The far side is
	 * *darker* than the flat ambient was, which is the point: #59 fixed the
	 * planet classes so the crescent reads, and a flat lift is what flattens it.
	 */
	hemisphere: { sky: 0x2f4666, ground: 0x0a1018, intensity: 0.9 },
	/** Camera-side, near layer only, off-axis. Unchanged. */
	fill: { color: 0x9fb6d0, intensity: 0.9 },
	/**
	 * How hard the baked environment is applied, as `Scene.environmentIntensity`.
	 *
	 * Set by opening the sheet, and there is no check in this repo that can set
	 * it — #104's finding one level down. **Bracketed rather than guessed**:
	 * three captures of `station-approach` at 1.0, 2.2 and 3.6. At 1.0 the
	 * plating grid becomes visible and nothing else changes, which is a term
	 * that is on and not worth having; at 3.6 the star-facing facet goes pale
	 * and loses the grid again under a wash. 2.2 is where the gradient across
	 * the facets is strongest with the plating still legible on both.
	 *
	 * A number that decides whether a frame looks right cannot be checked by
	 * anything that is not looking, so retuning it means reopening those PNGs.
	 */
	environmentIntensity: 2.2,
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
		high: { environment: true, hemisphere: true, exposure: 1.0 },
		low: { environment: false, hemisphere: true, exposure: 1.0 },
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
