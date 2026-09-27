/**
 * The ship in flight, by ear (#544): flight state in, the ship's loop levels
 * and its regime cues out.
 *
 * **Pure, and it imports only the cue vocabulary** (#542 D3), so the mapping is
 * held by `tests/flight-sound.test.ts` without a browser. What each loop
 * sounds like is `AudioFX.flight`'s; whether it sounds right is the
 * principal's ear.
 *
 * **A prototype, with its open questions as arms.** The node asks how the bed,
 * the thrusters and cruise should sound, and the answer is the principal's, by
 * ear, flown. So every question with more than one plausible answer is an arm
 * here, picked from the URL (`?flightsound=`), rather than a choice this file
 * makes:
 *
 * - **drive** — `thrust`: the drive is heard as it actually fires. With the
 *   assist on, the lever is a *speed* (`sim.ts`'s `assistedRelative`), so a
 *   ship holding its speed is not burning and is silent under the hum.
 *   `lever`: the drive follows the lever, as the bed before #544 did, and a
 *   ship at full lever roars whether or not it is accelerating.
 * - **rcs** — whether the manoeuvring thrusters are heard at all.
 * - **clicks** — `reactive`: a slow base rate, more while the hull cools after
 *   a burn, more when it is damaged. `sparse`: the base rate only. `noclicks`.
 * - **docked** — `dockhum`: the hum carries on, lower, in a berth.
 *   `docksilent`: a docked ship is silent.
 * - **cruise** — the sustained bed's voice: `shimmer` or `throb`.
 *
 * `?flightsound=legacy` is the build before #544: the throttle-driven bed and
 * nothing else, so the two can be flown one after the other.
 */
import type { CruiseVoice, Cue, FlightMix } from "./audio-cue";

export const FLIGHT_SOUND_ARMS = {
	drive: ["thrust", "lever"],
	rcs: ["rcs", "norcs"],
	clicks: ["reactive", "sparse", "noclicks"],
	docked: ["dockhum", "docksilent"],
	cruise: ["shimmer", "throb"],
} as const satisfies Record<string, readonly string[]> & {
	cruise: readonly CruiseVoice[];
};

export type FlightSoundArms = {
	-readonly [K in keyof typeof FLIGHT_SOUND_ARMS]: (typeof FLIGHT_SOUND_ARMS)[K][number];
};

/** The first of each arm. A default is needed to fly at all; it is not a
 *  ruling, and the principal's listen is what picks. */
export const DEFAULT_FLIGHT_ARMS: FlightSoundArms = {
	drive: "thrust",
	rcs: "rcs",
	clicks: "reactive",
	docked: "dockhum",
	cruise: "shimmer",
};

/**
 * The arms a `?flightsound=` value names: comma-separated tokens, each one an
 * arm's value (they are unique across arms), or `legacy`. Unknown tokens are
 * handed back so the caller can say so rather than fly a silent default.
 */
export function flightSoundArms(value: string | null): {
	arms: FlightSoundArms | "legacy";
	unknown: string[];
} {
	const tokens = (value ?? "")
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	if (tokens.includes("legacy")) return { arms: "legacy", unknown: [] };
	const arms: FlightSoundArms = { ...DEFAULT_FLIGHT_ARMS };
	const unknown: string[] = [];
	for (const token of tokens) {
		const arm = (
			Object.keys(FLIGHT_SOUND_ARMS) as (keyof FlightSoundArms)[]
		).find((k) => (FLIGHT_SOUND_ARMS[k] as readonly string[]).includes(token));
		if (arm) (arms as Record<string, string>)[arm] = token;
		else unknown.push(token);
	}
	return { arms, unknown };
}

/** What the game reads off one frame for the sound. */
export interface FlightReading {
	/** In a berth, or on the way in or out of one: flight is suspended. */
	readonly docked: boolean;
	/** `spool` is normal flight with the cruise wind-up running. */
	readonly regime: "normal" | "spool" | "cruise";
	/** Share of the wind-up done, `0`..`1`. */
	readonly spool: number;
	/** The throttle lever, `0`..`1`. */
	readonly lever: number;
	/** The main drive's applied share of full thrust this frame, `0`..`1`. */
	readonly drive: number;
	/** The manoeuvring thrusters' share of full authority, `0`..`1`. */
	readonly rcs: number;
	/** Hull left, as a share of the hull's integrity. */
	readonly hullShare: number;
}

export interface FlightSoundState {
	/** The regime last frame, so a change is one cue. */
	readonly regime: FlightReading["regime"];
	/** The drive's recent work, `0`..`1`: what the hull cools from. */
	readonly heat: number;
}

export const QUIET_FLIGHT: FlightSoundState = { regime: "normal", heat: 0 };

/** How fast the hull takes up and gives back the drive's heat, s. */
export const HEAT_TAU_S = 10;
/** The hum in a berth, against 1 in flight (`dockhum`). */
export const DOCKED_HUM = 0.45;
/** Cruise's bed at zero lever; full lever is 1. Never silent in cruise: the
 *  lever there is a speed, and a ship in cruise is always going. */
export const CRUISE_FLOOR = 0.55;
/** Clicks per second at rest. */
export const CLICK_BASE_PER_S = 0.12;
/** Extra clicks per second per unit of heat above the drive now (`reactive`). */
export const CLICK_COOLING_PER_S = 2;
/** Extra clicks per second on a hull with nothing left (`reactive`). */
export const CLICK_DAMAGE_PER_S = 1.2;

/** One frame: the next state, the loop levels, and any regime cue. */
export function flightSound(
	state: FlightSoundState,
	reading: FlightReading,
	arms: FlightSoundArms,
	dt: number,
): { state: FlightSoundState; mix: FlightMix; cues: Cue[] } {
	const cues: Cue[] = [];
	if (state.regime === "spool" && reading.regime === "cruise")
		cues.push({ kind: "cruiseEngage" });
	if (state.regime === "cruise" && reading.regime !== "cruise")
		cues.push({ kind: "cruiseDrop" });

	const inCruise = reading.regime === "cruise";
	const driveNow =
		reading.docked || inCruise
			? 0
			: clamp01(arms.drive === "lever" ? reading.lever : reading.drive);
	// Exact in `dt` for a held input, so a frame rate does not change the heat.
	const k = 1 - Math.exp(-Math.max(0, dt) / HEAT_TAU_S);
	const heat = state.heat + (driveNow - state.heat) * k;

	const silent = reading.docked && arms.docked === "docksilent";
	const clickRate =
		silent || arms.clicks === "noclicks"
			? 0
			: arms.clicks === "sparse"
				? CLICK_BASE_PER_S
				: CLICK_BASE_PER_S +
					CLICK_COOLING_PER_S * Math.max(0, heat - driveNow) +
					CLICK_DAMAGE_PER_S * (1 - clamp01(reading.hullShare));

	const mix: FlightMix = reading.docked
		? {
				hum: silent ? 0 : DOCKED_HUM,
				drive: 0,
				rcs: 0,
				spool: 0,
				cruise: 0,
				cruiseVoice: arms.cruise,
				clickRate,
			}
		: {
				hum: 1,
				drive: driveNow,
				rcs: arms.rcs === "norcs" ? 0 : clamp01(reading.rcs),
				spool: reading.regime === "spool" ? clamp01(reading.spool) : 0,
				cruise: inCruise
					? CRUISE_FLOOR + (1 - CRUISE_FLOOR) * clamp01(reading.lever)
					: 0,
				cruiseVoice: arms.cruise,
				clickRate,
			};
	return { state: { regime: reading.regime, heat }, mix, cues };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
