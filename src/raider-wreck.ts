/**
 * What a destroyed raider leaves behind (node #324 part d).
 *
 * **A lifecycle, not a despawn** (`combat-model.md` §4). A destroyed raider is
 * a world-state `destroy` with the player's provenance, and the destruction
 * schedules its own replacement: destroyed for `RAIDER_WRECK_S`, repairing for
 * `RAIDER_REPAIR_S`, then replaced. The principal split §4's thirty minutes
 * into ten and twenty (2026-09-14), and chose the lazy scheduled start in
 * `world-state.ts` so the lifecycle runs on the game clock wherever the player
 * is.
 *
 * **And cargo.** The wreck drops one to three one-tonne canisters. They are
 * drawn from the kill's own stream, with illegal goods likelier the more
 * lawless the system. They drift on the raider's last velocity and expire
 * after `CANISTER_LIFETIME_S`. Any ship scoops one by passing close at low
 * relative speed, with no module fitted (the principal's rulings).
 *
 * Headless: `Game` draws and applies what this returns.
 */
import type { CarrierKey } from "./carrier-key";
import { DOMAIN } from "./domains";
import { stream } from "./galaxy";
import { COMMODITIES, type Commodity } from "./market";
import { mix } from "./rng";
import { type Vec3, add, length, scale, sub, v3 } from "./vec3";
import { type Provenance, type TransitionEvent, fnv1a } from "./world-state";

/** How long a destroyed raider stays destroyed before its replacement starts. */
export const RAIDER_WRECK_S = 600;
/** How long the replacement takes once started. */
export const RAIDER_REPAIR_S = 1200;

/** The player's kill, as §5's provenance records it. */
export const PLAYER_KILL: Provenance = {
	causeKind: "player-weapons",
	actorId: "player",
	playerRole: "direct",
};

/** Who replaces a system's raiders. Out of sight, so it updates no knowledge. */
export const raiderReplacementActor = (systemIndex: number): Provenance => ({
	causeKind: "raider-replacement",
	actorId: `raider-network-${systemIndex}`,
	playerRole: "none",
});

/** The world-state transition a player's kill applies to the raider's slot. */
export function raiderDestruction(
	systemIndex: number,
	now: number,
): TransitionEvent {
	return {
		kind: "destroy",
		occurredAt: now,
		cause: PLAYER_KILL,
		schedule: {
			startsAt: now + RAIDER_WRECK_S,
			completesAt: now + RAIDER_WRECK_S + RAIDER_REPAIR_S,
			consequenceArea: `system:${systemIndex}`,
			cause: raiderReplacementActor(systemIndex),
		},
	};
}

/** How long a canister drifts before it is gone. */
export const CANISTER_LIFETIME_S = 300;
export const CANISTER_TONNES = 1;
export const CANISTER_COUNT = { min: 1, max: 3 } as const;
/** How close a ship must pass to scoop one. */
export const CANISTER_SCOOP_RADIUS_KM = 0.05;
/** And how slowly, relative to the canister. */
export const CANISTER_SCOOP_SPEED_KMS = 0.25;
/** The largest velocity a canister gains on top of the wreck's, per axis. */
export const CANISTER_SPREAD_KMS = 0.02;

export interface Canister {
	id: string;
	commodity: string;
	tonnes: number;
	pos: Vec3;
	vel: Vec3;
	expiresAt: number;
}

/**
 * The goods a wreck can carry, with their weights. Tonne goods only, since a
 * canister is a tonne, and nothing a station cannot buy. An illegal good weighs
 * `(7 − government) / 7` of a legal one, so an Anarchy's raiders carry
 * contraband as often as anything else and a Corporate State's carry none.
 */
export function cargoWeights(
	government: number,
): { good: Commodity; weight: number }[] {
	const g = Math.max(0, Math.min(7, Math.round(government)));
	return COMMODITIES.filter((c) => c.unit === "t" && !c.sellOnly).map(
		(good) => ({ good, weight: good.illegal ? (7 - g) / 7 : 1 }),
	);
}

/** The canisters one kill drops. The same kill always drops the same ones. */
export function dropCanisters(kill: {
	systemSeed: number;
	government: number;
	key: CarrierKey;
	killedAt: number;
	pos: Vec3;
	vel: Vec3;
}): Canister[] {
	const second = Math.floor(kill.killedAt) >>> 0;
	const rand = stream(
		mix(mix(kill.systemSeed, fnv1a(kill.key)), second),
		DOMAIN.CARGO_DROP,
	);
	const span = CANISTER_COUNT.max - CANISTER_COUNT.min + 1;
	const count =
		CANISTER_COUNT.min + Math.min(span - 1, Math.floor(rand() * span));
	const weights = cargoWeights(kill.government);
	const total = weights.reduce((sum, w) => sum + w.weight, 0);
	const spread = () => (rand() * 2 - 1) * CANISTER_SPREAD_KMS;
	return Array.from({ length: count }, (_, i) => {
		let pick = rand() * total;
		let good = weights[weights.length - 1].good;
		for (const w of weights) {
			if (pick < w.weight) {
				good = w.good;
				break;
			}
			pick -= w.weight;
		}
		return {
			id: `${kill.key}#canister-${second}-${i}`,
			commodity: good.name,
			tonnes: CANISTER_TONNES,
			pos: kill.pos,
			vel: add(kill.vel, v3(spread(), spread(), spread())),
			expiresAt: kill.killedAt + CANISTER_LIFETIME_S,
		};
	});
}

/** One canister moved one step along its velocity. */
export const driftCanister = (c: Canister, dt: number): Canister => ({
	...c,
	pos: add(c.pos, scale(c.vel, dt)),
});

/** Drift every canister by one step, and drop those that have expired. */
export function stepCanisters(
	canisters: readonly Canister[],
	dt: number,
	now: number,
): Canister[] {
	return canisters
		.filter((c) => now < c.expiresAt)
		.map((c) => driftCanister(c, dt));
}

/** Whether a ship scoops the canister now: close, and slow relative to it. */
export const scoops = (
	canister: Canister,
	ship: { pos: Vec3; vel: Vec3 },
): boolean =>
	length(sub(canister.pos, ship.pos)) <= CANISTER_SCOOP_RADIUS_KM &&
	length(sub(canister.vel, ship.vel)) <= CANISTER_SCOOP_SPEED_KMS;
