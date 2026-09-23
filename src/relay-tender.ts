/**
 * The pirate relay's repair tender (#351): the recovery a pilot can meet.
 *
 * #41 wants recovery visible, caused and **interruptible**, and #43's relay had
 * the first two and stopped there: a schedule and three log lines. The
 * principal's ruling on #351 is a tender — during the repairing window a
 * pirate tug flies in from far out and parks at the wreck, and destroying it
 * restarts the repair with a new wreck timer.
 *
 * **No new world-state verb.** `persistent-world-state.md` §4 already allows
 * "repairing → repairing when assistance, opposition, or another intervention
 * changes the active recovery descriptor". A tender kill is opposition: the
 * relay's `recovery-change` moves its completion out by a wreck and a repair,
 * in the same episode and the same process. The tender itself is its own
 * carrier slot (`relay-00/tender`, enrolled at generator 7) and takes an
 * ordinary `destroy` whose scheduled replacement completes when the next
 * tender is due — so its kill saves, loads and survives a jump like any
 * other carrier's.
 *
 * **One invariant ties the two.** A tender arrives one repair period before
 * the relay's completion (`tenderArrival`). A fresh repair starts there, and a
 * set-back puts the completion a wreck and a repair after the kill — so the
 * next tender arrives a wreck after it, exactly when the killed tender's own
 * replacement completes.
 *
 * Headless: imports the relay's module, the slot ids and the world-state
 * types; nothing that renders.
 */
import { playerLaserHit } from "./combat-enemy";
import { DOMAIN } from "./domains";
import { stream } from "./galaxy";
import { HULL_SPECS } from "./hull";
import {
	RELAY_REPAIR_S,
	RELAY_WRECK_S,
	relayReplacementActor,
} from "./pirate-relay";
import type { RaiderLogLine } from "./raider-log";
import { PLAYER_KILL } from "./raider-wreck";
import { RELAY_TENDER_HULL_ID, relaySlot, relayTenderSlot } from "./relay-slot";
import { type Vec3, scale, v3 } from "./vec3";
import {
	type EffectiveCarrier,
	type GalaxyEnvelope,
	type TransitionEvent,
	effectiveCarrier,
} from "./world-state";

/** What the log and the Target panel call it. */
export const RELAY_TENDER_NAME = "Relay tender";

/** How long the tender takes from its entry point to the wreck, seconds.
 *  Five minutes of a forty-minute repair: long enough to be met on the way,
 *  short enough that most of the window it is parked and findable. */
export const RELAY_TENDER_INBOUND_S = 300;
/** Where it comes in from, km off the relay. Far enough that it arrives at
 *  cruise speed rather than appearing beside the wreck. */
export const RELAY_TENDER_ENTRY_KM = 50_000;
/** Where it parks, km off the relay: alongside, not inside the hit sphere. */
export const RELAY_TENDER_PARK_KM = 0.25;

/** Hull points: the tug's own. */
export const RELAY_TENDER_INTEGRITY =
	HULL_SPECS[RELAY_TENDER_HULL_ID].integrity;
/** The hit sphere: half the envelope's diagonal, so it holds the built hull. */
export const RELAY_TENDER_HIT_RADIUS_KM = (() => {
	const { lengthKm, beamKm, heightKm } = HULL_SPECS[RELAY_TENDER_HULL_ID].env;
	return Math.hypot(lengthKm, beamKm, heightKm) / 2;
})();

/** Whether a shot along the sightline lands on the tender: the duel's own beam
 *  test against the tender's hull sphere, as `relayInSights` is the relay's. */
export const tenderInSights = (
	aimOrigin: Vec3,
	aimNose: Vec3,
	tenderPos: Vec3,
): boolean =>
	playerLaserHit(aimOrigin, aimNose, tenderPos, RELAY_TENDER_HIT_RADIUS_KM).hit;

/** When a repair's tender arrives: one repair period before it completes. */
export const tenderArrival = (recovery: { completesAt: number }): number =>
	recovery.completesAt - RELAY_REPAIR_S;

/**
 * Whether the tender is there at `now`, and since when: the relay is being
 * replaced, the tender's own slot is operational, and its arrival has come.
 * Null otherwise.
 */
export function tenderPresentSince(
	relay: EffectiveCarrier,
	tender: EffectiveCarrier,
	now: number,
): number | null {
	if (relay.condition !== "repairing") return null;
	if (relay.recovery?.kind !== "replacement") return null;
	if (tender.condition !== "operational") return null;
	const arrival = tenderArrival(relay.recovery);
	return now >= arrival ? arrival : null;
}

/** The direction a system's tender comes in from, a unit vector on its own
 *  stream. */
export function tenderEntry(systemSeed: number): Vec3 {
	const rand = stream(systemSeed, DOMAIN.RELAY_TENDER);
	const z = 2 * rand() - 1;
	const phi = 2 * Math.PI * rand();
	const r = Math.sqrt(Math.max(0, 1 - z * z));
	return v3(r * Math.cos(phi), r * Math.sin(phi), z);
}

/**
 * The tender relative to the relay, `sinceS` after it arrived: straight in
 * along `entry`, easing out to its parking offset, then still. The velocity is
 * the offset's exact derivative, so a contact placed from it leads correctly.
 */
export function tenderOffset(
	entry: Vec3,
	sinceS: number,
): { offset: Vec3; vel: Vec3 } {
	const s = Math.max(0, Math.min(1, sinceS / RELAY_TENDER_INBOUND_S));
	const eased = 1 - (1 - s) ** 3;
	const km =
		RELAY_TENDER_ENTRY_KM +
		(RELAY_TENDER_PARK_KM - RELAY_TENDER_ENTRY_KM) * eased;
	const rate =
		s >= 1
			? 0
			: ((RELAY_TENDER_PARK_KM - RELAY_TENDER_ENTRY_KM) * 3 * (1 - s) ** 2) /
				RELAY_TENDER_INBOUND_S;
	return { offset: scale(entry, km), vel: scale(entry, rate) };
}

/** The tender's kill: a `destroy` whose replacement completes one wreck later,
 *  when the next tender is due. */
export function tenderDestruction(
	systemIndex: number,
	now: number,
): TransitionEvent {
	return {
		kind: "destroy",
		occurredAt: now,
		cause: PLAYER_KILL,
		schedule: {
			startsAt: now + RELAY_WRECK_S / 2,
			completesAt: now + RELAY_WRECK_S,
			consequenceArea: `relay-repair:${systemIndex}`,
			cause: relayReplacementActor(systemIndex),
		},
	};
}

/** The relay's side of a tender kill: opposition, in §4's words, moving the
 *  replacement's completion out by a wreck and a repair. */
export function relaySetBack(
	now: number,
	consequenceArea: string,
): TransitionEvent {
	return {
		kind: "recovery-change",
		occurredAt: now,
		cause: PLAYER_KILL,
		completesAt: now + RELAY_WRECK_S + RELAY_REPAIR_S,
		consequenceArea,
	};
}

/**
 * The tender's Communications lines for one system at `gameTime`, newest
 * first: its current arrival, while the relay is being replaced, and its last
 * kill. The relay's own three lines are `relayLog`'s.
 */
export function tenderLog(
	env: GalaxyEnvelope,
	systemIndex: number,
	gameTime: number,
): RaiderLogLine[] {
	const relayKey = relaySlot(systemIndex).key;
	const tenderKey = relayTenderSlot(systemIndex).key;
	const lines: RaiderLogLine[] = [];
	const relay = effectiveCarrier(env, relayKey, gameTime);
	if (
		relay.condition === "repairing" &&
		relay.recovery?.kind === "replacement"
	) {
		const arrival = tenderArrival(relay.recovery);
		if (gameTime >= arrival)
			lines.push({
				at: arrival,
				key: tenderKey,
				text: `${RELAY_TENDER_NAME} inbound`,
			});
	}
	const episode = env.episodes[tenderKey];
	if (
		episode?.initiating.kind === "destroy" &&
		episode.initiating.occurredAt <= gameTime
	)
		lines.push({
			at: episode.initiating.occurredAt,
			key: tenderKey,
			text: `${RELAY_TENDER_NAME} destroyed · relay repair set back`,
		});
	return lines.sort((a, b) => b.at - a.at);
}
