/**
 * The music director (#548): the pilot's situation in, the synth's transport
 * commands out. One pure step per frame, beside `stepFlightSound`, so the
 * danger ladder, its hysteresis and every hand-over between beds are held
 * headless (`tests/music-director.test.ts`).
 *
 * **What plays (D2, D3).** In flight, the system's generative bed
 * (`flightBed`), held on the section its danger level names. Docked, the
 * station bed. Witchspace (#534), the docking computer (#547) and death own
 * their sound, so the music fades out under them — read before the hold,
 * because death holds the clock. A pause holds everything else: no command
 * and no clock. A synth whose worklet is not running is sent nothing at all.
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
import { numbersPhrase } from "./comms";
import type { MusicCommand, Song } from "./music-score";
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
}
export type MusicBed = "legacy" | "second" | "berlin";

/** Each bed's two songs: a system's flight bed and a station's. */
const BEDS: Readonly<
	Record<
		MusicBed,
		{
			flight: (systemSeed: number, variant: number) => Song;
			station: (systemSeed: number, role: StationType, variant: number) => Song;
		}
	>
> = {
	legacy: { flight: legacyFlightBed, station: legacyStationBed },
	second: { flight: flightBed, station: stationBed },
	berlin: { flight: berlinFlightBed, station: berlinStationBed },
};
export const DEFAULT_MUSIC_ARMS: MusicArms = {
	off: false,
	force: null,
	lowHull: "threat",
	bed: "berlin",
	voice: true,
};

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
		else if (token === "legacy" || token === "second" || token === "berlin")
			arms = { ...arms, bed: token };
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
});

const other = (id: FlightId | null): FlightId =>
	id === "flight-a" ? "flight-b" : "flight-a";

/** The cruise stem and lift for the song a hand-over just brought in: its
 *  stems start at full and its tempo scale at 1. */
const settle = (cruise: boolean): MusicCommand[] => [
	{ type: "stem", part: "arp", level: cruise ? 1 : 0, at: "now", fadeS: 0 },
	{ type: "tempo", scale: cruise ? CRUISE_TEMPO : 1, at: "bar", rampBars: 0 },
];

export function stepMusic(
	s: MusicState,
	r: MusicReading,
	dt: number,
	arms: MusicArms = DEFAULT_MUSIC_ARMS,
): { state: MusicState; commands: MusicCommand[]; voice?: string } {
	const cmds: MusicCommand[] = [];
	if (!r.ready) return { state: s, commands: cmds };

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
	if (arms.voice && arms.bed === "berlin" && level === "calm") {
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
