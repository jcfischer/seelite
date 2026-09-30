/**
 * The music engine the worklet runs (#560, after #543's D4, D5 and D7):
 * transport commands in, one block of samples out.
 *
 * It holds up to `MUSIC_SONG_SLOTS` compiled songs, a `Player` for each, one
 * `VoiceBank` for all of them, and the fades. Pure — no WebAudio and no
 * globals — so `tests/music-engine.test.ts` holds the whole transport
 * headless; `music-worklet.ts` moves messages and buffers and nothing else.
 *
 * **Every gain here is the synth's own**, for its fades and stems (#543 D5).
 * The music bus row stays the only level the player sets (#542 D1): the
 * worklet's output goes into `AudioFX.musicInput` and nowhere else.
 *
 * **`command` may allocate and `render` may not** (#543 D1). A command runs
 * when a `port` message arrives, between two calls to `process()`; `render`
 * is `process()`.
 */
import {
	MUSIC_SONG_SLOTS,
	MUSIC_VOICE_CAP,
	type MusicCommand,
	type Quantum,
	type Song,
	type SongSpace,
} from "./music-score";
import { Space, type SpaceSpec } from "./music-space";
import { compileSong, type NoteSink, Player } from "./music-sequencer";
import {
	type ResolvedPart,
	resolvePart,
	type StereoOut,
	VoiceBank,
	type VoiceGain,
} from "./music-voices";

/**
 * The engine's whole output at full fade, before the music bus: room for a
 * chord of loud voices under full scale. A mix figure, set by ear with the
 * test score; #547 and #548 balance their parts under it.
 */
export const MUSIC_HEADROOM = 0.35;

/** The room a song plays in when its score names none (`Song.space`). By
 *  ear, toward the references the principal named on #548: a long hall. */
export const DEFAULT_SONG_SPACE: Required<SongSpace> = {
	reverbS: 4.5,
	echoBeats: 0.75,
	echoFeedback: 0.4,
};

/** The block the engine renders in. The worklet's quantum is 128; a longer
 *  `render` is cut into these. */
const BLOCK = 128;

/**
 * A gain in two straight segments: from `lead` to `start` it runs from
 * `leadFrom` to `from`, and from `start` over `len` frames from `from` to
 * `to`; outside them it holds.
 *
 * **Two, because a fade is placed on a line ahead of now** (sage rounds 4
 * and 5). With one segment, a fade set on a future line replaced the path
 * *before* that line as well, holding the value the old fade would reach at
 * the line: a song fading out jumped at once to that value, which is 0 when
 * the fade ends first. The first segment now carries the old path from now to
 * the line — exact while the old fade is straight across that span, and never
 * a step, because both ends are read off it.
 */
class Ramp {
	lead = 0;
	leadFrom = 1;
	from = 1;
	to = 1;
	start = 0;
	len = 0;

	at(frame: number): number {
		if (frame < this.lead) return this.leadFrom;
		if (frame < this.start)
			return (
				this.leadFrom +
				((this.from - this.leadFrom) * (frame - this.lead)) /
					(this.start - this.lead)
			);
		if (frame >= this.start + this.len) return this.to;
		return (
			this.from + ((this.to - this.from) * (frame - this.start)) / this.len
		);
	}

	/** Head for `to` from `start` over `len`, from wherever this ramp is at
	 *  `start` — following its present path from `now` until then. */
	set(to: number, start: number, len: number, now: number) {
		const lead = Math.min(now, start);
		this.leadFrom = this.at(lead);
		this.from = this.at(start);
		this.lead = lead;
		this.to = to;
		this.start = start;
		this.len = Math.max(0, len);
	}

	/** Hold `value` from the beginning of time. */
	reset(value: number) {
		this.leadFrom = this.from = this.to = value;
		this.lead = this.start = 0;
		this.len = 0;
	}
}

interface Slot {
	readonly id: string;
	readonly player: Player;
	readonly parts: readonly ResolvedPart[];
	readonly partGain: readonly Ramp[];
	readonly gain: Ramp;
	/** When a fade out has run out: the song is halted and its voices freed. */
	haltAt: number;
	/** The room it plays in, with its echo in seconds at its first tempo. */
	readonly space: SpaceSpec;
}

export class MusicEngine implements NoteSink, VoiceGain {
	private readonly bank: VoiceBank;
	private readonly slots: (Slot | null)[] = new Array(MUSIC_SONG_SLOTS).fill(
		null,
	);
	/** The slot the transport moves: the song started last. -1 for none. */
	private lead = -1;
	/** The slot whose notes `note` is receiving, during `render`. */
	private rendering = 0;
	/** Where the last `render` ended: no move lands before it. */
	private rendered = 0;
	/** The reverb and echo every part sends into, and the gain on what comes
	 *  back: a stop now fades it with the song. */
	private readonly space: Space;
	private readonly spaceGain = new Ramp();
	/** The block's two channels, its three sends and the space's return. */
	private readonly bufL = new Float32Array(BLOCK);
	private readonly bufR = new Float32Array(BLOCK);
	private readonly wetL = new Float32Array(BLOCK);
	private readonly wetR = new Float32Array(BLOCK);
	private readonly sends: StereoOut = {
		right: this.bufR,
		revL: new Float32Array(BLOCK),
		revR: new Float32Array(BLOCK),
		echo: new Float32Array(BLOCK),
	};

	/**
	 * `onNote` hears every note as it is scheduled, by song id, frame and part
	 * name: for tests and instruments. The worklet passes none.
	 */
	constructor(
		private readonly sampleRate: number,
		readonly cap = MUSIC_VOICE_CAP,
		private readonly onNote?: (id: string, frame: number, part: string) => void,
	) {
		this.bank = new VoiceBank(cap, sampleRate);
		this.space = new Space(sampleRate, {
			reverbS: DEFAULT_SONG_SPACE.reverbS,
			echoS: 0.5,
			echoFeedback: DEFAULT_SONG_SPACE.echoFeedback,
		});
	}

	/** The song the transport is moving, while it plays. */
	get playing(): string | null {
		return this.playingLead()?.id ?? null;
	}

	/** Voices holding a slot. */
	get sounding(): number {
		return this.bank.sounding;
	}

	/**
	 * Apply a transport command that arrived when the next block begins at
	 * `now`. Throws on a command it cannot honour, naming why; the worklet
	 * reports that to the main thread.
	 */
	command(cmd: MusicCommand, now: number) {
		// A port message runs between two quanta, and `currentFrame` there need
		// not be the next quantum's start. A move placed behind what is
		// already rendered would lose its first note, so it lands at the end.
		now = Math.max(now, this.rendered);
		const fade = (s: number) => Math.max(0, Math.round(s * this.sampleRate));
		switch (cmd.type) {
			case "load":
				return this.load(cmd.id, cmd.song);
			case "play": {
				const hold = cmd.hold ?? false;
				const h = this.handover(cmd.id, cmd.at, cmd.section, now, hold);
				if (!h) return;
				h.lead?.player.stopAt(h.line);
				this.begin(h.ix, h.line, cmd.section, hold);
				// A song still fading out keeps fading until the line, then is
				// full: the cut is on the line, not before it (sage rounds 4, 5).
				if (h.back) h.target.gain.set(1, h.line, 0, now);
				else h.target.gain.reset(1);
				return;
			}
			case "crossfade": {
				const hold = cmd.hold ?? false;
				const h = this.handover(cmd.to, cmd.at, cmd.section, now, hold);
				if (!h) return;
				const len = fade(cmd.fadeS);
				if (h.lead) {
					h.lead.gain.set(0, h.line, len, now);
					h.lead.haltAt = h.line + len;
				}
				this.begin(h.ix, h.line, cmd.section, hold);
				// Back to a song still fading out (sage round 4): it fades up from
				// where it is now. Reset to 0, it was cut before the line.
				if (h.back) h.target.gain.set(1, now, len, now);
				else {
					h.target.gain.reset(0);
					h.target.gain.set(1, h.line, len, now);
				}
				return;
			}
			case "jump": {
				const lead = this.requireLead(cmd.type);
				lead.player.jumpAt(
					this.line(now, cmd.at),
					cmd.section,
					cmd.hold ?? false,
				);
				return;
			}
			case "resolve": {
				const lead = this.requireLead(cmd.type);
				lead.player.resolveAt(this.line(now, cmd.at));
				return;
			}
			case "stop": {
				if (cmd.at === "now") {
					const len = fade(cmd.fadeS);
					for (let i = 0; i < this.slots.length; i++) {
						const s = this.slots[i];
						if (s && this.isSounding(i)) {
							s.gain.set(0, now, len, now);
							s.haltAt = Math.min(s.haltAt, now + len);
						}
					}
					// The room goes with it: a stop now is a pilot taking the
					// stick back, and a hall ringing on after it is not a stop.
					this.spaceGain.set(0, now, len, now);
					return;
				}
				const line = this.line(now, cmd.at);
				for (const s of this.slots)
					if (s?.player.playing) s.player.stopAt(line);
				return;
			}
			case "stem": {
				const lead = this.requireLead(cmd.type);
				const part = lead.player.song.parts.indexOf(cmd.part);
				if (part < 0)
					throw new Error(`music: ${lead.id} has no part ${cmd.part}`);
				const at = cmd.at === "now" ? now : this.line(now, cmd.at);
				lead.partGain[part].set(cmd.level, at, fade(cmd.fadeS), now);
				return;
			}
			case "tempo": {
				const lead = this.requireLead(cmd.type);
				lead.player.tempoAt(this.line(now, cmd.at), cmd.scale, cmd.rampBars);
				return;
			}
			// The worklet answers it; there is nothing to move.
			case "sync":
				return;
		}
	}

	/**
	 * Render the block that starts on `frame` into `out`, overwriting it:
	 * the left channel, with `outR` the right. Without `outR`, `out` gets
	 * the fold-down, (L + R) / 2 — what a mono destination hears.
	 */
	render(out: Float32Array, frame: number, outR?: Float32Array) {
		for (let k = 0; k < out.length; k += BLOCK)
			this.renderBlock(
				out,
				outR,
				k,
				Math.min(BLOCK, out.length - k),
				frame + k,
			);
	}

	/** One block of at most `BLOCK` frames, written to `out` (and `outR`)
	 *  from `off`. Notes first, so a note due inside the block joins it on its
	 *  frame; then the voices, dry and sent; then the room.
	 *
	 *  **A whole block takes no view** (sage round 8): it renders into the
	 *  engine's own buffers as they are, and writes `out` by index. Only a
	 *  short last block — a `render` whose length is not a multiple of
	 *  `BLOCK`, which the worklet's quantum never is — cuts views of them. */
	private renderBlock(
		out: Float32Array,
		outR: Float32Array | undefined,
		off: number,
		n: number,
		frame: number,
	) {
		const to = frame + n;
		this.rendered = to;
		for (let i = 0; i < this.slots.length; i++) {
			const s = this.slots[i];
			if (!s) continue;
			if (s.haltAt <= frame) this.halt(i);
			if (!s.player.playing) continue;
			this.rendering = i;
			s.player.render(frame, to, this);
		}
		const whole = n === BLOCK;
		const L = whole ? this.bufL : this.bufL.subarray(0, n);
		const sends: StereoOut = whole
			? this.sends
			: {
					right: this.bufR.subarray(0, n),
					revL: this.sends.revL.subarray(0, n),
					revR: this.sends.revR.subarray(0, n),
					echo: this.sends.echo.subarray(0, n),
				};
		const R = sends.right;
		L.fill(0);
		R.fill(0);
		sends.revL.fill(0);
		sends.revR.fill(0);
		sends.echo.fill(0);
		this.bank.render(L, frame, this, sends);
		const wetL = whole ? this.wetL : this.wetL.subarray(0, n);
		const wetR = whole ? this.wetR : this.wetR.subarray(0, n);
		wetL.fill(0);
		wetR.fill(0);
		// A stop now faded the room out and it stays out: what it still holds
		// is heard by nothing, so drop it. Kept, it came back at full on the
		// next song's line, before that song had played a note.
		const room = this.spaceGain;
		if (room.to === 0 && frame >= room.start + room.len && !this.space.silent)
			this.space.clear();
		this.space.process(sends.revL, sends.revR, sends.echo, wetL, wetR);
		for (let k = 0; k < n; k++) {
			const g = this.spaceGain.at(frame + k);
			const l = L[k] + wetL[k] * g;
			const r = R[k] + wetR[k] * g;
			if (outR) {
				out[off + k] = l;
				outR[off + k] = r;
			} else out[off + k] = 0.5 * (l + r);
		}
	}

	/** `NoteSink`: a note from the slot being rendered. */
	note(frame: number, part: number, pitch: number, vel: number, dur: number) {
		const s = this.slots[this.rendering] as Slot;
		this.bank.noteOn(
			frame,
			s.parts[part],
			this.rendering,
			part,
			pitch,
			vel,
			dur,
		);
		this.onNote?.(s.id, frame, s.player.song.parts[part]);
	}

	/** `VoiceGain`: the song's fade, the part's stem and the headroom. */
	gain(owner: number, part: number, frame: number): number {
		const s = this.slots[owner];
		if (!s) return 0;
		return MUSIC_HEADROOM * s.gain.at(frame) * s.partGain[part].at(frame);
	}

	private load(id: string, song: Song) {
		const compiled = compileSong(song);
		let ix = this.slots.findIndex((s) => s?.id === id);
		if (ix >= 0) {
			if (this.isSounding(ix))
				throw new Error(`music: ${id} is sounding and cannot be replaced`);
			this.bank.clearOwner(ix);
		} else {
			// An empty slot first; then one whose song is silent.
			ix = this.slots.indexOf(null);
			if (ix < 0)
				ix = this.slots.findIndex((s, i) => s !== null && !this.isSounding(i));
			if (ix < 0)
				throw new Error(
					`music: all ${this.slots.length} song slots are sounding`,
				);
			if (this.slots[ix]) this.bank.clearOwner(ix);
		}
		this.slots[ix] = {
			id,
			player: new Player(compiled, this.sampleRate),
			parts: compiled.partSpecs.map((p) => resolvePart(p, this.sampleRate)),
			partGain: compiled.parts.map(() => new Ramp()),
			gain: new Ramp(),
			haltAt: Infinity,
			space: spaceOf(song),
		};
	}

	private find(id: string): number {
		const ix = this.slots.findIndex((s) => s?.id === id);
		if (ix < 0) throw new Error(`music: no song loaded as ${id}`);
		return ix;
	}

	private playingLead(): Slot | null {
		const s = this.slots[this.lead];
		return s?.player.playing ? s : null;
	}

	/**
	 * The playing song, for a move that has nothing to act on without one.
	 * Refused by name rather than dropped (sage round 3), for the reason an
	 * unknown section is: a move lost in silence leaves a score's author no
	 * signal.
	 */
	private requireLead(move: string): Slot {
		const lead = this.playingLead();
		if (!lead) throw new Error(`music: nothing is playing to ${move}`);
		return lead;
	}

	/**
	 * The quantum's line on the playing song, or `now` with none. A song
	 * fading out on a stop now is not one (sage round 6): it is leaving, and
	 * a start that waited for its line would wait on music that has stopped.
	 */
	private line(now: number, q: Quantum): number {
		const lead = this.steadyLead();
		return lead ? lead.player.lineAfter(now, q) : now;
	}

	/**
	 * A song sounds while it plays, while a fade out has yet to run out, and
	 * while any of its voices still rings — after a stop on the bar, its last
	 * notes (sage round 6: a load freed them under the tail with a step). The
	 * one test, for stop, load and the slot search.
	 */
	private isSounding(ix: number): boolean {
		const s = this.slots[ix];
		if (!s) return false;
		return s.player.playing || s.haltAt < Infinity || this.bank.holds(ix);
	}

	/**
	 * What a start and a crossfade share, with **every check made before any
	 * song is touched** (sage round 6: the playing song was told to stop, then
	 * the new one's section was refused, and the music stopped for nothing).
	 * Null when the move names the song already playing, which `again` has
	 * made a jump.
	 */
	private handover(
		id: string,
		at: Quantum,
		section: string | undefined,
		now: number,
		hold: boolean,
	): {
		ix: number;
		line: number;
		target: Slot;
		back: boolean;
		lead: Slot | null;
	} | null {
		const ix = this.find(id);
		const target = this.slots[ix] as Slot;
		if (section !== undefined && target.player.song.sectionIndex(section) < 0)
			throw new Error(`music: ${target.id} has no section ${section}`);
		const line = this.line(now, at);
		if (this.again(ix, line, now, section, hold)) return null;
		// A song already leaving on a stop's fade keeps that fade: handing it
		// over again would restart it and push its end out.
		return {
			ix,
			line,
			target,
			back: this.isSounding(ix),
			lead: this.steadyLead(),
		};
	}

	/** The playing song unless it is leaving on a stop's fade: the one rule
	 *  for the quantum and for a handover (sage round 7). */
	private steadyLead(): Slot | null {
		const lead = this.playingLead();
		return lead && lead.haltAt === Infinity ? lead : null;
	}

	/**
	 * A start or crossfade naming the song already playing (sage round 1):
	 * restarted in place, its bar line moved into the future and the rest of
	 * the bar went unheard; faded against itself, it faded to nothing. It is a
	 * jump instead — to `section`, or back to the top — on the same line.
	 * Returns whether it handled the move.
	 */
	private again(
		ix: number,
		line: number,
		now: number,
		section: string | undefined,
		hold: boolean,
	): boolean {
		const lead = this.playingLead();
		if (!lead || this.lead !== ix) return false;
		lead.player.jumpAt(line, section ?? 0, hold);
		// Full on the line, where the playhead moves, and on its present path
		// until then (sage round 7: set at once, it stepped mid-fade). Inside a
		// stop fade, the fade's halt goes too (round 3): left standing, it cut
		// the replayed song when the old fade would have ended.
		lead.gain.set(1, line, 0, now);
		// And its room, which the stop faded with it (sage round 9): left out,
		// the song came back dry, and once the fade had run the room was
		// cleared for good.
		this.spaceGain.set(1, line, 0, now);
		lead.haltAt = Infinity;
		return true;
	}

	private begin(
		ix: number,
		line: number,
		section: string | undefined,
		hold: boolean,
	) {
		const s = this.slots[ix] as Slot;
		// `handover` has refused a section the song does not have.
		const at = section === undefined ? 0 : s.player.song.sectionIndex(section);
		// A song faded out and restarted before its halt keeps its voices.
		s.haltAt = Infinity;
		for (const g of s.partGain) g.reset(1);
		s.player.start(line, at, hold);
		this.lead = ix;
		// The room is the lead's, and back at full from its line.
		this.space.set(s.space);
		this.spaceGain.set(1, line, 0, this.rendered);
	}

	private halt(ix: number) {
		const s = this.slots[ix] as Slot;
		s.player.halt();
		s.haltAt = Infinity;
		this.bank.clearOwner(ix);
	}
}

/** A song's room, its echo in seconds at its first tempo. A field given as
 *  `undefined` takes its default (sage round 9): spread over the defaults,
 *  it replaced one, and a NaN decay fed back through every line. */
function spaceOf(song: Song): SpaceSpec {
	const sp = song.space;
	const d = DEFAULT_SONG_SPACE;
	return {
		reverbS: sp?.reverbS ?? d.reverbS,
		echoS: ((sp?.echoBeats ?? d.echoBeats) * 60) / song.tempo[0].bpm,
		echoFeedback: sp?.echoFeedback ?? d.echoFeedback,
	};
}
