import {
	FLIGHT_LEVELS,
	MODES,
	type ModeName,
	type MusicLevel,
	type MusicTheme,
	musicTheme,
	pickOf,
	STATION_ROLES,
	writer,
} from "./music-generate";
import type { NoteEvent, PartSpec, Song, SongSpace } from "./music-score";
import {
	BASS_LINES,
	bassSteps,
	BLIP_LENGTHS,
	BLIP_NOTES,
	CLAPS,
	euclid,
	HATS,
	type Hit,
	hits,
	KICK_FILLS,
	KICK_MAIN,
	PROGRESSIONS,
	VOICINGS,
} from "./music-techno-patterns";
import { mix, seededRand } from "./rng";
import type { StationType } from "./station";

/**
 * A techno bed, a spike beside the sequence school (2026-10-24): a seeded
 * generator in the shape techno is made in.
 *
 * - **The loop is the unit.** A kick on every beat, closed hats on the
 *   sixteenths with their own accents, an open hat on the off-beat, a clap
 *   on two and four, and a bass line between the kicks.
 * - **The track is the loop, layered.** Every eight bars is a phrase, and a
 *   phrase is the set of layers that play in it: an intro that adds them one
 *   by one, phrases that leave one or two out, a breakdown with the kick and
 *   the bass gone, and the drop that brings everything back. A phrase ends
 *   on a kick fill, a breakdown on a noise riser.
 * - **Hypnotic, not repeating.** A rim on a Euclidean rhythm, a percussion
 *   hit and a blip on loops of 3, 5, 6, 7 or 9 sixteenths move across the
 *   bar; an acid line changes one step every eight bars and comes home
 *   every fourth; the hats' accents move every sixteen.
 * - **Chord memory.** One voicing, moved whole from root to root, as stabs
 *   or as a dub chord into a long echo.
 *
 * Each system draws a style (`TECHNO_STYLES`), its tempo, key and patterns;
 * each variant a new style at the same tempo, as a DJ holds the tempo from
 * one record to the next. The levels add energy: wary the full groove,
 * threat an acid lead and a ride, combat everything harder and faster.
 */
export const TECHNO_STYLES = {
	deep: {
		bpm: [120, 124],
		mode: "dorian",
		bass: ["offbeat", "offbeatOctave", "pulse"],
		chords: "memory",
		blip: true,
		swing: 0.04,
		acidBass: false,
	},
	dub: {
		bpm: [118, 122],
		mode: "aeolian",
		bass: ["sub", "offbeat"],
		chords: "dub",
		blip: false,
		swing: 0.03,
		acidBass: false,
	},
	acid: {
		bpm: [126, 130],
		mode: "phrygian",
		bass: [],
		chords: "none",
		blip: false,
		swing: 0.02,
		acidBass: true,
	},
	minimal: {
		bpm: [124, 127],
		mode: "aeolian",
		bass: ["pulse", "offbeat"],
		chords: "none",
		blip: true,
		swing: 0.05,
		acidBass: false,
	},
	hypnotic: {
		bpm: [128, 132],
		mode: "dorian",
		bass: ["rolling"],
		chords: "dub",
		blip: true,
		swing: 0,
		acidBass: false,
	},
	detroit: {
		bpm: [124, 128],
		mode: "aeolian",
		bass: ["rolling", "offbeatOctave", "gallop"],
		chords: "memory",
		blip: true,
		swing: 0.02,
		acidBass: false,
	},
	industrial: {
		bpm: [130, 134],
		mode: "phrygian",
		bass: ["rolling", "gallop"],
		chords: "none",
		blip: false,
		swing: 0,
		acidBass: false,
	},
} as const satisfies Record<string, TechnoStyleSpec>;

/** What a style fixes: its tempo range, mode, bass lines, chords, blip,
 *  swing (beats an off sixteenth is late) and whether the bass is the acid
 *  line. */
export interface TechnoStyleSpec {
	readonly bpm: readonly [number, number];
	readonly mode: ModeName;
	readonly bass: readonly (keyof typeof BASS_LINES)[];
	readonly chords: "memory" | "dub" | "none";
	readonly blip: boolean;
	readonly swing: number;
	readonly acidBass: boolean;
}
export type TechnoStyle = keyof typeof TECHNO_STYLES;
export const TECHNO_STYLE_NAMES = Object.keys(TECHNO_STYLES) as TechnoStyle[];

/** One step of an acid line: a note in semitones over the root, or a rest;
 *  an accent opens the filter, a slide glides into the next step. */
export interface AcidStep {
	readonly note: number | null;
	readonly accent: boolean;
	readonly slide: boolean;
}

/** The layers a phrase is made of. */
export const LAYERS = [
	"kick",
	"hats",
	"ohat",
	"clap",
	"rim",
	"perc",
	"bass",
	"acid",
	"chords",
	"pad",
	"blip",
	"ride",
] as const;
export type Layer = (typeof LAYERS)[number];

/** What a system's seed and variant fix: the style and every pattern. */
export interface TechnoTune {
	readonly style: TechnoStyle;
	readonly bpm: number;
	readonly hats: number;
	readonly clap: number;
	readonly fill: number;
	readonly bassLine: readonly (number | null)[];
	readonly acid: readonly AcidStep[];
	readonly voicing: readonly number[];
	readonly stab: readonly boolean[];
	readonly progression: readonly number[];
	readonly blip: readonly (number | null)[];
	readonly rim: { readonly k: number; readonly rotate: number };
	readonly perc: number;
	readonly order: readonly Layer[];
}

/** Calm is at least this long, so the director's refresh (180 s) comes in
 *  before it loops, even at the cruise lift. */
export const TECHNO_CALM_S = 196;
export const TECHNO_WARY_BARS = 32;
export const TECHNO_THREAT_BARS = 24;
export const TECHNO_COMBAT_BARS = 32;
export const TECHNO_STATION_BARS = 32;
/** Each level's tempo over calm's. */
export const TECHNO_LEVEL_BPM: Readonly<Record<MusicLevel, number>> = {
	calm: 0,
	wary: 0,
	threat: 2,
	combat: 6,
};
/** The acid line changes every this many bars. */
export const ACID_EVOLVE_BARS = 8;

const TECHNO_TUNE = 0x7465636e;
const STREAM = { calm: 1, wary: 2, threat: 3, combat: 4, station: 5 };
const KICK = 29;
const HAT = 104;
const PHRASE = 8;

const RAW_PARTS: Readonly<Record<string, PartSpec>> = {
	kick: { voice: "kick", level: 0.6, reverb: 0.04 },
	hat: {
		voice: "noise",
		level: 0.05,
		decayS: 0.03,
		releaseS: 0.02,
		pan: 0.2,
		reverb: 0.1,
	},
	ohat: {
		voice: "noise",
		level: 0.055,
		decayS: 0.12,
		releaseS: 0.08,
		pan: -0.15,
		reverb: 0.15,
	},
	ride: {
		voice: "noise",
		level: 0.03,
		decayS: 0.4,
		releaseS: 0.2,
		pan: 0.35,
		reverb: 0.3,
	},
	clap: {
		voice: "noise",
		level: 0.14,
		decayS: 0.2,
		releaseS: 0.1,
		reverb: 0.45,
	},
	rim: {
		voice: "noise",
		level: 0.05,
		decayS: 0.02,
		releaseS: 0.02,
		resonance: 0.8,
		pan: -0.35,
		reverb: 0.25,
		echo: 0.2,
	},
	perc: {
		voice: "fm",
		level: 0.06,
		ratio: 1.5,
		index: 3,
		indexDecayS: 0.04,
		decayS: 0.09,
		sustain: 0,
		releaseS: 0.06,
		pan: 0.4,
		reverb: 0.3,
		echo: 0.3,
	},
	bass: {
		voice: "acid",
		level: 0.28,
		cutoffHz: 220,
		envAmount: 1.6,
		envDecayS: 0.14,
		resonance: 0.4,
		drive: 0.4,
		glideS: 0,
		reverb: 0.04,
	},
	acid: {
		voice: "acid",
		level: 0.2,
		cutoffHz: 380,
		envAmount: 3,
		envDecayS: 0.18,
		resonance: 0.82,
		drive: 0.5,
		glideS: 0.05,
		sweepS: 37,
		sweepOct: 2.2,
		reverb: 0.1,
		echo: 0.25,
	},
	acidHard: {
		voice: "acid",
		level: 0.19,
		cutoffHz: 520,
		envAmount: 3.4,
		envDecayS: 0.14,
		resonance: 0.86,
		drive: 0.9,
		glideS: 0.04,
		sweepS: 23,
		sweepOct: 2.4,
		reverb: 0.08,
		echo: 0.2,
	},
	stab: {
		voice: "analog",
		level: 0.065,
		unison: 2,
		detune: 0.08,
		spread: 0.8,
		attackS: 0.004,
		decayS: 0.18,
		sustain: 0.15,
		releaseS: 0.1,
		cutoffHz: 1100,
		envAmount: 1.5,
		envDecayS: 0.12,
		pan: 0.2,
		reverb: 0.5,
		echo: 0.45,
	},
	dub: {
		voice: "analog",
		level: 0.065,
		unison: 2,
		detune: 0.1,
		spread: 0.9,
		attackS: 0.005,
		decayS: 0.35,
		sustain: 0.1,
		releaseS: 0.2,
		cutoffHz: 800,
		envAmount: 1.2,
		envDecayS: 0.2,
		sweepS: 29,
		sweepOct: 1,
		reverb: 0.6,
		echo: 0.7,
	},
	pad: {
		voice: "drone",
		level: 0.15,
		attackS: 2,
		releaseS: 2,
		detune: 0.1,
		drift: 6,
		spread: 1,
		reverb: 0.7,
	},
	blip: {
		voice: "fm",
		level: 0.055,
		ratio: 2,
		index: 1.5,
		indexDecayS: 0.1,
		decayS: 0.15,
		sustain: 0,
		releaseS: 0.1,
		pan: -0.25,
		reverb: 0.4,
		echo: 0.5,
	},
	riser: {
		voice: "noise",
		level: 0.05,
		attackS: 0.02,
		decayS: 0.2,
		releaseS: 0.1,
		resonance: 0.6,
		reverb: 0.6,
		echo: 0.3,
	},
	crash: {
		voice: "noise",
		level: 0.045,
		decayS: 1.5,
		releaseS: 1,
		pan: 0.1,
		reverb: 0.5,
	},
};

/** Every part's level is raised by this, so the bed is as loud as the
 *  sequence school's (measured headless, 2026-10-24). */
export const TECHNO_GAIN = 1.45;
const PARTS: Readonly<Record<string, PartSpec>> = Object.fromEntries(
	Object.entries(RAW_PARTS).map(([k, p]) => [
		k,
		{ ...p, level: p.level * TECHNO_GAIN },
	]),
);

/** The bed's room: a short reverb, and the dotted-eighth echo the stabs and
 *  the blip sit in. */
export const TECHNO_SPACE: SongSpace = {
	reverbS: 3.5,
	echoBeats: 0.75,
	echoFeedback: 0.45,
};

const streamOf = (systemSeed: number, variant: number, stream: number) =>
	seededRand(mix(mix(systemSeed >>> 0, TECHNO_TUNE + stream), variant));

/** The style of a system's variant: the seed's first, then each variant a
 *  style other than the one before it. */
export function technoStyle(systemSeed: number, variant: number): TechnoStyle {
	let style = pickOf(streamOf(systemSeed, 0, 0), TECHNO_STYLE_NAMES);
	for (let v = 1; v <= variant; v++) {
		const others = TECHNO_STYLE_NAMES.filter((s) => s !== style);
		style = pickOf(streamOf(systemSeed, v, 0), others);
	}
	return style;
}

/** The system's tempo: from its first style's range, held by every
 *  variant. */
export function technoBpm(systemSeed: number): number {
	const [lo, hi] = TECHNO_STYLES[technoStyle(systemSeed, 0)].bpm;
	const rand = streamOf(systemSeed, 0, 9);
	return lo + Math.floor(rand() * (hi - lo + 1));
}

/** Calm's length in bars at `bpm`: whole phrases, at least `TECHNO_CALM_S`
 *  at the cruise lift. */
export const technoCalmBars = (bpm: number) =>
	PHRASE * Math.ceil((TECHNO_CALM_S * 1.06 * bpm) / 240 / PHRASE);

function acidLine(rand: () => number, mode: readonly number[]): AcidStep[] {
	const pool = [0, 0, 0, 12, mode[2], mode[4], mode[6], mode[1], mode[6] - 12];
	const line = Array.from({ length: 16 }, (_, i) => ({
		note: i > 0 && rand() < 0.28 ? null : pickOf(rand, pool),
		accent: rand() < 0.3,
		slide: rand() < 0.2,
	}));
	line[0] = { ...line[0], note: 0 };
	return line;
}

/** The acid line's versions: each changes one step of the one before, and
 *  every fourth is the line itself again. */
export function acidVersions(
	line: readonly AcidStep[],
	rand: () => number,
	count: number,
	mode: readonly number[],
): AcidStep[][] {
	const pool = [0, 12, mode[2], mode[4], mode[6]];
	const out: AcidStep[][] = [];
	let now = [...line];
	for (let v = 0; v < count; v++) {
		if (v % 4 === 0) now = [...line];
		else {
			const i = 1 + Math.floor(rand() * 15);
			const s = now[i];
			const kind = Math.floor(rand() * 4);
			now = [...now];
			now[i] =
				kind === 0
					? { ...s, note: pickOf(rand, pool) }
					: kind === 1
						? { ...s, accent: !s.accent }
						: kind === 2
							? { ...s, slide: !s.slide }
							: { ...s, note: s.note === null ? pickOf(rand, pool) : null };
		}
		out.push(now);
	}
	return out;
}

/** A system's techno tune for a variant. */
export function technoTune(
	systemSeed: number,
	variant = 0,
	forced?: TechnoStyle,
): TechnoTune {
	const style = forced ?? technoStyle(systemSeed, variant);
	const spec: TechnoStyleSpec = TECHNO_STYLES[style];
	const rand = streamOf(systemSeed, variant, 7);
	const mode = MODES[spec.mode];
	const blipLength = pickOf(rand, BLIP_LENGTHS);
	const blipHits = euclid(Math.ceil(blipLength / 2), blipLength);
	const stabKind = spec.chords === "dub" ? 2 : pickOf(rand, [3, 3, 4, 5]);
	const stabRotate = Math.floor(rand() * 16);
	const order: Layer[] = [
		"kick",
		...(
			["hats", "bass", "ohat", "rim", "chords", "perc", "blip", "clap"] as const
		)
			.map((l) => [l, rand()] as const)
			.sort((a, b) => a[1] - b[1])
			.map(([l]) => l),
		"pad",
		"acid",
		"ride",
	];
	return {
		style,
		bpm: technoBpm(systemSeed),
		hats: Math.floor(rand() * HATS.length),
		clap: Math.floor(rand() * CLAPS.length),
		fill: Math.floor(rand() * KICK_FILLS.length),
		bassLine: spec.acidBass
			? []
			: bassSteps(BASS_LINES[pickOf(rand, spec.bass)]),
		acid: acidLine(rand, mode),
		voicing: pickOf(rand, VOICINGS),
		stab: euclid(stabKind, 16, stabRotate),
		progression: pickOf(rand, PROGRESSIONS),
		blip: blipHits.map((on) => (on ? pickOf(rand, BLIP_NOTES) : null)),
		rim: { k: pickOf(rand, [3, 5, 7]), rotate: Math.floor(rand() * 16) },
		perc: pickOf(rand, [3, 5, 6, 7]),
		order,
	};
}

/** One phrase: the layers that play in it, and whether it is a breakdown. */
export interface Phrase {
	readonly on: ReadonlySet<Layer>;
	readonly breakdown: boolean;
}

const BREAKDOWN_KEEPS: ReadonlySet<Layer> = new Set([
	"pad",
	"chords",
	"blip",
	"hats",
	"perc",
]);

/** The phrases of a section `phrases` long: an intro that adds the layers in
 *  `order`, phrases that leave out one or two, breakdowns and their drops. */
export function arrange(
	rand: () => number,
	phrases: number,
	layers: ReadonlySet<Layer>,
	order: readonly Layer[],
	opts: { intro: boolean; breakdowns: boolean },
): Phrase[] {
	const ordered = order.filter((l) => layers.has(l));
	const intro = opts.intro ? Math.min(3, Math.floor(phrases / 4)) : 0;
	const breaks = new Set<number>();
	if (opts.breakdowns && phrases >= 6) {
		let at = intro + 2 + Math.floor(rand() * 2);
		while (at < phrases - 2 && breaks.size < Math.floor(phrases / 5)) {
			breaks.add(at);
			at += 4 + Math.floor(rand() * 3);
		}
	}
	return Array.from({ length: phrases }, (_, p) => {
		if (p < intro) {
			const n = Math.ceil((ordered.length * (p + 1)) / (intro + 1));
			return {
				on: new Set(ordered.slice(0, Math.max(2, n))),
				breakdown: false,
			};
		}
		if (breaks.has(p)) {
			const on = new Set(ordered.filter((l) => BREAKDOWN_KEEPS.has(l)));
			if (layers.has("pad")) on.add("pad");
			return { on, breakdown: true };
		}
		const on = new Set(ordered);
		if (!breaks.has(p - 1)) {
			const optional = ordered.filter((l) => l !== "kick" && l !== "bass");
			const drops = Math.floor(rand() * 3);
			for (let d = 0; d < drops; d++) on.delete(pickOf(rand, optional));
		}
		return { on, breakdown: false };
	});
}

const layerList = (s: string) => s.split(" ") as Layer[];
const LEVEL_LAYERS: Readonly<Record<MusicLevel, readonly Layer[]>> = {
	calm: layerList("kick hats ohat clap rim perc bass chords pad blip"),
	wary: layerList("kick hats ohat clap rim perc bass chords blip"),
	threat: layerList("kick hats ohat clap rim bass acid chords ride"),
	combat: layerList("kick hats ohat clap rim perc bass acid chords ride"),
};
const LEVEL_ENERGY: Readonly<Record<MusicLevel, number>> = {
	calm: 1,
	wary: 0.8,
	threat: 0.82,
	combat: 1,
};

function layersOf(tune: TechnoTune, level: MusicLevel): Set<Layer> {
	const spec: TechnoStyleSpec = TECHNO_STYLES[tune.style];
	const on = new Set(LEVEL_LAYERS[level]);
	if (spec.chords === "none") on.delete("chords");
	if (!spec.blip) on.delete("blip");
	if (spec.acidBass) {
		on.delete("bass");
		on.add("acid");
	}
	if (level === "calm" && tune.style === "dub") on.delete("clap");
	return on;
}

const keyOffset = (tonic: number) => (tonic - 9 + 12) % 12;

/** The notes of one section: `bars` bars of `tune` at `level`, laid out by
 *  `arrange`. */
export function technoSection(
	theme: MusicTheme,
	tune: TechnoTune,
	level: MusicLevel,
	bars: number,
	rand: () => number,
	opts: { intro: boolean; breakdowns: boolean },
): NoteEvent[] {
	const spec: TechnoStyleSpec = TECHNO_STYLES[tune.style];
	const mode = MODES[spec.mode];
	const energy = LEVEL_ENERGY[level];
	const plan = arrange(
		rand,
		Math.ceil(bars / PHRASE),
		layersOf(tune, level),
		tune.order,
		opts,
	);
	const versions = acidVersions(
		tune.acid,
		rand,
		Math.ceil(bars / ACID_EVOLVE_BARS),
		mode,
	);
	const w = writer(4);
	const step = (
		part: string,
		bar: number,
		s: number,
		dur: number,
		pitch: number,
		vel: number,
	) =>
		w.at(
			part,
			bar * 4 + s / 4 + (s % 2 === 1 ? spec.swing : 0),
			dur,
			pitch,
			Math.min(1, vel * energy),
		);
	const pattern = (
		part: string,
		bar: number,
		p: readonly Hit[],
		pitch: number,
		dur: number,
		vel: number,
	) =>
		p.forEach((h, s) => {
			if (h !== null) step(part, bar, s, dur, pitch, h * vel);
		});
	const bassRoot = 33 + keyOffset(theme.tonic);
	const chordRoot = 45 + keyOffset(theme.tonic);
	const blipRoot = 60 + keyOffset(theme.tonic);
	const acidPart =
		level === "combat" || tune.style === "industrial" ? "acidHard" : "acid";
	const acidRoot = spec.acidBass ? bassRoot : bassRoot + 12;
	const kickMain = hits(KICK_MAIN);
	for (let bar = 0; bar < bars; bar++) {
		const p = Math.floor(bar / PHRASE);
		const { on, breakdown } = plan[p];
		const next = plan[p + 1];
		const last = bar % PHRASE === PHRASE - 1;
		const shift = tune.progression[p % tune.progression.length];
		const root = (base: number) => base + (shift > 6 ? shift - 12 : shift);
		if (on.has("kick")) {
			const kick =
				last && next?.breakdown
					? KICK_FILLS[KICK_FILLS.length - 1]
					: last
						? KICK_FILLS[(tune.fill + p) % (KICK_FILLS.length - 1)]
						: kickMain;
			pattern("kick", bar, kick, KICK, 0.5, 0.9);
		}
		if (on.has("hats"))
			pattern(
				"hat",
				bar,
				HATS[(tune.hats + Math.floor(p / 2)) % HATS.length],
				HAT + 4,
				0.1,
				breakdown ? 0.5 : 0.8,
			);
		if (on.has("ohat"))
			for (const s of [2, 6, 10, 14]) step("ohat", bar, s, 0.2, HAT, 0.65);
		if (on.has("ride"))
			for (let s = 0; s < 16; s += 2)
				step("ride", bar, s, 0.5, HAT + 8, s % 4 === 2 ? 0.6 : 0.35);
		if (on.has("clap"))
			pattern(
				"clap",
				bar,
				CLAPS[last ? (tune.clap + 1) % CLAPS.length : tune.clap],
				88,
				0.25,
				0.8,
			);
		if (on.has("rim"))
			euclid(tune.rim.k, 16, tune.rim.rotate + Math.floor(bar / 16)).forEach(
				(hit, s) => {
					if (hit) step("rim", bar, s, 0.05, 92 + (s % 3) * 2, 0.6);
				},
			);
		if (on.has("perc"))
			for (let s = 0; s < 16; s++) {
				const g = bar * 16 + s;
				if (g % tune.perc === 0)
					step("perc", bar, s, 0.1, 64 + ((g / tune.perc) % 3) * 5, 0.55);
			}
		if (on.has("bass"))
			tune.bassLine.forEach((n, s) => {
				if (n !== null) {
					const sub = tune.bassLine.filter((x) => x !== null).length === 2;
					step(
						"bass",
						bar,
						s,
						sub ? 1.4 : 0.2,
						root(bassRoot) + n,
						s % 4 === 2 ? 0.85 : 0.65,
					);
				}
			});
		if (on.has("acid")) {
			const line =
				versions[
					Math.min(versions.length - 1, Math.floor(bar / ACID_EVOLVE_BARS))
				];
			line.forEach((a, s) => {
				if (a.note === null) return;
				step(
					acidPart,
					bar,
					s,
					a.slide ? 0.4 : 0.18,
					root(acidRoot) + a.note,
					a.accent ? 0.95 : 0.6,
				);
			});
		}
		if (on.has("chords")) {
			const part = spec.chords === "dub" ? "dub" : "stab";
			tune.stab.forEach((hit, s) => {
				if (hit)
					for (const v of tune.voicing)
						step(
							part,
							bar,
							s,
							part === "dub" ? 0.5 : 0.25,
							root(chordRoot + 12) + v,
							breakdown ? 0.7 : 0.55,
						);
			});
		}
		if (on.has("pad") && bar % 2 === 0)
			for (const v of [0, 7, 15])
				step("pad", bar, 0, 8, root(chordRoot) + v, breakdown ? 0.6 : 0.4);
		if (on.has("blip"))
			for (let s = 0; s < 16; s++) {
				const g = bar * 16 + s;
				const n = tune.blip[g % tune.blip.length];
				if (n !== null)
					step(
						"blip",
						bar,
						s,
						0.15,
						blipRoot + n,
						g % tune.blip.length === 0 ? 0.75 : 0.5,
					);
			}
		if (last && breakdown && next && !next.breakdown)
			for (let s = 0; s < 16; s++)
				step("riser", bar, s, 0.2, 72 + s * 2.5, 0.3 + s * 0.04);
		if (bar % PHRASE === 0 && p > 0 && plan[p - 1].breakdown)
			step("crash", bar, 0, 4, 100, 0.8);
	}
	return w.events;
}

/** A system's techno flight bed for a variant: calm, wary, threat and
 *  combat, each layered by phrase. */
export function technoFlightBed(
	systemSeed: number,
	variant: number,
	style?: TechnoStyle,
): Song {
	const theme = musicTheme(systemSeed);
	const tune = technoTune(systemSeed, variant, style);
	const calmBars = technoCalmBars(tune.bpm);
	const lengths: Record<MusicLevel, number> = {
		calm: calmBars,
		wary: TECHNO_WARY_BARS,
		threat: TECHNO_THREAT_BARS,
		combat: TECHNO_COMBAT_BARS,
	};
	const sections = FLIGHT_LEVELS.map((level) => ({
		name: level,
		bars: lengths[level],
		events: technoSection(
			theme,
			tune,
			level,
			lengths[level],
			streamOf(systemSeed, variant, STREAM[level]),
			{ intro: level === "calm", breakdowns: level === "calm" },
		),
	}));
	let bar = 0;
	const tempo = sections.map((s, i) => {
		const point = { bar, bpm: tune.bpm + TECHNO_LEVEL_BPM[FLIGHT_LEVELS[i]] };
		bar += s.bars;
		return point;
	});
	return {
		name: `techno ${tune.style} ${systemSeed >>> 0}/${variant}`,
		beatsPerBar: 4,
		parts: PARTS,
		sections,
		tempo,
		space: TECHNO_SPACE,
	};
}

const STATION_LAYERS: Readonly<Record<StationType, readonly Layer[]>> = {
	trade: layerList("kick hats bass chords pad"),
	refinery: layerList("kick rim perc bass pad"),
	shipyard: layerList("kick hats ohat rim bass blip"),
	outpost: layerList("hats pad blip perc"),
};

/** A station's techno bed: the system's tune, slower and stripped to the
 *  role's layers, one phrase out at a time. */
export function technoStationBed(
	systemSeed: number,
	role: StationType,
	variant: number,
): Song {
	const theme = musicTheme(systemSeed);
	const own = technoStyle(systemSeed, variant);
	const style = TECHNO_STYLES[own].chords === "none" ? "deep" : own;
	const base = technoTune(systemSeed, variant, style);
	const layers = STATION_LAYERS[role];
	const tune: TechnoTune = {
		...base,
		order: base.order.filter((l) => layers.includes(l)),
	};
	const rand = streamOf(
		systemSeed,
		variant * 7 + STATION_ROLES.indexOf(role),
		STREAM.station,
	);
	const events = technoSection(theme, tune, "calm", TECHNO_STATION_BARS, rand, {
		intro: false,
		breakdowns: false,
	}).map((e) => (e.part === "kick" ? { ...e, vel: e.vel * 0.7 } : e));
	return {
		name: `techno station ${role} ${systemSeed >>> 0}/${variant}`,
		beatsPerBar: 4,
		parts: PARTS,
		sections: [{ name: "bed", bars: TECHNO_STATION_BARS, events }],
		tempo: [{ bar: 0, bpm: Math.round(tune.bpm * 0.94) }],
		space: TECHNO_SPACE,
	};
}
