/**
 * The generative bed (#548 D5, D7, D8): a system's seed gives it a theme —
 * tonic, bright mode, tempo, palette — and a variant draws the notes. Every
 * figure here is arithmetic on the score, so it is held headless; how it
 * sounds is the principal's ear.
 */
import { describe, expect, test } from "bun:test";
import {
	FLIGHT_LEVELS,
	flightBed,
	LEVEL_MODE,
	MODES,
	musicTheme,
	STATION_ROLES,
	stationBed,
} from "../src/music-generate-legacy";
import type { Song } from "../src/music-score";
import { compileSong } from "../src/music-sequencer";

const SEEDS = Array.from({ length: 64 }, (_, i) => (i * 2654435761) >>> 0);

const section = (song: Song, name: string) => {
	const s = song.sections.find((x) => x.name === name);
	if (!s) throw new Error(`no section ${name}`);
	return s;
};
const partsIn = (song: Song, name: string) =>
	new Set(section(song, name).events.map((e) => e.part));

describe("a system's theme", () => {
	test("the same seed and variant write the same score", () => {
		for (const seed of SEEDS.slice(0, 8))
			expect(flightBed(seed, 3)).toEqual(flightBed(seed, 3));
	});

	test("seeds spread over tonics and bright modes", () => {
		const themes = SEEDS.map(musicTheme);
		expect(new Set(themes.map((t) => t.tonic)).size).toBeGreaterThanOrEqual(10);
		expect(new Set(themes.map((t) => t.calmMode)).size).toBe(4);
	});

	test("a variant moves the notes and keeps the theme", () => {
		const seed = SEEDS[5];
		const a = flightBed(seed, 0);
		const b = flightBed(seed, 1);
		expect(a.parts).toEqual(b.parts);
		expect(a.tempo).toEqual(b.tempo);
		expect(section(a, "calm").events).not.toEqual(section(b, "calm").events);
	});
});

describe("the flight bed", () => {
	test("every seed and variant compiles, one section per level", () => {
		for (const seed of SEEDS)
			for (const v of [0, 1, 7]) {
				const song = flightBed(seed, v);
				expect(() => compileSong(song)).not.toThrow();
				expect(song.sections.map((s) => s.name)).toEqual([...FLIGHT_LEVELS]);
			}
	});

	test("each level's notes sit in its mode, on the system's one tonic", () => {
		for (const seed of SEEDS) {
			const theme = musicTheme(seed);
			const song = flightBed(seed, 0);
			for (const level of FLIGHT_LEVELS) {
				const mode = level === "calm" ? theme.calmMode : LEVEL_MODE[level];
				const allowed = new Set(MODES[mode].map((i) => (theme.tonic + i) % 12));
				for (const e of section(song, level).events) {
					if (e.part === "kick" || e.part === "hat") continue;
					expect(allowed.has(((Math.round(e.pitch) % 12) + 12) % 12)).toBe(
						true,
					);
				}
			}
		}
	});

	test("the mode darkens with the level: fewer major degrees", () => {
		const major = (m: readonly number[]) =>
			[4, 9, 11].filter((i) => m.includes(i)).length;
		const bright = Math.min(
			...["lydian", "ionian", "mixolydian", "dorian"].map((m) =>
				major(MODES[m as keyof typeof MODES]),
			),
		);
		expect(major(MODES[LEVEL_MODE.wary])).toBeLessThan(bright);
		expect(major(MODES[LEVEL_MODE.combat])).toBeLessThanOrEqual(
			major(MODES[LEVEL_MODE.wary]),
		);
	});

	test("tempo rises with the level", () => {
		for (const seed of SEEDS.slice(0, 16)) {
			const song = flightBed(seed, 0);
			const bpm = FLIGHT_LEVELS.map((name) => {
				let bar = 0;
				for (const s of song.sections) {
					if (s.name === name) break;
					bar += s.bars;
				}
				const points = song.tempo.filter((p) => p.bar <= bar);
				return points[points.length - 1].bpm;
			});
			for (let i = 1; i < bpm.length; i++)
				expect(bpm[i]).toBeGreaterThanOrEqual(bpm[i - 1]);
			expect(bpm[3]).toBeGreaterThan(bpm[0]);
		}
	});

	test("stems enter with the level, and the travel stem is in every one", () => {
		const song = flightBed(SEEDS[9], 0);
		const calm = partsIn(song, "calm");
		for (const p of ["pulse", "lead", "kick", "hat"])
			expect(calm.has(p)).toBe(false);
		expect(partsIn(song, "wary").has("pulse")).toBe(true);
		expect(partsIn(song, "threat").has("lead")).toBe(true);
		const combat = partsIn(song, "combat");
		for (const p of ["pulse", "lead", "kick", "hat"])
			expect(combat.has(p)).toBe(true);
		for (const level of FLIGHT_LEVELS)
			expect(partsIn(song, level).has("arp")).toBe(true);
	});
});

describe("the station bed", () => {
	test("every role compiles, in the system's key and bright mode", () => {
		for (const seed of SEEDS.slice(0, 16)) {
			const theme = musicTheme(seed);
			const allowed = new Set(
				MODES[theme.calmMode].map((i) => (theme.tonic + i) % 12),
			);
			for (const role of STATION_ROLES) {
				const song = stationBed(seed, role, 0);
				expect(() => compileSong(song)).not.toThrow();
				for (const s of song.sections)
					for (const e of s.events)
						expect(allowed.has(((Math.round(e.pitch) % 12) + 12) % 12)).toBe(
							true,
						);
			}
		}
	});

	test("it is calmer than flight: slower, with no pulse or drums", () => {
		const seed = SEEDS[3];
		const flightBpm = flightBed(seed, 0).tempo[0].bpm;
		for (const role of STATION_ROLES) {
			const song = stationBed(seed, role, 0);
			expect(song.tempo[0].bpm).toBeLessThan(flightBpm);
			const parts = new Set(
				song.sections.flatMap((s) => s.events.map((e) => e.part)),
			);
			for (const p of ["pulse", "kick", "hat", "lead"])
				expect(parts.has(p)).toBe(false);
		}
	});

	test("the role changes the texture", () => {
		const seed = SEEDS[3];
		const [a, ...rest] = STATION_ROLES.map((r) => stationBed(seed, r, 0));
		for (const b of rest) expect(b.parts).not.toEqual(a.parts);
	});
});
