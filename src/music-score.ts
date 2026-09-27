/**
 * The music vocabulary: a score, and the transport that plays it (#560, after
 * #543's D2, D3, D5 and D7).
 *
 * **A leaf that imports nothing**, as `audio-cue.ts` is, and
 * `tests/headless.test.ts` holds it. The main thread writes scores and sends
 * commands; the worklet reads both. Neither side reaches the other's module.
 *
 * A score is **source, not an asset** (#543 D2, on the map's Constraints): a
 * public-domain work written here as note data is synthesised at runtime, and
 * nothing is downloaded or recorded.
 */

/** The synth's voices (#543 D1). `noise` and `tone` are the two percussion
 *  voices: a burst of filtered noise, and a sine that drops in pitch. */
export type VoiceKind = "pad" | "pluck" | "fm" | "noise" | "tone";

/**
 * One note (#543 D3).
 *
 * - `part` — a key of the song's `parts`.
 * - `bar` — 0-based, within its section.
 * - `beat` — 0-based and fractional, within the bar: `1.5` is the "and" of
 *   the second beat. Less than the song's `beatsPerBar`.
 * - `dur` — beats, at the tempo the note starts in. A note that crosses a
 *   tempo change keeps the length it started with.
 * - `pitch` — a MIDI note number; fractional is a detune. For `noise` it is
 *   the centre of the band.
 * - `vel` — `0`..`1`.
 */
export interface NoteEvent {
	readonly part: string;
	readonly bar: number;
	readonly beat: number;
	readonly dur: number;
	readonly pitch: number;
	readonly vel: number;
}

/** A named run of bars: intro, A, B, coda. */
export interface Section {
	readonly name: string;
	readonly bars: number;
	readonly events: readonly NoteEvent[];
}

/**
 * A point on the tempo map.
 *
 * `bar` counts **score bars**: every section's bars in the order the song
 * lists them, once, from 0. A loop replays the same score bars, so it replays
 * their tempo too. A point takes effect at its bar line; with `ramp: true` it
 * is reached instead, linearly in beats from the point before it.
 */
export interface TempoPoint {
	readonly bar: number;
	readonly bpm: number;
	readonly ramp?: boolean;
}

/**
 * How one part sounds. Every field after `level` has a default per voice
 * (`music-voices.ts`); a part names only what it changes.
 *
 * - `level` — the part's gain, `0`..`1`, before any stem fade.
 * - `attackS`, `decayS`, `sustain`, `releaseS` — the envelope. `decayS` is a
 *   time constant; `sustain` is a share of the peak.
 * - `ratio`, `index` — FM only: the modulator's frequency as a multiple of
 *   the carrier's, and the modulation depth in radians at the peak.
 * - `feedback` — FM only: the modulator fed back into itself, in radians.
 * - `cutoffHz` — pad and noise: the filter. Pluck: the brightness of the
 *   pluck's first moment.
 */
export interface PartSpec {
	readonly voice: VoiceKind;
	readonly level: number;
	readonly attackS?: number;
	readonly decayS?: number;
	readonly sustain?: number;
	readonly releaseS?: number;
	readonly ratio?: number;
	readonly index?: number;
	readonly feedback?: number;
	readonly cutoffHz?: number;
}

/**
 * A song: an ordered list of sections, with a loop and a resolve point
 * (#543 D3).
 *
 * Play runs the sections in order. After the last bar of `loop.to` it goes
 * back to `loop.from` — until a `resolve` command sends it to `resolve`, from
 * where it plays on to the last section and ends. Without a `loop` a song
 * ends after its last section.
 *
 * `lilt` is the per-beat timing offset (D5), in beats, one entry per beat of
 * the bar: `[0, -0.08, 0.04]` pulls a waltz's second beat early and its third
 * late. The first entry must be 0, so a bar line stays where the tempo map
 * puts it. A note between two beats is moved by the offsets on either side,
 * in proportion.
 */
export interface Song {
	readonly name: string;
	readonly beatsPerBar: number;
	readonly parts: Readonly<Record<string, PartSpec>>;
	readonly sections: readonly Section[];
	readonly tempo: readonly TempoPoint[];
	readonly loop?: { readonly from: string; readonly to: string };
	readonly resolve?: string;
	readonly lilt?: readonly number[];
}

/**
 * The most music voices that sound at once (#543 D7): the synth's own budget,
 * outside the cue pool (`VOICE_CAPS` in `audio-cue.ts`). A cue never takes a
 * music voice and a music voice never takes a cue's. Over the cap, the oldest
 * music voice gives its place to the new note.
 *
 * **A placeholder**: the figure is set by ear in #547 and #548.
 */
export const MUSIC_VOICE_CAP = 24;

/** The most songs loaded at once. A crossfade needs two. */
export const MUSIC_SONG_SLOTS = 4;

/**
 * Where a transport move lands (D5): the next bar line of the song that is
 * playing, or the end of its current section. With nothing playing, both
 * mean now.
 */
export type Quantum = "bar" | "section";

/**
 * What the main thread sends the worklet over its `port` (D5). The music bus
 * row is the only level the player sets (#542 D1); every gain here is the
 * synth's own, for fades and stems.
 *
 * - `load` — compile a song into a slot, by id. Refused (ignored) while that
 *   id is sounding.
 * - `play` — start `id` at `section` (default its first) on the quantum. A
 *   song already playing stops on the same line: a cut, not a fade.
 * - `crossfade` — start `to` on the quantum, and over `fadeS` seconds fade it
 *   in while the playing song fades out and then stops.
 * - `jump` — the playing song moves to `section` on the quantum.
 * - `resolve` — the playing song moves to its `resolve` section on the
 *   quantum, and its loop no longer holds.
 * - `stop` — on a quantum: no note starts after the line, and the notes
 *   sounding ring out. `"now"`: everything fades out over `fadeS`, for a
 *   pilot who takes the stick back mid-waltz.
 * - `stem` — a part of the playing song fades to `level` over `fadeS`. Two
 *   stems moved at once are a crossfade between parts.
 * - `tempo` — the playing song's tempo map is scaled by `scale`, from the
 *   quantum, reached over `rampBars` bars (0: at the line).
 */
export type MusicCommand =
	| { readonly type: "load"; readonly id: string; readonly song: Song }
	| {
			readonly type: "play";
			readonly id: string;
			readonly section?: string;
			readonly at: Quantum;
	  }
	| {
			readonly type: "crossfade";
			readonly to: string;
			readonly section?: string;
			readonly at: Quantum;
			readonly fadeS: number;
	  }
	| { readonly type: "jump"; readonly section: string; readonly at: Quantum }
	| { readonly type: "resolve"; readonly at: Quantum }
	| {
			readonly type: "stop";
			readonly at: Quantum | "now";
			readonly fadeS: number;
	  }
	| {
			readonly type: "stem";
			readonly part: string;
			readonly level: number;
			readonly at: Quantum | "now";
			readonly fadeS: number;
	  }
	| {
			readonly type: "tempo";
			readonly scale: number;
			readonly at: Quantum;
			readonly rampBars: number;
	  };

/** The processor's registered name: the worklet registers it and the
 *  controller constructs it, from this one copy. */
export const MUSIC_PROCESSOR = "seelite-music";

/** What the worklet sends back over its `port`: a command it refused, and
 *  why. The controller keeps the reason and warns with it. */
export interface MusicReport {
	readonly type: "error";
	readonly message: string;
}
