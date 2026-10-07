/**
 * The Blue Danube as synthwave: the waltz on an 1980s night drive — a
 * gated snare on two and four, an octave-bouncing eighth bass, a wide
 * detuned pad, a sixteenth arpeggio into the echo and a DX-style bell.
 *
 * **Strauss's notes, re-metred as the techno version is.** Two waltz bars
 * become one 4/4 bar on a 3-3-2 sixteenth grid (`toFour`), so the tune
 * keeps its lilt over a straight beat; Waltz No. 1's 32 bars become 16. It
 * stays in **D major** — the techno version is the minor one — and the
 * intro is the decade's own progression, I–vi–IV–V, before the horn's call
 * leads the band in.
 */
import { CADENCE_THEME, HARMONY, THEME } from "../music-danube";
import { at, fromWaltz } from "../music-danube-remeter";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const SYNTHWAVE_BPM = 108;

const KICK = 29;
const SNARE = 86;
const HAT = 104;

const PARTS: Readonly<Record<string, PartSpec>> = {
	kick: { voice: "kick", level: 0.605, reverb: 0.05 },
	// The gated snare: a short burst thrown into a big room.
	snare: {
		voice: "noise",
		level: 0.22,
		decayS: 0.3,
		sustain: 0,
		releaseS: 0.05,
		resonance: 0.3,
		reverb: 0.8,
	},
	hat: { voice: "noise", level: 0.055, pan: 0.25, reverb: 0.1 },
	bass: {
		voice: "analog",
		level: 0.33,
		unison: 2,
		detune: 0.05,
		spread: 0.2,
		attackS: 0.003,
		decayS: 0.2,
		sustain: 0.5,
		releaseS: 0.05,
		cutoffHz: 480,
		envAmount: 2,
		envDecayS: 0.12,
		resonance: 0.2,
		reverb: 0.05,
	},
	pad: {
		voice: "analog",
		level: 0.143,
		unison: 4,
		detune: 0.15,
		drift: 6,
		spread: 1,
		attackS: 0.4,
		sustain: 0.85,
		releaseS: 0.8,
		cutoffHz: 1600,
		envAmount: 0.6,
		envDecayS: 2,
		reverb: 0.6,
	},
	arp: {
		voice: "analog",
		level: 0.099,
		unison: 2,
		detune: 0.04,
		spread: 0.6,
		attackS: 0.003,
		decayS: 0.14,
		sustain: 0,
		releaseS: 0.05,
		cutoffHz: 1500,
		envAmount: 1.6,
		envDecayS: 0.1,
		resonance: 0.25,
		pan: 0.3,
		reverb: 0.3,
		echo: 0.4,
	},
	lead: {
		voice: "analog",
		level: 0.22,
		unison: 3,
		detune: 0.1,
		spread: 0.6,
		attackS: 0.01,
		decayS: 1,
		sustain: 0.8,
		releaseS: 0.3,
		cutoffHz: 2400,
		envAmount: 0.8,
		envDecayS: 0.4,
		vibrato: 0.12,
		pan: -0.1,
		reverb: 0.4,
		echo: 0.3,
	},
	// The woodwinds' answers on a DX bell.
	bell: {
		voice: "fm",
		level: 0.099,
		ratio: 3.5,
		index: 2,
		indexDecayS: 0.5,
		decayS: 1,
		sustain: 0,
		releaseS: 0.4,
		pan: 0.35,
		reverb: 0.45,
		echo: 0.4,
	},
};

/** The kit over `bars` bars from `bar`. */
function kit(
	bar: number,
	bars: number,
	o: { snare?: boolean; hat?: boolean } = {},
): NoteEvent[] {
	const out: NoteEvent[] = [];
	for (let b = bar; b < bar + bars; b++)
		for (let q = 0; q < 4; q++) {
			const t = b * 4 + q;
			if (q % 2 === 0) out.push(at("kick", t, 0.5, KICK, 0.9));
			if (o.snare !== false && q % 2 === 1)
				out.push(at("snare", t, 0.3, SNARE, 0.85));
			if (o.hat !== false) {
				out.push(at("hat", t, 0.1, HAT, 0.45));
				out.push(at("hat", t + 0.5, 0.1, HAT, 0.7));
			}
		}
	return out;
}

/** Two beats of a harmony from `beat`: the octave bass in eighths and a
 *  sixteenth arpeggio up the chord. */
function band(
	beat: number,
	root: number,
	chord: readonly number[],
	vel: number,
): NoteEvent[] {
	const r = root < 33 ? root + 12 : root;
	const up = [...chord].sort((a, b) => a - b).map((p) => p + 12);
	const steps = [
		up[0],
		up[1],
		up[2],
		up[1] + 12,
		up[2],
		up[1],
		up[0] + 12,
		up[2],
	];
	return [
		...[0, 0.5, 1, 1.5].map((e, i) =>
			at("bass", beat + e, 0.4, i % 2 ? r + 12 : r, vel * (i ? 0.8 : 1)),
		),
		...steps.map((p, i) => at("arp", beat + i / 4, 0.2, p, vel * 0.7)),
	];
}

// ── Intro: I–vi–IV–V, the horn's call, the drums coming in ─────────────────

/** Two bars each of D, Bm, G and A: `[root, pad]`. */
const PROGRESSION: readonly (readonly [number, readonly number[]])[] = [
	[38, [57, 62, 66]],
	[47, [54, 59, 62]],
	[43, [55, 59, 62]],
	[45, [57, 61, 64]],
];

const INTRO: NoteEvent[] = [
	...PROGRESSION.flatMap(([root, pad], i) => [
		...pad.map((p) => at("pad", i * 8, 8, p, 0.55)),
		...[0, 2, 4, 6].flatMap((h) => {
			const notes = band(i * 8 + h, root, pad, 0.5 + i * 0.1);
			// The bass waits for the second turn of the progression's half.
			return i < 2 ? notes.filter((x) => x.part === "arp") : notes;
		}),
	]),
	...kit(4, 2, { snare: false, hat: false }),
	...kit(6, 2),
	// The call over the dominant, A–C#–E into the held E.
	...[
		[26.5, 69],
		[27, 73],
		[27.5, 76],
	].map(([t, p]) => at("lead", t, 0.5, p, 0.6)),
	at("lead", 28, 2, 76, 0.55),
	// A snare roll into the theme.
	...Array.from({ length: 8 }, (_, i) =>
		at("snare", 30 + i / 4, 0.2, SNARE, 0.4 + i * 0.07),
	),
];

// ── The theme: Waltz No. 1, re-metred ───────────────────────────────────────

const dyn = (bar: number) =>
	bar < 16 ? 0.62 : bar < 17 ? 0.68 : bar < 25 ? 0.8 : bar < 29 ? 0.92 : 0.86;

/** The pad held over each run of one harmony, in 4/4 beats. */
function pads(): NoteEvent[] {
	const out: NoteEvent[] = [];
	let from = 1;
	for (let bar = 2; bar <= HARMONY.length; bar++) {
		const a = HARMONY[from];
		const b = HARMONY[bar];
		if (b && a && b[2].join() === a[2].join()) continue;
		if (a)
			for (const p of a[2])
				out.push(at("pad", from * 2, (bar - from) * 2, p, dyn(from) * 0.7));
		from = bar;
	}
	return out;
}

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => [
		fromWaltz("lead", bar, beat, dur, pitch, dyn(bar)),
		...(answer
			? [fromWaltz("bell", bar, beat, Math.min(dur, 0.5), pitch, dyn(bar))]
			: []),
		...(answer && beat === 2
			? [fromWaltz("lead", bar, 1.9, 0.1, pitch - 1, dyn(bar) * 0.6)]
			: []),
	]),
	...HARMONY.flatMap((h, bar) =>
		h
			? band(bar * 2, h[0], h[1], dyn(bar))
			: band(0, 45, [55, 57, 61], dyn(0) * 0.8),
	),
	...pads(),
	...kit(0, 16),
];

// ── The cadence: Strauss's last three bars, then the tonic ringing ────────

const CADENCE: NoteEvent[] = [
	...CADENCE_THEME.map(([bar, beat, pitch, dur]) =>
		fromWaltz("lead", bar, beat, dur, pitch, 0.86),
	),
	at("lead", 6, 6, 74, 0.8),
	at("bell", 6, 0.5, 86, 0.8),
	...band(0, 43, [59, 62, 67], 0.86),
	...band(2, 45, [55, 61, 64], 0.86),
	...band(4, 38, [57, 62, 66], 0.86),
	...[55, 59, 62, 67].map((p) => at("pad", 0, 2, p, 0.6)),
	...[55, 61, 64, 69].map((p) => at("pad", 2, 2, p, 0.6)),
	...[50, 57, 62, 66].map((p) => at("pad", 4, 10, p, 0.6)),
	at("bass", 6, 6, 38, 0.8),
	...kit(0, 1),
	at("kick", 4, 0.5, KICK, 0.9),
	at("snare", 5, 0.3, SNARE, 0.85),
	at("kick", 8, 0.5, KICK, 1),
	at("snare", 8, 0.3, SNARE, 1),
];

/**
 * Score bars: the intro 0–7, the theme 8–23 (16 bars, 36 s a loop at
 * `SYNTHWAVE_BPM`), the cadence 24–27, slowing over its last two.
 */
export const DANUBE_SYNTHWAVE: Song = {
	name: "An der schönen blauen Donau (synthwave)",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 8, events: INTRO },
		{ name: "waltz", bars: 16, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: SYNTHWAVE_BPM },
		{ bar: 25, bpm: SYNTHWAVE_BPM },
		{ bar: 27, bpm: 96, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 3, echoBeats: 0.75, echoFeedback: 0.4 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_SYNTHWAVE;
