/**
 * The generative bed, second form (#548 D12): authored fragments
 * (`music-fragments.ts`) that a system's seed picks and develops, played on
 * the synth's second voices (#560 D10).
 *
 * The first bed (`music-generate-legacy.ts`, still `?music=legacy`) was heard
 * as *super boring*: a random walk of chords, no motif, one rhythm, and one
 * 16-bar loop the director held for minutes. This one answers each of those.
 *
 * - **A theme per system.** The seed fixes the key and bright mode (the
 *   shared `musicTheme`), and here a motif, how far it is shifted, which
 *   voice carries it, and an arpeggio shape — so a system has a tune, not
 *   only a key. A **variant** keeps all of that and draws a new progression
 *   and new ornaments, for the director's refresh.
 * - **Calm is long and never loops inside itself.** The director holds a
 *   section for as long as the level lasts, so a 16-bar section *is* a
 *   16-bar loop. Calm is `CALM_BARS` long, and its layers run on co-prime
 *   cycles, as Eno's airport music does: chords every 8 bars, the motif
 *   every 7, strings every 13, glints every 5. No two stretches line up the
 *   same way inside the section.
 * - **The motif is developed.** Each statement follows `CALM_FORM`: the
 *   theme, moved with the harmony, inverted, augmented, cut short,
 *   backwards, and home again.
 * - **The harmony goes somewhere.** A progression from the authored set,
 *   repeated with one chord substituted and closed on the dominant, so the
 *   held section leans back into its own top.
 *
 * **Wary, threat and combat are the first bed's sections** until the calm
 * and station beds pass the principal's ear (the order the prototype runs
 * in); they share the new parts' names where they meet (`bell`, `lead`,
 * `arp`) and play on the new voices there.
 *
 * Pure, so `tests/music-generate.test.ts` holds it headless.
 */
import {
	ARP_SHAPES,
	CALM_FORM,
	CALM_PROGRESSIONS,
	CALM_SUBSTITUTE,
	type Development,
	MOTIFS,
	type Motif,
} from "./music-fragments";
import {
	FLIGHT_LEVELS,
	FLIGHT_PARTS,
	LEVEL_MODE,
	LEVEL_TEMPO,
	levelSection,
	MODES,
	type MusicLevel,
	type MusicTheme,
	musicTheme,
	SECTION_BARS,
	STATION_ROLES,
	themeSeed,
} from "./music-generate-legacy";
import type { NoteEvent, PartSpec, Song } from "./music-score";
import { mix, seededRand } from "./rng";
import type { StationType } from "./station";

export {
	FLIGHT_LEVELS,
	LEVEL_MODE,
	LEVEL_TEMPO,
	MODES,
	type ModeName,
	type MusicLevel,
	type MusicTheme,
	musicTheme,
	STATION_ROLES,
} from "./music-generate-legacy";

/** Calm's length: long enough that the co-prime layers never line up twice
 *  inside it. */
export const CALM_BARS = 64;
/**
 * The second bed runs this much above the system's theme tempo: the
 * principal's ruling on the first listening of calm, 2026-09-29 (*ok to
 * increase the tempo of the calm music a bit, 10 bpm*). Every level and the
 * station bed scale from the lifted figure, so wary is not left slower than
 * calm; the first bed keeps the theme tempo, as it was heard.
 */
export const CALM_LIFT_BPM = 10;

/** The station bed's length. */
export const STATION_BARS = 32;
/** Bars per chord in calm and at the station. */
const CHORD_BARS = 8;
/** The layer cycles, in bars: pairwise co-prime with each other. */
const MOTIF_EVERY = 7;
const STRINGS_EVERY = 13;
const GLINT_EVERY = 5;

/** The voices that carry a system's motif. */
const CARRIERS = ["keys", "bell", "lead"] as const;
type Carrier = (typeof CARRIERS)[number];

/** What a system's seed fixes beyond its key (D12): its tune. */
export interface MusicTune {
	readonly motif: Motif;
	/** Scale degrees the motif is shifted by. */
	readonly shift: number;
	readonly carrier: Carrier;
	readonly arp: readonly number[];
	/** The octave the motif sits in: 60 or 72, as a C. */
	readonly register: number;
}

/** A stream of its own for the tune, apart from every variant's. */
const TUNE_STREAM = 0x74756e65;

export function musicTune(systemSeed: number): MusicTune {
	const rand = seededRand(mix(themeSeed(systemSeed), TUNE_STREAM));
	const pick = <T>(list: readonly T[]) =>
		list[Math.floor(rand() * list.length) % list.length];
	return {
		motif: pick(MOTIFS),
		shift: Math.floor(rand() * 3),
		carrier: pick(CARRIERS),
		arp: pick(ARP_SHAPES),
		register: rand() < 0.5 ? 60 : 72,
	};
}

/** The parts the second bed plays, on #560's second voices. By ear: the
 *  showcase the principal heard, softened for a bed. */
const PARTS: Readonly<Record<string, PartSpec>> = {
	drone: { voice: "drone", level: 0.4, reverb: 0.5 },
	strings: {
		voice: "analog",
		level: 0.26,
		unison: 4,
		detune: 0.15,
		spread: 1,
		attackS: 2.5,
		sustain: 0.9,
		releaseS: 3,
		cutoffHz: 1300,
		envAmount: 0.8,
		envDecayS: 4,
		vibrato: 0.06,
		reverb: 0.6,
	},
	keys: { voice: "keys", level: 0.34, reverb: 0.45, echo: 0.3 },
	bell: {
		voice: "fm",
		level: 0.2,
		ratio: 3.5,
		index: 3,
		indexDecayS: 0.8,
		sustain: 0.3,
		decayS: 3,
		releaseS: 1.5,
		reverb: 0.5,
		echo: 0.3,
		pan: 0.3,
	},
	lead: {
		voice: "analog",
		level: 0.22,
		unison: 2,
		detune: 0.05,
		attackS: 0.25,
		sustain: 0.8,
		releaseS: 1,
		cutoffHz: 1000,
		envAmount: 0.8,
		envDecayS: 1.5,
		vibrato: 0.12,
		reverb: 0.5,
		echo: 0.35,
	},
	glint: {
		voice: "keys",
		level: 0.18,
		decayS: 2,
		pan: -0.35,
		reverb: 0.6,
		echo: 0.4,
	},
	arp: {
		voice: "keys",
		level: 0.2,
		decayS: 0.8,
		releaseS: 0.2,
		reverb: 0.3,
		echo: 0.25,
	},
};

/** The room both beds play in. */
const SPACE = { reverbS: 5, echoBeats: 0.75, echoFeedback: 0.4 };

/** Degree `d` of `mode` over `tonic`, in the octave whose C is `base`. */
const degree = (
	mode: readonly number[],
	tonic: number,
	base: number,
	d: number,
) => base + tonic + 12 * Math.floor(d / 7) + mode[((d % 7) + 7) % 7];

/** The motif as a statement takes it: degrees and beats, developed. */
function develop(
	m: Motif,
	how: Development,
	shift: number,
	chordRoot: number,
): { degrees: number[]; beats: number[] } {
	const d = m.degrees.map((x) => x + shift);
	const b = [...m.beats];
	switch (how) {
		case "theme":
			return { degrees: d, beats: b };
		case "transposed":
			return { degrees: d.map((x) => x + chordRoot), beats: b };
		case "inverted":
			return { degrees: d.map((x) => 2 * d[0] - x), beats: b };
		case "augmented":
			return { degrees: d, beats: b.map((x) => x * 1.5) };
		case "fragment": {
			const n = Math.min(3, d.length);
			const beats = b.slice(0, n);
			beats[n - 1] *= 2;
			return { degrees: d.slice(0, n), beats };
		}
		case "retrograde":
			return { degrees: [...d].reverse(), beats: [...b].reverse() };
	}
}

/** Collects events, with a bar-and-beat position from a running beat count. */
function writer(beatsPerBar: number) {
	const events: NoteEvent[] = [];
	const at = (
		part: string,
		beat: number,
		dur: number,
		pitch: number,
		vel: number,
	) =>
		events.push({
			part,
			bar: Math.floor(beat / beatsPerBar),
			beat: beat % beatsPerBar,
			dur,
			pitch,
			vel,
		});
	return { events, at };
}

/** A long, layered bed over `chords` (scale-degree roots, one per
 *  `CHORD_BARS`), each layer on its own cycle. Which layers play is the
 *  caller's: calm has them all, each station role a few. */
function bed(opts: {
	theme: MusicTheme;
	tune: MusicTune;
	chords: readonly number[];
	bars: number;
	rand: () => number;
	carrier: string | null;
	motifEvery: number;
	strings: number | null;
	glint: number | null;
	arp: boolean;
	formOffset: number;
	lowDrone?: boolean;
}): NoteEvent[] {
	const { theme, tune, chords, bars, rand } = opts;
	const B = 4;
	const mode = MODES[theme.calmMode];
	const at = (b: number) => chords[Math.floor(b / CHORD_BARS) % chords.length];
	const deg = (base: number, d: number) => degree(mode, theme.tonic, base, d);
	const w = writer(B);

	// The drone: root, fifth and octave, one chord per change, held to the next.
	for (let b = 0; b < bars; b += CHORD_BARS) {
		const r = at(b);
		const len = CHORD_BARS * B;
		w.at("drone", b * B, len, deg(36, r), 0.7);
		w.at("drone", b * B, len, deg(36, r + 4), 0.55);
		w.at("drone", b * B, len, deg(48, r), 0.5);
		if (opts.lowDrone) w.at("drone", b * B, len, deg(24, r), 0.45);
	}

	// Strings: a chord now and then, held to the next change.
	if (opts.strings)
		for (let b = 3 % opts.strings; b < bars; b += opts.strings) {
			const r = at(b);
			const next = (Math.floor(b / CHORD_BARS) + 1) * CHORD_BARS;
			const len = Math.min(24, (next - b) * B);
			if (len < 8) continue;
			for (const k of [0, 2, 4, 6])
				w.at("strings", b * B, len, deg(48, r + k), 0.45);
		}

	// The motif, developed statement by statement.
	if (opts.carrier) {
		let s = 0;
		for (let b = 1; b < bars; b += opts.motifEvery, s++) {
			const how = CALM_FORM[(s + opts.formOffset) % CALM_FORM.length];
			const { degrees, beats } = develop(tune.motif, how, tune.shift, at(b));
			let pos = b * B;
			const total = beats.reduce((x, y) => x + y, 0);
			if (pos + total > bars * B) break;
			degrees.forEach((d, i) => {
				const vel = i === 0 ? 0.7 : i === degrees.length - 1 ? 0.5 : 0.6;
				w.at(
					opts.carrier as string,
					pos,
					beats[i] * 0.95,
					deg(tune.register, d),
					vel,
				);
				pos += beats[i];
			});
		}
	}

	// Glints: one or two high chord tones, quiet, on their own cycle.
	if (opts.glint)
		for (let b = 2; b < bars; b += opts.glint) {
			const r = at(b);
			const n = rand() < 0.5 ? 1 : 2;
			for (let k = 0; k < n; k++) {
				const beat = [0, 1.5, 2.5][Math.floor(rand() * 3) % 3];
				const tone = [0, 2, 4, 7][Math.floor(rand() * 4) % 4];
				w.at(
					"glint",
					b * B + beat + k,
					2,
					deg(84, r + tone),
					0.25 + 0.1 * rand(),
				);
			}
		}

	// The cruise stem: eighths over the chord, silent until the director
	// fades it in.
	if (opts.arp)
		for (let b = 0; b < bars; b++) {
			const r = at(b);
			const tones = [0, 2, 4, 7].map((k) => deg(60, r + k));
			tune.arp.forEach((ix, i) =>
				w.at("arp", b * B + i / 2, 0.5, tones[ix], i % 2 ? 0.25 : 0.35),
			);
		}
	return w.events;
}

/** A calm progression, twice, one chord substituted on the repeat and the
 *  last the dominant. */
function calmChords(rand: () => number): number[] {
	const p =
		CALM_PROGRESSIONS[
			Math.floor(rand() * CALM_PROGRESSIONS.length) % CALM_PROGRESSIONS.length
		];
	return [p[0], p[1], p[2], p[3], p[0], p[1], CALM_SUBSTITUTE[p[2]] ?? p[2], 4];
}

/**
 * A system's flight bed: one song, one section per level, each held by the
 * director. The same `(systemSeed, variant)` writes the same score.
 */
export function flightBed(systemSeed: number, variant: number): Song {
	const theme = musicTheme(systemSeed);
	const tune = musicTune(systemSeed);
	const rand = seededRand(mix(themeSeed(systemSeed), variant + 1));
	const calm = bed({
		theme,
		tune,
		chords: calmChords(rand),
		bars: CALM_BARS,
		rand,
		carrier: tune.carrier,
		motifEvery: MOTIF_EVERY,
		strings: STRINGS_EVERY,
		glint: GLINT_EVERY,
		arp: true,
		formOffset: variant,
	});
	const sections = [
		{ name: "calm", bars: CALM_BARS, events: calm },
		...FLIGHT_LEVELS.slice(1).map((level) => ({
			name: level,
			bars: SECTION_BARS,
			events: levelSection(
				level,
				MODES[LEVEL_MODE[level as Exclude<MusicLevel, "calm">]],
				theme.tonic,
				rand,
			),
		})),
	];
	let bar = 0;
	const tempo = sections.map((s, i) => {
		const point = {
			bar,
			bpm: Math.round(
				(theme.bpm + CALM_LIFT_BPM) * LEVEL_TEMPO[FLIGHT_LEVELS[i]],
			),
		};
		bar += s.bars;
		return point;
	});
	return {
		name: `flight ${systemSeed >>> 0}/${variant}`,
		beatsPerBar: 4,
		parts: { ...FLIGHT_PARTS(theme), ...PARTS },
		sections,
		tempo,
		space: SPACE,
	};
}

/** What a station's role plays (D8): which layers, on which cycles. */
const ROLE_BED: Readonly<
	Record<
		StationType,
		{
			carrier: string | null;
			motifEvery: number;
			strings: number | null;
			glint: number | null;
			lowDrone: boolean;
		}
	>
> = {
	trade: {
		carrier: "keys",
		motifEvery: 7,
		strings: 11,
		glint: null,
		lowDrone: false,
	},
	shipyard: {
		carrier: "bell",
		motifEvery: 9,
		strings: null,
		glint: 5,
		lowDrone: false,
	},
	refinery: {
		carrier: null,
		motifEvery: 7,
		strings: 9,
		glint: 7,
		lowDrone: true,
	},
	outpost: {
		carrier: "keys",
		motifEvery: 11,
		strings: null,
		glint: 6,
		lowDrone: false,
	},
};

/** The station bed: the system's key, bright mode and tune, slower, and
 *  textured by the station's role. */
export function stationBed(
	systemSeed: number,
	role: StationType,
	variant: number,
): Song {
	const theme = musicTheme(systemSeed);
	const tune = musicTune(systemSeed);
	const rand = seededRand(
		mix(mix(themeSeed(systemSeed), STATION_ROLES.indexOf(role) + 101), variant),
	);
	const r = ROLE_BED[role];
	const p = calmChords(rand);
	const events = bed({
		theme,
		tune,
		chords: [p[0], p[1], p[2], 4],
		bars: STATION_BARS,
		rand,
		carrier: r.carrier,
		motifEvery: r.motifEvery,
		strings: r.strings,
		glint: r.glint,
		arp: false,
		formOffset: variant + 3,
		lowDrone: r.lowDrone,
	});
	const used = new Set(events.map((e) => e.part));
	return {
		name: `station ${role} ${systemSeed >>> 0}/${variant}`,
		beatsPerBar: 4,
		parts: Object.fromEntries(
			Object.entries(PARTS).filter(([name]) => used.has(name)),
		),
		sections: [{ name: "bed", bars: STATION_BARS, events }],
		tempo: [{ bar: 0, bpm: Math.round((theme.bpm + CALM_LIFT_BPM) * 0.8) }],
		loop: { from: "bed", to: "bed" },
		space: SPACE,
	};
}
