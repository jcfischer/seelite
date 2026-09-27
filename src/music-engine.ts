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
} from "./music-score";
import { compileSong, type NoteSink, Player } from "./music-sequencer";
import {
	type ResolvedPart,
	resolvePart,
	VoiceBank,
	type VoiceGain,
} from "./music-voices";

/**
 * The engine's whole output at full fade, before the music bus: room for a
 * chord of loud voices under full scale. A mix figure, set by ear with the
 * test score; #547 and #548 balance their parts under it.
 */
export const MUSIC_HEADROOM = 0.35;

/** A gain moving linearly from `from` to `to` over `[start, start + len)`
 *  frames. */
class Ramp {
	from = 1;
	to = 1;
	start = 0;
	len = 0;

	at(frame: number): number {
		if (frame < this.start) return this.from;
		if (frame >= this.start + this.len) return this.to;
		return (
			this.from + ((this.to - this.from) * (frame - this.start)) / this.len
		);
	}

	/** Head for `to` from `start`, from wherever this ramp is at `start`. */
	set(to: number, start: number, len: number) {
		this.from = this.at(start);
		this.to = to;
		this.start = start;
		this.len = Math.max(0, len);
	}

	/** Hold `value` from the beginning of time. */
	reset(value: number) {
		this.from = this.to = value;
		this.start = 0;
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
		const s = this.slots[this.lead];
		return s?.player.playing ? s.id : null;
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
				const ix = this.find(cmd.id);
				const line = this.line(now, cmd.at);
				const lead = this.slots[this.lead];
				if (lead?.player.playing) lead.player.stopAt(line);
				this.begin(ix, line, cmd.section);
				this.slots[ix]?.gain.reset(1);
				return;
			}
			case "crossfade": {
				const ix = this.find(cmd.to);
				const line = this.line(now, cmd.at);
				const len = fade(cmd.fadeS);
				const lead = this.slots[this.lead];
				if (lead?.player.playing && this.lead !== ix) {
					lead.gain.set(0, line, len);
					lead.haltAt = line + len;
				}
				this.begin(ix, line, cmd.section);
				const gain = (this.slots[ix] as Slot).gain;
				gain.reset(0);
				gain.set(1, line, len);
				return;
			}
			case "jump": {
				const lead = this.playingLead();
				if (lead) lead.player.jumpAt(this.line(now, cmd.at), cmd.section);
				return;
			}
			case "resolve": {
				const lead = this.playingLead();
				if (lead) lead.player.resolveAt(this.line(now, cmd.at));
				return;
			}
			case "stop": {
				if (cmd.at === "now") {
					const len = fade(cmd.fadeS);
					for (const s of this.slots)
						if (s && (s.player.playing || s.haltAt < Infinity)) {
							s.gain.set(0, now, len);
							s.haltAt = Math.min(s.haltAt, now + len);
						}
					return;
				}
				const line = this.line(now, cmd.at);
				for (const s of this.slots)
					if (s?.player.playing) s.player.stopAt(line);
				return;
			}
			case "stem": {
				const lead = this.playingLead();
				if (!lead) return;
				const part = lead.player.song.parts.indexOf(cmd.part);
				if (part < 0)
					throw new Error(`music: ${lead.id} has no part ${cmd.part}`);
				const at = cmd.at === "now" ? now : this.line(now, cmd.at);
				lead.partGain[part].set(cmd.level, at, fade(cmd.fadeS));
				return;
			}
			case "tempo": {
				const lead = this.playingLead();
				if (lead)
					lead.player.tempoAt(this.line(now, cmd.at), cmd.scale, cmd.rampBars);
				return;
			}
			// The worklet answers it; there is nothing to move.
			case "sync":
				return;
		}
	}

	/**
	 * Render the block that starts on `frame` into `out`, overwriting it.
	 * Notes first, so a note due inside the block joins it on its frame.
	 */
	render(out: Float32Array, frame: number) {
		const to = frame + out.length;
		this.rendered = to;
		for (let i = 0; i < this.slots.length; i++) {
			const s = this.slots[i];
			if (!s) continue;
			if (s.haltAt <= frame) this.halt(i);
			if (!s.player.playing) continue;
			this.rendering = i;
			s.player.render(frame, to, this);
		}
		out.fill(0);
		this.bank.render(out, frame, this);
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
			const s = this.slots[ix] as Slot;
			if (s.player.playing || s.haltAt < Infinity)
				throw new Error(`music: ${id} is sounding and cannot be replaced`);
			this.bank.clearOwner(ix);
		} else {
			// An empty slot first; then one whose song is silent.
			ix = this.slots.indexOf(null);
			if (ix < 0)
				ix = this.slots.findIndex(
					(s) => s !== null && !s.player.playing && s.haltAt === Infinity,
				);
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

	/** The quantum's line on the playing song, or `now` with none. */
	private line(now: number, q: Quantum): number {
		const lead = this.playingLead();
		return lead ? lead.player.lineAfter(now, q) : now;
	}

	private begin(ix: number, line: number, section?: string) {
		const s = this.slots[ix] as Slot;
		const at = section === undefined ? 0 : s.player.song.sectionIndex(section);
		if (at < 0) throw new Error(`music: ${s.id} has no section ${section}`);
		// A song faded out and restarted before its halt keeps its voices.
		s.haltAt = Infinity;
		for (const g of s.partGain) g.reset(1);
		s.player.start(line, at);
		this.lead = ix;
	}

	private halt(ix: number) {
		const s = this.slots[ix] as Slot;
		s.player.halt();
		s.haltAt = Infinity;
		this.bank.clearOwner(ix);
	}
}
