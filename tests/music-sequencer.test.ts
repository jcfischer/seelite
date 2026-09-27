/**
 * The scheduling core the worklet runs (#560, after #543's D3–D5): score,
 * tempo map and a frame window in, notes out. Everything here is arithmetic,
 * so it is held headless; the worklet only calls it.
 */
import { describe, expect, test } from "bun:test";
import type { NoteEvent, Song } from "../src/music-score";
import {
	beatSeconds,
	compileSong,
	type NoteSink,
	Player,
} from "../src/music-sequencer";

const SR = 48000;

interface Heard {
	frame: number;
	part: number;
	pitch: number;
	vel: number;
	durFrames: number;
}
const collect = (): NoteSink & { notes: Heard[] } => {
	const notes: Heard[] = [];
	return {
		notes,
		note(frame, part, pitch, vel, durFrames) {
			notes.push({ frame, part, pitch, vel, durFrames });
		},
	};
};

/** One note per beat of every bar, pitch = 100 × section index + bar. */
const everyBeat = (bars: number, beats: number, pitch: number): NoteEvent[] =>
	Array.from({ length: bars * beats }, (_, i) => ({
		part: "p",
		bar: Math.floor(i / beats),
		beat: i % beats,
		dur: 0.5,
		pitch: pitch + Math.floor(i / beats),
		vel: 1,
	}));

const song = (over: Partial<Song> = {}): Song => ({
	name: "t",
	beatsPerBar: 4,
	parts: { p: { voice: "pluck", level: 1 } },
	sections: [
		{ name: "intro", bars: 1, events: everyBeat(1, 4, 0) },
		{ name: "A", bars: 2, events: everyBeat(2, 4, 100) },
		{ name: "coda", bars: 1, events: everyBeat(1, 4, 200) },
	],
	tempo: [{ bar: 0, bpm: 120 }],
	...over,
});

/** Render in windows of `block` frames from 0 to `frames`. */
const run = (p: Player, frames: number, block = 128) => {
	const sink = collect();
	for (let f = 0; f < frames; f += block)
		p.render(f, Math.min(frames, f + block), sink);
	return sink.notes;
};

describe("the tempo map", () => {
	test("a constant tempo puts every beat on its sample", () => {
		const p = new Player(compileSong(song()), SR);
		p.start(0);
		// One block past the last line, so the playhead crosses it.
		const notes = run(p, 4 * 96000 + 128);
		// 120 bpm is half a second a beat: 24000 frames.
		expect(notes.slice(0, 5).map((n) => n.frame)).toEqual([
			0, 24000, 48000, 72000, 96000,
		]);
		// Four bars of four beats, then the song ends: no loop.
		expect(notes).toHaveLength(16);
		expect(p.playing).toBe(false);
	});

	test("a step change takes effect at its bar line", () => {
		const p = new Player(
			compileSong(
				song({
					tempo: [
						{ bar: 0, bpm: 120 },
						{ bar: 2, bpm: 60 },
					],
				}),
			),
			SR,
		);
		p.start(0);
		const f = run(p, 8 * 96000).map((n) => n.frame);
		// Bars 0 and 1 at 120, bar 2 at 60: its beats are a second apart.
		expect(f[8]).toBe(192000);
		expect(f[9] - f[8]).toBe(48000);
		expect(f[7] - f[6]).toBe(24000);
	});

	test("a ramp is reached across the beats, and the time is its integral", () => {
		const c = compileSong(
			song({
				tempo: [
					{ bar: 0, bpm: 120 },
					{ bar: 2, bpm: 60, ramp: true },
				],
			}),
		);
		const p = new Player(c, SR);
		p.start(0);
		const f = run(p, 10 * 96000).map((n) => n.frame);
		const gaps = f.slice(1, 9).map((x, i) => x - f[i]);
		// Every beat longer than the one before while the ramp runs.
		for (let i = 1; i < gaps.length; i++)
			expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
		// Bar 0 runs 120 → 90 bpm over 4 beats: 60/s·ln(b1/b0), s = −7.5.
		const bar0 = (60 / -7.5) * Math.log(90 / 120);
		expect(f[4]).toBe(Math.round(bar0 * SR));
		expect(beatSeconds(120, 90, 4, 4)).toBeCloseTo(bar0, 12);
		// At 60 bpm from bar 2 on: a second a beat.
		expect(f[9] - f[8]).toBe(48000);
	});

	test("beatSeconds is the plain product when the tempo is flat", () => {
		expect(beatSeconds(90, 90, 3, 2)).toBeCloseTo((60 / 90) * 2, 12);
	});
});

describe("the lilt", () => {
	test("each beat moves by its offset, and a note between moves in proportion", () => {
		const waltz = song({
			beatsPerBar: 3,
			lilt: [0, -0.1, 0.05],
			sections: [
				{
					name: "A",
					bars: 2,
					events: [0, 1, 1.5, 2, 2.5].map((beat) => ({
						part: "p",
						bar: 0,
						beat,
						dur: 0.25,
						pitch: 60,
						vel: 1,
					})),
				},
			],
		});
		const p = new Player(compileSong(waltz), SR);
		p.start(0);
		const f = run(p, 3 * 72000).map((n) => n.frame);
		const beat = 24000;
		expect(f[0]).toBe(0);
		expect(f[1]).toBe(Math.round(0.9 * beat));
		// Halfway from −0.1 to +0.05.
		expect(f[2]).toBe(Math.round((1.5 - 0.025) * beat));
		expect(f[3]).toBe(Math.round(2.05 * beat));
		// Halfway from +0.05 to the next bar line's 0.
		expect(f[4]).toBe(Math.round((2.5 + 0.025) * beat));
	});
});

describe("the frame windows", () => {
	test("a note on a block boundary is heard once, whatever the block", () => {
		const c = compileSong(song());
		const whole = (() => {
			const p = new Player(c, SR);
			p.start(0);
			return run(p, 4 * 96000, 4 * 96000);
		})();
		for (const block of [1, 7, 128, 24000, 24001]) {
			const p = new Player(c, SR);
			p.start(0);
			expect(run(p, 4 * 96000, block)).toEqual(whole);
		}
		// 24000 is a beat: in 128-frame blocks, frame 24000 opens a block.
		expect(24000 % 128).toBe(64);
		expect(whole.some((n) => n.frame % 128 === 0 && n.frame > 0)).toBe(true);
	});

	test("a start later than the window is not heard early", () => {
		const p = new Player(compileSong(song()), SR);
		p.start(1000);
		const notes = run(p, 30000);
		expect(notes.map((n) => n.frame)).toEqual([1000, 25000]);
	});

	test("a note's length is its beats at the tempo it starts in", () => {
		const p = new Player(compileSong(song()), SR);
		p.start(0);
		expect(run(p, 100)[0].durFrames).toBe(12000);
	});
});

describe("sections, loops and quantised moves", () => {
	const looped = () =>
		compileSong(song({ loop: { from: "A", to: "A" }, resolve: "coda" }));
	const barsOf = (notes: Heard[]) =>
		notes.filter((_, i) => i % 4 === 0).map((n) => n.pitch);

	test("a loop replays its sections until it is resolved", () => {
		const p = new Player(looped(), SR);
		p.start(0);
		expect(barsOf(run(p, 7 * 96000))).toEqual([
			0, 100, 101, 100, 101, 100, 101,
		]);
		expect(p.playing).toBe(true);
	});

	test("resolve on the bar goes to the resolve section and then ends", () => {
		const p = new Player(looped(), SR);
		p.start(0);
		const sink = collect();
		p.render(0, 150000, sink);
		// Mid bar 1: the next line is bar 2's.
		expect(p.lineAfter(150000, "bar")).toBe(192000);
		p.resolveAt(p.lineAfter(150000, "bar"));
		p.render(150000, 10 * 96000, sink);
		expect(barsOf(sink.notes)).toEqual([0, 100, 200]);
		expect(p.playing).toBe(false);
	});

	test("the section quantum waits for the section's end, through the loop", () => {
		const p = new Player(looped(), SR);
		p.start(0);
		p.render(0, 100000, collect());
		// In A's first bar: A ends after its second, at bar 3's line.
		expect(p.lineAfter(100000, "section")).toBe(3 * 96000);
		expect(p.lineAfter(100000, "bar")).toBe(2 * 96000);
	});

	test("a line exactly at the window start is that line, not the next", () => {
		const p = new Player(looped(), SR);
		p.start(0);
		p.render(0, 96000, collect());
		expect(p.lineAfter(96000, "bar")).toBe(96000);
	});

	test("jump on the bar moves the playhead at the line and not before", () => {
		const p = new Player(looped(), SR);
		p.start(0);
		const sink = collect();
		p.render(0, 30000, sink);
		p.jumpAt(p.lineAfter(30000, "bar"), "coda");
		p.render(30000, 3 * 96000, sink);
		expect(sink.notes.map((n) => n.pitch)).toEqual([
			0, 0, 0, 0, 200, 200, 200, 200,
		]);
		expect(sink.notes[4].frame).toBe(96000);
	});

	test("a start at a section begins at its first bar", () => {
		const c = looped();
		const p = new Player(c, SR);
		p.start(500, c.sectionIndex("coda"));
		expect(run(p, 2 * 96000)[0]).toMatchObject({ frame: 500, pitch: 200 });
	});

	test("stop on the bar starts no note after the line", () => {
		const p = new Player(looped(), SR);
		p.start(0);
		const sink = collect();
		p.render(0, 30000, sink);
		p.stopAt(p.lineAfter(30000, "bar"));
		p.render(30000, 5 * 96000, sink);
		expect(sink.notes.map((n) => n.frame)).toEqual([0, 24000, 48000, 72000]);
		expect(p.playing).toBe(false);
	});

	test("nothing playing: every quantum is now", () => {
		const p = new Player(looped(), SR);
		expect(p.lineAfter(777, "bar")).toBe(777);
		expect(p.lineAfter(777, "section")).toBe(777);
	});
});

describe("a tempo move", () => {
	test("a scale at the line changes the bars after it", () => {
		const p = new Player(
			compileSong(song({ loop: { from: "A", to: "A" } })),
			SR,
		);
		p.start(0);
		const sink = collect();
		p.render(0, 10, sink);
		p.tempoAt(p.lineAfter(10, "bar"), 2, 0);
		p.render(10, 3 * 96000, sink);
		const f = sink.notes.map((n) => n.frame);
		expect(f[4]).toBe(96000);
		expect(f[5] - f[4]).toBe(12000);
	});

	test("a scale ramped over bars reaches its figure at the ramp's end", () => {
		const p = new Player(
			compileSong(song({ loop: { from: "A", to: "A" } })),
			SR,
		);
		p.start(0);
		const sink = collect();
		p.render(0, 10, sink);
		p.tempoAt(p.lineAfter(10, "bar"), 0.5, 2);
		p.render(10, 12 * 96000, sink);
		const f = sink.notes.map((n) => n.frame);
		const gaps = f.slice(5, 12).map((x, i) => x - f[4 + i]);
		for (let i = 1; i < gaps.length; i++)
			expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
		// From bar 3 on the tempo is 60 bpm: a second a beat.
		expect(f[13] - f[12]).toBe(48000);
	});
});

test("a tempo scale that is not positive is refused, not dropped", () => {
	const p = new Player(compileSong(song()), SR);
	p.start(0);
	expect(() => p.tempoAt(0, 0, 0)).toThrow(/tempo scale/);
});

describe("compiling refuses a malformed score", () => {
	const bad = (over: Partial<Song>, match: RegExp) =>
		expect(() => compileSong(song(over))).toThrow(match);
	const note = (e: Partial<NoteEvent>): NoteEvent => ({
		part: "p",
		bar: 0,
		beat: 0,
		dur: 1,
		pitch: 60,
		vel: 1,
		...e,
	});
	const one = (e: NoteEvent) => [{ name: "A", bars: 1, events: [e] }];

	test("an unknown part", () =>
		bad({ sections: one(note({ part: "q" })) }, /part/));
	test("a beat past the bar", () =>
		bad({ sections: one(note({ beat: 4 })) }, /beat/));
	test("a bar past the section", () =>
		bad({ sections: one(note({ bar: 1 })) }, /bar/));
	test("a lilt that moves the bar line", () =>
		bad({ lilt: [0.1, 0, 0, 0] }, /lilt/));
	test("a lilt of the wrong length", () => bad({ lilt: [0, 0] }, /lilt/));
	test("a loop or resolve naming no section", () => {
		bad({ loop: { from: "A", to: "B" } }, /loop/);
		bad({ resolve: "outro" }, /resolve/);
	});
	test("a tempo map that does not start at bar 0", () =>
		bad({ tempo: [{ bar: 1, bpm: 100 }] }, /tempo/));
	test("a tempo that is not positive", () =>
		bad({ tempo: [{ bar: 0, bpm: 0 }] }, /tempo/));
});
