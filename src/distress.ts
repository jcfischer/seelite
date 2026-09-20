/**
 * Who heard a civilian being shot at, and what the victim said (`#396` §§3–4,
 * amending `civilian-combat.md` H5).
 *
 * **The reach is the victim's transmission, not where the pilot was.** H5 used
 * to inherit the frame body's `NEAR_FAR_KM` and so filed exactly one witness —
 * the berth the flight assist happened to call the ship *at* — and missed every
 * station it could have heard. That rule is about which body a ship is standing
 * next to, and it is a poor answer to "who was within earshot": beside a busy
 * berth the frame body is chosen by distance alone, so a carrier gunned down in
 * the middle of a system indicted one berth and let the rest of them advertise.
 *
 * `DISTRESS_RANGE_KM` is therefore its own dial, declared at three times the
 * frame body's reach for two reasons. Past `NEAR_FAR_KM` the change is realised
 * rather than nominal — at exactly that figure the two rules pick the same
 * witness and the amendment is a no-op dressed as one. And short of a system's
 * own scale, so a shot near the middle does not indict every berth in it: at ten
 * times `NEAR_FAR_KM` it would, which turns H5's per-station judgement into a
 * per-system one and makes the exit-by-decay the only thing left of it.
 *
 * **The measure is the victim's position, and it is a distance rather than a
 * frame body.** Every candidate is a station in this system and every one is
 * asked the same question, so a system with three berths can produce three
 * hearers or none. A planet is not a candidate and neither is the star: H5 is
 * about the berths whose Traffic watched, and nothing answers a distress call
 * from a rock.
 *
 * **An empty list is an answer.** `stationsInEarshot` returns `[]` when nothing
 * heard, and `withOffence` requires the list as an argument rather than
 * defaulting it, because "nobody was in earshot" and "the caller never looked"
 * have to stay distinguishable — the difference `witnessed: CarrierKey | null`
 * was put in place to keep, and one a caller with an optional argument erases.
 */
import type { CarrierKey } from "./carrier-key";
import { NEAR_FAR_KM } from "./units";
import { length, sub, type Vec3 } from "./vec3";

/**
 * How far a distress transmission carries, in km. A **declared starting form**
 * (H12's precedent) and the dial on this ruling that changes how the game feels:
 * see the header for what the two ends of its range would make of H5.
 */
export const DISTRESS_RANGE_KM = 3 * NEAR_FAR_KM;

/** One station as the earshot question needs it: a key to file and a place. */
export interface EarshotStation {
	key: CarrierKey;
	pos: Vec3;
}

/**
 * The stations that heard a transmission made at `from`, as the keys H6's
 * witness list holds.
 *
 * Straight-line distance from the victim, at the moment of the charge: no
 * occlusion, because nothing in this world attenuates a radio and a station
 * behind the star would be a second model rather than a second figure.
 */
export const stationsInEarshot = (
	stations: readonly EarshotStation[],
	from: Vec3,
): CarrierKey[] =>
	stations
		.filter((s) => length(sub(s.pos, from)) <= DISTRESS_RANGE_KM)
		.map((s) => s.key);

/**
 * What the victim says, addressed to the pilot who is shooting at it.
 *
 * It names the speaker because the rail has to say *which* carrier is
 * transmitting, and it stops short of the charge: the hail is drawn on the
 * **first hit**, and the clock that convicts the pilot is still running. A pilot
 * who reads an accusation here that has not been made yet is being told the
 * wrong thing by the one surface that is honest about the moment.
 */
export const hailText = (callsign: string): string =>
	`${callsign} to you: cease fire!`;
