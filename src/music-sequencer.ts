/**
 * The scheduling core (#560, after #543's D4): a compiled score, its tempo
 * map and a window of frames in, notes out.
 *
 * The worklet counts frames and calls `Player.render` once per render
 * quantum, so a note starts on its exact frame and no main-thread timer
 * exists (D4). This module is pure — no WebAudio, no globals, `sampleRate`
 * passed in — so `tests/music-sequencer.test.ts` holds it headless, and the
 * build bundles the same code into the worklet.
 *
 * **Nothing allocates in `render`** (#543 D1). A score is compiled once, when
 * it is loaded; `render` walks cursors over the compiled arrays and hands each
 * note to a sink. Only the transport moves (`jumpAt` and the rest), which run
 * when a `port` message arrives and not inside `process()`, create anything.
 *
 * **Frames are float64 and never rounded where they accumulate.** A bar line
 * is the last bar line plus the bar's exact length; only the frame a note is
 * heard on is rounded. So a long song does not drift from its tempo map, and
 * a note is emitted in the window its rounded frame falls in — once, however
 * the windows are cut.
 */
import type { NoteEvent, PartSpec, Quantum, Song } from "./music-score";

/** A note as the player reads it: its part by index, its onset in beats
 *  from the bar line with the lilt already applied. */
export interface CompiledNote {
	readonly part: number;
	readonly at: number;
	readonly dur: number;
	readonly pitch: number;
	readonly vel: number;
}

export interface CompiledSection {
	readonly name: string;
	readonly bars: number;
	/** The section's notes, one list per bar, sorted by `at`. */
	readonly byBar: readonly (readonly CompiledNote[])[];
	/** Its first bar's index on the tempo map. */
	readonly scoreBar: number;
}

export interface CompiledSong {
	readonly name: string;
	readonly beatsPerBar: number;
	/** Part names, in the index order notes carry. */
	readonly parts: readonly string[];
	readonly partSpecs: readonly PartSpec[];
	readonly sections: readonly CompiledSection[];
	/** Section indices; -1 where the song has none. */
	readonly loopFrom: number;
	readonly loopTo: number;
	readonly resolve: number;
	readonly tempo: Song["tempo"];
	sectionIndex(name: string): number;
}

/**
 * Check a score and compile it for the player. Throws on a score the player
 * could not play as written — a wrong part name is a silent note otherwise,
 * and a bad tempo map a hung loop.
 */
export function compileSong(song: Song): CompiledSong {
	const B = song.beatsPerBar;
	const fail = (why: string): never => {
		throw new Error(`score "${song.name}": ${why}`);
	};
	if (!(B >= 1 && Number.isInteger(B))) fail(`beatsPerBar ${B}`);
	const parts = Object.keys(song.parts);
	const partIndex = new Map(parts.map((p, i) => [p, i]));

	const lilt = song.lilt ?? new Array<number>(B).fill(0);
	if (lilt.length !== B) fail(`lilt has ${lilt.length} beats, the bar ${B}`);
	if (lilt[0] !== 0) fail("lilt must not move the bar line: its first is 0");
	// Piecewise linear between the beats, to 0 at the next bar line.
	const warp = (beat: number) => {
		const k = Math.floor(beat);
		const frac = beat - k;
		const next = k + 1 < B ? lilt[k + 1] : 0;
		return beat + lilt[k] + (next - lilt[k]) * frac;
	};

	const tempo = song.tempo;
	if (!tempo.length || tempo[0].bar !== 0)
		fail("tempo map must start at bar 0");
	for (let i = 0; i < tempo.length; i++) {
		if (!(tempo[i].bpm > 0)) fail(`tempo ${tempo[i].bpm} bpm`);
		if (i > 0 && !(tempo[i].bar > tempo[i - 1].bar))
			fail("tempo points must be in bar order");
	}

	let scoreBar = 0;
	const sections: CompiledSection[] = song.sections.map((s) => {
		if (!(s.bars >= 1 && Number.isInteger(s.bars)))
			fail(`section ${s.name} has ${s.bars} bars`);
		const byBar: CompiledNote[][] = Array.from({ length: s.bars }, () => []);
		for (const e of s.events) {
			const part = partIndex.get(e.part);
			if (part === undefined) fail(`section ${s.name}: no part "${e.part}"`);
			if (!(e.bar >= 0 && e.bar < s.bars && Number.isInteger(e.bar)))
				fail(`section ${s.name}: bar ${e.bar} of ${s.bars}`);
			if (!(e.beat >= 0 && e.beat < B))
				fail(`section ${s.name}: beat ${e.beat} of ${B}`);
			if (!(e.dur > 0)) fail(`section ${s.name}: dur ${e.dur}`);
			byBar[e.bar].push(compileNote(e, part as number, warp(e.beat)));
		}
		for (const bar of byBar) bar.sort((a, b) => a.at - b.at);
		const out = { name: s.name, bars: s.bars, byBar, scoreBar };
		scoreBar += s.bars;
		return out;
	});
	const names = sections.map((s) => s.name);
	const indexOf = (name: string) => names.indexOf(name);

	let loopFrom = -1;
	let loopTo = -1;
	if (song.loop) {
		loopFrom = indexOf(song.loop.from);
		loopTo = indexOf(song.loop.to);
		if (loopFrom < 0 || loopTo < loopFrom)
			fail(`loop ${song.loop.from}..${song.loop.to}`);
	}
	const resolve = song.resolve === undefined ? -1 : indexOf(song.resolve);
	if (song.resolve !== undefined && resolve < 0)
		fail(`resolve ${song.resolve}`);

	return {
		name: song.name,
		beatsPerBar: B,
		parts,
		partSpecs: parts.map((p) => song.parts[p]),
		sections,
		loopFrom,
		loopTo,
		resolve,
		tempo,
		sectionIndex: indexOf,
	};
}

const compileNote = (e: NoteEvent, part: number, at: number): CompiledNote => ({
	part,
	at,
	dur: e.dur,
	pitch: e.pitch,
	vel: e.vel,
});

/**
 * The tempo at a score bar's line (`end` false) or just before the next line
 * (`end` true). A step point at the next line is not reached inside the bar;
 * a ramp point is.
 */
export function bpmAt(
	tempo: Song["tempo"],
	scoreBar: number,
	end: boolean,
): number {
	let i = 0;
	while (i + 1 < tempo.length && tempo[i + 1].bar <= scoreBar) i++;
	const p = tempo[i];
	const q = tempo[i + 1];
	if (!q || !q.ramp) return p.bpm;
	const at = end ? scoreBar + 1 : scoreBar;
	return p.bpm + ((q.bpm - p.bpm) * (at - p.bar)) / (q.bar - p.bar);
}

/**
 * Seconds from a bar line to `x` beats into a bar whose tempo runs linearly in
 * beats from `b0` to `b1` over `beats` beats: the integral of 60 / bpm.
 */
export function beatSeconds(
	b0: number,
	b1: number,
	beats: number,
	x: number,
): number {
	const s = (b1 - b0) / beats;
	if (Math.abs(s) < 1e-9) return (60 * x) / b0;
	return (60 / s) * Math.log((b0 + s * x) / b0);
}

/** Where a note goes: the frame it starts on, and its length in frames. */
export interface NoteSink {
	note(
		frame: number,
		part: number,
		pitch: number,
		vel: number,
		durFrames: number,
	): void;
}

/** A transport move waiting for its line. */
type Pending =
	| {
			readonly kind: "jump";
			readonly frame: number;
			readonly section: number;
			readonly resolve: boolean;
			readonly hold: boolean;
	  }
	| { readonly kind: "stop"; readonly frame: number }
	| {
			readonly kind: "tempo";
			readonly frame: number;
			readonly scale: number;
			readonly rampBars: number;
	  };

/** `Player.takeDue`'s answers that are not a section to jump to. */
const DUE_NONE = -1;
const DUE_STOP = -2;
const DUE_TEMPO = -3;

/**
 * One song's playhead.
 *
 * `start` places bar 0 of a section on a frame; `render(from, to, sink)`
 * emits every note whose frame is in `[from, to)` and crosses every bar line
 * before `to`. A move (`jumpAt`, `resolveAt`, `stopAt`, `tempoAt`) is placed
 * on a frame — a line from `lineAfter` — and applied as the playhead crosses
 * it.
 */
export class Player {
	playing = false;
	private section = 0;
	private bar = 0;
	/** The current bar's line and length, in frames. */
	private barStart = 0;
	private barLen = 0;
	/** Its tempo at the line and at its end, with the scale applied. */
	private b0 = 0;
	private b1 = 0;
	/** The next note of the current bar. */
	private cursor = 0;
	/** Bars begun since `start`: the tempo scale's clock. */
	private barsPlayed = 0;
	private resolved = false;
	/** The loop in force: the song's own, until a held move replaces it with
	 *  one section (#548). */
	private loopFrom = -1;
	private loopTo = -1;
	private scaleFrom = 1;
	private scaleTo = 1;
	private scaleStart = 0;
	private scaleBars = 0;
	private readonly pending: Pending[] = [];
	/** `lengthOf`'s tempo at a bar's line and end. */
	private tempo0 = 0;
	private tempo1 = 0;

	constructor(
		readonly song: CompiledSong,
		private readonly sampleRate: number,
	) {}

	/** Bar 0 of `section` sounds from `frame`. Clears every pending move and
	 *  the tempo scale. With `hold`, the section loops in place of the song's
	 *  own loop (#548). */
	start(frame: number, section = 0, hold = false) {
		this.playing = true;
		this.resolved = false;
		this.loopFrom = hold ? section : this.song.loopFrom;
		this.loopTo = hold ? section : this.song.loopTo;
		this.pending.length = 0;
		this.scaleFrom = this.scaleTo = 1;
		this.scaleBars = 0;
		this.barsPlayed = 0;
		this.enter(frame, section, 0);
	}

	/** The tempo at the current bar's line, with the scale applied: what the
	 *  engine times the song's echo by (#587). */
	get bpm(): number {
		return this.b0;
	}

	/** Stop now: no note after this. What is sounding is the voices' to end. */
	halt() {
		this.playing = false;
		this.pending.length = 0;
	}

	render(from: number, to: number, sink: NoteSink) {
		const sr = this.sampleRate;
		const B = this.song.beatsPerBar;
		while (this.playing) {
			// A move placed on this bar's own line before the bar began — sent
			// with the start that placed the bar — lands here, before its notes.
			if (this.cursor === 0 && this.pending.length > 0) {
				this.settle();
				if (!this.playing) return;
			}
			const notes = this.song.sections[this.section].byBar[this.bar];
			while (this.cursor < notes.length) {
				const n = notes[this.cursor];
				const onset =
					this.barStart + sr * beatSeconds(this.b0, this.b1, B, n.at);
				const frame = Math.round(onset);
				if (frame >= to) return;
				if (frame >= from) {
					const bpm = this.b0 + ((this.b1 - this.b0) * n.at) / B;
					sink.note(frame, n.part, n.pitch, n.vel, (sr * 60 * n.dur) / bpm);
				}
				this.cursor++;
			}
			const end = this.barStart + this.barLen;
			if (Math.round(end) >= to) return;
			this.advance(end);
		}
	}

	/**
	 * The first line at or after `frame` (#543 D5's quantum): a bar line, or
	 * the line that ends a section. With nothing playing, `frame` itself.
	 *
	 * Walks the bars ahead as the song will play them, through its loop, and
	 * ignores moves already pending — so two moves on one quantum land on one
	 * line.
	 */
	lineAfter(frame: number, q: Quantum): number {
		if (!this.playing) return frame;
		if (Math.round(this.barStart) >= frame) return this.barStart;
		let section = this.section;
		let bar = this.bar;
		let line = this.barStart;
		let len = this.barLen;
		let n = this.barsPlayed;
		// A song is finite or loops; either way this ends within one pass of
		// the song plus the loop, and a cap keeps a bad score from hanging.
		for (let guard = 0; guard < 100000; guard++) {
			line += len;
			const next = this.next(section, bar, this.resolved);
			if (next < 0) return line;
			const nextSection = next >> 16;
			const nextBar = next & 0xffff;
			if (Math.round(line) >= frame && (q === "bar" || nextBar === 0))
				return line;
			section = nextSection;
			bar = nextBar;
			n++;
			len = this.lengthOf(section, bar, n);
		}
		return line;
	}

	/**
	 * Go to `section` at `frame`. With `hold`, that section then loops in
	 * place of the song's own loop, until another held move (#548): an
	 * adaptive score stays on the section its level names.
	 */
	jumpAt(frame: number, section: string | number, hold = false) {
		this.pending.push({
			kind: "jump",
			frame,
			section: this.indexOf(section),
			resolve: false,
			hold,
		});
	}

	/** Go to the song's resolve section at `frame`; the loop stops holding. */
	resolveAt(frame: number) {
		if (this.song.resolve < 0)
			throw new Error(`music: ${this.song.name} has no resolve section`);
		this.pending.push({
			kind: "jump",
			frame,
			section: this.song.resolve,
			resolve: true,
			hold: false,
		});
	}

	stopAt(frame: number) {
		this.pending.push({ kind: "stop", frame });
	}

	/** Scale the tempo map by `scale`, from `frame`, over `rampBars` bars. */
	tempoAt(frame: number, scale: number, rampBars: number) {
		if (!(scale > 0))
			throw new Error(`music: a tempo scale of ${scale} is not a tempo`);
		this.pending.push({
			kind: "tempo",
			frame,
			scale,
			rampBars: Math.max(0, rampBars),
		});
	}

	/** A section's index, refusing one the song does not have by name: a jump
	 *  that dropped it in silence left a score's author no signal (sage round
	 *  1), where a bad section on `play` and a bad part on `stem` both throw. */
	private indexOf(section: string | number): number {
		const ix =
			typeof section === "number" ? section : this.song.sectionIndex(section);
		if (!(ix >= 0 && ix < this.song.sections.length))
			throw new Error(`music: ${this.song.name} has no section ${section}`);
		return ix;
	}

	/**
	 * The bar after `(section, bar)`, packed as `section << 16 | bar`; -1 at
	 * the end of the song. Packed rather than returned as a pair so the walk
	 * allocates nothing.
	 */
	private next(section: number, bar: number, resolved: boolean): number {
		const s = this.song;
		if (bar + 1 < s.sections[section].bars) return (section << 16) | (bar + 1);
		if (!resolved && this.loopTo === section) return this.loopFrom << 16;
		if (section + 1 < s.sections.length) return (section + 1) << 16;
		return -1;
	}

	/** Cross the line at `end` into the next bar, applying what is due. */
	private advance(end: number) {
		const next = this.next(this.section, this.bar, this.resolved);
		let section = next >> 16;
		let bar = next & 0xffff;
		let ended = next < 0;
		const due = this.takeDue(end, this.barsPlayed + 1);
		if (due === DUE_STOP) ended = true;
		else if (due >= 0) {
			section = due;
			bar = 0;
			ended = false;
		}
		if (ended) {
			this.halt();
			return;
		}
		this.barsPlayed++;
		this.enter(end, section, bar);
	}

	/**
	 * Apply the moves due on the current bar's own line, before any of its
	 * notes (sage round 4). `advance` applies what is due on the line it
	 * crosses; a move placed on a line the playhead has not reached yet — a
	 * start's, with a jump or a tempo sent beside it — would otherwise wait
	 * for the end of that bar.
	 */
	private settle() {
		const due = this.takeDue(this.barStart, this.barsPlayed);
		if (due === DUE_NONE) return;
		if (due === DUE_STOP) this.halt();
		else
			this.enter(
				this.barStart,
				due >= 0 ? due : this.section,
				due >= 0 ? 0 : this.bar,
			);
	}

	/**
	 * Take every pending move due on `line` — its frame is the line or before
	 * it — and apply what it sets: a resolve's flag, a tempo scale from the
	 * `n`th bar played. Returns what the moves ask of the playhead, the last
	 * one winning: a section to jump to, `DUE_STOP`, `DUE_TEMPO` for a tempo
	 * alone, or `DUE_NONE`.
	 *
	 * Compacted in place: a `splice` would return a new array, and this runs
	 * inside `process()`.
	 */
	private takeDue(line: number, n: number): number {
		const p = this.pending;
		let out = DUE_NONE;
		let kept = 0;
		for (let i = 0; i < p.length; i++) {
			const m = p[i];
			if (Math.round(m.frame) > Math.round(line)) {
				p[kept++] = m;
				continue;
			}
			if (m.kind === "jump") {
				out = m.section;
				if (m.resolve) this.resolved = true;
				if (m.hold) {
					this.loopFrom = this.loopTo = m.section;
					this.resolved = false;
				}
			} else if (m.kind === "stop") out = DUE_STOP;
			else {
				this.scaleFrom = this.scaleAt(n);
				this.scaleTo = m.scale;
				this.scaleStart = n;
				this.scaleBars = m.rampBars;
				if (out === DUE_NONE) out = DUE_TEMPO;
			}
		}
		p.length = kept;
		return out;
	}

	private enter(frame: number, section: number, bar: number) {
		this.section = section;
		this.bar = bar;
		this.barStart = frame;
		this.cursor = 0;
		this.barLen = this.lengthOf(section, bar, this.barsPlayed);
		this.b0 = this.tempo0;
		this.b1 = this.tempo1;
	}

	/**
	 * The `n`th bar played, at `(section, bar)`: its length in frames, and its
	 * tempo at the line and at its end in `tempo0` and `tempo1`. The one copy
	 * of that arithmetic, for `enter` and for `lineAfter`'s walk, so the walk
	 * cannot drift from the playhead (sage round 1). Scratch fields rather
	 * than a returned pair, so neither allocates.
	 */
	private lengthOf(section: number, bar: number, n: number): number {
		const scoreBar = this.song.sections[section].scoreBar + bar;
		this.tempo0 = bpmAt(this.song.tempo, scoreBar, false) * this.scaleAt(n);
		this.tempo1 = bpmAt(this.song.tempo, scoreBar, true) * this.scaleAt(n + 1);
		const B = this.song.beatsPerBar;
		return this.sampleRate * beatSeconds(this.tempo0, this.tempo1, B, B);
	}

	/** The tempo scale at the line that begins the `n`th bar played. */
	private scaleAt(n: number): number {
		if (this.scaleBars <= 0 || n >= this.scaleStart + this.scaleBars)
			return n >= this.scaleStart ? this.scaleTo : this.scaleFrom;
		if (n <= this.scaleStart) return this.scaleFrom;
		return (
			this.scaleFrom +
			((this.scaleTo - this.scaleFrom) * (n - this.scaleStart)) / this.scaleBars
		);
	}
}
