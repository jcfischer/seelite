/**
 * The generative bed, third form: a Berlin-school prototype, for the
 * principal's ear (2026-09-30). The second bed (`music-generate.ts`) was
 * heard as working but *too slow*, its melody fragments *boring*; the ask
 * was Berlin-school elements and early Tangerine Dream's noise sweeps.
 *
 * - **Faster, and busy underneath.** The bed runs at `BERLIN_BPM_LOW` and up,
 *   against the second bed's 76–92, and a sixteenth-note sequence runs
 *   under calm from bar 4. The pulse is what made the second bed read slow as
 *   much as the tempo: its only moving part was the cruise stem.
 * - **The sequence is the Berlin school.** Sixteen steps on the analog, its
 *   filter opening and closing over `SEQ_SWEEP_BARS` (the synth's `sweepS`),
 *   transposed with the harmony and **mutated a step at a time** every
 *   `MUTATE_EVERY` bars, as a player at a step sequencer would. Above it an
 *   odd-length counter-sequence phases against the bar, and a bass pulse
 *   bounces octaves under both.
 * - **Noise sweeps.** Two resonant noise bands, left and right, sweep on
 *   co-prime periods for the whole bed — Zeit's and Atem's wash — and a
 *   riser climbs into the sequence's return after the breakdown.
 * - **Livelier motifs, answered.** `BERLIN_MOTIFS` are two bars with a
 *   rhythm of their own; each statement is a call and its answer, the answer
 *   a third lower and home on its last note.
 * - **An arc inside calm.** Drone and wash first, then the sequence, the
 *   pulse, the lead, the counter-sequence; a breakdown at bar 28 where the
 *   sequence stops and the strings carry the motif; the riser; and the whole
 *   again to the end.
 *
 * Threat and combat keep the second bed's sections, which are already
 * sequenced on the acid, with the new motifs through them and no wash: under
 * the threat it covered the hats, and combat has no voices left for it. Each has a stream of its own, so a layer added to
 * calm cannot move a pick in a fight.
 *
 * Pure, so `tests/music-generate-berlin.test.ts` holds it headless.
 */
import {
	BERLIN_MOTIFS,
	CALM_FORM,
	ODD_SEQUENCES,
	PULSES,
	SEQUENCES,
	WARY_PROGRESSIONS,
} from "./music-fragments";
import {
	calmChords,
	combat,
	develop,
	FLIGHT_LEVELS,
	inMode,
	MODES,
	type MusicTheme,
	type MusicTune,
	musicTheme,
	musicTune,
	PARTS,
	pickOf,
	SPACE,
	STATION_ROLES,
	threat,
	writer,
} from "./music-generate";
import { LEVEL_MODE } from "./music-generate-legacy";
import type { NoteEvent, PartSpec, Song } from "./music-score";
import { mix, seededRand } from "./rng";
import type { StationType } from "./station";

/** The slowest system's calm, in bpm; the theme's own 66–82 spread rides
 *  on top, so the fastest calm is `BERLIN_BPM_LOW + 16`. A figure for the
 *  ear, not a measurement. */
export const BERLIN_BPM_LOW = 100;
/** Each level's tempo against calm. Faster than the second bed's ladder at
 *  wary, because the sequence is what carries the rise. */
export const BERLIN_LEVEL_TEMPO = {
	calm: 1,
	wary: 1.05,
	threat: 1.1,
	combat: 1.2,
} as const;

export const BERLIN_CALM_BARS = 64;
export const BERLIN_WARY_BARS = 32;
export const BERLIN_STATION_BARS = 32;
/** Bars per chord: shorter than the second bed's eight, so the sequence is
 *  transposed often enough to be heard moving. */
const CHORD_BARS = 4;
/** The sequence's filter: one open-and-close in this many bars. */
export const SEQ_SWEEP_BARS = 16;
/** A step of the sequence changes this often. */
export const MUTATE_EVERY = 8;
/** Calm's arc, in bars. */
const SEQ_IN = 4;
const PULSE_IN = 8;
const LEAD_IN = 12;
const SPARKLE_IN = 16;
const BREAK_AT = 28;
const BREAK_BARS = 8;
/** The noise wash's two periods, seconds: co-prime, so the two sides never
 *  sweep together for long. */
const WIND_S = [23, 31] as const;
/** A wash note's length. A held note outlives a jump to another level —
 *  the engine moves the playhead, not the voices already sounding — so a
 *  32-bar wash played calm's noise under a fight for over a minute, and
 *  covered the threat's hats (probe-music's ladder read 0.06 transients/s).
 *  No note of this bed is longer than `MAX_NOTE_BARS`. */
const WASH_BARS = 4;
export const MAX_NOTE_BARS = 4;

/** Streams of their own, apart from the second bed's. */
const BERLIN_TUNE = 0x6265726c;
const STREAM = { calm: 1, wary: 2, threat: 3, combat: 4, station: 5 } as const;

/** What the seed fixes beyond the second bed's tune: the Berlin material. */
export interface BerlinTune extends MusicTune {
	readonly seq: readonly (number | null)[];
	readonly odd: readonly number[];
	readonly pulse: readonly number[];
}

export function berlinTune(systemSeed: number): BerlinTune {
	const base = musicTune(systemSeed);
	const rand = seededRand(mix(systemSeed >>> 0, BERLIN_TUNE));
	const motif = pickOf(rand, BERLIN_MOTIFS);
	const shift = Math.floor(rand() * 3);
	const top = Math.max(...motif.degrees) + shift;
	return {
		...base,
		motif,
		shift,
		motifVoice: "lead",
		// High enough to sit over the sequence, low enough that a motif
		// reaching past the octave stays under the glints.
		register: top > 7 ? 60 : 72,
		seq: pickOf(rand, SEQUENCES),
		odd: pickOf(rand, ODD_SEQUENCES),
		pulse: pickOf(rand, PULSES),
	};
}

/** Seconds in `bars` of four at `bpm`. */
const barsS = (bars: number, bpm: number) => (bars * 4 * 60) / bpm;

export const berlinBpm = (theme: MusicTheme) =>
	BERLIN_BPM_LOW + (theme.bpm - 66);

/** The third bed's own parts, beside the second bed's (which threat and
 *  combat still play). Named apart, so neither set changes the other's. */
function berlinParts(bpm: number): Record<string, PartSpec> {
	return {
		choir: {
			voice: "analog",
			level: 0.2,
			unison: 4,
			detune: 0.15,
			spread: 1,
			attackS: 1.5,
			sustain: 0.9,
			// Short enough that a chord change does not hold six voices.
			releaseS: 1,
			cutoffHz: 1100,
			envAmount: 0.6,
			envDecayS: 4,
			vibrato: 0.05,
			reverb: 0.65,
		},
		seq: {
			voice: "analog",
			level: 0.3,
			unison: 2,
			detune: 0.06,
			spread: 0.5,
			attackS: 0.003,
			decayS: 0.22,
			sustain: 0,
			releaseS: 0.08,
			cutoffHz: 260,
			envAmount: 2.2,
			envDecayS: 0.12,
			resonance: 0.55,
			sweepS: barsS(SEQ_SWEEP_BARS, bpm),
			sweepOct: 2.6,
			pan: -0.1,
			reverb: 0.25,
			echo: 0.35,
		},
		sparkle: {
			voice: "keys",
			level: 0.14,
			decayS: 0.6,
			releaseS: 0.15,
			pan: 0.35,
			reverb: 0.4,
			echo: 0.5,
		},
		pulse: {
			voice: "analog",
			level: 0.3,
			unison: 2,
			detune: 0.04,
			spread: 0.2,
			attackS: 0.004,
			decayS: 0.18,
			sustain: 0.3,
			releaseS: 0.06,
			cutoffHz: 180,
			envAmount: 2.5,
			envDecayS: 0.09,
			resonance: 0.35,
			sweepS: barsS(24, bpm),
			sweepOct: 1.2,
			reverb: 0.08,
		},
		synlead: {
			voice: "analog",
			level: 0.2,
			unison: 2,
			detune: 0.07,
			attackS: 0.03,
			decayS: 0.8,
			sustain: 0.7,
			releaseS: 0.5,
			cutoffHz: 900,
			envAmount: 1.8,
			envDecayS: 0.5,
			resonance: 0.3,
			vibrato: 0.15,
			reverb: 0.45,
			echo: 0.4,
		},
		// The cruise stem, released quickly: silent until cruise, its tails
		// still hold voices, and the 4-bar wash left wary one voice from the
		// cap with the second bed's 0.2 s.
		arp: { ...PARTS.arp, releaseS: 0.08 },
		windL: {
			voice: "noise",
			level: 0.045,
			attackS: 1.5,
			sustain: 1,
			releaseS: 1.5,
			resonance: 0.85,
			sweepS: WIND_S[0],
			sweepOct: 3.2,
			pan: -0.6,
			reverb: 0.7,
		},
		windR: {
			voice: "noise",
			level: 0.04,
			attackS: 1.5,
			sustain: 1,
			releaseS: 1.5,
			resonance: 0.85,
			sweepS: WIND_S[1],
			sweepOct: 2.8,
			pan: 0.6,
			reverb: 0.7,
		},
		riser: {
			voice: "noise",
			level: 0.09,
			attackS: 0.12,
			sustain: 1,
			releaseS: 0.35,
			resonance: 0.7,
			reverb: 0.6,
			echo: 0.3,
		},
	};
}

type Writer = ReturnType<typeof writer>;
type Deg = (base: number, d: number) => number;

/** The noise wash over `bars`: a band a side, `WASH_BARS` a note, each
 *  note's release crossing the next one's attack, so the wash is continuous
 *  and a jump leaves at most a note of it behind. The sweep is the part's,
 *  on the synth's clock, so it does not restart with each note. */
function wash(w: Writer, bars: number, base: number, vel: number) {
	for (let b = 0; b < bars; b += WASH_BARS) {
		const len = Math.min(WASH_BARS, bars - b) * 4;
		w.at("windL", b * 4, len, base, vel);
		w.at("windR", b * 4 + 2, len - 2, base + 7, vel * 0.9);
	}
}

/** A riser: a noise band climbing `semis` over `bars`, in eighths that
 *  overlap, so the steps blur into one sweep. */
function riser(w: Writer, from: number, bars: number, base: number) {
	const steps = bars * 8;
	for (let k = 0; k < steps; k++)
		w.at(
			"riser",
			from * 4 + k / 2,
			0.75,
			base + (30 * k) / steps,
			0.3 + (0.5 * k) / steps,
		);
}

/** The running sequence over `[from, to)`: sixteenths over each bar's
 *  chord, one step mutated every `MUTATE_EVERY` bars, accents in threes.
 *  `steps` is the caller's and is mutated in place, so a run that stops
 *  and starts again carries on from where it was rather than from the
 *  seed's pattern; `resume` mutates on the way back in. */
function sequence(
	w: Writer,
	o: {
		steps: (number | null)[];
		resume?: boolean;
		deg: Deg;
		chordAt: (bar: number) => number;
		from: number;
		to: number;
		rand: () => number;
		register: number;
	},
) {
	const { steps } = o;
	for (let b = o.from; b < o.to; b++) {
		if ((b > o.from || o.resume) && (b - o.from) % MUTATE_EVERY === 0) {
			// Never the downbeat: the root on one is what keeps it anchored.
			// And never to the value it had, so every mutation is heard.
			const at = 1 + Math.floor(o.rand() * 15);
			steps[at] = pickOf(
				o.rand,
				[0, 2, 4, 5, 7, 9, 11].filter((d) => d !== steps[at]),
			);
		}
		const r = o.chordAt(b);
		steps.forEach((d, i) => {
			if (d === null) return;
			const accent = i % 3 === 0 && i < 15;
			w.at(
				"seq",
				b * 4 + i / 4,
				0.2,
				o.deg(o.register, r + d),
				accent ? 0.8 : 0.52,
			);
		});
	}
}

/** The odd-length counter-sequence: one continuous run of sixteenths across
 *  bar lines, so its phase against the bar walks. */
function sparkle(
	w: Writer,
	odd: readonly number[],
	deg: Deg,
	chordAt: (bar: number) => number,
	from: number,
	to: number,
) {
	for (let s = from * 16, k = 0; s < to * 16; s++, k++) {
		const b = Math.floor(s / 16);
		w.at(
			"sparkle",
			s / 4,
			0.2,
			deg(72, chordAt(b) + odd[k % odd.length]),
			k % odd.length === 0 ? 0.6 : 0.4,
		);
	}
}

/** The bass pulse over `[from, to)`: eighths. */
function pulse(
	w: Writer,
	shape: readonly number[],
	deg: Deg,
	chordAt: (bar: number) => number,
	from: number,
	to: number,
) {
	for (let b = from; b < to; b++)
		shape.forEach((d, i) =>
			w.at(
				"pulse",
				b * 4 + i / 2,
				0.4,
				deg(36, chordAt(b) + d),
				i % 2 ? 0.5 : 0.7,
			),
		);
}

/** A call and its answer: the motif, developed, then the same rhythm a
 *  third lower with its last note home. */
export function answerOf(degrees: readonly number[]): number[] {
	const a = degrees.map((d) => d - 2);
	const last = a[a.length - 1];
	// `+ 0`: a last note just below home rounds to -0.
	a[a.length - 1] = 7 * Math.round(last / 7) + 0;
	return a;
}

/** Call-and-answer statements on `part`, every `every` bars from `from`. */
function phrases(
	w: Writer,
	o: {
		tune: BerlinTune;
		deg: Deg;
		part: string;
		from: number;
		to: number;
		every: number;
		chordAt: (bar: number) => number;
		register: number;
		formOffset: number;
	},
) {
	let s = 0;
	for (let b = o.from; b < o.to; b += o.every, s++) {
		const how = CALM_FORM[(s + o.formOffset) % CALM_FORM.length];
		const call = develop(o.tune.motif, how, o.tune.shift, o.chordAt(b));
		const total = call.beats.reduce((x, y) => x + y, 0);
		if (b * 4 + 2 * total > o.to * 4) break;
		let pos = b * 4;
		for (const degrees of [call.degrees, answerOf(call.degrees)])
			degrees.forEach((d, i) => {
				w.at(
					o.part,
					pos,
					call.beats[i] * 0.92,
					o.deg(o.register, d),
					i === 0 ? 0.75 : 0.62,
				);
				pos += call.beats[i];
			});
	}
}

/** Held chords on the choir, one per change, three tones. */
function choir(
	w: Writer,
	deg: Deg,
	chordAt: (bar: number) => number,
	from: number,
	to: number,
	vel: number,
) {
	for (let b = from; b < to; b += CHORD_BARS)
		// Released a bar and a half early: its tail, not the next chord's
		// attack, is what overlaps.
		for (const k of [0, 2, 4])
			w.at("choir", b * 4, CHORD_BARS * 4 - 1.5, deg(48, chordAt(b) + k), vel);
}

/** The drone: the chord's root alone, one note per chord. The choir has the
 *  fifth; a second drone note held six voices at every change. */
function drone(
	w: Writer,
	deg: Deg,
	chordAt: (bar: number) => number,
	bars: number,
	vel: number,
) {
	for (let b = 0; b < bars; b += CHORD_BARS)
		w.at("drone", b * 4, CHORD_BARS * 4, deg(36, chordAt(b)), vel);
}

/** Calm: the arc in the module comment, over the bright mode. */
function calm(
	theme: MusicTheme,
	tune: BerlinTune,
	rand: () => number,
	variant: number,
): NoteEvent[] {
	const deg = inMode(theme, MODES[theme.calmMode]);
	const chords = calmChords(rand);
	const chordAt = (b: number) =>
		chords[Math.floor(b / CHORD_BARS) % chords.length];
	const w = writer(4);
	const bars = BERLIN_CALM_BARS;
	const back = BREAK_AT + BREAK_BARS;
	drone(w, deg, chordAt, bars, 0.6);
	wash(w, bars, 76, 0.7);
	choir(w, deg, chordAt, 0, bars, 0.4);
	const steps = [...tune.seq];
	for (const [from, to] of [
		[SEQ_IN, BREAK_AT],
		[back, bars],
	])
		sequence(w, {
			steps,
			resume: from === back,
			deg,
			chordAt,
			from,
			to,
			rand,
			register: 48,
		});
	pulse(w, tune.pulse, deg, chordAt, PULSE_IN, BREAK_AT);
	pulse(w, tune.pulse, deg, chordAt, back, bars);
	sparkle(w, tune.odd, deg, chordAt, SPARKLE_IN, BREAK_AT);
	sparkle(w, tune.odd, deg, chordAt, back + 8, bars);
	phrases(w, {
		tune,
		deg,
		part: "synlead",
		from: LEAD_IN,
		to: BREAK_AT,
		every: 8,
		chordAt,
		register: tune.register,
		formOffset: variant,
	});
	// The breakdown: the motif on the sparkle's bell-like keys, alone over
	// the choir and the wash.
	phrases(w, {
		tune,
		deg,
		part: "sparkle",
		from: BREAK_AT,
		to: back - 4,
		every: 4,
		chordAt,
		register: 72,
		formOffset: variant + 2,
	});
	riser(w, back - 4, 4, 60);
	phrases(w, {
		tune,
		deg,
		part: "synlead",
		from: back + 4,
		to: bars,
		every: 8,
		chordAt,
		register: tune.register,
		formOffset: variant + 4,
	});
	cruiseStem(w, tune, deg, chordAt, bars);
	return w.events;
}

/** The director's cruise stem, `arp`: the second bed's eighths, silent
 *  until the director fades it in. */
function cruiseStem(
	w: Writer,
	tune: MusicTune,
	deg: Deg,
	chordAt: (bar: number) => number,
	bars: number,
) {
	for (let b = 0; b < bars; b++) {
		const tones = [0, 2, 4, 7].map((k) => deg(72, chordAt(b) + k));
		tune.arp.forEach((ix, i) =>
			w.at("arp", b * 4 + i / 2, 0.5, tones[ix], i % 2 ? 0.2 : 0.3),
		);
	}
}

/** Wary (aeolian): the sequence throughout, darker and lower, the pulse in
 *  its gallop, the motif in fragments, the wash louder. */
function wary(
	theme: MusicTheme,
	tune: BerlinTune,
	rand: () => number,
): NoteEvent[] {
	const deg = inMode(theme, MODES[LEVEL_MODE.wary]);
	const chords = pickOf(rand, WARY_PROGRESSIONS);
	const chordAt = (b: number) =>
		chords[Math.floor(b / CHORD_BARS) % chords.length];
	const w = writer(4);
	const bars = BERLIN_WARY_BARS;
	drone(w, deg, chordAt, bars, 0.6);
	wash(w, bars, 69, 0.9);
	choir(w, deg, chordAt, 0, bars, 0.35);
	sequence(w, {
		steps: [...pickOf(rand, SEQUENCES)],
		deg,
		chordAt,
		from: 0,
		to: bars,
		rand,
		register: 48,
	});
	pulse(w, PULSES[1], deg, chordAt, 0, bars);
	phrases(w, {
		tune,
		deg,
		part: "synlead",
		from: 2,
		to: bars,
		every: 8,
		chordAt,
		register: 60,
		formOffset: 1,
	});
	riser(w, bars - 4, 4, 55);
	cruiseStem(w, tune, deg, chordAt, bars);
	return w.events;
}

/**
 * Every note longer than `MAX_NOTE_BARS`, as consecutive notes of at most
 * that length: the second bed's combat holds its tonic pedal for all 32 bars,
 * and this bed plays that section as it is written but not that note, which
 * would ring on through a fall for a minute. A voice's release crossing the
 * next one's attack keeps a held tone held.
 */
function splitLong(events: readonly NoteEvent[]): NoteEvent[] {
	const most = MAX_NOTE_BARS * 4;
	return events.flatMap((e) => {
		if (e.dur <= most) return [e];
		const out: NoteEvent[] = [];
		const start = e.bar * 4 + e.beat;
		for (let t = 0; t < e.dur; t += most) {
			const at = start + t;
			out.push({
				...e,
				bar: Math.floor(at / 4),
				beat: at % 4,
				dur: Math.min(most, e.dur - t),
			});
		}
		return out;
	});
}

/** The rand for one section of a variant: its own stream. */
const streamOf = (systemSeed: number, variant: number, section: number) =>
	seededRand(mix(mix(systemSeed >>> 0, BERLIN_TUNE + section), variant + 1));

/** A system's flight bed, third form: one section per level. */
export function berlinFlightBed(systemSeed: number, variant: number): Song {
	const theme = musicTheme(systemSeed);
	const tune = berlinTune(systemSeed);
	const bpm = berlinBpm(theme);
	const threatBars = 24;
	const combatBars = 32;
	const sections = [
		{
			name: "calm",
			bars: BERLIN_CALM_BARS,
			events: calm(
				theme,
				tune,
				streamOf(systemSeed, variant, STREAM.calm),
				variant,
			),
		},
		{
			name: "wary",
			bars: BERLIN_WARY_BARS,
			events: wary(theme, tune, streamOf(systemSeed, variant, STREAM.wary)),
		},
		{
			name: "threat",
			bars: threatBars,
			// No wash: under the threat it covered the hats, which are what a
			// threat is heard by (held alone, 1.06 transients/s with it, 2.06
			// without).
			events: threat(theme, tune, streamOf(systemSeed, variant, STREAM.threat)),
		},
		{
			name: "combat",
			bars: combatBars,
			// No wash: the kit and the acid hold every voice the cap has left.
			events: combat(theme, tune, streamOf(systemSeed, variant, STREAM.combat)),
		},
	];
	for (const s of sections) s.events = splitLong(s.events);
	let bar = 0;
	const tempo = sections.map((s, i) => {
		const point = {
			bar,
			bpm: Math.round(bpm * BERLIN_LEVEL_TEMPO[FLIGHT_LEVELS[i]]),
		};
		bar += s.bars;
		return point;
	});
	return {
		name: `berlin ${systemSeed >>> 0}/${variant}`,
		beatsPerBar: 4,
		parts: { ...PARTS, ...berlinParts(bpm) },
		sections,
		tempo,
		space: SPACE,
	};
}

/** What a station's role keeps of the bed: the sequence or not, the lead or
 *  the sparkle, and how much wash. */
const ROLE: Readonly<
	Record<
		StationType,
		{ seq: boolean; lead: string | null; wash: number; sparkle: boolean }
	>
> = {
	trade: { seq: true, lead: "synlead", wash: 0.5, sparkle: false },
	shipyard: { seq: true, lead: null, wash: 0.4, sparkle: true },
	refinery: { seq: false, lead: null, wash: 0.9, sparkle: false },
	outpost: { seq: false, lead: "sparkle", wash: 0.7, sparkle: true },
};

/** The station bed: slower, quieter, and textured by the role. */
export function berlinStationBed(
	systemSeed: number,
	role: StationType,
	variant: number,
): Song {
	const theme = musicTheme(systemSeed);
	const tune = berlinTune(systemSeed);
	const rand = seededRand(
		mix(
			mix(systemSeed >>> 0, BERLIN_TUNE + STREAM.station),
			STATION_ROLES.indexOf(role) * 97 + variant,
		),
	);
	const bpm = Math.round(berlinBpm(theme) * 0.8);
	const deg = inMode(theme, MODES[theme.calmMode]);
	const p = calmChords(rand);
	const chords = [p[0], p[1], p[2], 4];
	const chordAt = (b: number) =>
		chords[Math.floor(b / (2 * CHORD_BARS)) % chords.length];
	const r = ROLE[role];
	const w = writer(4);
	const bars = BERLIN_STATION_BARS;
	for (let b = 0; b < bars; b += 2 * CHORD_BARS) {
		w.at("drone", b * 4, 2 * CHORD_BARS * 4, deg(36, chordAt(b)), 0.55);
		w.at("drone", b * 4, 2 * CHORD_BARS * 4, deg(36, chordAt(b) + 4), 0.4);
	}
	choir(w, deg, chordAt, 0, bars, 0.35);
	wash(w, bars, 72, r.wash);
	if (r.seq)
		sequence(w, {
			steps: [...tune.seq],
			deg,
			chordAt,
			from: 4,
			to: bars,
			rand,
			register: 48,
		});
	if (r.sparkle) sparkle(w, tune.odd, deg, chordAt, 8, bars);
	if (r.lead)
		phrases(w, {
			tune,
			deg,
			part: r.lead,
			from: 6,
			to: bars,
			every: 12,
			chordAt,
			register: 72,
			formOffset: variant + 3,
		});
	const parts = berlinParts(bpm);
	const used = new Set(w.events.map((e) => e.part));
	return {
		name: `berlin station ${role} ${systemSeed >>> 0}/${variant}`,
		beatsPerBar: 4,
		parts: {
			...Object.fromEntries(
				Object.entries(PARTS).filter(([name]) => used.has(name)),
			),
			...Object.fromEntries(
				Object.entries(parts).filter(([name]) => used.has(name)),
			),
		},
		sections: [{ name: "bed", bars, events: w.events }],
		tempo: [{ bar: 0, bpm }],
		loop: { from: "bed", to: "bed" },
		space: SPACE,
	};
}
