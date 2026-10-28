/**
 * The guard for the engine's count-only mode, which the voice-cap tests use:
 * https://github.com/jcfischer/seelite/issues/1116
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DANUBE_VOICINGS, danubeSong } from "../src/music-danube";
import { MusicEngine } from "../src/music-engine";
import {
	flightBed as currentFlightBed,
	stationBed as currentStationBed,
} from "../src/music-generate";
import {
	berlinFlightBed,
	berlinStationBed,
} from "../src/music-generate-berlin";
import {
	flightBed as legacyFlightBed,
	stationBed as legacyStationBed,
} from "../src/music-generate-legacy";
import {
	schoolFlightBed,
	schoolStationBed,
} from "../src/music-generate-school";
import {
	TECHNO_STYLE_NAMES,
	technoFlightBed,
	technoStationBed,
} from "../src/music-generate-techno";
import {
	MUSIC_VOICE_CAP,
	type PartSpec,
	type SampleBank,
	type Song,
} from "../src/music-score";
import { resolvePart, VoiceBank } from "../src/music-voices";

const SR = 48000;
const BLOCK = 128;

function soundingAfterEachBlockOfATour(
	flight: Song,
	station: Song,
	countOnly: boolean,
): number[] {
	const e = new MusicEngine(SR, MUSIC_VOICE_CAP, undefined, { countOnly });
	const barFrames = (4 * 60 * SR) / flight.tempo[0].bpm;
	const moves: [number, Parameters<MusicEngine["command"]>[0]][] = [];
	let at = 0;
	moves.push([at, { type: "load", id: "flight", song: flight }]);
	moves.push([at, { type: "load", id: "station", song: station }]);
	for (const s of flight.sections) {
		moves.push([
			at,
			at === 0
				? { type: "play", id: "flight", section: s.name, at: "bar", hold: true }
				: { type: "jump", section: s.name, at: "bar", hold: true },
		]);
		at += Math.round(1.5 * barFrames);
	}
	moves.push([
		at,
		{ type: "crossfade", to: "station", at: "bar", fadeS: 1, hold: true },
	]);
	at += Math.round(1.5 * barFrames);
	moves.push([at, { type: "stop", at: "now", fadeS: 1 }]);
	const end = at + 3 * SR;
	const L = new Float32Array(BLOCK);
	const R = new Float32Array(BLOCK);
	const trace: number[] = [];
	let next = 0;
	for (let f = 0; f < end; f += BLOCK) {
		while (next < moves.length && moves[next][0] <= f)
			e.command(moves[next++][1], f);
		e.render(L, f, R);
		trace.push(e.sounding);
	}
	return trace;
}

function firstDifference(a: readonly number[], b: readonly number[]): number {
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
	return -1;
}

const GENERATORS: [string, Song, Song][] = [
	["current", currentFlightBed(1234, 0), currentStationBed(1234, "trade", 0)],
	["legacy", legacyFlightBed(1234, 0), legacyStationBed(1234, "trade", 0)],
	["school", schoolFlightBed(1234, 0), schoolStationBed(1234, "refinery", 0)],
	["berlin", berlinFlightBed(99, 0), berlinStationBed(99, "shipyard", 0)],
	...TECHNO_STYLE_NAMES.map((s): [string, Song, Song] => [
		`techno ${s}`,
		technoFlightBed(1234, 0, s),
		technoStationBed(1234, "outpost", 0),
	]),
	...(Object.keys(DANUBE_VOICINGS) as (keyof typeof DANUBE_VOICINGS)[]).map(
		(v): [string, Song, Song] => [
			`danube ${v}`,
			danubeSong(v),
			schoolStationBed(1234, "trade", 0),
		],
	),
];

describe("count-only mode holds the voices a full render holds", () => {
	for (const [name, flight, station] of GENERATORS)
		test(`${name}: the same count after every block`, () => {
			const full = soundingAfterEachBlockOfATour(flight, station, false);
			const counted = soundingAfterEachBlockOfATour(flight, station, true);
			expect(counted.length).toBe(full.length);
			expect(Math.max(...full)).toBeGreaterThan(0);
			expect(full.at(-1)).toBe(0);
			expect(firstDifference(full, counted)).toBe(-1);
		}, 20000);
});

const sine = (seconds: number) =>
	Int16Array.from({ length: Math.round(seconds * SR) }, (_, i) =>
		Math.round(16000 * Math.sin((2 * Math.PI * 220 * i) / SR)),
	);

const shortBank = (): SampleBank => ({
	rate: SR,
	gain: 1,
	layers: [
		{ maxVelocity: 1, zones: [{ root: 57, scale: 1, data: sine(0.1) }] },
	],
});

const sampler = (over: Partial<PartSpec> = {}) =>
	resolvePart({ voice: "sampler", samples: "short", level: 1, ...over }, SR);

describe("a recording that runs out frees its voice in count-only mode too", () => {
	const trace = (countOnly: boolean) => {
		const b = new VoiceBank(4, SR, { countOnly });
		b.addSamples("short", shortBank());
		b.noteOn(0, sampler(), 0, 0, 57, 1, SR);
		b.noteOn(SR / 20, sampler(), 0, 0, 69, 1, SR);
		const out = new Float32Array(BLOCK);
		const counts: number[] = [];
		for (let f = 0; f < SR / 2; f += BLOCK) {
			b.render(out, f, { gain: () => 1 });
			counts.push(b.sounding);
		}
		return counts;
	};
	test("the same count after every block, and both notes end early", () => {
		const full = trace(false);
		const counted = trace(true);
		expect(firstDifference(full, counted)).toBe(-1);
		expect(Math.max(...full)).toBe(2);
		expect(full.at(-1)).toBe(0);
	});
});

describe("count-only mode writes no sample", () => {
	test("the engine leaves both channels as it found them", () => {
		const e = new MusicEngine(SR, MUSIC_VOICE_CAP, undefined, {
			countOnly: true,
		});
		const song = schoolFlightBed(1234, 0);
		e.command({ type: "load", id: "s", song }, 0);
		e.command({ type: "play", id: "s", at: "bar", hold: true }, 0);
		const L = new Float32Array(BLOCK).fill(7);
		const R = new Float32Array(BLOCK).fill(7);
		let held = 0;
		for (let f = 0; f < 4 * SR; f += BLOCK) {
			e.render(L, f, R);
			held = Math.max(held, e.sounding);
		}
		expect(held).toBeGreaterThan(0);
		expect(L.every((x) => x === 7)).toBe(true);
		expect(R.every((x) => x === 7)).toBe(true);
	});
	test("the bank leaves its buffer as it found it", () => {
		const b = new VoiceBank(4, SR, { countOnly: true });
		b.addSamples("short", shortBank());
		b.noteOn(0, sampler(), 0, 0, 57, 1, SR);
		b.noteOn(
			0,
			resolvePart({ voice: "analog", level: 1 }, SR),
			0,
			1,
			60,
			1,
			SR,
		);
		const out = new Float32Array(BLOCK).fill(7);
		b.render(out, 0, { gain: () => 1 });
		expect(b.sounding).toBe(2);
		expect(out.every((x) => x === 7)).toBe(true);
	});
	test("the worklet builds its one engine from a rate and a cap, and no mode", () => {
		const src = readFileSync(
			new URL("../src/music-worklet.ts", import.meta.url),
			"utf8",
		);
		const calls = src.split("new MusicEngine(");
		expect(calls.length).toBe(2);
		let depth = 0;
		let args = 1;
		let end = 0;
		for (const ch of calls[1]) {
			end++;
			if (ch === "(" || ch === "{" || ch === "[") depth++;
			else if (ch === ")" || ch === "}" || ch === "]") {
				if (depth === 0) break;
				depth--;
			} else if (ch === "," && depth === 0) args++;
		}
		const list = calls[1].slice(0, end - 1).trim();
		expect(list.endsWith(",") ? args - 1 : args).toBe(2);
		expect(list.split(",")[0].trim()).toBe("sampleRate");
		expect(src).not.toContain("RenderMode");
		expect(src).not.toContain("countOnly");
	});
});
