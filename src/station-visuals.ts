/**
 * The numbers behind #36's visual pass — surface, light, activity, and how much
 * of any of it is drawn (`docs/specs/station-visuals.md`).
 *
 * **No Three.js here, deliberately**, and for a sharper reason than `station.ts`
 * has. Everything below is arithmetic: a band over a scalar, a waveform over the
 * game clock, and two buffers of texels. Kept as arithmetic it runs in the
 * headless tier, where a `DataTexture` whose buffer is the wrong length can be
 * caught by a length assertion instead of by someone noticing that a station
 * looks wrong. `station-mesh.ts` is the Three-side companion and imports this;
 * nothing here imports it back.
 *
 * **The plating is a `DataTexture`, never a `CanvasTexture`** (§4). This module
 * is reached from `tests/`, which has no `document`. A canvas would force a
 * `typeof document !== "undefined"` branch, and the branch that ships to players
 * would be the one no test ever takes.
 *
 * `station-mesh.ts` keeps its own `displayRand` for the asteroid and the window
 * grid. That is not a duplicate of `hash01` below: those feed *geometry* built
 * once at load, and this feeds texels and waveforms. Merging them would put a
 * shape and a light on the same stream, so a change to either moves the other.
 */

import type { StationType } from "./station";
import { HANDOFF_HYSTERESIS } from "./units";

/**
 * How much of a station is drawn, given how large it appears.
 *
 * `full` is a station you are flying at, `reduced` one in the same volume of
 * space, `outline` a lit shape among the planets.
 */
export type StationDetailLevel = "full" | "reduced" | "outline";

/**
 * The band edges, in **the station's own silhouette radii** (§3).
 *
 * Radii and not kilometres, because a rule in kilometres gives the refinery's
 * 0.4 km core detail nobody can resolve at the range it strips the shipyard's
 * 1.5 km frame of detail that is still legible. `distanceKm / silhouetteKm` is
 * the same question asked of every type.
 */
export const DETAIL_RADII = { full: 40, reduced: 400 } as const;

/**
 * Which level to draw, given the current one.
 *
 * The same state machine as `layerFor` (`units.ts`) and reading the same
 * `HANDOFF_HYSTERESIS`, so the two bands cannot drift apart: a station already
 * at a level is held there until it is 5% past the threshold. Without the
 * directional band a station parked on an edge switches its whole detail set
 * every frame, which is far more visible than any detail it is choosing
 * between.
 *
 * `current` is `undefined` for a station not yet placed, which resolves as the
 * undirected reading.
 */
export function stationDetailLevel(
	current: StationDetailLevel | undefined,
	apparentRadii: number,
): StationDetailLevel {
	const held = (threshold: number, level: StationDetailLevel) =>
		current === level ? threshold * HANDOFF_HYSTERESIS : threshold;
	if (apparentRadii <= held(DETAIL_RADII.full, "full")) return "full";
	if (apparentRadii <= held(DETAIL_RADII.reduced, "reduced")) return "reduced";
	return "outline";
}

/** What the generated plating looks like for one role (§4). */
export interface PlatingProfile {
	/** Panel pitch, texels. Small is a tight civil hull; large is structural. */
	pitchPx: number;
	/** How far a seam darkens the plate beneath it, 0–1. */
	seam: number;
	/** How much vertical streaking the role carries, 0–1. */
	weathering: number;
	/** The material's roughness and metalness where the map is neutral. */
	roughness: number;
	metalness: number;
}

/** The one emissive signature and the one motion a role carries (§5). */
export interface ActivityProfile {
	/** Beacon flash period, seconds. Zero for a role with no beacons. */
	beaconPeriodS: number;
	/** Fraction of the period a beacon is lit. */
	beaconDuty: number;
	/** Flicker rate, Hz. */
	flickerHz: number;
	/** How deep the flicker cuts, 0–1. Zero is a steady light. */
	flickerDepth: number;
	/** Whether the flicker interpolates between ticks — a flare breathing —
	 *  or steps between them, which is what an arc does. */
	flickerSmooth: boolean;
}

export interface StationVisualProfile {
	plating: PlatingProfile;
	activity: ActivityProfile;
	/** Habitation light behind the window grid. */
	windowColor: number;
	/** The two navigation beacons on the spin axis, port and starboard. Both
	 *  present for every role so the record answers for each; a role with a zero
	 *  beacon period never lights them. */
	beaconPortColor: number;
	beaconStarboardColor: number;
	/** Work light: the shipyard's cold bays, the refinery's arc. */
	floodColor: number;
	/** Heat: the refinery's flare and the dull glow at its drum. */
	heatColor: number;
}

/**
 * Per-role surface and light.
 *
 * A `Record<StationType, …>` for `station-types.md` §8.5's reason, which is the
 * same reason `STATION_GEOMETRY` is one: a fourth station type must stop the
 * build here rather than inherit a trade station's surface by default.
 *
 * The colours come from `hud-and-scanner.md` §4's grammar — cool for structure
 * and work light, warm for habitation and heat — rather than from a second
 * palette that would then have to be kept in step with it.
 */
/**
 * The navigation-light grammar, shared by every role that carries it.
 *
 * One definition rather than three identical literals: these are a *convention*
 * — port red, starboard green, work light cold — and retuning a convention by
 * editing it in three places is how two of the three end up retuned.
 */
const NAV_PORT = 0xff4d4d;
const NAV_STARBOARD = 0x53ff8a;
const WORK_FLOOD = 0xbfe4ff;

export const STATION_VISUALS: Record<StationType, StationVisualProfile> = {
	trade: {
		plating: {
			pitchPx: 16,
			seam: 0.3,
			weathering: 0.12,
			roughness: 0.55,
			metalness: 0.42,
		},
		activity: {
			beaconPeriodS: 2,
			beaconDuty: 0.12,
			flickerHz: 0,
			flickerDepth: 0,
			flickerSmooth: false,
		},
		// **Warm**, which the first version was not: 0xdfe8ff is a blue-white, and
		// §5 calls the trade station's window grid habitation light. The probe reads
		// warmth as `R − B` over the role's own fixtures, and a blue-white grid put
		// the trade station on the cold side of the ordering it is meant to sit warm
		// of — the spec said one thing and the literal said the other.
		windowColor: 0xffe3b8,
		beaconPortColor: NAV_PORT,
		beaconStarboardColor: NAV_STARBOARD,
		floodColor: WORK_FLOOD,
		heatColor: 0xffb347,
	},
	shipyard: {
		plating: {
			pitchPx: 26,
			seam: 0.46,
			weathering: 0.3,
			roughness: 0.72,
			metalness: 0.5,
		},
		activity: {
			beaconPeriodS: 2,
			beaconDuty: 0.12,
			// A welding arc: fast, deep, and stepped. It is the one motion on the
			// station that is meant to read as work rather than as signalling.
			flickerHz: 7,
			flickerDepth: 0.85,
			flickerSmooth: false,
		},
		windowColor: 0xdfe8ff,
		beaconPortColor: NAV_PORT,
		beaconStarboardColor: NAV_STARBOARD,
		floodColor: WORK_FLOOD,
		heatColor: 0xffb347,
	},
	refinery: {
		plating: {
			pitchPx: 34,
			// Soot from its own stacks, which is why the streaking is an order
			// above the trade station's and the plate is rougher and barely
			// metallic.
			seam: 0.34,
			weathering: 0.78,
			roughness: 0.9,
			metalness: 0.14,
		},
		activity: {
			// No navigation beacons: the refinery does not spin and its pad faces
			// outward, so a spin-axis pair would be marking an axis nothing turns
			// about. The flare is its light.
			beaconPeriodS: 0,
			beaconDuty: 0,
			flickerHz: 1.7,
			flickerDepth: 0.32,
			flickerSmooth: true,
		},
		windowColor: 0xffcf9a,
		beaconPortColor: NAV_PORT,
		beaconStarboardColor: NAV_STARBOARD,
		floodColor: WORK_FLOOD,
		heatColor: 0xff7a2a,
	},
};

/** The generated maps are square and this is the side, texels. Small on
 *  purpose: the plating is a surface language read at a few hundred pixels, not
 *  a photograph, and every station in the galaxy shares these two buffers. */
export const PLATE_TEXTURE_SIZE = 128;

/**
 * A deterministic value in [0, 1) from a string tag and two integers.
 *
 * FNV-1a over the tag, then a mix of the two coordinates through the same
 * constants. Its whole contract is that it is a pure function: the texels below
 * and the flicker further down both have to replay exactly, on every load and
 * on every client at the same clock.
 */
function hash01(tag: string, a: number, b: number): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < tag.length; i++) {
		h ^= tag.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	h ^= Math.imul(a | 0, 0x27d4eb2d);
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
	h ^= Math.imul(b | 0, 0x165667b1);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise over one axis, so a streak has a width rather than being
 *  one texel wide. One dimension is all §4's streaking needs: it runs down the
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
 * The role's albedo plating, RGBA, `PLATE_TEXTURE_SIZE` square.
 *
 * **Greyscale by construction** (§4): R, G and B are written from one value, so
 * `STATION_COLORS[type]` still multiplies through and §7's secondary colour cue
 * survives the pass. A coloured plate map would replace that cue with a painted
 * one and leave the docstrings that claim it still works saying something false.
 *
 * The buffer is exactly `4 × w × h`, which `THREE.DataTexture` with
 * `RGBAFormat` requires and does not check: a short buffer samples past its end
 * and draws garbage rather than throwing.
 */
export function platingTexels(type: StationType, size = PLATE_TEXTURE_SIZE) {
	const { pitchPx, seam, weathering } = STATION_VISUALS[type].plating;
	const out = new Uint8Array(size * size * 4);
	// **A whole number of panels across the map.** The pitch is an authored
	// intent in texels, but the map wraps (`RepeatWrapping`), so a pitch that
	// does not divide the size leaves a truncated panel at the seam and its
	// boundary doubles when the texture repeats. Rounding to a panel count and
	// deriving the boundaries from that keeps the authored figure meaningful and
	// the wrap clean.
	const panels = Math.max(1, Math.round(size / pitchPx));
	const panelOf = (n: number) => Math.floor((n * panels) / size);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			// Streaks run *down* the hull: the envelope varies with x and persists
			// in y, so a run of soot is a vertical band. Sampled from y — as the
			// first version did — it bands horizontally instead and chops the
			// finer streak below into segments, which reads as dirt in rows.
			const grime = streak(`${type}-grime`, x, 9) * weathering;
			const plate = hash01(`${type}-plate`, panelOf(x), panelOf(y));
			// Panel-to-panel variation is small; the seam between them is what the
			// eye reads as plating at all.
			let v = 196 + (plate - 0.5) * 26;
			// A texel is on a seam when the next texel — wrapping at the edge —
			// belongs to a different panel. That gives exactly `panels` seams in
			// each axis and one of them lands on the wrap, where it belongs.
			const onSeam =
				panelOf(x) !== panelOf((x + 1) % size) ||
				panelOf(y) !== panelOf((y + 1) % size);
			if (onSeam) v *= 1 - seam;
			// Weathering darkens rather than tints: a soot streak is missing light,
			// and tinting it would break the greyscale contract above.
			v *= 1 - grime * 0.55 * streak(`${type}-run`, x, 5);
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
 * The role's roughness and metalness map, RGBA.
 *
 * Green is roughness and blue is metalness, which is the channel layout
 * `MeshStandardMaterial` samples `roughnessMap` and `metalnessMap` from — so one
 * buffer serves as both and there is no second texture upload. Red is left at
 * full: an `aoMap` reads it, and a station has none.
 *
 * Seams and grime are rougher and less metallic than the plate they sit on,
 * which is what stops a station reading as one moulded object under a moving
 * sun.
 */
export function surfaceTexels(
	type: StationType,
	size = PLATE_TEXTURE_SIZE,
	/** The role's albedo, if the caller already has it. Generating both maps
	 *  for three roles otherwise runs the plating loop six times where three
	 *  will do — and the two must be derived from the *same* buffer in any case,
	 *  or a shine can miss its own seam. */
	precomputed?: Uint8Array,
) {
	const { roughness, metalness } = STATION_VISUALS[type].plating;
	const albedo = precomputed ?? platingTexels(type, size);
	const out = new Uint8Array(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		// Darker plate means seam or grime, both of which are rougher. Derived
		// from the albedo rather than regenerated so the two maps cannot fall out
		// of register — which shows up as a shine that misses its own seam.
		//
		// **A factor, not an offset**, and the map's own clamp-bite constraint
		// (#13) is why. Written as `roughness + wear × 0.5` the refinery's 0.9
		// ceiling plus a wear of 0.6 saturates at 1.0 across almost the whole
		// plate: the map collapsed to two distinct values and the role with the
		// most weathering was the one whose weathering stopped showing. Expressed
		// as a factor it cannot saturate, because the ceiling is the profile's own
		// figure and the plate only ever sits below it.
		const wear = Math.min(1, (1 - albedo[i * 4] / 255) / 0.7);
		out[i * 4] = 255;
		out[i * 4 + 1] = clamp255(roughness * (0.55 + 0.45 * wear) * 255);
		out[i * 4 + 2] = clamp255(metalness * (1 - 0.8 * wear) * 255);
		out[i * 4 + 3] = 255;
	}
	return out;
}

/**
 * A navigation beacon's brightness at `gameTime`, 0–1 (§5.2).
 *
 * `offsetS` puts the starboard light half a period behind the port one: two
 * beacons flashing together read as a single light, and the pair is what gives
 * the spin axis a direction at the range where the slot itself has not
 * resolved.
 *
 * A short ramp at each edge of the flash rather than a hard square: at 60 fps a
 * square pulse of this duty is a strobe that a frame can miss entirely, and the
 * symptom is a beacon that looks like it is failing.
 */
export function beaconIntensity(
	type: StationType,
	gameTime: number,
	offsetS: number,
): number {
	const { beaconPeriodS, beaconDuty } = STATION_VISUALS[type].activity;
	if (beaconPeriodS <= 0 || beaconDuty <= 0) return 0;
	const phase = ((((gameTime + offsetS) / beaconPeriodS) % 1) + 1) % 1;
	if (phase >= beaconDuty) return 0;
	const p = phase / beaconDuty;
	const ramp = 0.08;
	if (p < ramp) return p / ramp;
	if (p > 1 - ramp) return (1 - p) / ramp;
	return 1;
}

/**
 * The role's work-light flicker at `gameTime`, 0–1 (§5.2).
 *
 * 1 for a role whose profile declares no depth, so a caller multiplies by this
 * unconditionally rather than branching — a steady light is the depth-zero case
 * of the same expression, not a different code path.
 *
 * Stepped for the shipyard's arc and interpolated for the refinery's flare,
 * because those are different physical things: an arc strikes and dies, and a
 * flare breathes. Both are hashes of the quantised clock, so both look
 * stochastic and both replay exactly.
 */
export function flickerIntensity(type: StationType, gameTime: number): number {
	const { flickerHz, flickerDepth, flickerSmooth } =
		STATION_VISUALS[type].activity;
	if (flickerDepth <= 0 || flickerHz <= 0) return 1;
	const p = gameTime * flickerHz;
	const tick = Math.floor(p);
	let n = hash01(`${type}-flicker`, tick, 0);
	if (flickerSmooth) {
		const f = p - tick;
		const smooth = f * f * (3 - 2 * f);
		n = n * (1 - smooth) + hash01(`${type}-flicker`, tick + 1, 0) * smooth;
	}
	return 1 - flickerDepth * n;
}
