/**
 * The relay's defender (#515, ruled in #511): the first hit on the pirate relay
 * or its repair tender calls one of the system's raiders, which drops in beside
 * the pilot a few seconds later.
 *
 * **The call is the world's, not the journal's (#511).** It keys on damage, so
 * it is made whether or not a Bounty is accepted, and whether or not the
 * Long-Range Scanner has identified the relay. A pilot who only passes calls
 * nothing.
 *
 * **Who answers is the leg law's rule (#511 D2).** A seeded draw names one of
 * the system's raider slots. If that slot is destroyed or repairing, nobody
 * comes and the draw is not moved to another slot, so killing raiders weakens
 * the relay's guard in steps. The seed is the system, the target, the target's
 * instance and the call ordinal: a reload does not re-roll a call, and a
 * second call is a new draw.
 *
 * **One call per attack (#511 D3), and what an attack is.** A hit calls when
 * no encounter is active and the target has not already been answered. A call
 * that sent a raider is answered until that encounter ends; then the next hit
 * calls again, so hit-and-run does not buy a quiet relay. **A call that sent
 * nobody answers the attack for the rest of that instance**: #511 does not say
 * this, and it is the reading that keeps D2 true — if every later hit re-drew,
 * the relay would call until some operational slot came up, and a system that
 * lost a raider would be exactly as dangerous as before.
 *
 * Imports only leaves, the galaxy's stream helper and `raider-slots`, so the
 * rule runs headless.
 */
import type { CarrierKey } from "./carrier-key";
import { DOMAIN } from "./domains";
import { stream } from "./galaxy";
import { type EncounterBearing, raiderSlotCount } from "./raider-slots";
import { fnv1a, mix } from "./rng";

/**
 * Seconds from the call to the raider's arrival (#511 D1). The relay dies to
 * about ten seconds of pulse fire, so a leg's `ENCOUNTER_DELAY_S` would arrive
 * at a wreck; this leaves the pilot a choice between finishing the relay and
 * turning on the raider.
 */
export const DEFENDER_DELAY_S = [3, 5] as const;

/**
 * How far from the pilot the raider drops in, km. Inside the beam's reach
 * (`PLAYER_LASER_RANGE_KM`), so it is in the fight on arrival rather than
 * outside the exit a rout uses; the far end is about `ENGAGE_KM`, so it starts
 * its run at once.
 */
export const DEFENDER_RANGE_KM = [6, 10] as const;

const BEARINGS: readonly EncounterBearing[] = ["behind", "alongside", "ahead"];

export interface DefenderDraw {
	slotIndex: number;
	bearing: EncounterBearing;
	delayS: number;
	rangeKm: number;
	/** Which way round "alongside" falls, as a leg's `rollUnit`. */
	rollUnit: number;
	/** The duel's seeded stream, from the same key as this draw. */
	encounterSeed: number;
}

/**
 * One call's draw. `instance` names which life of the target was hit — the
 * carrier's instance ordinal, and for the tender its visit as well — and
 * `ordinal` counts the calls made against that instance.
 */
export function defenderDraw(
	systemSeed: number,
	government: number,
	target: CarrierKey,
	instance: number,
	ordinal: number,
): DefenderDraw {
	const key = mix(
		mix(systemSeed, fnv1a(target)),
		mix(instance >>> 0, ordinal >>> 0),
	);
	const rand = stream(key, DOMAIN.RELAY_DEFENDER);
	const count = raiderSlotCount(government);
	return {
		slotIndex: Math.min(count - 1, Math.floor(rand() * count)),
		bearing:
			BEARINGS[
				Math.min(BEARINGS.length - 1, Math.floor(rand() * BEARINGS.length))
			],
		delayS: lerp(DEFENDER_DELAY_S, rand()),
		rangeKm: lerp(DEFENDER_RANGE_KM, rand()),
		rollUnit: rand(),
		encounterSeed: mix(key, 0x5eed),
	};
}

/**
 * The tender's instance for a call: its carrier instance and the visit.
 * A tender that leaves when a repair completes keeps its slot's ordinal (sage
 * #507 round 2), so the ordinal alone would hand the next visit the last
 * visit's watch and its draws. `sinceS` is `tenderPresentSince`'s answer.
 */
export const tenderVisitInstance = (
	instanceOrdinal: number,
	sinceS: number,
): number => mix(instanceOrdinal >>> 0, Math.floor(sinceS) >>> 0);

/** What one target has called this visit. */
export interface DefenderWatch {
	instance: number;
	/** Calls made against this instance; the next call's ordinal. */
	calls: number;
	/** The last call sent nobody, which answers this instance's attack. */
	spent: boolean;
}

/** Every target's watch, by carrier key — which carries the system, so one
 *  map holds every system's watches apart. */
export type DefenderWatches = Readonly<Record<string, DefenderWatch>>;

/**
 * A hit on `target`: call a defender if the rule above allows one. `send`
 * builds the encounter for a call ordinal, or `null` when the drawn slot is
 * down. `encounterActive` is any encounter, a leg raider's included — the
 * game holds one.
 */
export function answerHit<E>(
	watches: DefenderWatches,
	hit: { target: CarrierKey; instance: number },
	encounterActive: boolean,
	send: (ordinal: number) => E | null,
): { watches: DefenderWatches; encounter: E | null } {
	if (encounterActive) return { watches, encounter: null };
	const known = watches[hit.target];
	const watch: DefenderWatch =
		known && known.instance === hit.instance
			? known
			: { instance: hit.instance, calls: 0, spent: false };
	if (watch.spent) return { watches, encounter: null };
	const encounter = send(watch.calls);
	return {
		watches: {
			...watches,
			[hit.target]: {
				instance: hit.instance,
				calls: watch.calls + 1,
				spent: encounter === null,
			},
		},
		encounter,
	};
}

const lerp = (range: readonly [number, number], t: number): number =>
	range[0] + (range[1] - range[0]) * t;
