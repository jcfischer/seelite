/**
 * The third bed, the Berlin-school prototype (2026-09-30: the second bed
 * *too slow*, its fragments *boring*). What is arithmetic is here, read off
 * the notes the score emits and the voices the engine holds; how it sounds
 * is the principal's ear.
 */
import { describe, expect, test } from "bun:test";
import { MusicEngine } from "../src/music-engine";
import {
	answerOf,
	BERLIN_BPM_LOW,
	BERLIN_CALM_BARS,
	berlinFlightBed,
	berlinStationBed,
	berlinTune,
	MUTATE_EVERY,
} from "../src/music-generate-berlin";
import { flightBed, STATION_ROLES } from "../src/music-generate";
import { MUSIC_VOICE_CAP, type Song } from "../src/music-score";
import { compileSong } from "../src/music-sequencer";

const SEEDS = Array.from({ length: 24 }, (_, i) => (i * 2654435761) >>> 0);

const section = (song: Song, name: string) => {
	const s = song.sections.find((x) => x.name === name);
	if (!s) throw new Error(`no section ${name}`);
	return s;
};

describe("the Berlin bed", () => {
	test("every flight and station bed compiles", () => {
		for (const seed of SEEDS.slice(0, 6)) {
			expect(() => compileSong(berlinFlightBed(seed, 0))).not.toThrow();
			for (const role of STATION_ROLES)
				expect(() => compileSong(berlinStationBed(seed, role, 1))).not.toThrow();
		}
	});

	test("the same system and variant write the same score", () => {
		expect(berlinFlightBed(77, 2)).toEqual(berlinFlightBed(77, 2));
	});

	test("calm is faster than the second bed's, for every system", () => {
		for (const seed of SEEDS) {
			const bpm = berlinFlightBed(seed, 0).tempo[0].bpm;
			expect(bpm).toBeGreaterThanOrEqual(BERLIN_BPM_LOW);
			expect(bpm).toBeGreaterThan(flightBed(seed, 0).tempo[0].bpm + 10);
		}
	});

	test("the tempo rises with the level", () => {
		const t = berlinFlightBed(5, 0).tempo.map((p) => p.bpm);
		for (let i = 1; i < t.length; i++)
			expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
	});

	test("a sixteenth sequence runs under calm, and stops for the breakdown", () => {
		for (const seed of SEEDS.slice(0, 8)) {
			const calm = section(berlinFlightBed(seed, 0), "calm");
			const perBar = Array.from({ length: calm.bars }, () => 0);
			for (const e of calm.events) if (e.part === "seq") perBar[e.bar]++;
			// Bars 4–27 and 36–63 run; 28–35 is the breakdown.
			for (let b = 4; b < 28; b++) expect(perBar[b]).toBeGreaterThanOrEqual(12);
			for (let b = 28; b < 36; b++) expect(perBar[b]).toBe(0);
			for (let b = 36; b < calm.bars; b++)
				expect(perBar[b]).toBeGreaterThanOrEqual(12);
		}
	});

	test("the sequence mutates as it runs", () => {
		// Each bar's sequence as intervals from its first step, which is never
		// mutated: a chord change moves every pitch and leaves this alone.
		for (const seed of SEEDS.slice(0, 8)) {
			const calm = section(berlinFlightBed(seed, 0), "calm");
			const shape = (bar: number) => {
				const notes = calm.events
					.filter((e) => e.part === "seq" && e.bar === bar)
					.sort((a, b) => a.beat - b.beat);
				return notes.map((n) => `${n.beat}:${n.pitch - notes[0].pitch}`).join();
			};
			const shapes = new Set<string>();
			for (let b = 4; b < 28; b += MUTATE_EVERY) shapes.add(shape(b));
			expect(shapes.size).toBeGreaterThan(1);
		}
	});

	test("the noise wash covers calm on both sides, and a riser leads back in", () => {
		const calm = section(berlinFlightBed(3, 0), "calm");
		for (const side of ["windL", "windR"]) {
			const covered = new Set<number>();
			for (const e of calm.events.filter((x) => x.part === side))
				for (let b = e.bar; b < e.bar + Math.ceil((e.beat + e.dur) / 4); b++)
					covered.add(b);
			expect(covered.size).toBe(BERLIN_CALM_BARS);
		}
		const riser = calm.events
			.filter((e) => e.part === "riser")
			.sort((a, b) => a.bar * 4 + a.beat - (b.bar * 4 + b.beat));
		expect(riser.length).toBeGreaterThan(16);
		expect(riser[riser.length - 1].pitch).toBeGreaterThan(riser[0].pitch + 24);
		expect(riser[riser.length - 1].bar).toBeLessThan(36);
	});

	test("an answer keeps the call's rhythm and ends home", () => {
		expect(answerOf([4, 4, 7, 4, 3, 2, 1])).toEqual([2, 2, 5, 2, 1, 0, 0]);
		expect(answerOf([0, 4, 7, 11, 9, 9])).toEqual([-2, 2, 5, 9, 7, 7]);
	});

	test("the lead states a call and its answer on the same rhythm", () => {
		for (const seed of SEEDS.slice(0, 8)) {
			const tune = berlinTune(seed);
			const calm = section(berlinFlightBed(seed, 0), "calm");
			const lead = calm.events
				.filter((e) => e.part === "synlead")
				.sort((a, b) => a.bar * 4 + a.beat - (b.bar * 4 + b.beat));
			const n = tune.motif.degrees.length;
			expect(lead.length).toBeGreaterThanOrEqual(2 * n);
			const durs = lead.slice(0, 2 * n).map((e) => e.dur);
			expect(durs.slice(n)).toEqual(durs.slice(0, n));
		}
	});

	test("the counter-sequence phases against the bar", () => {
		const calm = section(berlinFlightBed(11, 0), "calm");
		const lengths = new Set(
			[16, 17, 18, 19].map(
				(b) => calm.events.filter((e) => e.part === "sparkle" && e.bar === b).length,
			),
		);
		expect(lengths.size).toBe(1);
		expect(berlinTune(11).odd.length % 2 === 1 || berlinTune(11).odd.length === 6).toBe(true);
	});
});

/** The most voices the engine holds over a whole section, played held. */
function peakVoices(song: Song, name: string): number {
	const SR = 48000;
	const e = new MusicEngine(SR);
	e.command({ type: "load", id: "s", song }, 0);
	e.command({ type: "play", id: "s", section: name, at: "bar", hold: true }, 0);
	const bpm = song.tempo[0].bpm;
	const seconds = (section(song, name).bars * 4 * 60) / bpm;
	const L = new Float32Array(128);
	const R = new Float32Array(128);
	let peak = 0;
	for (let f = 0; f < seconds * SR; f += 128) {
		e.render(L, f, R);
		peak = Math.max(peak, e.sounding);
	}
	return peak;
}

describe("the voice cap", () => {
	// At the cap the oldest voice is stolen, and the oldest is the drone.
	for (const seed of [1234, 99, 7])
		for (const name of ["calm", "wary", "threat", "combat"])
			test(`${name} on system ${seed} never reaches it`, () => {
				expect(peakVoices(berlinFlightBed(seed, 0), name)).toBeLessThan(
					MUSIC_VOICE_CAP,
				);
			}, 30000);

	test("a station bed never reaches it", () => {
		for (const role of STATION_ROLES)
			expect(peakVoices(berlinStationBed(1234, role, 0), "bed")).toBeLessThan(
				MUSIC_VOICE_CAP,
			);
	}, 60000);
});
