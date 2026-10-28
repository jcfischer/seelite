import { describe, expect, test } from "bun:test";
import { CRUISE_TEMPO, musicArms, REFRESH_S } from "../src/music-director";
import { MusicEngine } from "../src/music-engine";
import { STATION_ROLES } from "../src/music-generate";
import {
	acidVersions,
	arrange,
	LAYERS,
	TECHNO_STYLE_NAMES,
	TECHNO_STYLES,
	technoBpm,
	technoCalmBars,
	technoFlightBed,
	technoStationBed,
	technoStyle,
	technoTune,
} from "../src/music-generate-techno";
import { MUSIC_VOICE_CAP, type Song } from "../src/music-score";
import { euclid } from "../src/music-techno-patterns";
import { seededRand } from "../src/rng";

const SEEDS = Array.from({ length: 12 }, (_, i) => (i * 2654435761) >>> 0);

const section = (song: Song, name: string) => {
	const s = song.sections.find((x) => x.name === name);
	if (!s) throw new Error(`no section ${name}`);
	return s;
};

describe("the Euclidean rhythm", () => {
	test("three in eight is the tresillo", () => {
		expect(
			euclid(3, 8)
				.map((h) => (h ? "x" : "."))
				.join(""),
		).toBe("x..x..x.");
	});
	test("it spreads k hits over n steps, turned", () => {
		for (const [k, n] of [
			[3, 16],
			[5, 16],
			[7, 16],
			[4, 9],
		])
			for (const r of [0, 3])
				expect(euclid(k, n, r).filter(Boolean).length).toBe(k);
		expect(euclid(5, 16, 1)).not.toEqual(euclid(5, 16, 0));
	});
});

describe("the techno tune", () => {
	test("is the same for the same seed and variant", () => {
		expect(JSON.stringify(technoFlightBed(1234, 1))).toBe(
			JSON.stringify(technoFlightBed(1234, 1)),
		);
	});

	test("500 systems × 3 variants are 1500 different tunes, in every style", () => {
		const tunes = new Set<string>();
		const styles = new Set<string>();
		for (let i = 0; i < 500; i++) {
			const seed = (i * 2654435761) >>> 0;
			for (let v = 0; v < 3; v++) {
				const t = technoTune(seed, v);
				tunes.add(JSON.stringify(t));
				styles.add(t.style);
			}
		}
		expect(tunes.size).toBe(1500);
		expect([...styles].sort()).toEqual([...TECHNO_STYLE_NAMES].sort());
	});

	test("each variant is a new style at the system's tempo", () => {
		for (const seed of SEEDS) {
			for (let v = 1; v < 5; v++)
				expect(technoStyle(seed, v)).not.toBe(technoStyle(seed, v - 1));
			for (let v = 0; v < 5; v++)
				expect(technoTune(seed, v).bpm).toBe(technoBpm(seed));
		}
	});

	test("a forced style plays in its own tempo range", () => {
		for (const style of TECHNO_STYLE_NAMES) {
			const [lo, hi] = TECHNO_STYLES[style].bpm;
			for (const seed of SEEDS) {
				const bpm = technoFlightBed(seed, 0, style).tempo[0].bpm;
				expect(bpm).toBeGreaterThanOrEqual(lo);
				expect(bpm).toBeLessThanOrEqual(hi);
			}
		}
	});

	test("calm outlasts the refresh at the cruise lift", () => {
		for (const seed of SEEDS) {
			const bpm = technoBpm(seed);
			const s = (technoCalmBars(bpm) * 240) / (bpm * CRUISE_TEMPO);
			expect(s).toBeGreaterThan(REFRESH_S);
		}
	});

	test("an acid line changes every version and comes home every fourth", () => {
		const t = technoTune(1234);
		const v = acidVersions(t.acid, seededRand(1), 12, [0, 2, 3, 5, 7, 8, 10]);
		for (let i = 0; i < 12; i++) {
			expect(v[i].length).toBe(16);
			if (i % 4 === 0) expect(v[i]).toEqual([...t.acid]);
			else expect(v[i]).not.toEqual(v[i - 1]);
		}
	});
});

describe("the arrangement", () => {
	const all = new Set(LAYERS);
	test("an intro adds layers, a breakdown drops the kick and the bass, the drop brings them back", () => {
		const plan = arrange(seededRand(7), 13, all, LAYERS, {
			intro: true,
			breakdowns: true,
		});
		expect(plan[0].on.size).toBeLessThan(plan[1].on.size);
		const b = plan.findIndex((p) => p.breakdown);
		expect(b).toBeGreaterThan(0);
		expect(plan[b].on.has("kick")).toBe(false);
		expect(plan[b].on.has("bass")).toBe(false);
		expect(plan[b + 1].on).toEqual(all);
	});

	test("calm opens on the pad, then keeps four on the floor outside its breakdowns and fills", () => {
		for (const seed of SEEDS) {
			const calm = section(technoFlightBed(seed, 0), "calm");
			expect(calm.events.some((e) => e.bar < 8 && e.part === "pad")).toBe(true);
			expect(calm.events.some((e) => e.part === "hat")).toBe(false);
			const kicks = new Set(
				calm.events
					.filter((e) => e.part === "kick")
					.map((e) => e.bar * 4 + e.beat),
			);
			const barsWithKick = new Set([...kicks].map((t) => Math.floor(t / 4)));
			for (const bar of barsWithKick)
				if (bar % 8 !== 7)
					for (let q = 0; q < 4; q++) expect(kicks.has(bar * 4 + q)).toBe(true);
			for (const t of kicks)
				if (Math.floor(t / 4) % 8 !== 7) expect(t % 1).toBe(0);
			expect(barsWithKick.size).toBeLessThan(calm.bars);
			expect(calm.events.some((e) => e.part === "riser")).toBe(true);
		}
	});

	test("the danger rises: wary busier than calm, threat and combat busier than wary, the acid in threat and combat, the ride in combat", () => {
		const perBar = (song: Song, name: string) => {
			const s = section(song, name);
			const at = new Set(
				s.events
					.filter((e) => e.part !== "arp")
					.map((e) => Math.round((e.bar * 4 + e.beat) * 4)),
			);
			return at.size / s.bars;
		};
		for (const seed of SEEDS) {
			const song = technoFlightBed(seed, 0);
			const [calm, wary, threat, combat] = [
				"calm",
				"wary",
				"threat",
				"combat",
			].map((n) => perBar(song, n));
			expect(wary).toBeGreaterThan(calm);
			expect(threat).toBeGreaterThan(wary);
			expect(combat).toBeGreaterThan(wary);
			for (const name of ["threat", "combat"]) {
				const parts = new Set(section(song, name).events.map((e) => e.part));
				expect(parts.has("acid") || parts.has("acidHard")).toBe(true);
			}
			expect(
				section(song, "combat").events.some((e) => e.part === "ride"),
			).toBe(true);
			expect(song.tempo[3].bpm).toBeGreaterThan(song.tempo[0].bpm);
		}
	});
});

describe("the director", () => {
	test("plays techno on ?music=techno and a style on techno-<style>", () => {
		expect(musicArms("techno").arms.bed).toBe("techno");
		for (const s of TECHNO_STYLE_NAMES)
			expect(musicArms(`techno-${s}`).arms.bed).toBe(`techno-${s}`);
	});
});

function peakVoices(song: Song, from: string): number {
	const SR = 48000;
	const e = new MusicEngine(SR, MUSIC_VOICE_CAP, undefined, {
		countOnly: true,
	});
	e.command({ type: "load", id: "s", song }, 0);
	e.command({ type: "play", id: "s", section: from, at: "bar", hold: true }, 0);
	const i = song.sections.findIndex((x) => x.name === from);
	const barS = (4 * 60) / song.tempo[i].bpm;
	const end = Math.min(section(song, from).bars, 48) * barS * SR;
	const L = new Float32Array(128);
	const R = new Float32Array(128);
	let peak = 0;
	for (let f = 0; f < end; f += 128) {
		e.render(L, f, R);
		peak = Math.max(peak, e.sounding);
	}
	return peak;
}

describe("the voice cap", () => {
	for (const style of TECHNO_STYLE_NAMES)
		test(`${style}: every level stays below it`, () => {
			const song = technoFlightBed(1234, 0, style);
			for (const name of ["calm", "wary", "threat", "combat"])
				expect(peakVoices(song, name)).toBeLessThan(MUSIC_VOICE_CAP);
		}, 120000);

	test("a station bed stays below it", () => {
		for (const role of STATION_ROLES)
			expect(peakVoices(technoStationBed(1234, role, 0), "bed")).toBeLessThan(
				MUSIC_VOICE_CAP,
			);
	}, 60000);
});
