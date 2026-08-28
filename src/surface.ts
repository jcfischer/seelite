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
	/** Panel pitch **across** the map, texels. Small is a tight civil hull;
	 *  large is structural. With `aspect` this is the plate's short side. */
	pitchPx: number;
	/**
	 * How many times longer a plate is than it is wide, along the second axis.
	 *
	 * **1 is a square, and a square grid is what makes a surface read as scales
	 * rather than as plating.** Rolled steel comes off the mill in long strips
	 * and a hull is planked with them lengthwise; a wall of identical squares is
	 * tiling, and the eye names it as such immediately.
	 *
	 * Rounded to a whole number of rows, because the map wraps: a row count that
	 * does not divide the map leaves a truncated row at the seam whose boundary
	 * doubles on the repeat. So the achieved aspect is `cols / round(cols /
	 * aspect)` and not exactly this — at 8 columns, an asked-for 4 is exactly 4
	 * and an asked-for 3 is also 4.
	 */
	aspect: number;
	/**
	 * How far alternate rows are offset, as a fraction of a plate's width.
	 *
	 * **0 leaves a continuous seam running the whole length of the hull**, in
	 * both axes, which is the other half of what reads as tiling. Half a plate
	 * is a brick bond and is what plating actually is.
	 *
	 * Only even row counts wrap cleanly: with an odd count the last row and the
	 * first are both unshifted and sit adjacent on the repeat. Nothing enforces
	 * that, because the visible cost is one doubled row in a tile nobody is
	 * looking at edge-on.
	 */
	stagger: number;
	/**
	 * Half the width of the groove cut into the normal map, texels.
	 *
	 * **The single largest driver of the scale-like read.** At 2 against a
	 * 16-texel pitch the bevel is a quarter of every plate on all four sides, so
	 * each one domes into a pillow — a 25 cm chamfer on a 1 m plate, where a
	 * real seam is millimetres. What a plate wants is a flat face and a scribed
	 * line, which means the smallest groove the map's resolution allows and a
	 * pitch wide enough in texels that it stays small.
	 */
	seamHalfWidthPx: number;
	/**
	 * Panel-to-panel brightness spread, 8-bit levels either side of the base.
	 *
	 * Large enough and every plate is its own tone, which is a patchwork rather
	 * than one skin with lines scribed into it. It is the seam that says
	 * "plating"; this only says the plates were not cut from one sheet.
	 */
	variation: number;
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
 * Where the plates are: **one definition, read by both maps.**
 *
 * `plateTexels` darkens the seams and `seamNormalTexels` grooves them, and #36
 * recorded what happens when two maps that must agree derive their geometry
 * independently — a shine that misses its own seam. An embossed seam that
 * misses its own painted one is that defect one channel over. So the layout is
 * built once and handed to both, and neither recomputes any part of it.
 *
 * **A whole number of plates in each axis**, because the map wraps
 * (`RepeatWrapping`): a pitch that does not divide the size leaves a truncated
 * plate at the edge whose boundary doubles on the repeat.
 *
 * The stagger is what makes this two-dimensional rather than two independent
 * axes. A plate's column depends on its row, so there is no list of boundary
 * columns that describes the map — which is why this returns predicates and not
 * the offsets an earlier version handed out.
 */
export function plateLayout(
	profile: PlatingProfile,
	size = PLATE_TEXTURE_SIZE,
) {
	const cols = Math.max(1, Math.round(size / profile.pitchPx));
	const rows = Math.max(1, Math.round(cols / profile.aspect));
	const width = size / cols;
	const rowOf = (y: number) => Math.floor((y * rows) / size);
	/** How far this row is pushed along, texels. Alternate rows only, so the
	 *  pattern is a brick bond rather than a shear. */
	const shiftOf = (row: number) => (row % 2) * profile.stagger * width;
	const colOf = (x: number, row: number) =>
		Math.floor((((x - shiftOf(row) + size) % size) * cols) / size);
	/**
	 * Signed distance to the nearest seam **centre**, in each axis.
	 *
	 * The centre is a boundary plus a half texel: a boundary lies *between* two
	 * texels, so measuring from the texel itself puts one exactly at the bottom
	 * of the groove, where its slope is undefined and has to be encoded as flat.
	 * A flat column down the middle of every seam is the same defect a smoothed
	 * profile has, and at these widths it is a third of the groove.
	 */
	const toSeam = (n: number, boundary: (m: number) => boolean) => {
		let best = size;
		for (let m = 0; m < size; m++) {
			if (!boundary(m)) continue;
			const raw = n - (m + 0.5);
			const wrapped =
				raw > size / 2 ? raw - size : raw < -size / 2 ? raw + size : raw;
			if (Math.abs(wrapped) < Math.abs(best)) best = wrapped;
		}
		return best;
	};
	const seamAcross = (x: number, row: number) =>
		colOf(x, row) !== colOf((x + 1) % size, row);
	const seamAlong = (y: number) => rowOf(y) !== rowOf((y + 1) % size);
	return {
		cols,
		rows,
		width,
		rowOf,
		colOf,
		/** Whether a texel sits on a seam in either axis — what the albedo
		 *  darkens. */
		onSeam: (x: number, y: number) => {
			const row = rowOf(y);
			return seamAcross(x, row) || seamAlong(y);
		},
		/** Distance to the nearest groove centre in each axis, for the normal
		 *  map. Across depends on the row, which is the whole point of the
		 *  stagger. */
		distanceTo: (x: number, y: number) => {
			const row = rowOf(y);
			return {
				across: toSeam(x, (m) => seamAcross(m, row)),
				along: toSeam(y, seamAlong),
			};
		},
	};
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
	const { seam, weathering, variation } = profile;
	const out = new Uint8Array(size * size * 4);
	// **The one layout**, shared with `seamNormalTexels` — see `plateLayout`.
	const layout = plateLayout(profile, size);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			// Streaks run *down* the hull: the envelope varies with x and persists
			// in y, so a run of soot is a vertical band. Sampled from y it bands
			// horizontally instead and chops the finer streak below into segments,
			// which reads as dirt in rows.
			const grime = streak(`${tag}-grime`, x, 9) * weathering;
			const row = layout.rowOf(y);
			const plate = hash01(`${tag}-plate`, layout.colOf(x, row), row);
			// Panel-to-panel variation is small; the seam between them is what the
			// eye reads as plating at all.
			let v = 196 + (plate - 0.5) * 2 * variation;
			if (layout.onSeam(x, y)) v *= 1 - seam;
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
	const layout = plateLayout(profile, size);
	const half = profile.seamHalfWidthPx;
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
	const slope = (d: number) => (Math.abs(d) >= half ? 0 : Math.sign(d) / half);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const { across, along } = layout.distanceTo(x, y);
			// Each axis contributes its own groove independently, so a plate
			// corner is a pit rather than a crossing of two lines that cancel.
			// `+depth × slope` and not `−`, because the groove goes *down*: the
			// surface tilts towards the cut on each side.
			const nx = profile.seamDepth * slope(across);
			const ny = profile.seamDepth * slope(along);
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
