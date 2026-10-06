/**
 * The music engine the worklet runs (#560, after #543's D4, D5 and D7):
 * transport commands in, one block of samples out.
 *
 * It holds up to `MUSIC_SONG_SLOTS` compiled songs, a `Player` and a room
 * for each, one `VoiceBank` for all of them, and the fades. **A room is a
 * slot's, not the engine's** (#587): with one room for every song, a song
 * started inside a stop now's fade set it back to full, and the stopped
 * song's tail came back with it. Pure — no WebAudio and no
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
import { compileSong, type NoteSink, Player } from "./music-sequencer";
import { Space, type SpaceSpec } from "./music-space";
import {
	type ResolvedPart,
	type RoomSends,
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
	/** The room it starts in, with its echo in seconds at its first tempo. */
	readonly space: SpaceSpec;
	/** Its echo in beats: `render` retimes the room to the tempo (#587). */
	readonly echoBeats: number;
}

/** A slot's room: the reverb and echo its parts send into, the gain on what
 *  comes back (a stop now fades it with the song), and its sends. It
 *  outlives the song in the slot, so a tail rings out after a halt. */
interface Room {
	readonly space: Space;
	readonly gain: Ramp;
	readonly sends: RoomSends;
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
	/** Each slot's room, by slot: made when a song is first loaded there. */
	private readonly rooms: (Room | null)[] = new Array(MUSIC_SONG_SLOTS).fill(
		null,
	);
	/** The block's two channels, and a room's return. */
	private readonly bufL = new Float32Array(BLOCK);
	private readonly bufR = new Float32Array(BLOCK);
	private readonly wetL = new Float32Array(BLOCK);
	private readonly wetR = new Float32Array(BLOCK);
	/** Every slot's sends, whether or not it has a room yet: the bank writes
	 *  by owner, and an owner with no song has no voice. */
	private readonly sendBufs: readonly RoomSends[] = Array.from(
		{ length: MUSIC_SONG_SLOTS },
		() => ({
			revL: new Float32Array(BLOCK),
			revR: new Float32Array(BLOCK),
			echo: new Float32Array(BLOCK),
		}),
	);
	private readonly stereo: StereoOut = {
		right: this.bufR,
		sends: this.sendBufs,
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
				// Its room likewise, and only its room (#587).
				this.restoreRoom(h.ix, h.line, now, !h.back);
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
				if (h.back) {
					h.target.gain.set(1, now, len, now);
					this.roomOf(h.ix).gain.set(1, now, len, now);
				} else {
					h.target.gain.reset(0);
					h.target.gain.set(1, h.line, len, now);
					this.restoreRoom(h.ix, h.line, now, true);
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
					// Every room goes with it, a halted song's tail too: a stop now
					// is a pilot taking the stick back, and a hall ringing on after
					// it is not a stop.
					// Silent rooms too (sage round 1): a song stopped in a rest
					// plays on until its fade ends, and a note inside the fade
					// rang on in a room still at full.
					for (const room of this.rooms) room?.gain.set(0, now, len, now);
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
			// A sample set for the `sampler` voice: held from now on, for notes
			// that start after it.
			case "samples":
				this.bank.addSamples(cmd.set, cmd.bank);
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
			// The echo keeps the beat: the tempo moves on a bar line, and so
			// does the room (#587). Timed once, at the first tempo, a faster
			// section drifted against its own repeats.
			if (s.player.playing)
				this.roomOf(i).space.setEcho((s.echoBeats * 60) / s.player.bpm);
		}
		const whole = n === BLOCK;
		const L = whole ? this.bufL : this.bufL.subarray(0, n);
		const stereo: StereoOut = whole
			? this.stereo
			: {
					right: this.bufR.subarray(0, n),
					sends: this.sendBufs.map((b) => ({
						revL: b.revL.subarray(0, n),
						revR: b.revR.subarray(0, n),
						echo: b.echo.subarray(0, n),
					})),
				};
		const R = stereo.right;
		L.fill(0);
		R.fill(0);
		// Only a slot with a room has a song, and only a song has voices to
		// send (sage round 1: every slot was cleared every block).
		for (let i = 0; i < this.rooms.length; i++) {
			if (!this.rooms[i]) continue;
			const b = stereo.sends[i];
			b.revL.fill(0);
			b.revR.fill(0);
			b.echo.fill(0);
		}
		this.bank.render(L, frame, this, stereo);
		const wetL = whole ? this.wetL : this.wetL.subarray(0, n);
		const wetR = whole ? this.wetR : this.wetR.subarray(0, n);
		for (let i = 0; i < this.rooms.length; i++) {
			const room = this.rooms[i];
			if (!room) continue;
			const g = room.gain;
			// A stop now faded the room out and it stays out: what it still
			// holds is heard by nothing, so drop it. Kept, it came back at full
			// on the next song's line, before that song had played a note.
			if (g.to === 0 && frame >= g.start + g.len && !room.space.silent)
				room.space.clear();
			const b = stereo.sends[i];
			wetL.fill(0);
			wetR.fill(0);
			room.space.process(b.revL, b.revR, b.echo, wetL, wetR);
			if (room.space.silent) continue;
			for (let k = 0; k < n; k++) {
				const gk = g.at(frame + k);
				L[k] += wetL[k] * gk;
				R[k] += wetR[k] * gk;
			}
		}
		for (let k = 0; k < n; k++) {
			if (outR) {
				out[off + k] = L[k];
				outR[off + k] = R[k];
			} else out[off + k] = 0.5 * (L[k] + R[k]);
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
			// An empty slot first; then one whose song is silent: its room
			// silent too if one is; then a room ringing at full, whose tail
			// rings on into the new song's; last, a room a stop now is fading,
			// whose tail the start drops (`restoreRoom`, sage round 1).
			const free = (s: Slot | null, i: number) =>
				s !== null && !this.isSounding(i);
			ix = this.slots.indexOf(null);
			if (ix < 0)
				ix = this.slots.findIndex(
					(s, i) => free(s, i) && !!this.rooms[i]?.space.silent,
				);
			if (ix < 0)
				ix = this.slots.findIndex(
					(s, i) => free(s, i) && this.rooms[i]?.gain.to !== 0,
				);
			if (ix < 0) ix = this.slots.findIndex(free);
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
			echoBeats: song.space?.echoBeats ?? DEFAULT_SONG_SPACE.echoBeats,
		};
		this.rooms[ix] ??= {
			space: new Space(this.sampleRate, spaceOf(song)),
			gain: new Ramp(),
			sends: this.sendBufs[ix],
		};
	}

	/**
	 * Slot `ix`'s room at full from `line`, on its present path until then:
	 * the one rule for a play, a crossfade and a replay (sage round 2).
	 *
	 * A song starting `fresh` in a room a stop now has faded, or is fading,
	 * first drops what that room still holds (sage round 1). Brought back to
	 * full on the line, a stopped song's tail came back loud — the fault a
	 * room per slot was made to remove — and it is the stop's to finish, not
	 * the new song's to carry. A song coming back to its own room keeps it.
	 */
	private restoreRoom(ix: number, line: number, now: number, fresh: boolean) {
		const room = this.roomOf(ix);
		if (fresh && room.gain.to === 0) {
			room.space.clear();
			room.gain.reset(1);
		}
		room.gain.set(1, line, 0, now);
	}

	/** Slot `ix`'s room: every loaded slot has one. */
	private roomOf(ix: number): Room {
		return this.rooms[ix] as Room;
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
		this.restoreRoom(ix, line, now, false);
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
		// Its room takes its shape; its gain is the caller's, beside the
		// song's own.
		this.roomOf(ix).space.set(s.space);
	}

	private halt(ix: number) {
		const s = this.slots[ix] as Slot;
		s.player.halt();
		s.haltAt = Infinity;
		this.bank.clearOwner(ix);
	}
}

/** A song's room as it starts, its echo in seconds at its first tempo;
 *  `render` retimes the echo from there. A field given as
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
