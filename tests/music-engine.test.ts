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
		expect(
			r.heard.filter((h) => h.id === "a").every((h) => h.frame < BAR),
		).toBe(true);
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

	test("playing the song that plays moves it on the line and keeps its bar", () => {
		// Sage round 1: restarting it in place moved its bar line into the
		// future, and the rest of the current bar was never heard.
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		r.send({ type: "play", id: "a", section: "B", at: "bar" });
		r.until(BAR + 30000);
		expect(r.heard.map((h) => h.frame)).toEqual([
			0,
			24000,
			48000,
			72000,
			BAR,
			BAR + 24000,
		]);
		expect(r.heard.at(-1)?.part).toBe("a2");
		// And a crossfade to it is the same move, not a fade against itself.
		r.send({ type: "crossfade", to: "a", section: "A", at: "bar", fadeS: 1 });
		r.until(2 * BAR + 30000);
		expect(r.heard.find((h) => h.frame === 2 * BAR)?.part).toBe("a");
		expect(r.e.gain(0, 0, 2 * BAR + 100)).toBeCloseTo(MUSIC_HEADROOM, 9);
	});

	test("playing the song that plays, inside its stop fade, keeps it playing", () => {
		// Sage round 3: the replay reset the gain but left the fade's halt
		// standing, so the song snapped back to full and was cut when the
		// old fade would have ended.
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30080);
		r.send({ type: "stop", at: "now", fadeS: 0.5 });
		r.until(30080 + 6400);
		r.send({ type: "play", id: "a", section: "A", at: "bar" });
		r.until(3 * BAR);
		expect(r.e.playing).toBe("a");
		expect(r.heard.filter((h) => h.frame >= BAR).length).toBeGreaterThan(0);
	});

	test("a move sent with the start lands on the start's line, not a bar later", () => {
		// Sage round 4: the start's own line had not been crossed yet, so a
		// jump queued on it waited for the end of that bar.
		const r = rig();
		r.until(1280);
		r.send({ type: "play", id: "a", at: "bar" });
		r.send({ type: "jump", section: "B", at: "bar" });
		r.send({ type: "tempo", scale: 2, at: "bar", rampBars: 0 });
		r.until(30000);
		expect(r.heard[0]).toEqual({ id: "a", frame: 1280, part: "a2" });
		expect(r.heard[1].frame - r.heard[0].frame).toBe(12000);
	});

	test("a crossfade back to a song still fading out fades it back up", () => {
		// Sage round 4: its gain was reset to 0 at once, cutting a song that
		// was still ringing, before the line.
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		r.send({ type: "crossfade", to: "b", at: "bar", fadeS: 1 });
		r.until(BAR + 24000);
		const was = r.e.gain(0, 0, r.now());
		expect(was).toBeGreaterThan(0);
		r.send({ type: "crossfade", to: "a", at: "bar", fadeS: 1 });
		expect(r.e.gain(0, 0, r.now())).toBeCloseTo(was, 6);
		r.until(2 * BAR + 48000 + 256);
		expect(r.e.playing).toBe("a");
		expect(r.e.gain(0, 0, r.now())).toBeCloseTo(MUSIC_HEADROOM, 9);
	});

	test("a play back to a song still fading out holds it until the line", () => {
		// Sage round 5: the play's gain step replaced the fade before the
		// line with the fade's value *at* the line — 0 when the fade ends
		// first — so the song was cut before the line.
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		r.send({ type: "crossfade", to: "b", at: "bar", fadeS: 1 });
		r.until(BAR + 24000);
		const was = r.e.gain(0, 0, r.now());
		r.send({ type: "play", id: "a", at: "bar" });
		expect(r.e.gain(0, 0, r.now())).toBeCloseTo(was, 6);
		expect(r.e.gain(0, 0, 2 * BAR - 1)).toBeGreaterThanOrEqual(0);
		expect(r.e.gain(0, 0, 2 * BAR)).toBeCloseTo(MUSIC_HEADROOM, 9);
	});

	test("a crossfade asked for during a crossfade starts from where the fades are", () => {
		// The same cause: a fade placed on a future line took the path before
		// that line away from the one still running.
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		r.send({ type: "crossfade", to: "b", at: "bar", fadeS: 1.5 });
		r.until(BAR + 24000);
		const b = r.e.gain(1, 0, r.now());
		expect(b).toBeGreaterThan(0);
		expect(b).toBeLessThan(MUSIC_HEADROOM);
		r.send({ type: "stem", part: "b", level: 0, at: "bar", fadeS: 0.5 });
		r.send({ type: "crossfade", to: "a", at: "bar", fadeS: 1 });
		// b's fade in and its stem keep moving as they were until the line.
		expect(r.e.gain(1, 0, r.now())).toBeCloseTo(b, 6);
		expect(r.e.gain(1, 0, r.now() + 4800)).toBeGreaterThan(b);
	});

	test("replaying the song that plays keeps its fade until the line", () => {
		// Sage round 7: the replay set the gain to full when it arrived, a bar
		// before the playhead moved, which was a step in the middle of a fade.
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		r.send({ type: "crossfade", to: "b", at: "bar", fadeS: 1.5 });
		r.until(BAR + 24000);
		const b = r.e.gain(1, 0, r.now());
		expect(b).toBeLessThan(MUSIC_HEADROOM);
		r.send({ type: "play", id: "b", at: "bar" });
		expect(r.e.gain(1, 0, r.now())).toBeCloseTo(b, 6);
		expect(r.e.gain(1, 0, 2 * BAR)).toBeCloseTo(MUSIC_HEADROOM, 9);
	});

	test("a refused start leaves the playing song as it was", () => {
		// Sage round 6: the lead was told to stop before the section was
		// checked, so a start refused by name still silenced the music.
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		expect(() =>
			r.send({ type: "play", id: "b", section: "Q", at: "bar" }),
		).toThrow(/Q/);
		expect(() =>
			r.send({ type: "crossfade", to: "b", section: "Q", at: "bar", fadeS: 1 }),
		).toThrow(/Q/);
		r.until(2 * BAR);
		expect(r.e.playing).toBe("a");
		expect(r.e.gain(0, 0, 2 * BAR)).toBeCloseTo(MUSIC_HEADROOM, 9);
		expect(r.heard.some((h) => h.frame === BAR && h.id === "a")).toBe(true);
	});

	test("a song whose last notes still ring cannot be replaced under them", () => {
		// Sage round 6: after a stop on the bar the song no longer plays but
		// its notes ring out, and a load freed their voices with a step.
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30000);
		r.send({ type: "stop", at: "bar", fadeS: 0 });
		r.until(BAR + 1280);
		expect(r.e.playing).toBe(null);
		expect(r.e.sounding).toBeGreaterThan(0);
		expect(() =>
			r.send({ type: "load", id: "a", song: song("z", 40) }),
		).toThrow(/sounding/);
	});

	test("after a stop now, a start does not wait for the fading song's line", () => {
		// Sage round 6: the song fading out still set the quantum, where the
		// quantum's own rule is "with nothing playing, now".
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(30080);
		r.send({ type: "stop", at: "now", fadeS: 1 });
		r.until(30080 + 1280);
		r.send({ type: "play", id: "b", at: "bar" });
		r.until(30080 + 12800);
		expect(r.heard.find((h) => h.id === "b")?.frame).toBe(30080 + 1280);
	});

	test("a move with nothing playing is refused by name", () => {
		// Sage round 3: the same reason as the unknown section below — a move
		// dropped in silence leaves a score's author no signal.
		const r = rig();
		for (const cmd of [
			{ type: "jump", section: "A", at: "bar" },
			{ type: "resolve", at: "bar" },
			{ type: "stem", part: "a", level: 0, at: "now", fadeS: 0 },
			{ type: "tempo", scale: 2, at: "bar", rampBars: 0 },
		] as const)
			expect(() => r.send(cmd)).toThrow(/nothing is playing/);
	});

	test("a jump to a section the song does not have is refused by name", () => {
		// Sage round 1: it was dropped in silence, where its siblings throw.
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		expect(() => r.send({ type: "jump", section: "Q", at: "bar" })).toThrow(
			/Q/,
		);
		const plain = new MusicEngine(SR);
		plain.command(
			{ type: "load", id: "p", song: { ...song("p", 60), resolve: undefined } },
			0,
		);
		plain.command({ type: "play", id: "p", at: "bar" }, 0);
		expect(() => plain.command({ type: "resolve", at: "bar" }, 0)).toThrow(
			/resolve/,
		);
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
		expect(
			r.heard.filter((h) => h.id === "a").every((h) => h.frame < BAR + F),
		).toBe(true);
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
		expect(Math.max(...tail.slice(5000, 7000).map(Math.abs))).toBeGreaterThan(
			0,
		);
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
		expect(() =>
			r.send({ type: "load", id: "a", song: song("z", 40) }),
		).toThrow(/sounding/);
	});

	test("an id that was never loaded is refused by name", () => {
		const r = rig();
		expect(() => r.send({ type: "play", id: "nope", at: "bar" })).toThrow(
			/nope/,
		);
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

describe("a held section (#548)", () => {
	const parts = (heard: Heard[], id: string) =>
		heard.filter((h) => h.id === id && h.frame % BAR === 0).map((h) => h.part);

	test("a held play loops the section it starts at", () => {
		const r = rig();
		r.send({ type: "play", id: "a", section: "B", at: "bar", hold: true });
		r.until(4 * BAR);
		expect(parts(r.heard, "a")).toEqual(["a2", "a2", "a2", "a2"]);
	});

	test("a held jump moves the loop to its section", () => {
		const r = rig();
		r.send({ type: "play", id: "a", section: "B", at: "bar", hold: true });
		r.until(1000);
		r.send({ type: "jump", section: "A", at: "bar", hold: true });
		r.until(4 * BAR);
		expect(parts(r.heard, "a")).toEqual(["a2", "a", "a", "a"]);
	});

	test("a held crossfade holds the section in the song it brings in", () => {
		const r = rig();
		r.send({ type: "play", id: "a", at: "bar" });
		r.until(1000);
		r.send({
			type: "crossfade",
			to: "b",
			section: "B",
			at: "bar",
			fadeS: 0.5,
			hold: true,
		});
		r.until(5 * BAR);
		expect(parts(r.heard, "b")).toEqual(["b2", "b2", "b2", "b2"]);
	});
});

describe("stereo and the space (#560, after #548's first listening)", () => {
	/** One note of one part, rendered in stereo for `seconds`. */
	const stereo = (
		part: Partial<Song["parts"][string]>,
		seconds: number,
		extra: (e: MusicEngine, f: number) => void = () => {},
		mono = false,
	) => {
		const e = new MusicEngine(SR, 16);
		const one: Song = {
			name: "one",
			beatsPerBar: 4,
			parts: { p: { voice: "fm", level: 1, ...part } },
			sections: [
				{
					name: "A",
					bars: 1,
					events: [{ part: "p", bar: 0, beat: 0, dur: 0.5, pitch: 69, vel: 1 }],
				},
			],
			tempo: [{ bar: 0, bpm: 120 }],
			space: { reverbS: 2, echoBeats: 1, echoFeedback: 0.4 },
		};
		e.command({ type: "load", id: "one", song: one }, 0);
		e.command({ type: "play", id: "one", at: "bar" }, 0);
		const n = Math.round(seconds * SR);
		const L = new Float32Array(n);
		const R = new Float32Array(n);
		for (let f = 0; f < n; f += 128) {
			extra(e, f);
			e.render(
				L.subarray(f, f + 128),
				f,
				mono ? undefined : R.subarray(f, f + 128),
			);
		}
		return { L, R };
	};
	const energy = (x: Float32Array, a: number, b: number) => {
		let s = 0;
		for (let i = Math.round(a * SR); i < Math.round(b * SR); i++)
			s += x[i] * x[i];
		return s;
	};

	test("a centred dry part is the same on both sides, and its fold-down is the mono render", () => {
		const { L, R } = stereo({}, 0.5);
		const mono = stereo({}, 0.5, undefined, true).L;
		for (let i = 0; i < L.length; i++) {
			expect(L[i]).toBe(R[i]);
			expect(mono[i]).toBeCloseTo((L[i] + R[i]) / 2, 7);
		}
		expect(energy(L, 0, 0.3)).toBeGreaterThan(0);
	});

	test("a part panned hard left is silent on the right", () => {
		const { L, R } = stereo({ pan: -1 }, 0.5);
		expect(energy(R, 0, 0.5)).toBeLessThan(1e-12);
		expect(energy(L, 0, 0.5)).toBeGreaterThan(0);
	});

	test("a part with a reverb send rings after its note; a dry part does not", () => {
		const wet = stereo(
			{ reverb: 0.6, decayS: 0.1, sustain: 0, releaseS: 0.05 },
			2,
		);
		const dry = stereo({ decayS: 0.1, sustain: 0, releaseS: 0.05 }, 2);
		expect(energy(dry.L, 0.6, 1.5)).toBe(0);
		expect(energy(wet.L, 0.6, 1.5)).toBeGreaterThan(0);
		expect(energy(wet.R, 0.6, 1.5)).toBeGreaterThan(0);
	});

	test("the song's space sets the echo: one beat at 120 bpm repeats at 0.5 s", () => {
		const { L } = stereo(
			{ echo: 1, decayS: 0.05, sustain: 0, releaseS: 0.02 },
			1,
		);
		// Dry note over by 0.2 s; the first repeat, on the left, at 0.5 s.
		expect(energy(L, 0.3, 0.45)).toBe(0);
		expect(energy(L, 0.5, 0.65)).toBeGreaterThan(0);
	});

	test("the echo follows the tempo: one beat at 60 bpm after 120 repeats at 1 s (#587)", () => {
		// The echo was timed at the song's first tempo, so a section written
		// faster or slower drifted against its own repeats.
		const e = new MusicEngine(SR, 16);
		const two: Song = {
			name: "two",
			beatsPerBar: 4,
			parts: {
				p: {
					voice: "fm",
					level: 1,
					echo: 1,
					decayS: 0.05,
					sustain: 0,
					releaseS: 0.02,
				},
			},
			sections: [
				// A note in A, so the room is ringing when B's tempo lands and the
				// echo glides rather than jumps (sage round 1).
				{
					name: "A",
					bars: 1,
					events: [{ part: "p", bar: 0, beat: 0, dur: 0.1, pitch: 69, vel: 1 }],
				},
				{
					name: "B",
					bars: 2,
					events: [{ part: "p", bar: 0, beat: 0, dur: 0.1, pitch: 69, vel: 1 }],
				},
			],
			tempo: [
				{ bar: 0, bpm: 120 },
				{ bar: 1, bpm: 60 },
			],
			space: { echoBeats: 1, echoFeedback: 0 },
		};
		e.command({ type: "load", id: "two", song: two }, 0);
		e.command({ type: "play", id: "two", at: "bar" }, 0);
		const n = 5 * SR;
		const L = new Float32Array(n);
		const R = new Float32Array(n);
		for (let f = 0; f < n; f += 128)
			e.render(L.subarray(f, f + 128), f, R.subarray(f, f + 128));
		// Section B, and its note, begin at 2 s. What A's note left in the room
		// rings under both windows, so read the repeat against it.
		const oldTime = energy(L, 2.45, 2.6);
		const newTime = energy(L, 2.98, 3.15);
		expect(newTime).toBeGreaterThan(20 * oldTime);
	});

	test("replaying the song inside its stop now's fade brings its room back on the line (sage round 9)", () => {
		// The stop faded the room to 0 and the replay restored only the
		// song's own gain: the song came back dry, for good.
		const e = new MusicEngine(SR, 16);
		const hall: Song = {
			name: "hall",
			beatsPerBar: 4,
			parts: {
				p: {
					voice: "fm",
					level: 1,
					reverb: 1,
					decayS: 0.1,
					sustain: 0,
					releaseS: 0.05,
				},
			},
			sections: [
				{
					name: "A",
					bars: 2,
					events: [{ part: "p", bar: 0, beat: 0, dur: 0.1, pitch: 69, vel: 1 }],
				},
			],
			tempo: [{ bar: 0, bpm: 120 }],
			space: { reverbS: 2 },
		};
		e.command({ type: "load", id: "hall", song: hall }, 0);
		e.command({ type: "play", id: "hall", at: "bar" }, 0);
		const L = new Float32Array(128);
		const stopAt = 0.25 * SR - ((0.25 * SR) % 128);
		const replayAt = 0.5 * SR - ((0.5 * SR) % 128);
		let tail = 0;
		for (let f = 0; f < 2.8 * SR; f += 128) {
			if (f === stopAt) e.command({ type: "stop", at: "now", fadeS: 0.5 }, f);
			if (f === replayAt)
				e.command({ type: "play", id: "hall", section: "A", at: "bar" }, f);
			e.render(L, f);
			// The replay is a jump on the bar line at 2 s, and its note is dry by
			// 2.2 s: after that, only the room sounds.
			if (f >= 2.3 * SR) for (const v of L) tail += v * v;
		}
		expect(e.playing).toBe("hall");
		expect(tail).toBeGreaterThan(1e-6);
	});

	test("a room field given as undefined takes its default, not NaN (sage round 9)", () => {
		const { L, R } = stereo({ reverb: 1, echo: 1 }, 1, (e, f) => {
			if (f === 0) {
				e.command({ type: "stop", at: "now", fadeS: 0 }, 0);
				e.command(
					{
						type: "load",
						id: "undef",
						song: {
							name: "undef",
							beatsPerBar: 4,
							parts: { p: { voice: "fm", level: 1, reverb: 1, echo: 1 } },
							sections: [
								{
									name: "A",
									bars: 1,
									events: [
										{ part: "p", bar: 0, beat: 0, dur: 0.5, pitch: 69, vel: 1 },
									],
								},
							],
							tempo: [{ bar: 0, bpm: 120 }],
							space: {
								reverbS: undefined,
								echoBeats: undefined,
								echoFeedback: undefined,
							},
						},
					},
					0,
				);
				e.command({ type: "play", id: "undef", at: "bar" }, 0);
			}
		});
		let energy = 0;
		for (let i = 0; i < L.length; i++) {
			expect(Number.isFinite(L[i]) && Number.isFinite(R[i])).toBe(true);
			energy += L[i] * L[i];
		}
		expect(energy).toBeGreaterThan(0);
	});

	test("a song started after a stop now's fade has run does not bring the stopped room back", () => {
		// The stop fades the room to 0, but the room still holds the hall's
		// tail; the next song's line set the room back to full, and that tail
		// came back with it, at once, before the new song had played a note.
		const e = new MusicEngine(SR, 16);
		const at = (beat: number): Song => ({
			name: "hall",
			beatsPerBar: 4,
			parts: { p: { voice: "pad", level: 1, reverb: 1, echo: 1 } },
			sections: [
				{
					name: "A",
					bars: 1,
					events: [{ part: "p", bar: 0, beat, dur: 1, pitch: 60, vel: 1 }],
				},
			],
			tempo: [{ bar: 0, bpm: 120 }],
		});
		e.command({ type: "load", id: "a", song: at(0) }, 0);
		e.command({ type: "load", id: "b", song: at(3) }, 0);
		e.command({ type: "play", id: "a", at: "bar" }, 0);
		const stopAt = 1.2 * SR - ((1.2 * SR) % 128);
		const playAt = 1.5 * SR - ((1.5 * SR) % 128);
		const L = new Float32Array(128);
		const R = new Float32Array(128);
		let ringing = 0;
		let between = 0;
		for (let f = 0; f < 2.5 * SR; f += 128) {
			if (f === stopAt) e.command({ type: "stop", at: "now", fadeS: 0.1 }, f);
			if (f === playAt) e.command({ type: "play", id: "b", at: "bar" }, f);
			e.render(L, f, R);
			for (let k = 0; k < 128; k++) {
				const v = Math.abs(L[k]) + Math.abs(R[k]);
				// Before the stop the room is ringing; after b starts, and
				// before its first note on beat 3, it must be silent.
				if (f + k < stopAt) ringing = Math.max(ringing, v);
				else if (f + k >= playAt) between = Math.max(between, v);
			}
		}
		expect(ringing).toBeGreaterThan(0.01);
		expect(between).toBe(0);
	});

	test("a song started inside a stop now's fade leaves the old tail on its fade (#587)", () => {
		// One room for every song: the new song's line set it back to full,
		// and the stopped song's tail came back with it, loud, in the middle
		// of its own fade out.
		const e = new MusicEngine(SR, 16);
		const at = (beat: number): Song => ({
			name: "hall",
			beatsPerBar: 4,
			parts: { p: { voice: "pad", level: 1, reverb: 1, echo: 1 } },
			sections: [
				{
					name: "A",
					bars: 1,
					events: [{ part: "p", bar: 0, beat, dur: 1, pitch: 60, vel: 1 }],
				},
			],
			tempo: [{ bar: 0, bpm: 120 }],
			space: { reverbS: 6 },
		});
		e.command({ type: "load", id: "a", song: at(0) }, 0);
		e.command({ type: "load", id: "b", song: at(3) }, 0);
		e.command({ type: "play", id: "a", at: "bar" }, 0);
		const snap = (s: number) => s * SR - ((s * SR) % 128);
		const stopAt = snap(1.2);
		const fadeS = 1;
		const playAt = snap(1.5);
		const quiet = stopAt + fadeS * SR;
		// b starts now (a is leaving) and its first note is on beat 3.
		const bNote = playAt + 1.5 * SR;
		const L = new Float32Array(128);
		const R = new Float32Array(128);
		let before = 0;
		let after = 0;
		let past = 0;
		for (let f = 0; f < bNote; f += 128) {
			if (f === stopAt) e.command({ type: "stop", at: "now", fadeS }, f);
			if (f === playAt) e.command({ type: "play", id: "b", at: "bar" }, f);
			e.render(L, f, R);
			for (let k = 0; k < 128; k++) {
				const v = Math.abs(L[k]) + Math.abs(R[k]);
				const t = f + k;
				if (t >= playAt - 0.05 * SR && t < playAt) before = Math.max(before, v);
				else if (t >= playAt && t < quiet) after = Math.max(after, v);
				else if (t >= quiet && t < bNote) past = Math.max(past, v);
			}
		}
		expect(before).toBeGreaterThan(0.001);
		// Still fading: never louder than it was just before b started.
		expect(after).toBeLessThanOrEqual(before);
		// And once the fade has run, silence until b plays.
		expect(past).toBe(0);
	});

	test("a stop now at a rest still fades that song's room (#587 sage round 1)", () => {
		// The stop faded only rooms that were ringing at that instant. A song
		// stopped in a rest plays on until its fade ends, and a note inside
		// the fade rang on in a room still at full.
		const e = new MusicEngine(SR, 16);
		const late: Song = {
			name: "late",
			beatsPerBar: 4,
			parts: { p: { voice: "pad", level: 1, reverb: 1 } },
			sections: [
				{
					name: "A",
					bars: 1,
					events: [{ part: "p", bar: 0, beat: 2, dur: 0.5, pitch: 60, vel: 1 }],
				},
			],
			tempo: [{ bar: 0, bpm: 120 }],
			space: { reverbS: 6 },
		};
		e.command({ type: "load", id: "late", song: late }, 0);
		e.command({ type: "play", id: "late", at: "bar" }, 0);
		const stopAt = 0.5 * SR - ((0.5 * SR) % 128);
		const fadeS = 1;
		const quiet = stopAt + fadeS * SR + 128;
		const L = new Float32Array(128);
		const R = new Float32Array(128);
		let inFade = 0;
		let past = 0;
		for (let f = 0; f < 3 * SR; f += 128) {
			if (f === stopAt) e.command({ type: "stop", at: "now", fadeS }, f);
			e.render(L, f, R);
			for (let k = 0; k < 128; k++) {
				const v = Math.abs(L[k]) + Math.abs(R[k]);
				if (f + k < quiet) inFade = Math.max(inFade, v);
				else past = Math.max(past, v);
			}
		}
		// The note on beat 2, at 1 s, sounded inside the fade.
		expect(inFade).toBeGreaterThan(0.001);
		expect(past).toBe(0);
	});

	test("a song loaded into a slot whose room is fading out does not bring that tail back (#587 sage round 1)", () => {
		// With every slot's room ringing, a load takes one whose room a stop
		// now is fading, and the new song's line set it back to full.
		const e = new MusicEngine(SR, 16);
		// 480 bpm: a bar is half a second, so four songs play in two. A long
		// room on the first three, a short one on the last, so the tails a
		// load can land on are about as loud as each other.
		const hall = (name: string, beat: number, reverbS = 20): Song => ({
			name,
			beatsPerBar: 4,
			parts: { p: { voice: "pad", level: 1, reverb: 1 } },
			sections: [
				{
					name: "A",
					bars: 1,
					events: [{ part: "p", bar: 0, beat, dur: 0.5, pitch: 60, vel: 1 }],
				},
			],
			tempo: [{ bar: 0, bpm: 480 }],
			space: { reverbS },
		});
		const ids = ["a", "b", "c", "d"];
		for (const id of ids)
			e.command(
				{ type: "load", id, song: hall(id, 0, id === "d" ? 1 : 20) },
				0,
			);
		const snap = (s: number) => s * SR - ((s * SR) % 128);
		// Each plays one bar, on the bar: every room rings.
		const plays = new Map(ids.map((id, i) => [snap(i * 0.5 + 0.1), id]));
		const stopAt = snap(1.7);
		const fadeS = 2;
		// Late in the fade, where the rooms are at a fifth.
		const loadAt = snap(3.3);
		const eNote = loadAt + 0.375 * SR;
		const L = new Float32Array(128);
		const R = new Float32Array(128);
		let before = 0;
		let after = 0;
		for (let f = 0; f < eNote; f += 128) {
			const id = plays.get(f);
			if (id) e.command({ type: "play", id, at: "bar" }, f);
			if (f === stopAt) e.command({ type: "stop", at: "now", fadeS }, f);
			if (f === loadAt) {
				e.command({ type: "load", id: "e", song: hall("e", 3) }, f);
				e.command({ type: "play", id: "e", at: "bar" }, f);
			}
			e.render(L, f, R);
			for (let k = 0; k < 128; k++) {
				const v = Math.abs(L[k]) + Math.abs(R[k]);
				const t = f + k;
				if (t >= loadAt - 0.05 * SR && t < loadAt) before = Math.max(before, v);
				else if (t >= loadAt && t < eNote) after = Math.max(after, v);
			}
		}
		expect(before).toBeGreaterThan(0.001);
		expect(after).toBeLessThanOrEqual(before);
	});

	test("a worklet quantum takes no typed-array view, stereo or folded (sage round 8)", () => {
		// `render` may not allocate (#543 D1). A view is an allocation, and the
		// stereo render took eight a quantum: one per buffer and send.
		const e = new MusicEngine(SR, 16);
		const room: Song = {
			name: "room",
			beatsPerBar: 4,
			parts: {
				p: { voice: "pad", level: 1, reverb: 0.5, echo: 0.5, pan: -0.5 },
				d: { voice: "drone", level: 1, reverb: 0.5 },
			},
			sections: [
				{
					name: "A",
					bars: 1,
					events: [
						{ part: "p", bar: 0, beat: 0, dur: 2, pitch: 60, vel: 1 },
						{ part: "d", bar: 0, beat: 0, dur: 2, pitch: 48, vel: 1 },
					],
				},
			],
			tempo: [{ bar: 0, bpm: 120 }],
		};
		e.command({ type: "load", id: "room", song: room }, 0);
		e.command({ type: "play", id: "room", at: "bar" }, 0);
		const L = new Float32Array(128);
		const R = new Float32Array(128);
		const subarray = Float32Array.prototype.subarray;
		let views = 0;
		Float32Array.prototype.subarray = function (
			this: Float32Array,
			...args: [number?, number?]
		) {
			views++;
			return subarray.apply(this, args);
		};
		let peak = 0;
		try {
			for (let f = 0; f < 0.5 * SR; f += 128) {
				if (f % 256 === 0) e.render(L, f, R);
				else e.render(L, f);
				for (let k = 0; k < 128; k++) peak = Math.max(peak, Math.abs(L[k]));
			}
		} finally {
			Float32Array.prototype.subarray = subarray;
		}
		expect(peak).toBeGreaterThan(0);
		expect(views).toBe(0);
	});

	test("a stop now fades the space with the song, and then it is silence", () => {
		const { L, R } = stereo({ reverb: 1, echo: 1 }, 2, (e, f) => {
			if (f === 0.25 * SR - ((0.25 * SR) % 128))
				e.command({ type: "stop", at: "now", fadeS: 0.1 }, f);
		});
		for (let i = Math.round(0.5 * SR); i < 2 * SR; i++) {
			expect(L[i]).toBe(0);
			expect(R[i]).toBe(0);
		}
	});
});
