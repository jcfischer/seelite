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
import { SVF_STABLE, svfLimit, svfStep } from "../src/music-voices";

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
	e.command({ type: "play", id: "s", at: "bar", section }, 0);
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

describe("the state-variable filter", () => {
	test("rings out for every coefficient and damping a voice can ask for", () => {
		const unstable: string[] = [];
		for (const g of [0.05, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2])
			for (const damp of [0.1, 0.5, 1, 1.62, 2]) {
				const lp = new Float64Array(1);
				const bp = new Float64Array(1);
				let peak = 0;
				for (let n = 0; n < 5000; n++) {
					const y = svfStep(lp, bp, 0, g, n === 0 ? 1 : 0, damp, false);
					peak = Math.max(peak, Math.abs(y), Math.abs(bp[0]));
				}
				if (!(peak < 10)) unstable.push(`g ${g} damp ${damp}: ${peak}`);
			}
		expect(unstable).toEqual([]);
	});

	test("the limit sits inside the stability edge and leaves a coefficient below it alone", () => {
		for (const damp of [0.1, 1, 1.62, 2]) {
			const g = svfLimit(damp);
			expect(g * (g + 2 * damp)).toBeCloseTo(SVF_STABLE, 9);
			expect(g * (g + 2 * damp)).toBeLessThan(4);
		}
		const lp = new Float64Array(1);
		const bp = new Float64Array(1);
		svfStep(lp, bp, 0, 0.5, 1, 1, false);
		expect(svfStep(lp, bp, 0, 0.5, 0, 1, false)).toBe(0.25);
	});
});

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
						const p = peakOf(song, s.name, sr, 0, 6);
						if (!(p < 1)) loud.push(`${kind} ${s.name}: ${p}`);
					}
				expect(loud).toEqual([]);
			}, 60_000);

	test("the school bed's calm holds at 24 kHz to the end of its sweeps", () => {
		const loud: string[] = [];
		for (const seed of [1234, 987654, 42, 7, 31337, 2024]) {
			const p = peakOf(schoolFlightBed(seed, 0), "calm", 24000, 40, 100);
			if (!(p < 1)) loud.push(`${seed}: ${p}`);
		}
		expect(loud).toEqual([]);
	}, 60_000);
});
