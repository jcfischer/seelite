import { describe, expect, test } from "bun:test";
import { MusicEngine } from "../src/music-engine";
import { flightBed, stationBed } from "../src/music-generate";
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
	technoFlightBed,
	technoStationBed,
} from "../src/music-generate-techno";
import type { Song } from "../src/music-score";
import { beatSeconds, bpmAt, compileSong } from "../src/music-sequencer";

const RATES = [16000, 22050, 24000, 44100, 48000];

const BEDS = {
	legacy: [legacyFlightBed, legacyStationBed],
	second: [flightBed, stationBed],
	berlin: [berlinFlightBed, berlinStationBed],
	school: [schoolFlightBed, schoolStationBed],
	techno: [technoFlightBed, technoStationBed],
} as const;

const peakOf = (
	song: Song,
	section: string,
	sr: number,
	fromS: number,
	toS: number,
) => {
	const e = new MusicEngine(sr, 16);
	e.command({ type: "load", id: "s", song }, 0);
	e.command({ type: "play", id: "s", at: "bar", section, hold: true }, 0);
	const L = new Float32Array(128);
	const R = new Float32Array(128);
	let peak = 0;
	for (let f = 0; f < toS * sr; f += 128) {
		e.render(L, f, R);
		if (f < fromS * sr) continue;
		for (let i = 0; i < 128; i++)
			peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
		if (!(peak < 1)) return peak;
	}
	return peak;
};

const sectionWindow = (song: Song, section: string) => {
	const compiled = compileSong(song);
	const s = compiled.sections[compiled.sectionIndex(section)];
	let durationS = 0;
	for (let bar = s.scoreBar; bar < s.scoreBar + s.bars; bar++)
		durationS += beatSeconds(
			bpmAt(song.tempo, bar, false),
			bpmAt(song.tempo, bar, true),
			song.beatsPerBar,
			song.beatsPerBar,
		);
	const parts = Object.values(song.parts);
	const sweepS = Math.max(
		0,
		...parts.flatMap((part) => [part.sweepS ?? 0, part.phaserS ?? 0]),
	);
	const tailS = Math.max(0, ...parts.map((part) => part.releaseS ?? 0));
	return Math.max(durationS, sweepS) + tailS;
};

describe("every bed at the rates a device may run", () => {
	for (const [bed, [flight, station]] of Object.entries(BEDS))
		for (const sr of RATES)
			test(`${bed} stays finite and under full scale at ${sr} Hz`, () => {
				const loud: string[] = [];
				for (const [kind, song] of [
					["flight", flight(1234, 0)],
					["station", station(1234, "trade", 0)],
				] as const)
					for (const s of song.sections) {
						const p = peakOf(song, s.name, sr, 0, sectionWindow(song, s.name));
						if (!(p < 1)) loud.push(`${kind} ${s.name}: ${p}`);
					}
				expect(loud).toEqual([]);
			}, 300_000);

	test("the school bed's calm holds at 24 kHz to the end of its sweeps", () => {
		const loud: string[] = [];
		for (const seed of [1234, 987654, 42, 7, 31337, 2024]) {
			const p = peakOf(schoolFlightBed(seed, 0), "calm", 24000, 40, 100);
			if (!(p < 1)) loud.push(`${seed}: ${p}`);
		}
		expect(loud).toEqual([]);
	}, 60_000);
});
