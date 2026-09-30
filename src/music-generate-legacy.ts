/**
 * The first generative bed (#548), kept as `?music=legacy` after the
 * principal heard it as *super boring*: `music-generate.ts` is the second.
 * The second writes every section of its own and shares only this file's
 * vocabulary: the modes, the levels and their modes and tempi, the station
 * roles, and the theme and its seed (#548 D12).
 *
 * **What is authored and what is drawn (D8).** The rules are written here —
 * the modes, the progressions each level walks, how each part plays — and the
 * notes are drawn. A system's seed, under its own `DOMAIN.MUSIC` tag, gives it
 * a **theme**: a tonic, a bright mode, a tempo and a palette, so a system has
 * a recognisable sound and a revisit sounds familiar. A **variant** index
 * draws the notes inside that theme, so the director can bring in fresh
 * material without the key moving.
 *
 * **One song per system, one section per level (D4, D5).** `calm`, `wary`,
 * `threat` and `combat` share the tonic and the palette; each has its own
 * mode, darker as the level rises, its own tempo on the tempo map, and its
 * own parts — the stems that enter with the level. The director holds the
 * section its level names (`hold` on the transport) and jumps on a bar line.
 * `arp` is the cruise stem (D7): written into every section and faded in and
 * out by the director.
 *
 * **The station bed (D2, D8)** takes the system's key and bright mode in a
 * slower, sparser arrangement, and the station's role picks its texture.
 *
 * Pure, and imports only the score's types and the seed arithmetic, so it is
 * held headless (`tests/music-generate-legacy.test.ts`).
 */
import { DOMAIN } from "./domains";
import type { NoteEvent, PartSpec, Song } from "./music-score";
import { mix, seededRand } from "./rng";
import type { StationType } from "./station";

/** Scale intervals from the tonic, one octave. */
export const MODES = {
	lydian: [0, 2, 4, 6, 7, 9, 11],
	ionian: [0, 2, 4, 5, 7, 9, 11],
	mixolydian: [0, 2, 4, 5, 7, 9, 10],
	dorian: [0, 2, 3, 5, 7, 9, 10],
	aeolian: [0, 2, 3, 5, 7, 8, 10],
	harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
	phrygian: [0, 1, 3, 5, 7, 8, 10],
} as const;
export type ModeName = keyof typeof MODES;

/** The four levels of danger, calm first (D4). */
export const FLIGHT_LEVELS = ["calm", "wary", "threat", "combat"] as const;
export type MusicLevel = (typeof FLIGHT_LEVELS)[number];

/** The bright modes a system's calm is drawn from. */
const CALM_MODES: readonly ModeName[] = [
	"lydian",
	"ionian",
	"mixolydian",
	"dorian",
];

/** The mode each level above calm is in: darker as the level rises (D5). */
export const LEVEL_MODE: Readonly<
	Record<Exclude<MusicLevel, "calm">, ModeName>
> = { wary: "aeolian", threat: "harmonicMinor", combat: "phrygian" };

/** Each level's tempo as a multiple of the theme's (D5). By ear. */
export const LEVEL_TEMPO: Readonly<Record<MusicLevel, number>> = {
	calm: 1,
	wary: 1,
	threat: 1.1,
	combat: 1.25,
};

/** Bars per level section: four phrases of four. */
export const SECTION_BARS = 16;

export const STATION_ROLES: readonly StationType[] = [
	"trade",
	"refinery",
	"shipyard",
	"outpost",
];

/** What a system's seed fixes about its music (D8). */
export interface MusicTheme {
	/** Pitch class of the tonic, 0 = C. */
	readonly tonic: number;
	readonly calmMode: ModeName;
	readonly bpm: number;
	readonly padCutoffHz: number;
	readonly bellRatio: number;
	readonly bellIndex: number;
}

/** The root of every draw in this module: the system's seed, split by tag. */
export const themeSeed = (systemSeed: number) =>
	mix(systemSeed >>> 0, DOMAIN.MUSIC);

const pick = <T>(rand: () => number, list: readonly T[]): T =>
	list[Math.floor(rand() * list.length) % list.length];

export function musicTheme(systemSeed: number): MusicTheme {
	const rand = seededRand(themeSeed(systemSeed));
	return {
		tonic: Math.floor(rand() * 12) % 12,
		calmMode: pick(rand, CALM_MODES),
		bpm: Math.round(66 + rand() * 16),
		padCutoffHz: Math.round(700 + rand() * 900),
		bellRatio: pick(rand, [2, 3, 3.5, 1.5, 4]),
		bellIndex: 1.2 + rand() * 1.4,
	};
}

/** The pitch of a scale degree above `base`, where `base` is a tonic. */
const degree = (mode: readonly number[], base: number, d: number) =>
	base + 12 * Math.floor(d / 7) + mode[((d % 7) + 7) % 7];

/** A chord's pitch classes voiced upward from `lo`, closest first. */
const voice = (pitches: readonly number[], lo: number) =>
	pitches.map((p) => lo + ((((p - lo) % 12) + 12) % 12)).sort((a, b) => a - b);

/** The chords a level walks, as scale degrees of its mode: tonic first. */
const PROGRESSIONS: Readonly<Record<MusicLevel, readonly number[]>> = {
	calm: [0, 3, 4, 5, 1],
	wary: [0, 5, 3, 6],
	threat: [0, 3, 4, 5],
	combat: [0, 1, 0, 6],
};
/** Bars per chord at each level: calm breathes, combat drives. */
const CHORD_BARS: Readonly<Record<MusicLevel, number>> = {
	calm: 2,
	wary: 2,
	threat: 1,
	combat: 1,
};

export const FLIGHT_PARTS = (t: MusicTheme): Record<string, PartSpec> => ({
	pad: {
		voice: "pad",
		level: 0.3,
		attackS: 1.6,
		releaseS: 2.6,
		cutoffHz: t.padCutoffHz,
	},
	bass: { voice: "pluck", level: 0.5, cutoffHz: 600, decayS: 3 },
	bell: {
		voice: "fm",
		level: 0.2,
		ratio: t.bellRatio,
		index: t.bellIndex,
		decayS: 2.4,
		sustain: 0,
		feedback: 0.05,
	},
	arp: { voice: "pluck", level: 0.2, cutoffHz: 2400, decayS: 0.7 },
	pulse: { voice: "pluck", level: 0.42, cutoffHz: 450, decayS: 0.35 },
	lead: {
		voice: "fm",
		level: 0.22,
		ratio: 1,
		index: 1.4,
		attackS: 0.02,
		decayS: 0.9,
		sustain: 0.35,
		releaseS: 0.3,
		feedback: 0.25,
	},
	kick: { voice: "tone", level: 0.6 },
	hat: { voice: "noise", level: 0.13 },
});

/** One level's section: its chords, and each part as the level plays it. */
export function levelSection(
	level: MusicLevel,
	mode: readonly number[],
	tonic: number,
	rand: () => number,
): NoteEvent[] {
	const out: NoteEvent[] = [];
	const push = (
		part: string,
		bar: number,
		beat: number,
		dur: number,
		pitch: number,
		vel: number,
	) => out.push({ part, bar, beat, dur, pitch, vel });
	const prog = PROGRESSIONS[level];
	const per = CHORD_BARS[level];
	const bass = 36 + tonic;
	// Tonic on each phrase's first chord; the rest walk the progression.
	let chord = 0;
	for (let bar = 0; bar < SECTION_BARS; bar++) {
		if (bar % per === 0) chord = bar % 4 === 0 ? 0 : pick(rand, prog.slice(1));
		const root = degree(mode, bass, chord);
		const triad = [0, 2, 4, 6].map((k) => degree(mode, bass, chord + k));
		const first = bar % per === 0;
		if (first) {
			// The pad holds the chord across its bars, a seventh on top.
			const pad = voice(triad, 55);
			for (const p of pad) push("pad", bar, 0, 4 * per, p, 0.55);
			if (level !== "combat") push("bass", bar, 0, 4 * per, root, 0.6);
		}
		// The travel stem: eighths up and down the chord, faded by the director.
		const arp = voice(triad, 62);
		const shape = [0, 1, 2, 3, 2, 1, 0, 2];
		for (let i = 0; i < 8; i++)
			push("arp", bar, i / 2, 0.5, arp[shape[i]], i % 2 ? 0.3 : 0.45);

		if (level === "calm" || level === "wary") {
			// The bell: a sparse line from the chord, high and quiet.
			const chance = level === "calm" ? 0.55 : 0.3;
			if (rand() < chance) {
				const n = 1 + Math.floor(rand() * 3);
				const beats = [0, 1.5, 2, 3].filter(() => rand() < 0.6).slice(0, n);
				for (const b of beats)
					push(
						"bell",
						bar,
						b,
						2,
						degree(mode, 72 + tonic, pick(rand, [0, 2, 4, 7, 9])),
						0.3 + rand() * 0.3,
					);
			}
		}
		if (level !== "calm") {
			// The pulse: eighths on the root, accents moving with the level.
			for (let i = 0; i < 8; i++) {
				const accent = level === "combat" ? i % 3 === 0 : i % 4 === 0;
				push("pulse", bar, i / 2, 0.4, root, accent ? 0.7 : 0.4);
			}
		}
		if (level === "threat" || level === "combat") {
			// The lead: a half-step motif round the tonic, a phrase per two bars.
			if (bar % 2 === 0) {
				const top = 60 + tonic;
				const motif =
					level === "threat"
						? [0, mode[6] - 12, 0, mode[2]]
						: [0, mode[1], 0, mode[1], mode[2], mode[1]];
				const step = level === "threat" ? 1 : 0.5;
				motif.forEach((iv, i) =>
					push("lead", bar, i * step, step * 0.9, top + iv, 0.55),
				);
			}
			// Offbeat hats in threat, sixteenths in combat.
			const hats =
				level === "threat"
					? [0.5, 1.5, 2.5, 3.5]
					: [...Array(16)].map((_, i) => i / 4);
			for (const b of hats)
				push("hat", bar, b, 0.1, 104, b % 1 === 0.5 ? 0.6 : 0.3 + rand() * 0.2);
		}
		if (level === "combat") {
			push("kick", bar, 0, 0.5, 36, 0.9);
			push("kick", bar, 2, 0.5, 36, 0.8);
			if (rand() < 0.5) push("kick", bar, 2.5, 0.5, 36, 0.6);
			push("bass", bar, 0, 1.5, root, 0.7);
			push("bass", bar, 2, 1.5, root, 0.6);
		}
	}
	return out;
}

/**
 * A system's flight bed: one song, one section per level, each held by the
 * director. The same `(systemSeed, variant)` writes the same score.
 */
export function flightBed(systemSeed: number, variant: number): Song {
	const theme = musicTheme(systemSeed);
	const rand = seededRand(mix(themeSeed(systemSeed), variant + 1));
	const sections = FLIGHT_LEVELS.map((level) => ({
		name: level,
		bars: SECTION_BARS,
		events: levelSection(
			level,
			MODES[level === "calm" ? theme.calmMode : LEVEL_MODE[level]],
			theme.tonic,
			rand,
		),
	}));
	return {
		name: `flight ${systemSeed >>> 0}/${variant}`,
		beatsPerBar: 4,
		parts: FLIGHT_PARTS(theme),
		sections,
		tempo: FLIGHT_LEVELS.map((level, i) => ({
			bar: i * SECTION_BARS,
			bpm: Math.round(theme.bpm * LEVEL_TEMPO[level]),
		})),
	};
}

/** What a station's role does to the bed's texture (D8). */
const ROLE_TEXTURE: Readonly<
	Record<
		StationType,
		{
			bellChance: number;
			bellRatio: number | null;
			cutoff: number;
			arp: boolean;
		}
	>
> = {
	trade: { bellChance: 0.5, bellRatio: null, cutoff: 1, arp: true },
	shipyard: { bellChance: 0.35, bellRatio: 3.5, cutoff: 1.2, arp: false },
	refinery: { bellChance: 0.2, bellRatio: 1.41, cutoff: 0.6, arp: false },
	outpost: { bellChance: 0.15, bellRatio: 2, cutoff: 0.8, arp: false },
};

/** The station bed: the system's key and bright mode, slower and sparser. */
export function stationBed(
	systemSeed: number,
	role: StationType,
	variant: number,
): Song {
	const theme = musicTheme(systemSeed);
	const tex = ROLE_TEXTURE[role];
	const rand = seededRand(
		mix(mix(themeSeed(systemSeed), STATION_ROLES.indexOf(role) + 101), variant),
	);
	const mode = MODES[theme.calmMode];
	const bass = 36 + theme.tonic;
	const events: NoteEvent[] = [];
	const push = (
		part: string,
		bar: number,
		beat: number,
		dur: number,
		pitch: number,
		vel: number,
	) => events.push({ part, bar, beat, dur, pitch, vel });
	for (let bar = 0; bar < SECTION_BARS; bar += 4) {
		const chord = bar === 0 ? 0 : pick(rand, PROGRESSIONS.calm.slice(1));
		const tones = [0, 2, 4, 6].map((k) => degree(mode, bass, chord + k));
		for (const p of voice(tones, 55)) push("pad", bar, 0, 16, p, 0.45);
		push("bass", bar, 0, 16, degree(mode, bass, chord), 0.4);
		for (let b = bar; b < bar + 4; b++) {
			if (rand() < tex.bellChance)
				push(
					"bell",
					b,
					pick(rand, [0, 1, 2, 3]),
					3,
					degree(mode, 72 + theme.tonic, pick(rand, [0, 2, 4, 7, 9])),
					0.25 + rand() * 0.25,
				);
			if (tex.arp && b % 2 === 0) {
				const arp = voice(tones, 62);
				for (let i = 0; i < 4; i++) push("arp", b, i, 1, arp[i], 0.25);
			}
		}
	}
	const parts: Record<string, PartSpec> = {
		pad: {
			voice: "pad",
			level: 0.3,
			attackS: 2.4,
			releaseS: 3.2,
			cutoffHz: Math.round(theme.padCutoffHz * tex.cutoff),
		},
		bass: { voice: "pluck", level: 0.4, cutoffHz: 500, decayS: 4 },
		bell: {
			voice: "fm",
			level: 0.18,
			ratio: tex.bellRatio ?? theme.bellRatio,
			index: theme.bellIndex,
			decayS: 3,
			sustain: 0,
			feedback: 0.05,
		},
	};
	if (tex.arp)
		parts.arp = { voice: "pluck", level: 0.15, cutoffHz: 1800, decayS: 1.2 };
	return {
		name: `station ${role} ${systemSeed >>> 0}/${variant}`,
		beatsPerBar: 4,
		parts,
		sections: [{ name: "bed", bars: SECTION_BARS, events }],
		tempo: [{ bar: 0, bpm: Math.round(theme.bpm * 0.8) }],
		loop: { from: "bed", to: "bed" },
	};
}
