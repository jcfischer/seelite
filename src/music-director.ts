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
import { numbersPhrase } from "./comms";
import {
	DANUBE_CANCEL_FADE_S,
	DANUBE_VOICINGS,
	type DanubeVoicing,
	danubeSong,
} from "./music-danube";
import type { MusicCommand, Song } from "./music-score";
import { beatSeconds, bpmAt } from "./music-sequencer";
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

const cadences = new Map<DanubeVoicing, number>();

/**
 * From the plane to the cadence's end (#547 D1), in one voicing: one waltz
 * bar at most to reach the line the `resolve` lands on, then the cadence on
 * that song's own tempo map, which broadens it. The station bed comes in
 * after it. Read off the song the director loads, so a retuned cadence — or a
 * voicing given a tempo map of its own — moves it (sage round 1).
 */
export const waltzCadenceS = (voicing: DanubeVoicing): number => {
	const known = cadences.get(voicing);
	if (known !== undefined) return known;
	const song = danubeSong(voicing);
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
	cadences.set(voicing, s);
	return s;
};

/** Whether these arms play the numbers station at all (#600): the one
 *  gate the director says them by and the host renders them ahead by. */
export const numbersOn = (arms: MusicArms) =>
	arms.voice && arms.bed === "berlin";

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
	| `school-${CalmForm}`;

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
};
export const DEFAULT_MUSIC_ARMS: MusicArms = {
	off: false,
	force: null,
	lowHull: "threat",
	bed: "berlin",
	voice: true,
	waltz: "hybrid",
};

/** The default voicing's cadence hold, for the tests and the probe. */
export const WALTZ_CADENCE_S = waltzCadenceS(DEFAULT_MUSIC_ARMS.waltz);

export function musicArms(value: string | null): {
	arms: MusicArms;
	unknown: string[];
} {
	let arms = DEFAULT_MUSIC_ARMS;
	const unknown: string[] = [];
	for (const token of (value ?? "").split(",").map((t) => t.trim())) {
		if (!token) continue;
		if (token === "off") arms = { ...arms, off: true };
		else if (token === "lowhull-always") arms = { ...arms, lowHull: "always" };
		else if (Object.hasOwn(BEDS, token))
			arms = { ...arms, bed: token as MusicBed };
		else if (Object.hasOwn(DANUBE_VOICINGS, token))
			arms = { ...arms, waltz: token as DanubeVoicing };
		else if ((FLIGHT_LEVELS as readonly string[]).includes(token))
			arms = { ...arms, force: token as MusicLevel };
		else unknown.push(token);
	}
	return { arms, unknown };
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
	/** The voicing loaded as `danube`, once a waltz has been. */
	readonly waltzKey: DanubeVoicing | null;
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
		const hold = waltzCadenceS(s.waltzKey);
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
		if (s.waltzKey !== arms.waltz)
			cmds.push({ type: "load", id: "danube", song: danubeSong(arms.waltz) });
		// `play`, not a crossfade: the bed stops starting notes on its line and
		// the ones sounding ring out, so the intro's chord bows in whole.
		cmds.push({ type: "play", id: "danube", at: "bar" });
		return {
			state: { ...s, bed: "none", waltz: "playing", waltzKey: arms.waltz },
			commands: cmds,
			done: true,
		};
	}
	return { state: s, commands: cmds, done: false };
}

export function stepMusic(
	state: MusicState,
	r: MusicReading,
	dt: number,
	arms: MusicArms = DEFAULT_MUSIC_ARMS,
): { state: MusicState; commands: MusicCommand[]; voice?: string } {
	if (!r.ready) return { state, commands: [] };
	const waltz = stepWaltz(state, r, dt, arms);
	if (waltz.done) return { state: waltz.state, commands: waltz.commands };
	let s = waltz.state;
	const cmds = waltz.commands;

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
	if (numbersOn(arms) && level === "calm") {
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
