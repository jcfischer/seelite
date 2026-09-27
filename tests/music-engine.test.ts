/**
 * The worklet's engine (#560, after #543's D5 and D7): transport commands in,
 * a block of samples out. Pure, so the whole transport — quantised starts,
 * crossfades, stops and stems — is held headless here, and the worklet shell
 * around it only moves messages and buffers.
 */
import { describe, expect, test } from "bun:test";
import { MusicEngine, MUSIC_HEADROOM } from "../src/music-engine";
import type { MusicCommand, NoteEvent, Song } from "../src/music-score";

const SR = 48000;
/** 120 bpm in 4/4: a bar is two seconds. */
const BAR = 96000;

const beats = (part: string, pitch: number): NoteEvent[] =>
	[0, 1, 2, 3].map((beat) => ({ part, bar: 0, beat, dur: 0.5, pitch, vel: 1 }));

const song = (part: string, pitch: number): Song => ({
	name: part,
	beatsPerBar: 4,
	parts: {
		[part]: { voice: "fm", level: 1 },
		[`${part}2`]: { voice: "pad", level: 1 },
	},
	sections: [
		{ name: "A", bars: 1, events: beats(part, pitch) },
		{ name: "B", bars: 1, events: beats(`${part}2`, pitch + 12) },
	],
	tempo: [{ bar: 0, bpm: 120 }],
	loop: { from: "A", to: "B" },
	resolve: "B",
});

interface Heard {
	id: string;
	frame: number;
	part: string;
}

/** An engine with songs `a` and `b` loaded, recording every note. */
const rig = () => {
	const heard: Heard[] = [];
	const e = new MusicEngine(SR, 16, (id, frame, part) =>
		heard.push({ id, frame, part }),
	);
	e.command({ type: "load", id: "a", song: song("a", 60) }, 0);
	e.command({ type: "load", id: "b", song: song("b", 72) }, 0);
	let frame = 0;
	const out = new Float32Array(128);
	const until = (end: number, sink?: number[]) => {
		for (; frame < end; frame += 128) {
			e.render(out, frame);
			if (sink) for (const v of out) sink.push(v);
		}
	};
	const send = (cmd: MusicCommand) => e.command(cmd, frame);
	return { e, heard, until, send, now: () => frame };
};

describe("starting", () => {
	test("with nothing playing, a start is on the next block", () => {
		const r = rig();
		r.until(1280);
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(3000);
		expect(r.heard[0]).toEqual({ id: "a", frame: 1280, part: "a" });
	});

	test("a start while a song plays cuts on its next bar line", () => {
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		r.send({ type: "play", id: "b", at: "bar" });
		r.until(3 * BAR);
		const b = r.heard.filter((h) => h.id === "b");
		expect(b[0].frame).toBe(BAR);
		expect(r.heard.filter((h) => h.id === "a").every((h) => h.frame < BAR)).toBe(
			true,
		);
	});

	test("the section quantum waits for the section's end", () => {
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		r.send({ type: "jump", section: "A", at: "section" });
		r.until(3 * BAR);
		// A is one bar long, so its section line is the bar line.
		expect(r.heard.find((h) => h.frame === BAR)?.part).toBe("a");
	});

	test("a command stamped before the rendered end acts at that end", () => {
		// A port message runs between two quanta, and what `currentFrame`
		// reads there is not the next quantum's start on every engine. A start
		// placed behind what is rendered would lose its first note.
		const r = rig();
		r.until(1280);
		r.e.command({ type: "play", id: "a", at: "bar" }, 1280 - 128);
		r.until(3000);
		expect(r.heard[0]).toEqual({ id: "a", frame: 1280, part: "a" });
	});

	test("a start names its section", () => {
		const r = rig();
		r.send({ type: "play", id: "a", section: "B", at: "bar" });
		r.until(1000);
		expect(r.heard[0].part).toBe("a2");
	});
});

describe("a crossfade between songs", () => {
	const fadeS = 1;
	const run = () => {
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		r.send({ type: "crossfade", to: "b", at: "bar", fadeS });
		return r;
	};

	test("the new song starts on the playing song's next bar line", () => {
		const r = run();
		r.until(2 * BAR);
		expect(r.heard.find((h) => h.id === "b")?.frame).toBe(BAR);
	});

	test("the gains cross over the fade and the old song is let go", () => {
		const r = run();
		const F = fadeS * SR;
		const { e } = r;
		expect(e.gain(0, 0, BAR)).toBeCloseTo(MUSIC_HEADROOM, 9);
		expect(e.gain(1, 0, BAR)).toBe(0);
		expect(e.gain(0, 0, BAR + F / 2)).toBeCloseTo(MUSIC_HEADROOM / 2, 9);
		expect(e.gain(1, 0, BAR + F / 2)).toBeCloseTo(MUSIC_HEADROOM / 2, 9);
		expect(e.gain(0, 0, BAR + F)).toBe(0);
		expect(e.gain(1, 0, BAR + F)).toBeCloseTo(MUSIC_HEADROOM, 9);
		r.until(BAR + F + 256);
		expect(r.e.playing).toBe("b");
		// No note of the old song after the fade has run out.
		r.until(3 * BAR);
		expect(r.heard.filter((h) => h.id === "a").every((h) => h.frame < BAR + F)).toBe(
			true,
		);
	});
});

describe("stopping", () => {
	test("on the bar: no note after the line, and what sounds rings out", () => {
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		r.send({ type: "stop", at: "bar", fadeS: 0 });
		const tail: number[] = [];
		r.until(BAR + 4800, tail);
		expect(r.heard.every((h) => h.frame < BAR)).toBe(true);
		expect(r.e.playing).toBe(null);
		// The last beat's note is still ringing past the line.
		const after = tail.slice(BAR - 30080 + 1000);
		expect(Math.max(...after.map(Math.abs))).toBeGreaterThan(0);
	});

	test("now, with a fade: silent once the fade has run, and every voice free", () => {
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30080);
		r.send({ type: "stop", at: "now", fadeS: 0.25 });
		const tail: number[] = [];
		r.until(30080 + 12000 + 1280, tail);
		const past = tail.slice(12000 + 128);
		expect(Math.max(...past.map(Math.abs))).toBe(0);
		expect(r.e.sounding).toBe(0);
		expect(r.e.playing).toBe(null);
		// And it faded rather than cut: halfway through, still sounding.
		expect(Math.max(...tail.slice(5000, 7000).map(Math.abs))).toBeGreaterThan(0);
	});

	test("a start after a stop is heard", () => {
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(10240);
		r.send({ type: "stop", at: "now", fadeS: 0.1 });
		r.until(20480);
		r.send({ type: "play", id: "b", at: "bar" });
		r.until(30720);
		expect(r.heard.at(-1)).toMatchObject({ id: "b", frame: 20480 });
	});
});

describe("stems, jumps, resolve and tempo", () => {
	test("a stem fades its part from the line, and only that part", () => {
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		r.send({ type: "stem", part: "a2", level: 0, at: "bar", fadeS: 0.5 });
		expect(r.e.gain(0, 1, BAR)).toBeCloseTo(MUSIC_HEADROOM, 9);
		expect(r.e.gain(0, 1, BAR + 12000)).toBeCloseTo(MUSIC_HEADROOM / 2, 9);
		expect(r.e.gain(0, 1, BAR + 24000)).toBe(0);
		expect(r.e.gain(0, 0, BAR + 24000)).toBeCloseTo(MUSIC_HEADROOM, 9);
	});

	test("a stem now starts from where the part is", () => {
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(1280);
		r.send({ type: "stem", part: "a", level: 0.5, at: "now", fadeS: 0 });
		expect(r.e.gain(0, 0, 1280)).toBeCloseTo(MUSIC_HEADROOM / 2, 9);
	});

	test("resolve leaves the loop for the resolve section", () => {
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		r.send({ type: "resolve", at: "bar" });
		r.until(4 * BAR);
		// A, then B (the resolve point) and the end: no second A.
		expect(r.heard.map((h) => h.part)).toEqual([
			"a",
			"a",
			"a",
			"a",
			"a2",
			"a2",
			"a2",
			"a2",
		]);
		expect(r.e.playing).toBe(null);
	});

	test("a tempo move reaches the playing song", () => {
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(1280);
		r.send({ type: "tempo", scale: 2, at: "bar", rampBars: 0 });
		r.until(BAR + 30000);
		const f = r.heard.map((h) => h.frame);
		expect(f[5] - f[4]).toBe(12000);
	});
});

describe("loading", () => {
	test("a song cannot be replaced while it sounds", () => {
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		expect(() => r.send({ type: "load", id: "a", song: song("z", 40) })).toThrow(
			/sounding/,
		);
	});

	test("an id that was never loaded is refused by name", () => {
		const r = rig();
		expect(() => r.send({ type: "play", id: "nope", at: "bar" })).toThrow(/nope/);
	});

	test("a malformed score is refused at load", () => {
		const r = rig();
		const bad = { ...song("z", 40), tempo: [] };
		expect(() => r.send({ type: "load", id: "z", song: bad })).toThrow(/tempo/);
	});

	test("the voice cap is the engine's own", () => {
		const e = new MusicEngine(SR, 3);
		expect(e.cap).toBe(3);
	});
});
