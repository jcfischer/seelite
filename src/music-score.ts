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
export type VoiceKind =
	| "pad"
	| "pluck"
	| "fm"
	| "noise"
	| "tone"
	| "analog"
	| "drone"
	| "acid"
	| "keys"
	| "kick"
	| "strings"
	| "brass";

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
 * - `attackS`, `decayS`, `sustain`, `releaseS` — the envelope. `attackS` is a
 *   linear rise to the peak; `decayS` and `releaseS` are each the time to fall
 *   60 dB, toward `sustain` and toward silence. `sustain` is a share of the
 *   peak; at 0 a voice ends when its decay does.
 * - `ratio` — FM: the modulator's frequency as a multiple of the carrier's.
 *   Tone: the pitch it starts at, as a multiple of the note's, before it
 *   glides down to it. Analog: the cross-modulator's, as for FM. Keys: the
 *   spacing of the partials in multiples of the note — 1 is harmonic, a
 *   little above 1 stretches them toward glass and bells.
 * - `index` — FM: the modulation depth in radians at the peak. Analog: how
 *   far the cross-modulator bends the pitch (0 is none). Keys: brightness,
 *   how slowly the partials fall off with their number.
 * - `indexDecayS` — FM: the time for the index to fall 60 dB on its own
 *   clock, so a bell darkens while it rings. 0, the default, keeps the index
 *   on the amplitude envelope.
 * - `feedback` — FM only: the modulator fed back into itself, in radians.
 * - `unison` — analog, drone: oscillators per note, 1..8.
 * - `detune` — analog, drone: how far they spread in pitch, semitones.
 * - `drift` — analog, drone: how often, per second, each takes a new small
 *   random detune, glided into: the analog wander.
 * - `spread` — analog, drone: how wide across the field they sit, `0`..`1`.
 * - `envAmount`, `envDecayS` — analog, acid: the filter envelope, in octaves
 *   above `cutoffHz` at its peak, and its 60 dB fall.
 * - `resonance` — analog, acid: the filter's peak at its cutoff, `0`..`1`.
 * - `drive` — acid: saturation, `0`..`1`.
 * - `glideS` — acid: a note that overlaps the next slides to it, on this
 *   time constant, without a new attack. Strings, brass: the same, and it is
 *   what makes a part **legato** — 0, the default, bows every note anew.
 * - `vibrato` — analog: depth in semitones, fading in over the first bars.
 *   Strings, brass: the same, arriving only once a note is under way.
 * - For **strings** (#547 D8), `index` is how much bow noise the attack
 *   carries and `envAmount` how many octaves the lowpass opens at full
 *   velocity. For **brass**, `index` is how far below the note, in
 *   semitones, the pitch starts before it rises into it, and `envAmount`
 *   how far the filter swells on the attack, scaled by velocity.
 * - `cutoffHz` — pad: the lowpass. Pluck: the brightness of the pluck's first
 *   moment. Noise has none: its band is centred on the note's pitch.
 * - `pan` — `-1` left .. `1` right; 0, the centre, is the default.
 * - `reverb`, `echo` — the part's sends into the song's space
 *   (`music-space.ts`), `0`..`1`. **Both default to 0**: a part is dry
 *   unless its score puts it in the room, so every score states its own mix.
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
	readonly indexDecayS?: number;
	readonly unison?: number;
	readonly detune?: number;
	readonly drift?: number;
	readonly spread?: number;
	readonly envAmount?: number;
	readonly envDecayS?: number;
	readonly resonance?: number;
	readonly drive?: number;
	readonly glideS?: number;
	readonly vibrato?: number;
	readonly cutoffHz?: number;
	readonly pan?: number;
	readonly reverb?: number;
	readonly echo?: number;
}

/**
 * The room a song plays in (`music-space.ts`): the reverb's time to fall
 * 60 dB, the echo's spacing in beats at the tempo the song is playing (#587:
 * retimed on every bar line), and each
 * echo's level against the last. Every field has a default
 * (`DEFAULT_SONG_SPACE` in `music-engine.ts`).
 */
export interface SongSpace {
	readonly reverbS?: number;
	readonly echoBeats?: number;
	readonly echoFeedback?: number;
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
	readonly space?: SongSpace;
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
 * - `load` — compile a song into a slot, by id. Refused while that id is
 *   sounding, or when the score is malformed: the worklet reports the reason
 *   back (`MusicReport`) and the controller keeps it in `errors`.
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
 * - `hold` on `play`, `crossfade` and `jump` (#548) — the section it
 *   lands on then loops in place of the song's own loop, until another held
 *   move: an adaptive score stays on the section its level names.
 * - `stem` — a part of the playing song fades to `level` over `fadeS`. Two
 *   stems moved at once are a crossfade between parts.
 * - `tempo` — the playing song's tempo map is scaled by `scale`, from the
 *   quantum, reached over `rampBars` bars (0: at the line).
 * - `sync` — moves nothing; the worklet answers `synced` with the token once
 *   every command before it has been applied. An offline render needs it: a
 *   message sent while the render is suspended is applied only when the
 *   worklet next runs its message loop, which is the *next* suspend unless
 *   the sender waits for the answer before it resumes.
 */
export type MusicCommand =
	| { readonly type: "load"; readonly id: string; readonly song: Song }
	| {
			readonly type: "play";
			readonly id: string;
			readonly section?: string;
			readonly at: Quantum;
			readonly hold?: boolean;
	  }
	| {
			readonly type: "crossfade";
			readonly to: string;
			readonly section?: string;
			readonly at: Quantum;
			readonly fadeS: number;
			readonly hold?: boolean;
	  }
	| {
			readonly type: "jump";
			readonly section: string;
			readonly at: Quantum;
			readonly hold?: boolean;
	  }
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
	  }
	| { readonly type: "sync"; readonly token: number };

/** The processor's registered name: the worklet registers it and the
 *  controller constructs it, from this one copy. */
export const MUSIC_PROCESSOR = "seelite-music";

/** What the worklet sends back over its `port`: a command it refused and
 *  why, which the controller keeps and warns with; or a `sync`'s answer. */
export type MusicReport =
	| { readonly type: "error"; readonly message: string }
	| { readonly type: "synced"; readonly token: number };
