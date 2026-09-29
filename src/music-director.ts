/**
 * The music director (#548): the pilot's situation in, the synth's transport
 * commands out. One pure step per frame, beside `stepFlightSound`, so the
 * danger ladder, its hysteresis and every hand-over between beds are held
 * headless (`tests/music-director.test.ts`).
 *
 * **What plays (D2, D3).** In flight, the system's generative bed
 * (`flightBed`), held on the section its danger level names. Docked, the
 * station bed. Witchspace (#534), the docking computer (#547) and death own
 * their sound, so the music fades out under them. A pause holds everything:
 * no command and no clock.
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
 * a new variant of the same theme comes in on a section line, so the bed does
 * not loop audibly (D8).
 */
import {
	FLIGHT_LEVELS,
	flightBed,
	type MusicLevel,
	stationBed,
} from "./music-generate";
import type { MusicCommand } from "./music-score";
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

/** A hit this recent is combat. By ear. */
export const STRUCK_WINDOW_S = 4;
/** Below these, the ship is hurt (D4's "low", set by ear). */
export const LOW_SHIELD_SHARE = 0.25;
export const LOW_HULL_SHARE = 0.35;
/** How long nothing as high must last before the music falls a level (D6). */
export const FALL_HOLD_S = 10;
/** Calm this long brings in a new variant (D8). */
export const REFRESH_S = 180;
/** The cruise lift (D7). */
export const CRUISE_TEMPO = 1.06;

const FADE_IN_S = 3;
const HAND_OVER_S = 4;
const FADE_OUT_S = 2.5;
const REFRESH_FADE_S = 6;
const STEM_FADE_S = 2;

const rank = (l: MusicLevel) => FLIGHT_LEVELS.indexOf(l);

export function dangerLevel(r: MusicReading): MusicLevel {
	const threat = r.encounter !== "none" || r.engaged;
	const low = r.shieldShare < LOW_SHIELD_SHARE || r.hullShare < LOW_HULL_SHARE;
	if (
		r.raiderFiring ||
		r.engaged ||
		r.sinceStruckS < STRUCK_WINDOW_S ||
		(low && threat)
	)
		return "combat";
	if (r.encounter === "contest" || r.encounter === "duel") return "threat";
	if (r.encounter === "inbound" || r.standing !== "clean" || low) return "wary";
	return "calm";
}

type FlightId = "flight-a" | "flight-b";

export interface MusicState {
	readonly bed: "none" | "flight" | "station";
	/** The slot holding this system's flight bed. */
	readonly flightId: FlightId | null;
	readonly flightSeed: number | null;
	readonly variant: number;
	readonly stationKey: string | null;
	readonly level: MusicLevel;
	/** Time with nothing as high as `level`. */
	readonly fallS: number;
	/** Time at calm since the last variant came in. */
	readonly calmS: number;
	readonly cruise: boolean;
}

export const initialMusicState = (): MusicState => ({
	bed: "none",
	flightId: null,
	flightSeed: null,
	variant: 0,
	stationKey: null,
	level: "calm",
	fallS: 0,
	calmS: 0,
	cruise: false,
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
): { state: MusicState; commands: MusicCommand[] } {
	if (r.held) return { state: s, commands: [] };
	const cmds: MusicCommand[] = [];

	if (r.scene !== "flight" && r.scene !== "docked") {
		if (s.bed !== "none")
			cmds.push({ type: "stop", at: "now", fadeS: FADE_OUT_S });
		return { state: { ...s, bed: "none" }, commands: cmds };
	}

	if (r.scene === "docked") {
		const role = r.stationRole ?? "trade";
		const key = `${r.systemSeed >>> 0}/${role}`;
		if (s.bed === "station" && s.stationKey === key)
			return { state: s, commands: cmds };
		if (s.stationKey !== key)
			cmds.push({
				type: "load",
				id: "station",
				song: stationBed(r.systemSeed, role, 0),
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

	const target = dangerLevel(r);
	// Into flight: from silence, from the station, or into a new system.
	if (s.bed !== "flight" || s.flightSeed !== r.systemSeed) {
		let { flightId, variant } = s;
		if (s.flightSeed !== r.systemSeed || flightId === null) {
			flightId = other(flightId);
			variant = 0;
			cmds.push({
				type: "load",
				id: flightId,
				song: flightBed(r.systemSeed, variant),
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
				flightSeed: r.systemSeed,
				variant,
				level: target,
				fallS: 0,
				calmS: 0,
				cruise: r.cruise,
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
				song: flightBed(r.systemSeed, variant),
			},
			{
				type: "crossfade",
				to: flightId,
				fadeS: REFRESH_FADE_S,
				section: "calm",
				at: "section",
				hold: true,
			},
			...settle(cruise),
		);
	}

	return {
		state: { ...s, level, fallS, calmS, cruise, flightId, variant },
		commands: cmds,
	};
}
