/**
 * The music director (#548): the pilot's situation in, the synth's transport
 * commands out. One pure step per frame, beside `stepFlightSound`, so the
 * danger ladder, its hysteresis and every hand-over between beds are held
 * headless (`tests/music-director.test.ts`).
 *
 * **What plays (D2, D3).** In flight, the system's generative bed
 * (`flightBed`), held on the section its danger level names. Docked, the
 * station bed. Witchspace (#534) and death own their sound, so the music
 * fades out under them — read before the hold, because death holds the
 * clock. A pause holds everything else: no command and no clock. A synth
 * whose worklet is not running is sent nothing at all.
 *
 * **The docking computer plays the waltz (#603, after #547).** Engaging it
 * loads the Blue Danube once and plays it on the bed's next bar line, so the
 * bed's last notes ring out under the intro. Crossing the plane is the frame
 * the dock disengages the computer, so the scene goes straight from the
 * computer to docked: a `resolve` on the bar takes the loop into the
 * cadence (D1), and the station bed waits `WALTZ_CADENCE_S` for it. Any other
 * way out — the pilot's stick or toggle, a refusal, a bounce, death,
 * witchspace — fades the waltz over two of its bars and the bed comes back
 * on the bar (D2). The ship bus ducks by `WALTZ_DUCK_DB` while it plays (D5,
 * `waltzDuckDb`).
 *
 * **The ladder (D4).** `dangerLevel` reads the highest signal: taking fire is
 * combat, a contest or a duel is threat, an inbound raider or a Wanted
 * standing is wary. Low shields or hull are combat while a threat is present
 * and wary without one — hull does not repair in flight, so read alone it
 * would hold combat in empty space until the next dock (the principal's
 * ruling, 2026-09-29).
 *
 * **Movement (D5, D6).** A rise jumps on the next bar at once. A fall waits
 * `FALL_HOLD_S` with nothing as high, and then drops one level, so a raider
 * at the edge of range does not flip the mood each second. Cruise fades the
 * `arp` stem in and lifts the tempo a little (D7). After `REFRESH_S` of calm
 * a new variant of the same theme comes in on the next bar, so the bed does
 * not loop audibly (D8).
 */
import {
	FLIGHT_LEVELS,
	flightBed,
	type MusicLevel,
	stationBed,
} from "./music-generate";
import {
	flightBed as legacyFlightBed,
	stationBed as legacyStationBed,
} from "./music-generate-legacy";
import { berlinFlightBed, berlinStationBed } from "./music-generate-berlin";
import {
	CALM_FORM_NAMES,
	type CalmForm,
	schoolFlightBed,
	schoolStationBed,
} from "./music-generate-school";
import {
	TECHNO_STYLE_NAMES,
	type TechnoStyle,
	technoFlightBed,
	technoStationBed,
} from "./music-generate-techno";
import { numbersPhrase } from "./comms";
import {
	DANUBE_CANCEL_FADE_S,
	DANUBE_VOICINGS,
	type DanubeVoicing,
	danubeSong,
} from "./music-danube";
import { BRUCKNER_ADAGIO } from "./music-classical/bruckner-7-adagio";
import { DVORAK_LARGO } from "./music-classical/dvorak-largo";
import { MARS } from "./music-classical/holst-mars";
import { ZARATHUSTRA } from "./music-classical/strauss-zarathustra";
import { MUSIC_FIRSTS, type MusicFirst } from "./music-firsts";
import type { MusicCommand, Song } from "./music-score";
import { setsOf } from "./music-samples";
import { beatSeconds, bpmAt } from "./music-sequencer";
import { mix, seededRand } from "./rng";
import type { StationType } from "./station";

/** Who owns the sound this frame. */
export type MusicScene =
	| "flight"
	| "docked"
	| "witchspace"
	| "dockingComputer"
	| "dead";

/** What the director reads from the game each frame. */
export interface MusicReading {
	readonly scene: MusicScene;
	/** The synth takes commands: false until its worklet has loaded, and for
	 *  good if it failed to. `Music.send` holds what it is sent until then,
	 *  with no limit, so the director sends nothing and keeps no state; the
	 *  first ready frame starts the bed from silence. */
	readonly ready: boolean;
	/** The clock is held: a pause, a menu. */
	readonly held: boolean;
	readonly cruise: boolean;
	/** The raider encounter's phase, `none` when there is none. */
	readonly encounter: "none" | "inbound" | "contest" | "duel";
	readonly sinceStruckS: number;
	readonly raiderFiring: boolean;
	/** An armed carrier the pilot struck is fighting back. */
	readonly engaged: boolean;
	readonly standing: "clean" | "wanted" | "fugitive";
	/** The weaker shield's share of its pool, `0`..`1`. */
	readonly shieldShare: number;
	readonly hullShare: number;
	readonly systemSeed: number;
	readonly stationRole: StationType | null;
	readonly waltz: StationWaltz | null;
	readonly wallDtS: number;
	readonly gameTimeS: number;
	readonly heard: boolean;
	readonly firsts: readonly MusicFirst[];
	readonly cue: SetPieceCue | null;
}

/** The fixed moments that ask for a set-piece (#589 D3, D5, D6). */
export type SetPieceCue = "boot" | "newHull" | "capitalShip";

/** The once-per-commander pieces: every first but the hull mark (#589 D5, D6, D7). */
export type FirstPieceId = Exclude<MusicFirst, "hull-bought">;

/** The set-pieces this director plays: the boot's and the firsts (#589 D3). */
export type SetPieceId = "strauss-zarathustra" | FirstPieceId;

/** A one-shot score's length on its own tempo map, bar by bar. */
export const songSeconds = (song: Song): number => {
	let bar = 0;
	let s = 0;
	for (const section of song.sections)
		for (let i = 0; i < section.bars; i++, bar++)
			s += beatSeconds(
				bpmAt(song.tempo, bar, false),
				bpmAt(song.tempo, bar, true),
				song.beatsPerBar,
				song.beatsPerBar,
			);
	return s;
};

const pieceOf = (song: Song) => ({
	song,
	seconds: songSeconds(song),
	bars: song.sections.reduce((n, x) => n + x.bars, 0),
});

/** Each piece's score, its length and its bar count. */
export const SET_PIECES: Readonly<
	Record<SetPieceId, { song: Song; seconds: number; bars: number }>
> = {
	"strauss-zarathustra": pieceOf(ZARATHUSTRA),
	"dvorak-largo": pieceOf(DVORAK_LARGO),
	"bruckner-7-adagio": pieceOf(BRUCKNER_ADAGIO),
	"holst-mars": pieceOf(MARS),
};

const FIRST_OF_CUE: Readonly<Record<SetPieceCue, FirstPieceId | null>> = {
	boot: null,
	newHull: "dvorak-largo",
	capitalShip: "bruckner-7-adagio",
};

/** A cut is two of the piece's bars (D10), at its mean bar. */
export const setPieceCutFadeS = (id: SetPieceId): number =>
	(2 * SET_PIECES[id].seconds) / SET_PIECES[id].bars;

/** Game time between two chance pieces (#589 D4's start value). */
export const CHANCE_COOLDOWN_S = 25 * 60;

/** Whether a chance piece may play now: the boot piece starts the clock, and
 *  a page that played none has no clock running. */
export const chanceCooldownOpen = (s: MusicState, gameTimeS: number): boolean =>
	s.cooldownFromS === null || gameTimeS - s.cooldownFromS >= CHANCE_COOLDOWN_S;

type PieceSlot = "piece-a" | "piece-b";

/**
 * The waltz the game picked for the station the docking computer flies to
 * (node #1324): the version's name and the song that plays it. A reading
 * with none plays the arms' voicing.
 */
export interface StationWaltz {
	readonly version: string;
	readonly song: Song;
}

/**
 * A hit this recent is combat. By ear, and under the shields' recharge delay
 * (`SHIELD_RECHARGE_DELAY_S`, 3 s): a fresh condition starts `sinceStruckS`
 * there as its "not struck lately", so a wider window made every boot and
 * every repair start at combat.
 */
export const STRUCK_WINDOW_S = 2.5;
/** Below these, the ship is hurt (D4's "low", set by ear). */
export const LOW_SHIELD_SHARE = 0.25;
export const LOW_HULL_SHARE = 0.35;
/** How long nothing as high must last before the music falls a level (D6). */
export const FALL_HOLD_S = 10;
/** Calm this long brings in a new variant (D8). */
export const REFRESH_S = 180;
/** The cruise lift (D7). */
export const CRUISE_TEMPO = 1.06;

/** The ship bus under the waltz (#547 D5): about 6 dB. */
export const WALTZ_DUCK_DB = 6;

const cadences = new WeakMap<Song, number>();

/**
 * From the plane to the cadence's end (#547 D1), in one voicing: one waltz
 * bar at most to reach the line the `resolve` lands on, then the cadence on
 * that song's own tempo map, which broadens it. The station bed comes in
 * after it. Read off the song the director loads, so a retuned cadence — or a
 * voicing given a tempo map of its own — moves it (sage round 1).
 */
export const waltzCadenceS = (voicing: DanubeVoicing): number =>
	songCadenceS(danubeSong(voicing));

/** `waltzCadenceS` for any song on the waltz's contract, a station's version
 *  as well as a voicing (node #1324). */
export const songCadenceS = (song: Song): number => {
	const known = cadences.get(song);
	if (known !== undefined) return known;
	const at = song.sections.findIndex((x) => x.name === song.resolve);
	if (at < 0) throw new Error(`${song.name} has no resolve section`);
	const startOf = (i: number) =>
		song.sections.slice(0, i).reduce((n, x) => n + x.bars, 0);
	const beats = song.beatsPerBar;
	const barS = (bar: number) =>
		beatSeconds(
			bpmAt(song.tempo, bar, false),
			bpmAt(song.tempo, bar, true),
			beats,
			beats,
		);
	// The wait for the line: the longest bar of the loop the resolve is sent
	// in, on that song's own tempo map (sage round 3: it was `WALTZ_BPM`).
	const loop = song.sections.findIndex((x) => x.name === song.loop?.from);
	if (loop < 0) throw new Error(`${song.name} has no loop`);
	let s = 0;
	for (
		let bar = startOf(loop);
		bar < startOf(loop) + song.sections[loop].bars;
		bar++
	)
		s = Math.max(s, barS(bar));
	const first = startOf(at);
	for (let bar = first; bar < first + song.sections[at].bars; bar++)
		s += barS(bar);
	// Stryker disable next-line BlockStatement, CallExpression: the cache saves recomputing only; a miss computes the same seconds
	cadences.set(song, s);
	return s;
};

/** Whether these arms play the numbers station at all (#600): the one
 *  gate the director says them by and the host renders them ahead by. */
export const numbersOn = (arms: MusicArms, systemSeed: number) => {
	const bed = drawnBed(arms, systemSeed);
	return arms.voice && bed !== "legacy" && bed !== "second";
};

/** The bed a system plays under these arms: the `system` arm's draw, or
 *  the arm itself. */
export const drawnBed = (arms: MusicArms, systemSeed: number): MusicBed =>
	arms.bed === "system" ? systemBed(systemSeed) : arms.bed;

/** Which room the numbers station is heard in: a short slap over techno,
 *  the far-off wash over every other bed. */
export type NumbersRoom = "techno" | "far";
export const numbersRoom = (
	arms: MusicArms,
	systemSeed: number,
): NumbersRoom =>
	drawnBed(arms, systemSeed).startsWith("techno") ? "techno" : "far";

/** The numbers station's first phrase in calm, and the gap after each. By
 *  ear, and a placeholder until it is heard: rare enough to be an event. */
export const VOICE_FIRST_S = 40;
export const VOICE_EVERY_S = 95;

const FADE_IN_S = 3;
const HAND_OVER_S = 4;
const FADE_OUT_S = 2.5;
const REFRESH_FADE_S = 6;
const STEM_FADE_S = 2;

const rank = (l: MusicLevel) => FLIGHT_LEVELS.indexOf(l);

/**
 * The prototype's arms, flown by ear from `?music=`: `off`; a level name,
 * which holds the music at that level whatever the signals say, for
 * listening; `lowhull-always`, the arm the principal did not choose —
 * low condition is combat even with no threat; and which bed plays —
 * `legacy`, the first bed the principal heard as boring (D12), `second`,
 * the authored-fragment bed heard as too slow (2026-09-30), or the Berlin-
 * school prototype, the default, kept side by side to compare by ear.
 */
export interface MusicArms {
	readonly off: boolean;
	readonly force: MusicLevel | null;
	readonly lowHull: "threat" | "always";
	readonly bed: MusicBed;
	/** The numbers station in Berlin calm (#600); `?voices=off` or
	 *  `nomusic` turns it off. */
	readonly voice: boolean;
	/** The waltz's voicing (#547 D12). `hybrid` by the principal's ruling on
	 *  #603; the other two stay on `?music=` to compare in flight. */
	readonly waltz: DanubeVoicing;
}
export type MusicBed =
	| "legacy"
	| "second"
	| "berlin"
	| "school"
	| `school-${CalmForm}`
	| "techno"
	| "system"
	| `techno-${TechnoStyle}`;

/** The share of systems that play techno under the `system` bed, the
 *  sequence school the rest (the principal, 2026-10-24: 60:40). */
export const TECHNO_SHARE = 0.4;
const SYSTEM_BED_TAG = 0x62656473;

/** The bed a system plays under the `system` arm, drawn once from its
 *  seed. */
export const systemBed = (systemSeed: number): "school" | "techno" =>
	seededRand(mix(systemSeed >>> 0, SYSTEM_BED_TAG))() < TECHNO_SHARE
		? "techno"
		: "school";

/** Each bed's two songs: a system's flight bed and a station's. */
interface BedSongs {
	flight: (systemSeed: number, variant: number) => Song;
	station: (systemSeed: number, role: StationType, variant: number) => Song;
}

const BEDS: Readonly<Record<MusicBed, BedSongs>> = {
	legacy: { flight: legacyFlightBed, station: legacyStationBed },
	second: { flight: flightBed, station: stationBed },
	berlin: { flight: berlinFlightBed, station: berlinStationBed },
	school: { flight: schoolFlightBed, station: schoolStationBed },
	...(Object.fromEntries(
		CALM_FORM_NAMES.map((form) => [
			`school-${form}`,
			{
				flight: (seed: number, variant: number) =>
					schoolFlightBed(seed, variant, form),
				station: schoolStationBed,
			},
		]),
	) as Record<`school-${CalmForm}`, BedSongs>),
	techno: { flight: technoFlightBed, station: technoStationBed },
	system: {
		flight: (seed, variant) => BEDS[systemBed(seed)].flight(seed, variant),
		station: (seed, role, variant) =>
			BEDS[systemBed(seed)].station(seed, role, variant),
	},
	...(Object.fromEntries(
		TECHNO_STYLE_NAMES.map((style) => [
			`techno-${style}`,
			{
				flight: (seed: number, variant: number) =>
					technoFlightBed(seed, variant, style),
				station: technoStationBed,
			},
		]),
	) as Record<`techno-${TechnoStyle}`, BedSongs>),
};
/** Every value the bed arm takes. */
export const MUSIC_BED_NAMES = Object.keys(BEDS) as MusicBed[];
export const DEFAULT_MUSIC_ARMS: MusicArms = {
	off: false,
	force: null,
	lowHull: "threat",
	bed: "system",
	voice: true,
	waltz: "hybrid",
};

/** The default voicing's cadence hold, for the tests and the probe. */
export const WALTZ_CADENCE_S = waltzCadenceS(DEFAULT_MUSIC_ARMS.waltz);

/** The arms `?music=` names, the tokens it did not know, and whether it named
 *  a voicing of the waltz, which then plays at every station (node #1324). */
export function musicArms(value: string | null): {
	arms: MusicArms;
	unknown: string[];
	waltzNamed: boolean;
} {
	let arms = DEFAULT_MUSIC_ARMS;
	const unknown: string[] = [];
	let waltzNamed = false;
	for (const token of (value ?? "").split(",").map((t) => t.trim())) {
		if (!token) continue;
		if (token === "off") arms = { ...arms, off: true };
		else if (token === "lowhull-always") arms = { ...arms, lowHull: "always" };
		else if (Object.hasOwn(BEDS, token))
			arms = { ...arms, bed: token as MusicBed };
		else if (Object.hasOwn(DANUBE_VOICINGS, token)) {
			arms = { ...arms, waltz: token as DanubeVoicing };
			waltzNamed = true;
		} else if ((FLIGHT_LEVELS as readonly string[]).includes(token))
			arms = { ...arms, force: token as MusicLevel };
		else unknown.push(token);
	}
	return { arms, unknown, waltzNamed };
}

/** A quiet reading: in flight, nothing near, a whole ship, the synth ready.
 *  The lab and the offline renders spread their own situation over it. */
export const QUIET_READING: MusicReading = {
	scene: "flight",
	ready: true,
	held: false,
	cruise: false,
	encounter: "none",
	sinceStruckS: 99,
	raiderFiring: false,
	engaged: false,
	standing: "clean",
	shieldShare: 1,
	hullShare: 1,
	systemSeed: 1,
	stationRole: null,
	waltz: null,
	wallDtS: 0,
	gameTimeS: 0,
	heard: true,
	firsts: MUSIC_FIRSTS,
	cue: null,
};

export function dangerLevel(
	r: MusicReading,
	arms: MusicArms = DEFAULT_MUSIC_ARMS,
): MusicLevel {
	if (arms.force) return arms.force;
	const threat = r.encounter !== "none" || r.engaged;
	const low = r.shieldShare < LOW_SHIELD_SHARE || r.hullShare < LOW_HULL_SHARE;
	if (
		r.raiderFiring ||
		r.engaged ||
		r.sinceStruckS < STRUCK_WINDOW_S ||
		(low && (threat || arms.lowHull === "always"))
	)
		return "combat";
	if (r.encounter === "contest" || r.encounter === "duel") return "threat";
	if (r.encounter === "inbound" || r.standing !== "clean" || low) return "wary";
	return "calm";
}

type FlightId = "flight-a" | "flight-b";

export interface MusicState {
	readonly bed: "none" | "flight" | "station";
	/** The song id holding this system's flight bed. */
	readonly flightId: FlightId | null;
	/** Which bed that song id holds: the system, and first or second bed
	 *  (`legacy`), so a change of either loads a new one. */
	readonly flightKey: string | null;
	readonly variant: number;
	readonly stationKey: string | null;
	readonly level: MusicLevel;
	/** Time with nothing as high as `level`. */
	readonly fallS: number;
	/** Time at calm since the last variant came in. */
	readonly calmS: number;
	readonly cruise: boolean;
	/** Time at Berlin calm since the last numbers phrase, and how many have
	 *  been heard (#600). */
	readonly voiceS: number;
	readonly voiceN: number;
	/** The docking computer's waltz (#603): playing through the run, or
	 *  resolving into its cadence after the plane. */
	readonly waltz: "none" | "playing" | "resolving";
	/** Time since the resolve, while the cadence plays. */
	readonly waltzS: number;
	/** The version loaded as `danube`, once a waltz has been: a voicing or a
	 *  station's version (node #1324), with its cadence hold. */
	readonly waltzKey: string | null;
	readonly waltzHoldS: number;
	readonly piece: SetPieceId | null;
	readonly pieceSlot: PieceSlot | null;
	readonly pieceS: number;
	readonly pieceFallS: number;
	readonly pieceClockS: number;
	readonly pieceFreeAtS: Readonly<Record<PieceSlot, number>>;
	readonly bootOwed: boolean;
	readonly cooldownFromS: number | null;
	readonly samplesKey: string | null;
}

export const initialMusicState = (): MusicState => ({
	bed: "none",
	flightId: null,
	flightKey: null,
	variant: 0,
	stationKey: null,
	level: "calm",
	fallS: 0,
	calmS: 0,
	cruise: false,
	voiceS: 0,
	voiceN: 0,
	waltz: "none",
	waltzS: 0,
	waltzKey: null,
	waltzHoldS: 0,
	piece: null,
	pieceSlot: null,
	pieceS: 0,
	pieceFallS: 0,
	pieceClockS: 0,
	pieceFreeAtS: { "piece-a": 0, "piece-b": 0 },
	bootOwed: false,
	cooldownFromS: null,
	samplesKey: null,
});

const other = (id: FlightId | null): FlightId =>
	id === "flight-a" ? "flight-b" : "flight-a";

/** The cruise stem and lift for the song a hand-over just brought in: its
 *  stems start at full and its tempo scale at 1. */
const settle = (cruise: boolean): MusicCommand[] => [
	{ type: "stem", part: "arp", level: cruise ? 1 : 0, at: "now", fadeS: 0 },
	{ type: "tempo", scale: cruise ? CRUISE_TEMPO : 1, at: "bar", rampBars: 0 },
];

/**
 * How far the ship bus is ducked under the waltz (D5): `WALTZ_DUCK_DB` while
 * it plays and can be heard, nothing once the plane or a cancel has ended the
 * run. `heard` is whether the music bus reaches the speakers: a pilot who
 * turned the music off keeps the engine at full under a waltz nobody hears
 * (sage round 2).
 */
export const waltzDuckDb = (s: MusicState, heard: boolean): number =>
	heard && s.waltz === "playing" ? WALTZ_DUCK_DB : 0;

/**
 * The docking computer's waltz (#603), ahead of the beds: `done` when this
 * step belongs to it. Otherwise the bed logic carries on from the state and
 * commands it returns — a cancel's fade, then whatever the scene plays.
 */
function stepWaltz(
	state: MusicState,
	r: MusicReading,
	dt: number,
	arms: MusicArms,
): { state: MusicState; commands: MusicCommand[]; done: boolean } {
	let s = state;
	const cmds: MusicCommand[] = [];
	// A run ends one of two ways, and both are read before the hold, because
	// death holds the clock and still owes its fade.
	if (s.waltz === "playing" && (arms.off || r.scene !== "dockingComputer")) {
		if (r.scene === "docked" && !arms.off) {
			// The plane (D1): the loop goes to the cadence on the bar.
			cmds.push({ type: "resolve", at: "bar" });
			return {
				state: { ...s, waltz: "resolving", waltzS: 0 },
				commands: cmds,
				done: true,
			};
		}
		// Anything else (D2): two bars' fade, then whatever the scene plays.
		cmds.push({ type: "stop", at: "now", fadeS: DANUBE_CANCEL_FADE_S });
		s = { ...s, waltz: "none" };
	}
	if (s.waltz === "resolving") {
		// The cadence plays out into the berth; the station bed waits for it.
		// Out of the dock early (a launch), the bed's crossfade takes it.
		// The voicing that is playing: `waltzKey` is set by the load that
		// started it, and the arms are not read. Null is a broken invariant,
		// said rather than covered (sage round 3).
		if (s.waltzKey === null)
			throw new Error("a waltz resolving with none loaded");
		const hold = s.waltzHoldS;
		if (r.scene === "docked" && !arms.off && s.waltzS < hold) {
			const waltzS = r.held ? s.waltzS : s.waltzS + dt;
			if (waltzS < hold)
				return { state: { ...s, waltzS }, commands: cmds, done: true };
		}
		s = { ...s, waltz: "none", waltzS: 0 };
	}
	if (r.scene === "dockingComputer" && !arms.off) {
		// Held — the opening, a menu — nothing starts.
		if (s.waltz === "playing" || r.held)
			return { state: s, commands: cmds, done: true };
		const pick = r.waltz ?? {
			version: arms.waltz,
			song: danubeSong(arms.waltz),
		};
		if (s.waltzKey !== pick.version)
			cmds.push({ type: "load", id: "danube", song: pick.song });
		// `play`, not a crossfade: the bed stops starting notes on its line and
		// the ones sounding ring out, so the intro's chord bows in whole.
		cmds.push({ type: "play", id: "danube", at: "bar" });
		return {
			state: {
				...s,
				bed: "none",
				waltz: "playing",
				waltzKey: pick.version,
				waltzHoldS: songCadenceS(pick.song),
			},
			commands: cmds,
			done: true,
		};
	}
	return { state: s, commands: cmds, done: false };
}

const ownsScene = (r: MusicReading) =>
	r.scene === "flight" || r.scene === "docked";

const tenseInFlight = (r: MusicReading, target: MusicLevel) =>
	r.scene === "flight" && rank(target) >= rank("threat");

const clearPiece = (s: MusicState): MusicState => ({
	...s,
	piece: null,
	pieceS: 0,
	pieceFallS: 0,
});

type PieceStep = {
	state: MusicState;
	commands: MusicCommand[];
	done: boolean;
	played?: FirstPieceId;
};

function continuePiece(
	s: MusicState,
	r: MusicReading,
	dt: number,
	arms: MusicArms,
	target: MusicLevel,
): PieceStep {
	const piece = s.piece;
	const slot = s.pieceSlot;
	// Stryker disable next-line ConditionalExpression: a piece is only ever set together with its slot, so the slot test never decides
	if (piece === null || slot === null)
		return { state: s, commands: [], done: false };
	const mars = piece === "holst-mars";
	const fallS =
		mars && rank(target) < rank("threat")
			? s.pieceFallS + (r.held ? 0 : dt)
			: 0;
	const cut =
		arms.off ||
		!ownsScene(r) ||
		(!mars && tenseInFlight(r, target)) ||
		(mars && fallS >= FALL_HOLD_S);
	if (cut) {
		const fadeS = setPieceCutFadeS(piece);
		return {
			state: {
				...clearPiece(s),
				pieceFreeAtS: { ...s.pieceFreeAtS, [slot]: s.pieceClockS + fadeS },
			},
			commands: [{ type: "stop", at: "now", fadeS }],
			done: false,
		};
	}
	const pieceS = s.pieceS + r.wallDtS;
	if (pieceS >= SET_PIECES[piece].seconds)
		return { state: clearPiece(s), commands: [], done: false };
	return {
		state: { ...s, pieceS, pieceFallS: fallS },
		commands: [],
		done: true,
	};
}

function startPiece(
	s: MusicState,
	r: MusicReading,
	arms: MusicArms,
	target: MusicLevel,
): PieceStep {
	const none = { state: s, commands: [], done: false };
	if (arms.off) return { ...none, state: { ...s, bootOwed: false } };
	if (!ownsScene(r) || s.waltz !== "none") return none;
	const unheard = (id: FirstPieceId) => r.heard && !r.firsts.includes(id);
	const cued = r.cue === null ? null : FIRST_OF_CUE[r.cue];
	// Stryker disable next-line ConditionalExpression: with no cue, unheard(null) is true and the start is null either way
	const anyCued = cued !== null;
	const cuedFirst = anyCued && unheard(cued) ? cued : null;
	let start: SetPieceId | null;
	if (r.scene === "flight" && target === "combat" && unheard("holst-mars"))
		start = "holst-mars";
	else if (tenseInFlight(r, target)) start = null;
	else if (s.bootOwed) start = "strauss-zarathustra";
	else start = cuedFirst;
	if (start === null) return none;
	const prefer: PieceSlot = s.pieceSlot === "piece-a" ? "piece-b" : "piece-a";
	const fallback: PieceSlot = prefer === "piece-a" ? "piece-b" : "piece-a";
	const slot = [prefer, fallback].find(
		(id) => s.pieceFreeAtS[id] <= s.pieceClockS,
	);
	if (slot === undefined) return none;
	const commands: MusicCommand[] = [
		{ type: "load", id: slot, song: SET_PIECES[start].song },
		{ type: "play", id: slot, at: "bar" },
	];
	const state: MusicState = {
		...clearPiece(s),
		bed: "none",
		piece: start,
		pieceSlot: slot,
	};
	if (start === "strauss-zarathustra")
		return {
			state: { ...state, bootOwed: false, cooldownFromS: r.gameTimeS },
			commands,
			done: true,
		};
	return { state, commands, done: true, played: start };
}

function stepSetPiece(
	state: MusicState,
	r: MusicReading,
	dt: number,
	arms: MusicArms,
): PieceStep {
	const target = dangerLevel(r, arms);
	const s: MusicState = {
		...state,
		pieceClockS: state.pieceClockS + r.wallDtS,
	};
	const going = continuePiece(s, r, dt, arms, target);
	if (going.done) return going;
	const next = startPiece(going.state, r, arms, target);
	return { ...next, commands: [...going.commands, ...next.commands] };
}

/** What the director asks of the sample loader: load a song's sets, or let
 *  every set go (node #1325). */
export type SampleOrder = { load: Song } | { release: true };

export interface MusicStep {
	state: MusicState;
	commands: MusicCommand[];
	voice?: string;
	samples?: SampleOrder;
	played?: MusicFirst;
}

function stepSamples(
	s: MusicState,
	r: MusicReading,
	arms: MusicArms,
): { state: MusicState; samples?: SampleOrder } {
	if (r.scene === "docked") return { state: s };
	const sampled = r.waltz && setsOf(r.waltz.song).length > 0 ? r.waltz : null;
	const armed = r.scene === "dockingComputer" && !arms.off;
	if (armed && sampled && s.samplesKey !== sampled.version)
		return {
			state: { ...s, samplesKey: sampled.version },
			samples: { load: sampled.song },
		};
	if (!armed && s.samplesKey !== null)
		return { state: { ...s, samplesKey: null }, samples: { release: true } };
	return { state: s };
}

export function stepMusic(
	state: MusicState,
	r: MusicReading,
	dt: number,
	arms: MusicArms = DEFAULT_MUSIC_ARMS,
): MusicStep {
	const asked =
		r.cue === "boot" && !state.bootOwed ? { ...state, bootOwed: true } : state;
	if (!r.ready) return { state: asked, commands: [] };
	const beds = stepBeds(asked, r, dt, arms);
	const sampled = stepSamples(beds.state, r, arms);
	return { ...beds, state: sampled.state, samples: sampled.samples };
}

function stepBeds(
	state: MusicState,
	r: MusicReading,
	dt: number,
	arms: MusicArms,
): Omit<MusicStep, "samples"> {
	const piece = stepSetPiece(state, r, dt, arms);
	const played = piece.played ? { played: piece.played } : {};
	if (piece.done)
		return { state: piece.state, commands: piece.commands, ...played };
	const waltz = stepWaltz(piece.state, r, dt, arms);
	if (waltz.done)
		return {
			state: waltz.state,
			commands: [...piece.commands, ...waltz.commands],
		};
	let s = waltz.state;
	const cmds = [...piece.commands, ...waltz.commands];

	// Before the hold: death holds the clock as the ship dies, and the fade is
	// what it owes (D2).
	if (arms.off || (r.scene !== "flight" && r.scene !== "docked")) {
		if (s.bed !== "none")
			cmds.push({ type: "stop", at: "now", fadeS: FADE_OUT_S });
		return { state: { ...s, bed: "none" }, commands: cmds };
	}
	if (r.held) return { state: s, commands: cmds };

	if (r.scene === "docked") {
		const role = r.stationRole ?? "trade";
		const key = `${r.systemSeed >>> 0}/${role}/${arms.bed}`;
		if (s.bed === "station" && s.stationKey === key)
			return { state: s, commands: cmds };
		if (s.stationKey !== key)
			cmds.push({
				type: "load",
				id: "station",
				song: BEDS[arms.bed].station(r.systemSeed, role, 0),
			});
		cmds.push({
			type: "crossfade",
			to: "station",
			fadeS: s.bed === "none" ? FADE_IN_S : HAND_OVER_S,
			at: "bar",
		});
		return {
			state: { ...s, bed: "station", stationKey: key },
			commands: cmds,
		};
	}

	const target = dangerLevel(r, arms);
	// Into flight: from silence, from the station, or into a new system.
	const flightKey = `${r.systemSeed >>> 0}/${arms.bed}`;
	if (s.bed !== "flight" || s.flightKey !== flightKey) {
		let { flightId, variant } = s;
		if (s.flightKey !== flightKey || flightId === null) {
			flightId = other(flightId);
			variant = 0;
			cmds.push({
				type: "load",
				id: flightId,
				song: BEDS[arms.bed].flight(r.systemSeed, variant),
			});
		}
		cmds.push(
			{
				type: "crossfade",
				to: flightId,
				fadeS: s.bed === "none" ? FADE_IN_S : HAND_OVER_S,
				section: target,
				at: "bar",
				hold: true,
			},
			...settle(r.cruise),
		);
		return {
			state: {
				...s,
				bed: "flight",
				flightId,
				flightKey,
				variant,
				level: target,
				fallS: 0,
				calmS: 0,
				cruise: r.cruise,
				// A new system starts its own numbers from the first:
				// `numbersPhrase` is the system's, and so is their order.
				...(s.flightKey === flightKey ? {} : { voiceS: 0, voiceN: 0 }),
			},
			commands: cmds,
		};
	}

	// In flight: the ladder, with its hold on the way down.
	let { level, fallS, calmS, cruise, flightId, variant } = s;
	if (rank(target) > rank(level)) {
		level = target;
		fallS = 0;
		cmds.push({ type: "jump", section: level, at: "bar", hold: true });
	} else if (rank(target) < rank(level)) {
		fallS += dt;
		if (fallS >= FALL_HOLD_S) {
			level = FLIGHT_LEVELS[rank(level) - 1];
			fallS = 0;
			cmds.push({ type: "jump", section: level, at: "bar", hold: true });
		}
	} else fallS = 0;

	if (r.cruise !== cruise) {
		cruise = r.cruise;
		cmds.push(
			{
				type: "stem",
				part: "arp",
				level: cruise ? 1 : 0,
				at: "bar",
				fadeS: STEM_FADE_S,
			},
			{
				type: "tempo",
				scale: cruise ? CRUISE_TEMPO : 1,
				at: "bar",
				rampBars: 2,
			},
		);
	}

	calmS = level === "calm" ? calmS + dt : 0;
	if (calmS >= REFRESH_S) {
		calmS = 0;
		variant += 1;
		flightId = other(flightId);
		cmds.push(
			{
				type: "load",
				id: flightId,
				song: BEDS[arms.bed].flight(r.systemSeed, variant),
			},
			{
				type: "crossfade",
				to: flightId,
				fadeS: REFRESH_FADE_S,
				section: "calm",
				// On the bar, not the section line: the incoming song is the lead from
				// the moment it is asked for, so a rise sent before a section line
				// waited for it, up to 16 bars of calm under a raider.
				at: "bar",
				hold: true,
			},
			...settle(cruise),
		);
	}

	// A numbers station overheard, far off (#600): in Berlin calm only, the
	// first after `VOICE_FIRST_S` and then every `VOICE_EVERY_S`. The host says
	// it; the director only says when and what.
	let { voiceS, voiceN } = s;
	let voice: string | undefined;
	if (numbersOn(arms, r.systemSeed) && level === "calm") {
		voiceS += dt;
		if (voiceS >= (voiceN === 0 ? VOICE_FIRST_S : VOICE_EVERY_S)) {
			voiceS = 0;
			voice = numbersPhrase(r.systemSeed, voiceN);
			voiceN += 1;
		}
	} else voiceS = 0;

	return {
		state: {
			...s,
			level,
			fallS,
			calmS,
			cruise,
			flightId,
			variant,
			voiceS,
			voiceN,
		},
		commands: cmds,
		...(voice ? { voice } : {}),
	};
}
