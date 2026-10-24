import { describe, expect, test } from "bun:test";
import { musicArms } from "../src/music-director";
import { MusicEngine } from "../src/music-engine";
import { MODES, musicTheme, STATION_ROLES } from "../src/music-generate";
import { berlinFlightBed } from "../src/music-generate-berlin";
import {
	anchorGrowth,
	CALM_SPANS,
	SCHOOL_SPACE,
	schoolFlightBed,
	schoolStationBed,
} from "../src/music-generate-school";
import { MUSIC_VOICE_CAP, type Song } from "../src/music-score";
import { compileSong } from "../src/music-sequencer";

const SEEDS = Array.from({ length: 12 }, (_, i) => (i * 2654435761) >>> 0);

const section = (song: Song, name: string) => {
	const s = song.sections.find((x) => x.name === name);
	if (!s) throw new Error(`no section ${name}`);
	return s;
};

const barsOf = (song: Song, name: string, part: string) =>
	new Set(
		section(song, name)
			.events.filter((e) => e.part === part)
			.map((e) => e.bar),
	);

describe("the sequence-school bed", () => {
	test("every flight and station bed compiles", () => {
		for (const seed of SEEDS.slice(0, 6)) {
			expect(() => compileSong(schoolFlightBed(seed, 0))).not.toThrow();
			for (const role of STATION_ROLES)
				expect(() =>
					compileSong(schoolStationBed(seed, role, 1)),
				).not.toThrow();
		}
	});

	test("the same system and variant write the same score", () => {
		expect(schoolFlightBed(77, 2)).toEqual(schoolFlightBed(77, 2));
	});

	test("?music=school selects it", () => {
		expect(musicArms("school").arms.bed).toBe("school");
	});

	test("calm hands each type to the next inside its span", () => {
		const song = schoolFlightBed(1234, 0);
		const spans: [string, readonly [number, number]][] = [
			["mirage", CALM_SPANS.mirage],
			["breathA", CALM_SPANS.breathing],
			["canopy", CALM_SPANS.canopy],
			["modal", CALM_SPANS.modal],
			["mantra", CALM_SPANS.mantra],
		];
		for (const [part, [from, to]] of spans) {
			const bars = barsOf(song, "calm", part);
			expect(bars.has(from), part).toBe(true);
			expect(bars.has(to - 1), part).toBe(true);
			for (const b of bars) {
				expect(b, part).toBeGreaterThanOrEqual(from);
				expect(b, part).toBeLessThan(to);
			}
		}
	});

	test("the modal sequence holds only root, fourth, fifth and octave", () => {
		for (const seed of SEEDS) {
			const tonic = musicTheme(seed).tonic;
			const allowed = new Set(
				[0, 3, 4].map((d) => (tonic + MODES.aeolian[d]) % 12),
			);
			for (const e of section(schoolFlightBed(seed, 0), "calm").events)
				if (e.part === "modal")
					expect(allowed.has(((e.pitch % 12) + 12) % 12)).toBe(true);
		}
	});

	test("the choir turns between major and minor over the modal sequence", () => {
		const song = schoolFlightBed(1234, 0);
		const tonic = musicTheme(1234).tonic;
		const thirds = new Set(
			section(song, "calm")
				.events.filter(
					(e) =>
						e.part === "choir" &&
						e.bar >= CALM_SPANS.modal[0] &&
						e.bar < CALM_SPANS.modal[1],
				)
				.map((e) => (((e.pitch - tonic) % 12) + 12) % 12)
				.filter((pc) => pc === 3 || pc === 4),
		);
		expect([...thirds].sort()).toEqual([3, 4]);
	});

	test("the anchor grows from roots one step at a time", () => {
		const g = anchorGrowth([0, 7, 4, 2, 6], 15, 3);
		expect(g[0]).toEqual([0, 0, 0, 0, 0]);
		expect(g[3]).toEqual([0, 7, 0, 0, 0]);
		expect(g[12]).toEqual([0, 7, 4, 2, 6]);
	});

	test("mirage, breathing and anchor play the moog ladder voice", () => {
		const song = schoolFlightBed(5, 0);
		for (const part of ["mirage", "mirage2", "breathA", "breathB", "anchor"])
			expect(song.parts[part].voice, part).toBe("moog");
	});

	test("combat is the Berlin bed's: its notes, voices and tempo", () => {
		for (const seed of [1234, 5, 99]) {
			const school = schoolFlightBed(seed, 0);
			const berlin = berlinFlightBed(seed, 0);
			const combat = section(school, "combat");
			expect(combat).toEqual(section(berlin, "combat"));
			for (const part of new Set(combat.events.map((e) => e.part)))
				expect(school.parts[part], part).toEqual(berlin.parts[part]);
			expect(school.tempo[3].bpm).toBe(berlin.tempo[3].bpm);
		}
	});

	test("the gallop leans on a dotted-eighth echo", () => {
		const song = schoolFlightBed(5, 0);
		expect(SCHOOL_SPACE.echoBeats).toBe(0.75);
		expect(song.parts.gallop.echo).toBeGreaterThan(0.9);
		expect(barsOf(song, "threat", "gallop").size).toBe(
			section(song, "threat").bars,
		);
	});
});

function peakVoices(
	song: Song,
	from: string,
	jump?: { afterBars: number; to: string },
): number {
	const SR = 48000;
	const e = new MusicEngine(SR);
	e.command({ type: "load", id: "s", song }, 0);
	e.command({ type: "play", id: "s", section: from, at: "bar", hold: true }, 0);
	const i = song.sections.findIndex((x) => x.name === from);
	const barS = (4 * 60) / song.tempo[i].bpm;
	const jumpAt = jump ? Math.round((jump.afterBars + 0.5) * barS * SR) : 0;
	const end = jump
		? jumpAt + 10 * barS * SR
		: section(song, from).bars * barS * SR;
	const L = new Float32Array(128);
	const R = new Float32Array(128);
	let peak = 0;
	let sent = !jump;
	for (let f = 0; f < end; f += 128) {
		if (!sent && jump && f >= jumpAt) {
			e.command({ type: "jump", section: jump.to, at: "bar", hold: true }, f);
			sent = true;
		}
		e.render(L, f, R);
		if (f >= jumpAt) peak = Math.max(peak, e.sounding);
	}
	return peak;
}

describe("the voice cap", () => {
	for (const name of ["calm", "wary", "threat"])
		test(`${name} never reaches it`, () => {
			expect(peakVoices(schoolFlightBed(1234, 0), name)).toBeLessThan(
				MUSIC_VOICE_CAP,
			);
		}, 30000);

	for (const [from, after, to] of [
		["calm", 47, "combat"],
		["wary", 23, "combat"],
		["threat", 15, "combat"],
	] as const)
		test(`a jump from ${from} to ${to} never reaches it`, () => {
			expect(
				peakVoices(schoolFlightBed(1234, 0), from, { afterBars: after, to }),
			).toBeLessThan(MUSIC_VOICE_CAP);
		}, 30000);

	test("a station bed never reaches it", () => {
		for (const role of STATION_ROLES)
			expect(peakVoices(schoolStationBed(1234, role, 0), "bed")).toBeLessThan(
				MUSIC_VOICE_CAP,
			);
	}, 60000);
});
