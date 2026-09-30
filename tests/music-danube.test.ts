/**
 * The docking computer's Blue Danube (#547): the score compiles, has the form
 * D1 and D3 ruled — an intro, Waltz No. 1 looping, a cadence it resolves
 * into — carries Strauss's theme as the Breitkopf score has it, and renders
 * through the engine under full scale.
 */
import { expect, test } from "bun:test";
import {
	BLUE_DANUBE,
	DANUBE_CANCEL_FADE_S,
	WALTZ_BPM,
} from "../src/music-danube";
import { MusicEngine } from "../src/music-engine";
import type { NoteEvent } from "../src/music-score";
import { beatSeconds, bpmAt, compileSong } from "../src/music-sequencer";

const SR = 48000;
/** A render of a minute of bowed strings runs past bun's 5 s default. */
const RENDER_TIMEOUT_MS = 60_000;
const section = (name: string) => {
	const s = BLUE_DANUBE.sections.find((x) => x.name === name);
	if (!s) throw new Error(`no section ${name}`);
	return s;
};
/** A part's notes in time order, grace notes left out: a grace is a tenth of
 *  a beat, and what the ear follows is the note it leans on. */
const line = (sec: string, part: string): NoteEvent[] =>
	section(sec)
		.events.filter((e) => e.part === part && e.dur >= 0.5)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat);
const pc = (p: number) => ((p % 12) + 12) % 12;

test("the score compiles", () => {
	expect(() => compileSong(BLUE_DANUBE)).not.toThrow();
});

test("an intro, Waltz No. 1 looping, and a cadence to resolve into (D1, D3)", () => {
	expect(BLUE_DANUBE.beatsPerBar).toBe(3);
	expect(BLUE_DANUBE.sections.map((s) => [s.name, s.bars])).toEqual([
		["intro", 9],
		["waltz", 32],
		["cadence", 4],
	]);
	expect(BLUE_DANUBE.loop).toEqual({ from: "waltz", to: "waltz" });
	expect(BLUE_DANUBE.resolve).toBe("cadence");
});

test("the waltz's second beat comes early: the Viennese lilt", () => {
	const lilt = BLUE_DANUBE.lilt ?? [];
	expect(lilt.length).toBe(3);
	expect(lilt[1]).toBeLessThan(0);
});

test("the loop is the waltz's 32 bars, every one at the waltz tempo", () => {
	const song = compileSong(BLUE_DANUBE);
	const waltz = song.sections[song.sectionIndex("waltz")];
	let seconds = 0;
	for (let b = 0; b < waltz.bars; b++) {
		const bar = waltz.scoreBar + b;
		expect(bpmAt(song.tempo, bar, false)).toBe(WALTZ_BPM);
		expect(bpmAt(song.tempo, bar, true)).toBe(WALTZ_BPM);
		seconds += beatSeconds(WALTZ_BPM, WALTZ_BPM, 3, 3);
	}
	expect(seconds).toBeCloseTo((32 * 3 * 60) / WALTZ_BPM, 6);
});

test("the theme opens as the Breitkopf score has it: D F# A | A A' | A' F#' | F#' D", () => {
	const opening = line("waltz", "melody")
		.filter((e) => e.bar < 4)
		.map((e) => e.pitch);
	expect(opening).toEqual([62, 66, 69, 69, 81, 81, 78, 78, 62]);
});

test("the second phrase answers on the dominant: A G' and then C# E B", () => {
	const phrase = line("waltz", "melody")
		.filter((e) => e.bar >= 4 && e.bar < 9)
		.map((e) => e.pitch);
	expect(phrase).toEqual([62, 66, 69, 69, 81, 81, 79, 79, 61, 61, 64, 71]);
});

test("the intro is the Andantino's A major, and the horn calls A C# E", () => {
	const first = section("intro").events.filter(
		(e) => e.part === "violins" && e.bar === 0 && e.beat === 0,
	);
	expect(new Set(first.map((e) => pc(e.pitch)))).toEqual(new Set([9, 1, 4]));
	const call = line("intro", "horn")
		.filter((e) => e.bar === 1)
		.map((e) => e.pitch);
	expect(call).toEqual([57, 61, 64]);
});

test("the intro ends on the waltz's dominant, so it lands on the tonic", () => {
	const last = section("intro").events.filter((e) => e.bar === 8);
	const pcs = new Set(last.map((e) => pc(e.pitch)));
	// A7: A, C#, G, and the root under it.
	for (const want of [9, 1, 7]) expect(pcs.has(want)).toBe(true);
});

test("the cadence ends on the tonic, in the melody and in the bass", () => {
	const cad = section("cadence");
	const lastBar = cad.events.filter((e) => e.bar === cad.bars - 1);
	expect(lastBar.length).toBeGreaterThan(0);
	// The kick is a drum, and its pitch is its body, not the harmony.
	for (const e of lastBar.filter((x) => x.part !== "kick"))
		expect([2, 6, 9]).toContain(pc(e.pitch));
	const melody = line("cadence", "melody");
	expect(pc(melody[melody.length - 1].pitch)).toBe(2);
	const bass = lastBar.filter((e) => e.part === "bass");
	expect(bass.length).toBeGreaterThan(0);
	expect(pc(Math.min(...bass.map((e) => e.pitch)))).toBe(2);
});

test("the cancel fade is two bars of the waltz (D2)", () => {
	expect(DANUBE_CANCEL_FADE_S).toBeCloseTo((2 * 3 * 60) / WALTZ_BPM, 9);
});

/** Render `seconds`, calling `at` before each block; returns the rms of each
 *  whole second and the peak. */
function render(seconds: number, at: (e: MusicEngine, f: number) => void) {
	const heard = new Set<string>();
	const e = new MusicEngine(SR, undefined, (_, __, part) => heard.add(part));
	e.command({ type: "load", id: "danube", song: BLUE_DANUBE }, 0);
	e.command({ type: "play", id: "danube", at: "bar" }, 0);
	const out = new Float32Array(128);
	const rms: number[] = [];
	let peak = 0;
	let sum = 0;
	let n = 0;
	for (let f = 0; f < seconds * SR; f += 128) {
		at(e, f);
		e.render(out, f);
		for (const v of out) {
			peak = Math.max(peak, Math.abs(v));
			sum += v * v;
			n++;
		}
		if (n >= SR) {
			rms.push(Math.sqrt(sum / n));
			sum = 0;
			n = 0;
		}
	}
	return { heard, rms, peak };
}

const introSeconds = () => {
	const song = compileSong(BLUE_DANUBE);
	let s = 0;
	for (let bar = 0; bar < section("intro").bars; bar++)
		s += beatSeconds(
			bpmAt(song.tempo, bar, false),
			bpmAt(song.tempo, bar, true),
			3,
			3,
		);
	return s;
};

test(
	"resolved at the plane, it plays every part, ends, and falls silent (D1)",
	() => {
		// A 62 s run: the shortest measured on #547.
		const resolveAt = 62 * SR - ((62 * SR) % 128);
		const r = render(75, (e, f) => {
			if (f === resolveAt) e.command({ type: "resolve", at: "bar" }, f);
		});
		expect([...r.heard].sort()).toEqual(Object.keys(BLUE_DANUBE.parts).sort());
		expect(r.peak).toBeLessThan(0.9);
		// Sounding through the intro and the waltz.
		expect(Math.min(...r.rms.slice(1, 60))).toBeGreaterThan(0.005);
		// The cadence is four bars at no less than 120 bpm: six seconds at most,
		// and the hall's tail another few. By 74 s it is over.
		expect(r.rms[73]).toBeLessThan(0.001);
	},
	RENDER_TIMEOUT_MS,
);

test(
	"unresolved, the waltz loops rather than ending",
	() => {
		const r = render(Math.ceil(introSeconds() + 2 * 36 + 4), () => {});
		expect(Math.min(...r.rms.slice(1))).toBeGreaterThan(0.005);
	},
	RENDER_TIMEOUT_MS,
);

test(
	"a cancel fades it to silence within the fade and its tail (D2)",
	() => {
		const stopAt = 40 * SR - ((40 * SR) % 128);
		const r = render(48, (e, f) => {
			if (f === stopAt)
				e.command({ type: "stop", at: "now", fadeS: DANUBE_CANCEL_FADE_S }, f);
		});
		expect(r.rms[38]).toBeGreaterThan(0.005);
		expect(r.rms[40 + Math.ceil(DANUBE_CANCEL_FADE_S) + 1]).toBeLessThan(0.001);
	},
	RENDER_TIMEOUT_MS,
);

test("the listening renders' script matches the score (sound-set)", async () => {
	const { SOUND_SET } = await import("../scripts/lib/sound-set.mjs");
	const row = (name: string) => {
		const r = (
			SOUND_SET as readonly {
				name: string;
				music?: {
					script?: readonly (readonly [
						number,
						{ type: string; fadeS?: number },
					])[];
				};
			}[]
		).find((e) => e.name === name);
		if (!r?.music?.script) throw new Error(`no row ${name}`);
		return r.music.script;
	};
	// "Two whole loops": the resolve is asked for in the second loop's last
	// bar, so the next bar line is the loop's end.
	const intro = introSeconds();
	const loopEnd = intro + (2 * 32 * 3 * 60) / WALTZ_BPM;
	const bar = (3 * 60) / WALTZ_BPM;
	const [t] = row("music-danube").find(([, c]) => c.type === "resolve") ?? [];
	expect(t).toBeGreaterThan(loopEnd - bar);
	expect(t).toBeLessThanOrEqual(loopEnd);
	// The cancel row fades over the score's two bars.
	const stop = row("music-danube-cancel").find(([, c]) => c.type === "stop");
	expect(stop?.[1].fadeS).toBeCloseTo(DANUBE_CANCEL_FADE_S, 9);
	// The comment in sound-set says the intro is ~19.2 s.
	expect(intro).toBeGreaterThan(19.1);
	expect(intro).toBeLessThan(19.3);
});
