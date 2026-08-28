/**
 * How a plated surface is *generated*, for every consumer that wants one.
 *
 * This began as `station-visuals.ts`'s texel half (#36) and became its own
 * module when #101 gave it a second consumer and #105 a third. The decision
 * recorded there was **one system rather than two**, and the reason is
 * structural rather than tidiness: `hullLoft` already writes UVs in kilometres
 * (`loft.ts`), and `hullLoft` is the ship's own primitive that stations
 * borrowed. A station's plating is therefore three lines and a panel size away
 * from being a hull's, and a second generator would be the same arithmetic
 * written twice — then three times, when the cockpit arrives.
 *
 * **No Three.js here, deliberately**, and it is `station-visuals.ts`'s reason
 * unchanged: everything below is arithmetic over a byte buffer, so it runs in
 * the headless tier where a buffer of the wrong length is a failing assertion
 * rather than something a player notices. The Three-side companions are
 * `station-mesh.ts` and `ship-surface.ts`; nothing here imports either.
 *
 * **Keyed by a profile and a tag, never by a type.** The generators used to
 * read `STATION_VISUALS[type]`, which made every caller a station. A profile
 * is passed in and the tag seeds the hashes, so `station-visuals.ts` keeps its
 * `Record<StationType, …>` — and with it #36's guarantee that a fourth station
 * type stops the build — while a ship supplies its own profile.
 */

/** What a generated plating map looks like, for one consumer. */
export interface PlatingProfile {
	/** Panel pitch, texels. Small is a tight civil hull; large is structural. */
	pitchPx: number;
	/** How far a seam darkens the plate beneath it, 0–1. */
	seam: number;
	/** How much vertical streaking the surface carries, 0–1. */
	weathering: number;
	/** The material's roughness and metalness where the map is neutral. */
	roughness: number;
	metalness: number;
	/**
	 * How deep the seams are cut into the *normal* map, 0–1. Zero means the
	 * consumer has no normal map at all and its seams are painted.
	 *
	 * Required rather than optional, for the same reason the station record is
	 * a `Record` and not a `Partial`: a new consumer must answer the question
	 * rather than inherit an answer.
	 *
	 * Every station role answers **0**. #101 gave ships an embossed seam and
	 * deliberately left the stations' painted one alone: changing how a station
	 * looks is a judgement somebody has to make in front of a frame, and nobody
	 * made it in that node. Zero there is an answer, not an omission.
	 */
	seamDepth: number;
}

/** The generated maps are square and this is the side, texels. Small on
 *  purpose: plating is a surface language read at a few hundred pixels, not a
 *  photograph, and every consumer of one profile shares its buffers. */
export const PLATE_TEXTURE_SIZE = 128;

/** FNV-1a over a tag, as a seed. */
function hashSeed(tag: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < tag.length; i++) {
		h ^= tag.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * A deterministic value in [0, 1) from a string tag and two integers.
 *
 * Its whole contract is that it is a pure function: the texels below and
 * `station-visuals.ts`'s flicker both have to replay exactly, on every load and
 * on every client at the same clock.
 */
export function hash01(tag: string, a: number, b: number): number {
	let h = hashSeed(tag);
	h ^= Math.imul(a | 0, 0x27d4eb2d);
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
	h ^= Math.imul(b | 0, 0x165667b1);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise over one axis, so a streak has a width rather than being
 *  one texel wide. One dimension is all the streaking needs: it runs down the
 *  hull, and the variation across it is what the seams already give. */
function streak(tag: string, x: number, scale: number): number {
	const p = x / scale;
	const i = Math.floor(p);
	const f = p - i;
	const smooth = f * f * (3 - 2 * f);
	return hash01(tag, i, 0) * (1 - smooth) + hash01(tag, i + 1, 0) * smooth;
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * How many whole panels the map carries across one axis.
 *
 * **A whole number of panels.** The pitch is an authored intent in texels, but
 * the map wraps (`RepeatWrapping`), so a pitch that does not divide the size
 * leaves a truncated panel at the seam and its boundary doubles when the
 * texture repeats. Rounding to a count and deriving the boundaries from that
 * keeps the authored figure meaningful and the wrap clean.
 */
export const panelCount = (profile: PlatingProfile, size: number) =>
	Math.max(1, Math.round(size / profile.pitchPx));

/**
 * Which texel columns a panel boundary falls on.
 *
 * **One boundary set, two maps.** `plateTexels` darkens these columns and
 * `seamNormalTexels` grooves them, and #36 recorded what happens when two maps
 * that must agree are each derived independently: a shine that misses its own
 * seam. An embossed seam that misses its own painted one is that defect one
 * channel over, so both read this.
 *
 * A texel is on a seam when the next texel — wrapping at the edge — belongs to
 * a different panel. That gives exactly `panelCount` boundaries in each axis
 * and puts one of them on the wrap, where it belongs. The two axes share the
 * rule, so the returned lists are equal; both are returned anyway, because a
 * caller reading one and assuming the other is how the rule stops holding.
 */
export function seamOffsets(
	profile: PlatingProfile,
	size = PLATE_TEXTURE_SIZE,
) {
	const panels = panelCount(profile, size);
	const panelOf = (n: number) => Math.floor((n * panels) / size);
	const at: number[] = [];
	for (let n = 0; n < size; n++)
		if (panelOf(n) !== panelOf((n + 1) % size)) at.push(n);
	return { x: at, y: [...at] };
}

/**
 * The profile's albedo plating, RGBA, `size` square.
 *
 * **Greyscale by construction**: R, G and B are written from one value, so the
 * consumer's own colour still multiplies through — `STATION_COLORS[type]` for a
 * station, a hull livery for a ship. A coloured plate map would replace that
 * cue with a painted one.
 *
 * The buffer is exactly `4 × w × h`, which `THREE.DataTexture` with
 * `RGBAFormat` requires and does not check: a short buffer samples past its end
 * and draws garbage rather than throwing.
 */
export function plateTexels(
	profile: PlatingProfile,
	tag: string,
	size = PLATE_TEXTURE_SIZE,
) {
	const { seam, weathering } = profile;
	const out = new Uint8Array(size * size * 4);
	const panels = panelCount(profile, size);
	const panelOf = (n: number) => Math.floor((n * panels) / size);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			// Streaks run *down* the hull: the envelope varies with x and persists
			// in y, so a run of soot is a vertical band. Sampled from y it bands
			// horizontally instead and chops the finer streak below into segments,
			// which reads as dirt in rows.
			const grime = streak(`${tag}-grime`, x, 9) * weathering;
			const plate = hash01(`${tag}-plate`, panelOf(x), panelOf(y));
			// Panel-to-panel variation is small; the seam between them is what the
			// eye reads as plating at all.
			let v = 196 + (plate - 0.5) * 26;
			const onSeam =
				panelOf(x) !== panelOf((x + 1) % size) ||
				panelOf(y) !== panelOf((y + 1) % size);
			if (onSeam) v *= 1 - seam;
			// Weathering darkens rather than tints: a soot streak is missing light,
			// and tinting it would break the greyscale contract above.
			v *= 1 - grime * 0.55 * streak(`${tag}-run`, x, 5);
			const g = clamp255(v);
			const i = (y * size + x) * 4;
			out[i] = g;
			out[i + 1] = g;
			out[i + 2] = g;
			out[i + 3] = 255;
		}
	}
	return out;
}

/**
 * The profile's roughness and metalness map, RGBA.
 *
 * Green is roughness and blue is metalness, which is the channel layout
 * `MeshStandardMaterial` samples `roughnessMap` and `metalnessMap` from — so one
 * buffer serves as both and there is no second texture upload. Red is left at
 * full: an `aoMap` reads it, and nothing here has one.
 *
 * Seams and grime are rougher and less metallic than the plate they sit on,
 * which is what stops a surface reading as one moulded object under a moving
 * sun.
 */
export function wearTexels(
	profile: PlatingProfile,
	/** The albedo this is derived from. Required rather than optional: the two
	 *  maps must come from the *same* buffer or a shine can miss its own seam,
	 *  and an optional argument is how the second call gets forgotten. */
	albedo: Uint8Array,
	size = PLATE_TEXTURE_SIZE,
) {
	const { roughness, metalness } = profile;
	// A buffer of the wrong length would be read past its end by the loop below
	// and produce a map that is garbage from some row down — the same failure
	// mode as a short `DataTexture`, one step earlier.
	if (albedo.length !== size * size * 4)
		throw new Error(
			`albedo is ${albedo.length} bytes, expected ${size * size * 4}`,
		);
	const out = new Uint8Array(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		// Darker plate means seam or grime, both of which are rougher.
		//
		// **A factor, not an offset**, and the map's own clamp-bite constraint
		// (#13) is why. Written as `roughness + wear × 0.5` the refinery's 0.9
		// ceiling plus a wear of 0.6 saturates at 1.0 across almost the whole
		// plate: the map collapses to two distinct values and the role with the
		// most weathering is the one whose weathering stops showing.
		const wear = Math.min(1, (1 - albedo[i * 4] / 255) / 0.7);
		out[i * 4] = 255;
		out[i * 4 + 1] = clamp255(roughness * (0.55 + 0.45 * wear) * 255);
		out[i * 4 + 2] = clamp255(metalness * (1 - 0.8 * wear) * 255);
		out[i * 4 + 3] = 255;
	}
	return out;
}

/**
 * How many texels wide the groove either side of a boundary is.
 *
 * Not one texel. A one-texel step has a gradient on one side only, so it
 * encodes a *ramp* rather than a groove and the hull reads as tilted plates
 * rather than plates with a line between them. Two texels is the narrowest that
 * gives the central difference below something symmetric to read.
 */
const SEAM_HALF_WIDTH_PX = 2;

/**
 * The profile's seam normal map, RGBA, tangent space.
 *
 * #101's answer to *where do panel lines live*: in the normal, so a seam is lit
 * rather than painted — a moving sun breaks across it, which is the thing the
 * reference frames do that a darkened texel cannot. The albedo still carries
 * its own faint darkening, because a groove in shadow is darker and a map that
 * emitted only one of the two reads as either a decal or a dent.
 *
 * **Derived from `seamOffsets`, not from a second pass over the panel
 * arithmetic**, so the emboss cannot land anywhere but on a painted seam.
 *
 * `seamDepth === 0` returns a flat map, which is the station case and is also
 * the control the tests measure the ship case against: same generator, same
 * boundaries, one term off.
 */
export function seamNormalTexels(
	profile: PlatingProfile,
	size = PLATE_TEXTURE_SIZE,
) {
	const out = new Uint8Array(size * size * 4);
	const { x: boundaries } = seamOffsets(profile, size);
	/**
	 * Signed distance from texel `n` to the centre of the nearest groove.
	 *
	 * The centre is `b + 0.5`, not `b`. A boundary lies *between* texel `b` and
	 * texel `b + 1` — that is what `seamOffsets` means by it — so measuring from
	 * `b` puts one texel exactly at the bottom of the V, where the slope is
	 * undefined and this function would have to encode it as flat. A flat texel
	 * down the middle of every seam is the same defect a smoothstep profile has,
	 * and it would have shipped unnoticed: it is one column in four.
	 */
	const toSeam = (n: number) => {
		let best = size;
		for (const b of boundaries) {
			const raw = n - (b + 0.5);
			const wrapped =
				raw > size / 2 ? raw - size : raw < -size / 2 ? raw + size : raw;
			if (Math.abs(wrapped) < Math.abs(best)) best = wrapped;
		}
		return best;
	};
	/**
	 * The groove's slope at a signed distance from its centre.
	 *
	 * A V rather than a smoothstep: the gradient is what is being encoded, and a
	 * smoothstep's gradient is zero at the bottom of the groove — which puts a
	 * flat texel in the middle of every seam and reads as a line with a hole in
	 * it. A V has a constant slope either side and a sign flip at the centre,
	 * which is what a cut plate edge actually looks like. The slope is emitted
	 * directly rather than differenced out of a height field, because a central
	 * difference taken across the centre reads the two opposite slopes and
	 * cancels them to flat.
	 */
	const slope = (d: number) =>
		Math.abs(d) >= SEAM_HALF_WIDTH_PX ? 0 : Math.sign(d) / SEAM_HALF_WIDTH_PX;
	// One scan per column, not per texel: `toSeam` walks every boundary, and the
	// answer depends on one coordinate. Inside the inner loop it ran size² times
	// for size distinct answers, and the waste grows with the square of
	// `PLATE_TEXTURE_SIZE`.
	const distance = Array.from({ length: size }, (_, n) => toSeam(n));
	for (let y = 0; y < size; y++) {
		const dy = distance[y];
		for (let x = 0; x < size; x++) {
			const dx = distance[x];
			// Each axis contributes its own groove independently, so a panel
			// corner is a pit rather than a crossing of two lines that cancel.
			// `+depth × slope` and not `−`, because the groove goes *down*: the
			// surface tilts towards the cut on each side.
			const nx = profile.seamDepth * slope(dx);
			const ny = profile.seamDepth * slope(dy);
			// GL convention: +Y is up in the tangent frame, and Z is out of the
			// surface. Normalised so the decoded vector is unit length, which is
			// what three.js's `normal_fragment_maps` assumes of a normal map.
			const length = Math.hypot(nx, ny, 1);
			const i = (y * size + x) * 4;
			out[i] = clamp255((nx / length) * 0.5 * 255 + 127.5);
			out[i + 1] = clamp255((ny / length) * 0.5 * 255 + 127.5);
			out[i + 2] = clamp255((1 / length) * 0.5 * 255 + 127.5);
			out[i + 3] = 255;
		}
	}
	return out;
}
