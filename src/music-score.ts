/**
 * The music vocabulary: a score, and the transport that plays it (#560, after
 * #543's D2, D3, D5 and D7).
 *
 * **A leaf that imports nothing**, as `audio-cue.ts` is, and
 * `tests/headless.test.ts` holds it. The main thread writes scores and sends
 * commands; the worklet reads both. Neither side reaches the other's module.
 *
 * A score is **source, not an asset** (#543 D2, on the map's Constraints): a
 * public-domain work written here as note data and played at runtime. A score
 * itself downloads and records nothing. A `sampler` part plays a sample set,
 * the one recorded material the music may use (map #1's Constraints,
 * 2026-10-06); every other part is synthesised.
 */

/** The synth's voices (#543 D1). `noise` and `tone` are the two percussion
 *  voices: a burst of filtered noise, and a sine that drops in pitch.
 *  `pulse`, `epiano`, `harpsi` and `softsaw` are the Danube versions':
 *  a chip's pulse wave, an electric piano, a harpsichord and a soft-edged
 *  saw lead. `moog` is saws and a sub square into a four-pole ladder
 *  filter that saturates. */
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
	| "brass"
	| "flute"
	| "pulse"
	| "epiano"
	| "harpsi"
	| "softsaw"
	| "moog"
	| "sampler";

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
 * - `resonance` — analog, acid, noise: the filter's peak at its cutoff, `0`..`1`.
 * - `drive` — acid: saturation, `0`..`1`. Strings: the same after the
 *   lowpass, its level kept — the grit (#547 D16).
 * - `glideS` — acid: a note that overlaps the next slides to it, on this
 *   time constant, without a new attack. Strings, brass: the same, and it is
 *   what makes a part **legato** — 0, the default, bows every note anew.
 * - `vibrato` — analog: depth in semitones, fading in over the first bars.
 *   Strings, brass: the same, arriving only once a note is under way.
 * - For **strings** (#547 D8), `index` is how much bow noise the attack
 *   carries and `envAmount` how many octaves the lowpass opens at full
 *   velocity. For **brass**, `index` is how far below the note, in
 *   semitones, the pitch starts before it rises into it, and `envAmount`
 *   how far the filter swells on the attack, scaled by velocity. For
 *   **flute** (#547 D10), `index` is how much breath the tone carries —
 *   more at the onset, a little under the held note — `cutoffHz` is where
 *   that breath's band sits, and `glideS` makes it legato as for strings.
 * - `sweepS`, `sweepOct` — analog, acid, noise: a slow sweep of the
 *   filter, one period in `sweepS` seconds, opening up to `sweepOct`
 *   octaves above where it would be and closing again. Its phase is the
 *   part's, on the synth's clock, so a run of short notes hears one
 *   continuous movement: the Berlin-school sequence, and the noise wash.
 *   For noise the band's centre moves.
 * - `cutoffHz` — pad: the lowpass. Pluck: the brightness of the pluck's first
 *   moment. Noise has none: its band is centred on the note's pitch.
 * - For **pulse**, `width` is the share of the cycle the wave is high,
 *   0.05..0.5 (0.5 is a square); `pwmHz` and `pwmDepth` sweep it, the
 *   depth in the same units and the width kept inside its range. `cutoffHz`
 *   above 0 puts a lowpass after it, and `drive` saturates it.
 * - For **epiano**, `index` is the body's brightness at full velocity,
 *   falling over `envDecayS`; `envAmount` is the tine's strike and
 *   `indexDecayS` how fast it dies; `ratio` is the tine's partial.
 * - For **harpsi**, `index` is where along the string it is plucked, as a
 *   share of its length — the harmonics at multiples of its inverse are
 *   missing; `cutoffHz` the pluck's brightness; `decayS` the string's
 *   own 60 dB fall at its fundamental. Velocity barely moves its level.
 * - For **softsaw**, `unison` saws (default 8), each with its edge rounded
 *   wider as the envelope falls, so a note mellows as it rings;
 *   `detune` and `spread` as for analog.
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
	readonly sweepS?: number;
	readonly sweepOct?: number;
	readonly cutoffHz?: number;
	readonly pan?: number;
	readonly reverb?: number;
	readonly echo?: number;
	/** Strings, brass, flute: the vibrato's rate, when it starts into a note,
	 *  and how long it takes to reach its depth (#547 D15). */
	readonly vibratoHz?: number;
	readonly vibratoOnsetS?: number;
	readonly vibratoRiseS?: number;
	/** Strings: how quickly the attack's bow noise dies, s. */
	readonly bowS?: number;
	/** Strings: how much darker a note starts, opening over its attack. */
	readonly swell?: number;
	/** Strings, the grit (#547 D16), with `drive` above: how far the lowpass
	 *  opens for a note below A4; a rosin scratch tuned to the note's
	 *  harmonics under the whole note; and how much more of it a low note
	 *  gets. All off by default. `strings-params.ts` has each range. */
	readonly keyTrack?: number;
	readonly rosin?: number;
	readonly rosinLow?: number;
	/** Pulse: the duty cycle, and its sweep's rate and depth. */
	readonly width?: number;
	readonly pwmHz?: number;
	readonly pwmDepth?: number;
	/**
	 * Sampler: the sample set it plays, by its folder under
	 * `public/music-samples/` (map #1's ruling on open-licensed music samples,
	 * 2026-10-06). `Music` fetches it when a song naming it is loaded; until
	 * it has arrived, or where it cannot be decoded, the part plays
	 * `fallback` — a synth voice, given every other field of the part — or
	 * nothing.
	 */
	readonly samples?: string;
	readonly fallback?: Exclude<VoiceKind, "sampler">;
}

/**
 * One sampled note of a set (O27, 2026-10-07): its root, and its recording
 * as 16-bit integers — `data` the left (or only) channel, `right` a stereo
 * set's right — each step worth `scale`, the recording's own peak over
 * 32767. A render through Int16 and through Float32 storage differs by
 * 89.8 dB below the signal (`voice-piano-grand-rich`; measured once on
 * 2026-10-07 by a comparison not kept in the repository), so the
 * worklet keeps half the memory. `data` is `null` until the recording has
 * arrived: a note that picks it plays the part's `fallback`.
 */
export interface SampleZone {
	readonly root: number;
	readonly scale: number;
	readonly data: Int16Array | null;
	readonly right?: Int16Array | null;
}

/** A velocity layer: the notes up to `maxVelocity` play its `zones`,
 *  which are its sampled roots, ascending. */
export interface SampleLayer {
	readonly maxVelocity: number;
	readonly zones: readonly SampleZone[];
}

/**
 * One sample set as the worklet holds it: every layer and every root of the
 * set — the skeleton — with the recordings the songs loaded so far need.
 * `layers` run soft to loud. `rate` is the recordings' (the context's,
 * where they were decoded) and `gain` the set's one linear gain.
 */
export interface SampleBank {
	readonly rate: number;
	readonly gain: number;
	readonly layers: readonly SampleLayer[];
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
 * - `samples` — moves nothing: a sample set for the `sampler` voice. The
 *   first for a set is its skeleton, every layer and root, `data` `null`
 *   where nothing is sent yet; each later one **merges**: the zones that
 *   carry `data` fill in the held set's, by layer index and root, and the
 *   rest are left as they are. `Music` sends the recordings a loaded song
 *   plays and no others (O27), so a later song adds only what it lacks.
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
	| { readonly type: "sync"; readonly token: number }
	| {
			readonly type: "samples";
			readonly set: string;
			readonly bank: SampleBank;
	  };

/** The processor's registered name: the worklet registers it and the
 *  controller constructs it, from this one copy. */
export const MUSIC_PROCESSOR = "seelite-music";

/** What the worklet sends back over its `port`: a command it refused and
 *  why, which the controller keeps and warns with; or a `sync`'s answer. */
export type MusicReport =
	| { readonly type: "error"; readonly message: string }
	| { readonly type: "synced"; readonly token: number };
