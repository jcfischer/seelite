/**
 * Every knob of the `strings` voice, declared once (#547 D15): its range, its
 * default, its unit and a line of help. The voice takes its defaults from
 * here (`music-voices.ts`) and the strings lab builds its sliders from here
 * (`strings-lab.ts`), so a knob added to this table is a default the voice
 * reads and a slider the lab shows, with no second list to keep in step.
 *
 * **Every default is the sound the principal heard before the lab** — the
 * grit knobs (D16) default to off — and `tests/music-strings-params.test.ts`
 * pins the voice's output at these defaults to the figures it printed before
 * the table existed.
 *
 * Imports only the score's types, so it is data and nothing else.
 */
import type { PartSpec } from "./music-score";

/** The slider groups, in the order the lab shows them. */
export const STRINGS_GROUPS = [
	"tone",
	"envelope",
	"bow",
	"vibrato",
	"filter",
	"grit",
	"space",
] as const;
export type StringsGroup = (typeof STRINGS_GROUPS)[number];

/** A numeric field of a part. */
export type StringsKey = {
	[K in keyof PartSpec]-?: PartSpec[K] extends number | undefined ? K : never;
}[keyof PartSpec];

export interface StringsParam {
	readonly key: StringsKey;
	readonly label: string;
	readonly group: StringsGroup;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly def: number;
	readonly unit: string;
	readonly help: string;
}

export const STRINGS_PARAMS: readonly StringsParam[] = [
	// ── tone
	{
		key: "level",
		label: "Level",
		group: "tone",
		min: 0,
		max: 1,
		step: 0.01,
		def: 0.3,
		unit: "",
		help: "The part's gain before any fade. A desk sets its own.",
	},
	{
		key: "unison",
		label: "Saws per note",
		group: "tone",
		min: 1,
		max: 8,
		step: 1,
		def: 5,
		unit: "",
		help: "Players in the section: detuned saws sounding each note.",
	},
	{
		key: "detune",
		label: "Detune spread",
		group: "tone",
		min: 0,
		max: 0.5,
		step: 0.01,
		def: 0.12,
		unit: "st",
		help: "How far the players spread either side of the note.",
	},
	{
		key: "drift",
		label: "Drift rate",
		group: "tone",
		min: 0,
		max: 12,
		step: 0.5,
		def: 4,
		unit: "/s",
		help: "How often each player's tuning wanders to a new small offset.",
	},
	// ── envelope
	{
		key: "attackS",
		label: "Attack",
		group: "envelope",
		min: 0.005,
		max: 2,
		step: 0.005,
		def: 0.1,
		unit: "s",
		help: "The bow's time to reach the note.",
	},
	{
		key: "decayS",
		label: "Decay",
		group: "envelope",
		min: 0.05,
		max: 5,
		step: 0.05,
		def: 1,
		unit: "s",
		help: "Time to fall 60 dB toward the sustain, after the attack.",
	},
	{
		key: "sustain",
		label: "Sustain",
		group: "envelope",
		min: 0,
		max: 1,
		step: 0.01,
		def: 1,
		unit: "",
		help: "The held level as a share of the peak. 1: a bow holds the note.",
	},
	{
		key: "releaseS",
		label: "Release",
		group: "envelope",
		min: 0.02,
		max: 4,
		step: 0.01,
		def: 0.35,
		unit: "s",
		help: "Time to fall 60 dB once the note ends.",
	},
	{
		key: "glideS",
		label: "Legato glide",
		group: "envelope",
		min: 0,
		max: 0.3,
		step: 0.005,
		def: 0,
		unit: "s",
		help: "Above 0 the part is legato: a following note glides on the same bow.",
	},
	// ── bow
	{
		key: "index",
		label: "Bow noise",
		group: "bow",
		min: 0,
		max: 1.5,
		step: 0.01,
		def: 0.35,
		unit: "",
		help: "How much bow scrape the attack carries.",
	},
	{
		key: "bowS",
		label: "Bow noise length",
		group: "bow",
		min: 0.005,
		max: 0.3,
		step: 0.005,
		def: 0.045,
		unit: "s",
		help: "How quickly the attack's scrape dies away.",
	},
	// ── vibrato
	{
		key: "vibrato",
		label: "Vibrato depth",
		group: "vibrato",
		min: 0,
		max: 0.6,
		step: 0.01,
		def: 0.15,
		unit: "st",
		help: "Peak pitch swing once the vibrato has arrived.",
	},
	{
		key: "vibratoHz",
		label: "Vibrato rate",
		group: "vibrato",
		min: 2,
		max: 9,
		step: 0.1,
		def: 5,
		unit: "Hz",
		help: "Swings per second.",
	},
	{
		key: "vibratoOnsetS",
		label: "Vibrato onset",
		group: "vibrato",
		min: 0,
		max: 1.5,
		step: 0.01,
		def: 0.3,
		unit: "s",
		help: "How long into a note before the vibrato starts.",
	},
	{
		key: "vibratoRiseS",
		label: "Vibrato fade-in",
		group: "vibrato",
		min: 0.01,
		max: 2,
		step: 0.01,
		def: 0.5,
		unit: "s",
		help: "Time for the vibrato to grow to its full depth.",
	},
	// ── filter
	{
		key: "cutoffHz",
		label: "Lowpass base",
		group: "filter",
		min: 100,
		max: 6000,
		step: 10,
		def: 1300,
		unit: "Hz",
		help: "The lowpass at no velocity, before key tracking.",
	},
	{
		key: "envAmount",
		label: "Velocity → brightness",
		group: "filter",
		min: 0,
		max: 3,
		step: 0.05,
		def: 1.6,
		unit: "oct",
		help: "How many octaves the lowpass opens at full velocity.",
	},
	{
		key: "swell",
		label: "Attack swell",
		group: "filter",
		min: 0,
		max: 1,
		step: 0.01,
		def: 0.4,
		unit: "",
		help: "How much darker the note starts, opening over the attack.",
	},
	{
		key: "resonance",
		label: "Resonance",
		group: "filter",
		min: 0,
		max: 0.9,
		step: 0.01,
		def: 0,
		unit: "",
		help: "A peak at the cutoff. A body's formant, or a whistle if too much.",
	},
	{
		key: "keyTrack",
		label: "Low key tracking",
		group: "filter",
		min: 0,
		max: 1.5,
		step: 0.01,
		def: 0,
		unit: "",
		help: "Opens the lowpass for notes below A4 by (440 / f) to this power, so a low note is not darkened.",
	},
	// ── grit
	{
		key: "drive",
		label: "Drive",
		group: "grit",
		min: 0,
		max: 1,
		step: 0.01,
		def: 0,
		unit: "",
		help: "Saturation after the lowpass, level kept: the clipped edges are the grit.",
	},
	{
		key: "rosin",
		label: "Rosin",
		group: "grit",
		min: 0,
		max: 1,
		step: 0.01,
		def: 0,
		unit: "",
		help: "A scratch under the whole note: noise tuned to the note's harmonics.",
	},
	{
		key: "rosinLow",
		label: "Rosin toward the low register",
		group: "grit",
		min: 0,
		max: 2,
		step: 0.05,
		def: 1,
		unit: "",
		help: "How much more rosin a low note gets: (440 / f) to this power, at most 4x.",
	},
	// ── space
	{
		key: "spread",
		label: "Stereo width",
		group: "space",
		min: 0,
		max: 1,
		step: 0.01,
		def: 0.8,
		unit: "",
		help: "How wide the players sit across the field.",
	},
	{
		key: "pan",
		label: "Pan",
		group: "space",
		min: -1,
		max: 1,
		step: 0.01,
		def: 0,
		unit: "",
		help: "Where the desk sits, left to right.",
	},
	{
		key: "reverb",
		label: "Reverb send",
		group: "space",
		min: 0,
		max: 1,
		step: 0.01,
		def: 0,
		unit: "",
		help: "How much of the desk goes into the song's hall.",
	},
	{
		key: "echo",
		label: "Echo send",
		group: "space",
		min: 0,
		max: 1,
		step: 0.01,
		def: 0,
		unit: "",
		help: "How much goes into the song's echo.",
	},
];

/** Every knob at its default, by key. */
export function stringsDefaults(): Partial<Record<StringsKey, number>> {
	return Object.fromEntries(STRINGS_PARAMS.map((p) => [p.key, p.def]));
}
