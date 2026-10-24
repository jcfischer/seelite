import { describe, expect, test } from "bun:test";
import { CRUISE_TEMPO, musicArms, REFRESH_S } from "../src/music-director";
import { MusicEngine } from "../src/music-engine";
import { MODES, musicTheme, STATION_ROLES } from "../src/music-generate";
import { berlinFlightBed } from "../src/music-generate-berlin";
import {
	anchorGrowth,
	CALM_FORM_NAMES,
	type CalmForm,
	calmSpans,
	SCHOOL_CALM_S,
	SCHOOL_SPACE,
	schoolBpm,
	schoolCalmBars,
	schoolForm,
	schoolFlightBed,
	schoolStationBed,
	schoolTune,
} from "../src/music-generate-school";
import { DRIVE_SHAPES, MODALS, stepDegree } from "../src/music-school-patterns";
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

	const LEAD: Record<string, string> = {
		mirage: "mirage",
		breathing: "breathA",
		canopy: "canopy",
		modal: "modal",
		mantra: "mantra",
		drive: "drive",
	};

	for (const form of CALM_FORM_NAMES)
		test(`the ${form} form plays each type only inside its spans`, () => {
			const song = schoolFlightBed(1234, 0, form);
			const spans = calmSpans(form, section(song, "calm").bars);
			for (const type of new Set(spans.map(([t]) => t))) {
				const own = spans.filter(([t]) => t === type);
				const bars = barsOf(song, "calm", LEAD[type]);
				for (const [, from] of own)
					expect(bars.has(from + (type === "drive" ? 2 : 0)), type).toBe(true);
				for (const b of bars)
					expect(
						own.some(([, from, to]) => b >= from && b < to),
						`${type} at bar ${b}`,
					).toBe(true);
			}
		});

	test("systems spread across the calm forms", () => {
		const seeds = Array.from({ length: 60 }, (_, i) => (i * 2654435761) >>> 0);
		const forms = new Set(seeds.map((seed) => schoolTune(seed).form));
		expect(forms.size).toBe(CALM_FORM_NAMES.length);
	});

	test("the drive runs its five steps unbroken across the bar", () => {
		const seed = 1234;
		const shape = schoolTune(seed).drive;
		expect(DRIVE_SHAPES).toContainEqual(shape);
		const n = shape.length;
		const notes = section(schoolFlightBed(seed, 0, "drive"), "calm")
			.events.filter((e) => e.part === "drive" && e.bar >= 4 && e.bar < 8)
			.sort((x, y) => x.bar * 4 + x.beat - (y.bar * 4 + y.beat));
		expect(notes.length).toBe(64);
		const root = notes[0].pitch - shape[(2 * 16) % n];
		notes.forEach((e, i) =>
			expect(e.pitch - root).toBe(shape[(2 * 16 + i) % n]),
		);
	});

	test("the drive's strings are minor triads, phased", () => {
		const song = schoolFlightBed(1234, 0, "drive");
		expect(song.parts.phased.phaser ?? 0).toBeGreaterThan(0);
		const byStart = new Map<number, number[]>();
		for (const e of section(song, "calm").events)
			if (e.part === "phased") {
				const t = e.bar * 4 + e.beat;
				byStart.set(t, [...(byStart.get(t) ?? []), e.pitch]);
			}
		expect(byStart.size).toBeGreaterThan(0);
		for (const pitches of byStart.values()) {
			const [r, ...rest] = [...pitches].sort((x, y) => x - y);
			expect(rest.map((p) => p - r)).toEqual([3, 7, 12]);
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
		const song = schoolFlightBed(1234, 0, "voyage");
		const [, modalFrom, modalTo] = calmSpans(
			"voyage",
			section(song, "calm").bars,
		)[3];
		const tonic = musicTheme(1234).tonic;
		const thirds = new Set(
			section(song, "calm")
				.events.filter(
					(e) => e.part === "choir" && e.bar >= modalFrom && e.bar < modalTo,
				)
				.map((e) => (((e.pitch - tonic) % 12) + 12) % 12)
				.filter((pc) => pc === 3 || pc === 4),
		);
		expect([...thirds].sort()).toEqual([3, 4]);
	});

	test("calm outlasts the refresh, even at the cruise lift", () => {
		for (const seed of SEEDS) {
			const bpm = schoolBpm(musicTheme(seed)) * CRUISE_TEMPO;
			expect(
				(schoolCalmBars(schoolBpm(musicTheme(seed))) * 240) / bpm,
			).toBeGreaterThanOrEqual(REFRESH_S);
		}
		expect(SCHOOL_CALM_S * (1 / CRUISE_TEMPO)).toBeGreaterThan(REFRESH_S);
	});

	test("each variant is a new form: never the one before it", () => {
		for (const seed of SEEDS) {
			const forms = Array.from({ length: 8 }, (_, v) => schoolForm(seed, v));
			for (let v = 1; v < forms.length; v++)
				expect(forms[v]).not.toBe(forms[v - 1]);
			expect(new Set(forms).size).toBeGreaterThanOrEqual(3);
			expect(schoolTune(seed, undefined, 3).form).toBe(forms[3]);
		}
	});

	test("three variants of a system are three different movements", () => {
		for (const seed of SEEDS) {
			const calms = [0, 1, 2].map((v) =>
				JSON.stringify(section(schoolFlightBed(seed, v), "calm").events),
			);
			expect(new Set(calms).size).toBe(3);
		}
	});

	test("a sequence changes as it plays and comes home", () => {
		const song = schoolFlightBed(1234, 0, "voyage");
		const [, from, to] = calmSpans("voyage", section(song, "calm").bars)[2];
		const canopy = section(song, "calm").events.filter(
			(e) => e.part === "canopy",
		);
		const bars = (a: number) =>
			JSON.stringify(
				canopy
					.filter((e) => e.bar >= a && e.bar < a + 2)
					.map((e) => [e.bar - a, e.beat, e.pitch]),
			);
		expect(to - from).toBeGreaterThanOrEqual(16);
		expect(bars(from + 8)).not.toBe(bars(from));
	});

	test("the pentatonic never leaves its five notes, over any chord", () => {
		for (const mode of [
			"ionian",
			"lydian",
			"mixolydian",
			"dorian",
			"aeolian",
		] as const) {
			const deg = (base: number, d: number) =>
				base + 12 * Math.floor(d / 7) + MODES[mode][((d % 7) + 7) % 7];
			const minor = MODES[mode][2] === 3;
			const allowed = new Set(minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9]);
			for (let root = 0; root < 7; root++)
				for (let d = -5; d < 12; d++) {
					const pc = ((deg(0, stepDegree(deg, true, root, d)) % 12) + 12) % 12;
					expect(allowed.has(pc), `${mode} root ${root} step ${d}`).toBe(true);
				}
		}
	});

	test("the modal pool holds only root, fourth, fifth and octave", () => {
		for (const m of MODALS)
			for (const d of m.steps) expect([0, 3, 4, 7, null]).toContain(d);
	});

	test("hats, a slow kick and the noise wash come and go in calm", () => {
		const seeds = Array.from({ length: 24 }, (_, i) => (i * 2654435761) >>> 0);
		let kicks = 0;
		let washes = 0;
		for (const seed of seeds) {
			const song = schoolFlightBed(seed, 0);
			const calmBars = section(song, "calm").bars;
			const ticks = barsOf(song, "calm", "tick");
			expect(ticks.size).toBeGreaterThan(0);
			expect(ticks.size).toBeLessThan(calmBars);
			if (barsOf(song, "calm", "thud").size > 0) kicks++;
			if (barsOf(song, "calm", "washL").size > 0) washes++;
		}
		expect(kicks).toBeGreaterThan(0);
		expect(kicks).toBeLessThan(seeds.length);
		expect(washes).toBeGreaterThan(0);
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
	const crowd = (song: Song) => {
		const edges = section(song, "calm").events.flatMap((e) => {
			const t = e.bar * 4 + e.beat;
			return [
				[t, 1],
				[t + e.dur + 1, -1],
			] as const;
		});
		edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		let now = 0;
		let most = 0;
		for (const [, d] of edges) most = Math.max(most, (now += d));
		return most;
	};
	const densest = (form: CalmForm) =>
		SEEDS.slice(0, 8)
			.flatMap((seed) => [0, 1].map((v) => schoolFlightBed(seed, v, form)))
			.reduce((a, b) => (crowd(b) > crowd(a) ? b : a));

	for (const form of CALM_FORM_NAMES)
		test(`calm in the ${form} form never reaches it, its most crowded of 16 systems and variants`, () => {
			expect(peakVoices(densest(form), "calm")).toBeLessThan(MUSIC_VOICE_CAP);
		}, 60000);

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
