/**
 * The generative bed, second form (#548 D12, after the principal's first
 * listening: *super boring*): authored fragments a system's seed picks and
 * develops, in long sections whose layers run on co-prime cycles.
 *
 * Every row reads the **notes the score emits**, never the generator's own
 * choices: a row that asked the generator which motif it picked would pass
 * whatever it wrote. How it sounds is the principal's ear.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	CALM_BARS,
	CALM_LIFT_BPM,
	FLIGHT_LEVELS,
	flightBed,
	MODES,
	musicTheme,
	STATION_BARS,
	STATION_ROLES,
	stationBed,
} from "../src/music-generate";
import type { NoteEvent, Song } from "../src/music-score";
import { compileSong } from "../src/music-sequencer";
import { repoPath } from "./lib/source-scan";

const SEEDS = Array.from({ length: 48 }, (_, i) => (i * 2654435761) >>> 0);
const UNPITCHED = new Set(["kick", "hat", "snare"]);

const section = (song: Song, name: string) => {
	const s = song.sections.find((x) => x.name === name);
	if (!s) throw new Error(`no section ${name}`);
	return s;
};
const pc = (pitch: number) => ((Math.round(pitch) % 12) + 12) % 12;

/** Each bar's **pattern** — which parts play, on which beats, how long —
 *  with the pitch left out, and the cruise stem too. A chord change moves
 *  every pitch and leaves the pattern; a bed that repeats its pattern is the
 *  loop the principal heard, whatever key it is in. */
const barPrints = (events: readonly NoteEvent[], bars: number) => {
	const out: string[][] = Array.from({ length: bars }, () => []);
	for (const e of events)
		if (e.part !== "arp") out[e.bar].push(`${e.part}@${e.beat}/${e.dur}`);
	return out.map((b) => b.sort().join(" "));
};

/** The shortest period after which every bar repeats, up to `max`; 0 if none. */
const loopPeriod = (prints: readonly string[], max: number) => {
	for (let p = 1; p <= max; p++) {
		let same = true;
		for (let b = 0; b + p < prints.length && same; b++)
			same = prints[b] === prints[b + p];
		if (same) return p;
	}
	return 0;
};

/** A motif voice's statements: its notes grouped where a gap of two beats or more
 *  separates them. */
const statements = (
	events: readonly NoteEvent[],
	part: string,
	beatsPerBar: number,
) => {
	const notes = events
		.filter((e) => e.part === part)
		.map((e) => ({
			at: e.bar * beatsPerBar + e.beat,
			end: e.bar * beatsPerBar + e.beat + e.dur,
			pitch: e.pitch,
		}))
		.sort((a, b) => a.at - b.at);
	const groups: number[][] = [];
	let last = Number.NEGATIVE_INFINITY;
	for (const n of notes) {
		if (n.at - last >= 2 || groups.length === 0) groups.push([]);
		groups[groups.length - 1].push(n.pitch);
		last = n.end;
	}
	return groups;
};
/** The up/down shape of a statement: +1, -1 or 0 per step. */
const contour = (pitches: readonly number[]) =>
	pitches.slice(1).map((p, i) => Math.sign(p - pitches[i]));

describe("the flight bed", () => {
	test("the same seed and variant write the same score; a variant moves the notes", () => {
		expect(flightBed(SEEDS[3], 2)).toEqual(flightBed(SEEDS[3], 2));
		const a = flightBed(SEEDS[3], 0);
		const b = flightBed(SEEDS[3], 1);
		expect(a.parts).toEqual(b.parts);
		expect(a.tempo).toEqual(b.tempo);
		expect(section(a, "calm").events).not.toEqual(section(b, "calm").events);
	});

	test("every seed and variant compiles, one section per level, the cruise stem in each", () => {
		for (const seed of SEEDS)
			for (const v of [0, 3]) {
				const song = flightBed(seed, v);
				expect(() => compileSong(song)).not.toThrow();
				expect(song.sections.map((s) => s.name)).toEqual([...FLIGHT_LEVELS]);
				for (const s of song.sections)
					expect(s.events.some((e) => e.part === "arp")).toBe(true);
			}
	});

	test("a bed stays cheap to compile: few enough notes for one quantum's slack", () => {
		// A refresh loads a whole bed while music plays, against a 2.67 ms
		// quantum. Re-measured in sage round 1, bun on the principal's machine:
		// at most 3274 notes over these seeds, compiled in a median 0.25 ms
		// (p90 0.65, 200 runs). No row times it: a wall clock on CI is noise.
		for (const seed of SEEDS.slice(0, 8)) {
			const n = flightBed(seed, 0).sections.reduce(
				(k, s) => k + s.events.length,
				0,
			);
			expect(n).toBeLessThan(3500);
		}
	});
});

describe("calm (D12)", () => {
	test("is long, and does not loop inside itself", () => {
		for (const seed of SEEDS.slice(0, 16)) {
			const calm = section(flightBed(seed, 0), "calm");
			expect(calm.bars).toBe(CALM_BARS);
			expect(CALM_BARS).toBeGreaterThanOrEqual(48);
			expect(loopPeriod(barPrints(calm.events, calm.bars), 16)).toBe(0);
		}
	});

	test("every pitch is in the system's bright mode, on its tonic", () => {
		for (const seed of SEEDS) {
			const t = musicTheme(seed);
			const allowed = new Set(MODES[t.calmMode].map((i) => (t.tonic + i) % 12));
			for (const e of section(flightBed(seed, 0), "calm").events)
				if (!UNPITCHED.has(e.part)) expect(allowed.has(pc(e.pitch))).toBe(true);
		}
	});

	test("the system's motif returns, developed: one shape, stated several ways", () => {
		for (const seed of SEEDS.slice(0, 16)) {
			const song = flightBed(seed, 0);
			const calm = section(song, "calm");
			const motifVoice = ["keys", "bell", "lead"].find((p) =>
				calm.events.some((e) => e.part === p && e.pitch >= 60),
			);
			expect(motifVoice).toBeDefined();
			const st = statements(
				calm.events,
				motifVoice as string,
				song.beatsPerBar,
			).filter((s) => s.length >= 3);
			expect(st.length).toBeGreaterThanOrEqual(5);
			const shape = contour(st[0]).join();
			const flipped = contour(st[0])
				.map((x) => -x)
				.join();
			const backward = contour([...st[0]].reverse()).join();
			const kin = st.filter((s) =>
				[shape, flipped, backward].includes(contour(s).join()),
			);
			// The shape returns in three statements or more ...
			expect(kin.length).toBeGreaterThanOrEqual(3);
			// ... and not always the same way: at least two distinct statements.
			expect(new Set(st.map((s) => s.join())).size).toBeGreaterThanOrEqual(2);
		}
	});

	test("the section ends on the dominant, leaning back into its top", () => {
		for (const seed of SEEDS.slice(0, 16)) {
			const t = musicTheme(seed);
			const calm = section(flightBed(seed, 0), "calm");
			const last = calm.events.filter(
				(e) => e.part === "drone" && e.bar >= calm.bars - 8,
			);
			const low = Math.min(...last.map((e) => e.pitch));
			expect(pc(low)).toBe((t.tonic + MODES[t.calmMode][4]) % 12);
			const first = calm.events.filter(
				(e) => e.part === "drone" && e.bar === 0,
			);
			expect(pc(Math.min(...first.map((e) => e.pitch)))).toBe(t.tonic);
		}
	});
});

describe("the station bed", () => {
	test("every role compiles, long and unlooped, in the system's key and bright mode", () => {
		for (const seed of SEEDS.slice(0, 12)) {
			const t = musicTheme(seed);
			const allowed = new Set(MODES[t.calmMode].map((i) => (t.tonic + i) % 12));
			for (const role of STATION_ROLES) {
				const song = stationBed(seed, role, 0);
				expect(() => compileSong(song)).not.toThrow();
				const bed = song.sections[0];
				expect(bed.bars).toBe(STATION_BARS);
				expect(loopPeriod(barPrints(bed.events, bed.bars), 8)).toBe(0);
				for (const e of bed.events) expect(allowed.has(pc(e.pitch))).toBe(true);
			}
		}
	});

	test("it is calmer than flight: slower, with no drums and no acid", () => {
		const seed = SEEDS[5];
		const flightBpm = flightBed(seed, 0).tempo[0].bpm;
		for (const role of STATION_ROLES) {
			const song = stationBed(seed, role, 0);
			expect(song.tempo[0].bpm).toBeLessThan(flightBpm);
			const parts = new Set(
				song.sections.flatMap((s) => s.events.map((e) => e.part)),
			);
			for (const p of ["kick", "hat", "snare", "acid"])
				expect(parts.has(p)).toBe(false);
		}
	});

	test("the role changes the texture", () => {
		const seed = SEEDS[5];
		const prints = STATION_ROLES.map((r) =>
			[...new Set(stationBed(seed, r, 0).sections[0].events.map((e) => e.part))]
				.sort()
				.join(),
		);
		expect(new Set(prints).size).toBe(STATION_ROLES.length);
	});
});

test("calm runs 10 bpm above the system's theme tempo (the principal, 2026-09-29)", () => {
	for (const seed of SEEDS.slice(0, 8)) {
		const t = musicTheme(seed);
		expect(flightBed(seed, 0).tempo[0].bpm).toBe(t.bpm + CALM_LIFT_BPM);
		expect(CALM_LIFT_BPM).toBe(10);
	}
});

describe("wary, threat and combat (D12, after the ear on calm)", () => {
	const LEVELS = ["wary", "threat", "combat"] as const;
	const MODE_OF = {
		wary: "aeolian",
		threat: "harmonicMinor",
		combat: "phrygian",
	} as const;

	test("each is long enough to hold, in its level's mode on the system's tonic", () => {
		for (const seed of SEEDS.slice(0, 16)) {
			const t = musicTheme(seed);
			const song = flightBed(seed, 0);
			for (const level of LEVELS) {
				const s = section(song, level);
				expect(s.bars).toBeGreaterThanOrEqual(24);
				const allowed = new Set(
					MODES[MODE_OF[level]].map((i) => (t.tonic + i) % 12),
				);
				for (const e of s.events)
					if (!UNPITCHED.has(e.part))
						expect(allowed.has(pc(e.pitch))).toBe(true);
			}
		}
	});

	test("none loops in a few bars: wary not within 16, threat and combat not within 8", () => {
		for (const seed of SEEDS.slice(0, 16)) {
			const song = flightBed(seed, 0);
			const wary = section(song, "wary");
			expect(loopPeriod(barPrints(wary.events, wary.bars), 16)).toBe(0);
			for (const level of ["threat", "combat"]) {
				const s = section(song, level);
				expect(loopPeriod(barPrints(s.events, s.bars), 8)).toBe(0);
			}
		}
	});

	test("the danger comes in as parts: bass and lead when wary, acid and hats in a threat, the kit in combat", () => {
		const song = flightBed(SEEDS[4], 0);
		const parts = (level: string) =>
			new Set(section(song, level).events.map((e) => e.part));
		for (const p of ["kick", "snare", "hat", "acid"])
			expect(parts("calm").has(p)).toBe(false);
		for (const p of ["bass", "lead"]) expect(parts("wary").has(p)).toBe(true);
		for (const p of ["kick", "snare"]) expect(parts("wary").has(p)).toBe(false);
		for (const p of ["creep", "hat"]) expect(parts("threat").has(p)).toBe(true);
		for (const p of ["kick", "snare", "hat", "acid", "lead"])
			expect(parts("combat").has(p)).toBe(true);
	});

	test("the system's motif is heard in every level, in its own mode", () => {
		for (const seed of SEEDS.slice(0, 16)) {
			const song = flightBed(seed, 0);
			const calm = section(song, "calm");
			const motifVoice = ["keys", "bell", "lead"].find((p) =>
				calm.events.some((e) => e.part === p && e.pitch >= 60),
			) as string;
			const theme = statements(calm.events, motifVoice, 4).filter(
				(s) => s.length >= 3,
			)[0];
			const kin = [
				contour(theme).join(),
				contour(theme)
					.map((x) => -x)
					.join(),
			];
			for (const level of ["wary", "combat"]) {
				const st = statements(section(song, level).events, "lead", 4).filter(
					(s) => s.length >= 3,
				);
				expect(st.some((s) => kin.includes(contour(s).join()))).toBe(true);
			}
			// A threat states only the head, three notes, and never develops it:
			// every statement has the first two steps of the theme's own shape,
			// not its inversion (sage round 1).
			const heads = statements(section(song, "threat").events, "lead", 4);
			expect(heads.length).toBeGreaterThanOrEqual(5);
			const head = contour(theme).slice(0, 2).join();
			for (const s of heads) expect(contour(s).join()).toBe(head);
		}
	});

	test("a threat climbs: its motif fragments start higher and higher", () => {
		for (const seed of SEEDS.slice(0, 16)) {
			const threat = section(flightBed(seed, 0), "threat");
			const firsts = statements(threat.events, "lead", 4).map((s) => s[0]);
			expect(firsts.length).toBeGreaterThanOrEqual(5);
			const rises = firsts.slice(1).filter((p, i) => p > firsts[i]).length;
			expect(rises).toBeGreaterThanOrEqual(
				Math.ceil((firsts.length - 1) * 0.6),
			);
		}
	});

	test("combat fills its fourth bars: the kit's pattern there is not the groove's", () => {
		const combat = section(flightBed(SEEDS[2], 0), "combat");
		const kit = (bar: number) =>
			combat.events
				.filter(
					(e) => e.bar === bar && ["kick", "snare", "hat"].includes(e.part),
				)
				.map((e) => `${e.part}@${e.beat}`)
				.sort()
				.join();
		for (let b = 3; b < combat.bars; b += 4) {
			expect(kit(b)).not.toBe(kit(b - 1));
			expect(kit(b)).not.toBe(kit(b - 3));
		}
	});
});

describe("vocabulary", () => {
	test("the generator never calls the motif's voice a carrier (#587)", () => {
		// *Carrier* is a game term (CONTEXT.md): a ship or station the world
		// tracks. The voice that plays a system's motif is its motif voice. FM's
		// carrier and modulator live in the synth, not here.
		const source = readFileSync(repoPath("src/music-generate.ts"), "utf8");
		expect(source.match(/carrier/gi) ?? []).toEqual([]);
	});
});
