/**
 * The Blue Danube as dark techno: a listening spike beside the docking
 * computer's waltz (`music-danube.ts`), on the same synth.
 *
 * **Strauss's notes, re-metred.** The theme and the harmony are the waltz
 * module's own tables (`THEME`, `HARMONY`), not a second encoding. Two
 * waltz bars become one 4/4 bar on a 3-3-2 sixteenth grid: a waltz bar's
 * three beats land on 0, 0.75 and 1.5 of its half of the bar, so the tune
 * keeps its lilt as a syncopation over a straight kick (`toFour`). Waltz
 * No. 1's 32 bars become 16.
 *
 * **D major turned to D minor**: every F# is an F and every B a B flat; the
 * C# stays, as the minor's leading tone. The theme is an octave down on a
 * saw lead into a dotted-eighth echo, the woodwinds' answers are short
 * stabs at the printed octave, and the oom-pah-pah is a rolling acid line
 * on each bar's root, between the kicks.
 *
 * The form keeps the waltz's contract, so the director could play it as it
 * plays the waltz: an intro, a loop (here a groove of eight bars and the
 * theme), and a `resolve` to the cadence on the next bar line.
 */
import { DANUBE_VOICINGS, HARMONY, THEME } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const TECHNO_BPM = 128;

/** The kit's pitches, as the flight beds' kit has them
 *  (`music-generate.ts`). */
const KICK = 29;
const CLAP = 88;
const HAT = 104;

const PARTS: Readonly<Record<string, PartSpec>> = {
	kick: { voice: "kick", level: 0.62, reverb: 0.05 },
	clap: {
		voice: "noise",
		level: 0.16,
		decayS: 0.22,
		releaseS: 0.1,
		reverb: 0.45,
	},
	hat: { voice: "noise", level: 0.07, pan: 0.25, reverb: 0.12 },
	tick: {
		voice: "noise",
		level: 0.035,
		decayS: 0.04,
		releaseS: 0.03,
		pan: -0.3,
		reverb: 0.1,
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
	// The rolling bass: the acid voice held dark, its filter breathing open
	// over a slow sweep.
	bass: {
		voice: "acid",
		level: 0.3,
		cutoffHz: 180,
		envAmount: 2.4,
		envDecayS: 0.16,
		resonance: 0.62,
		drive: 0.55,
		glideS: 0,
		sweepS: 30,
		sweepOct: 1.6,
		reverb: 0.05,
	},
	pad: {
		voice: "drone",
		level: 0.1,
		attackS: 1.2,
		releaseS: 1.5,
		detune: 0.1,
		drift: 6,
		spread: 1,
		reverb: 0.7,
	},
	// The theme, an octave down: a detuned saw, its filter snapping shut.
	lead: {
		voice: "analog",
		level: 0.2,
		unison: 3,
		detune: 0.12,
		spread: 0.7,
		attackS: 0.008,
		decayS: 0.5,
		sustain: 0.55,
		releaseS: 0.15,
		cutoffHz: 700,
		envAmount: 2,
		envDecayS: 0.22,
		resonance: 0.35,
		reverb: 0.4,
		echo: 0.35,
	},
	// The answers, at the printed octave: dub stabs into the echo.
	stab: {
		voice: "analog",
		level: 0.11,
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
		pan: 0.3,
		reverb: 0.55,
		echo: 0.55,
	},
	// The intro's horn call, on the waltz's own bowed desk, darker and wetter.
	horn: { ...DANUBE_VOICINGS.orchestra.horn, level: 0.22, reverb: 0.7 },
};

/** D major's F# and B lowered: D minor, its C# kept as the leading tone. */
const minor = (p: number): number => {
	const pc = ((Math.round(p) % 12) + 12) % 12;
	return pc === 6 || pc === 11 ? p - 1 : p;
};

/** A waltz position in 4/4 beats from the section's start: two waltz bars a
 *  4/4 bar, a waltz bar's beats on the 3-3-2 sixteenth grid. */
const fourBeats = (waltzBeats: number): number => {
	const bar = Math.floor(waltzBeats / 3);
	const w = waltzBeats - bar * 3;
	return bar * 2 + (w < 2 ? w * 0.75 : 1.5 + (w - 2) * 0.5);
};

/** One note at an absolute 4/4 beat of its section. */
const at = (
	part: string,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => ({
	part,
	bar: Math.floor(beat / 4),
	beat: beat - Math.floor(beat / 4) * 4,
	dur,
	pitch,
	vel,
});

/** A note written in waltz time, re-metred. */
const fromWaltz = (
	part: string,
	bar: number,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => {
	const from = fourBeats(bar * 3 + beat);
	return at(part, from, fourBeats(bar * 3 + beat + dur) - from, pitch, vel);
};

/** The kit over `bars` bars from `bar`: kick on every beat, the open hat on
 *  the off-beats, a soft tick on the sixteenths, the clap on two and four. */
function kit(
	bar: number,
	bars: number,
	o: { clap?: boolean; hat?: boolean; kickVel?: (b: number) => number } = {},
): NoteEvent[] {
	const out: NoteEvent[] = [];
	for (let b = bar; b < bar + bars; b++)
		for (let q = 0; q < 4; q++) {
			const t = b * 4 + q;
			out.push(at("kick", t, 0.5, KICK, o.kickVel?.(b) ?? 0.9));
			if (o.hat !== false) {
				out.push(at("hat", t + 0.5, 0.15, HAT, 0.7));
				out.push(at("tick", t + 0.25, 0.05, HAT + 6, 0.5));
				out.push(at("tick", t + 0.75, 0.05, HAT + 6, 0.4));
			}
			if (o.clap && q % 2 === 1) out.push(at("clap", t, 0.25, CLAP, 0.8));
		}
	return out;
}

/** The rolling bass on `root` over one beat: the three sixteenths after the
 *  kick, the last an octave up every other beat. */
const roll = (beat: number, root: number, vel = 1): NoteEvent[] =>
	[1, 2, 3].map((i) =>
		at(
			"bass",
			beat + i / 4,
			0.15,
			i === 3 && Math.floor(beat) % 2 === 1 ? root + 12 : root,
			vel * [0, 0.55, 0.8, 0.62][i],
		),
	);

/** Sixteen sixteenths of noise climbing through the last bar of a build. */
const riser = (bar: number): NoteEvent[] =>
	Array.from({ length: 16 }, (_, i) =>
		at("riser", bar * 4 + i / 4, 0.2, 72 + i * 2.5, 0.3 + i * 0.04),
	);

const DM = [50, 57, 62, 65];
const A = [49, 57, 61, 64];
const chord = (
	beat: number,
	pitches: readonly number[],
	dur: number,
	vel: number,
) => pitches.map((p) => at("pad", beat, dur, p, vel));

// ── Intro: the pad, the horn's call, the kick coming in ─────────────────────

const INTRO: NoteEvent[] = [
	...chord(0, DM, 16, 0.5),
	...chord(16, A, 16, 0.5),
	// The call, A–C#–E into a held E, then D–F–A into a held A, then the
	// thirds rising twice over the dominant.
	...[
		[6.5, 57],
		[7, 61],
		[7.5, 64],
	].map(([t, p]) => at("horn", t, 0.5, p, 0.55)),
	at("horn", 8, 6, 64, 0.5),
	...[
		[14.5, 50],
		[15, 53],
		[15.5, 57],
	].map(([t, p]) => at("horn", t, 0.5, p, 0.55)),
	at("horn", 16, 4, 57, 0.5),
	...[22, 30].flatMap((t) => [
		...[52, 57].map((p) => at("horn", t + 0.5, 0.5, p, 0.5)),
		...[55, 58].map((p) => at("horn", t + 1, 0.5, p, 0.55)),
		...[57, 61].map((p) => at("horn", t + 1.5, 0.5, p, 0.6)),
	]),
	...[57, 61].map((p) => at("horn", 24, 4, p, 0.55)),
	...kit(4, 4, { hat: false, kickVel: (b) => 0.45 + (b - 4) * 0.12 }),
	...Array.from({ length: 8 }, (_, q) => roll(24 + q, 33, 0.7)).flat(),
	...riser(7),
];

// ── The groove: eight bars before the theme, every loop ─────────────────────

const GROOVE: NoteEvent[] = [
	...chord(0, DM, 16, 0.45),
	...chord(16, A, 16, 0.45),
	...kit(0, 8, { clap: true }),
	...Array.from({ length: 32 }, (_, q) => roll(q, q < 16 ? 38 : 33)).flat(),
	...riser(7),
];

// ── The theme: Waltz No. 1, re-metred and in the minor ───────────────────────

/** Loudness by waltz bar, as the waltz's: p, then f, then ff at bar 25. */
const dyn = (bar: number) =>
	bar < 16 ? 0.6 : bar < 17 ? 0.66 : bar < 25 ? 0.78 : bar < 29 ? 0.92 : 0.86;

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => [
		fromWaltz("lead", bar, beat, dur, minor(pitch) - 12, dyn(bar)),
		...(answer
			? [
					fromWaltz(
						"stab",
						bar,
						beat,
						Math.min(dur, 0.5),
						minor(pitch),
						dyn(bar),
					),
				]
			: []),
		// The grace before each answer on a third beat.
		...(answer && beat === 2
			? [fromWaltz("lead", bar, 1.9, 0.1, minor(pitch) - 13, dyn(bar) * 0.6)]
			: []),
	]),
	// Each waltz bar's root, two beats of the roll; the pad on each 4/4 bar's
	// first harmony.
	...HARMONY.flatMap((h, bar) => {
		const root = minor(h ? h[0] : 38);
		const t = bar * 2;
		return [...roll(t, root), ...roll(t + 1, root)];
	}),
	...Array.from({ length: 16 }, (_, b) => {
		const h = HARMONY[b * 2] ?? HARMONY[b * 2 + 1];
		const pad = h ? h[2] : DM;
		return chord(b * 4, [minor(pad[0]) - 12, ...pad.map(minor)], 4, 0.4);
	}).flat(),
	...kit(0, 16, { clap: true }),
];

// ── The cadence: Strauss's last three bars, then the tonic left to ring ─────

const CADENCE: NoteEvent[] = [
	...(
		[
			[0, 0, 78, 2],
			[0, 2, 76, 1],
			[1, 0, 83, 2],
			[1, 2, 81, 1],
			[2, 0, 74, 1],
			[2, 1.5, 74, 0.5],
			[2, 2, 74, 1],
		] as const
	).map(([bar, beat, pitch, dur]) =>
		fromWaltz("lead", bar, beat, dur, minor(pitch) - 12, 0.86),
	),
	at("lead", 6, 6, 62, 0.8),
	at("stab", 6, 0.5, 74, 0.8),
	...chord(0, [43, 55, 58, 62], 2, 0.45),
	...chord(2, [45, 55, 61, 64], 2, 0.45),
	...chord(4, [38, ...DM], 12, 0.5),
	...[0, 1].flatMap((q) => roll(q, 43)),
	...[2, 3].flatMap((q) => roll(q, 45)),
	...[4, 5].flatMap((q) => roll(q, 38)),
	...kit(0, 1, { clap: true }),
	...[4, 5].map((t) => at("kick", t, 0.5, KICK, 0.9)),
	at("kick", 8, 0.5, KICK, 1),
	at("clap", 8, 0.25, CLAP, 0.9),
];

/**
 * Score bars: the intro 0–7, the groove 8–15, the theme 16–31, the cadence
 * 32–35. The loop is the groove and the theme, 24 bars, 45 s at
 * `TECHNO_BPM`; the cadence slows over its last two bars.
 */
export const DANUBE_TECHNO: Song = {
	name: "An der schönen blauen Donau (dark techno)",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 8, events: INTRO },
		{ name: "groove", bars: 8, events: GROOVE },
		{ name: "waltz", bars: 16, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: TECHNO_BPM },
		{ bar: 33, bpm: TECHNO_BPM },
		{ bar: 35, bpm: 112, ramp: true },
	],
	loop: { from: "groove", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 4, echoBeats: 0.75, echoFeedback: 0.45 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_TECHNO;
