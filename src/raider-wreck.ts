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
 * lawless the system. They keep a fifth of the raider's last velocity
 * relative to the local frame, leave the wreck in different directions, come to
 * rest in that frame over `CANISTER_FADE_S`, and expire after
 * `CANISTER_LIFETIME_S`. The player's ship (no raider or Traffic actor yet)
 * scoops one by passing close at low relative speed, with no module fitted (the
 * principal's rulings).
 *
 * Headless: `Game` draws and applies what this returns.
 */
import type { CarrierKey } from "./carrier-key";
import { DOMAIN } from "./domains";
import { stream } from "./galaxy";
import { COMMODITIES, type Commodity } from "./market";
import { mix } from "./rng";
import {
	type Vec3,
	add,
	cross,
	frameAcross,
	length,
	scale,
	sub,
	v3,
} from "./vec3";
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
/**
 * How fast each canister leaves the wreck, on top of the share of the wreck's
 * velocity it keeps. The canisters of one drop leave in directions spread
 * evenly round a drawn circle, so two go opposite ways and three 120° apart
 * (the principal's ruling after the fourth playtest).
 */
export const CANISTER_EJECT_KMS = 0.15;
/**
 * How long a canister takes to come to rest in its frame, slowing linearly,
 * by the same ruling. It had kept drifting, so scooping one meant matching a
 * velocity no readout shows. `scripts/measure-canister-scoop.ts` flies a pilot
 * who stops, faces and creeps in, with the fade and with it switched off. That
 * pilot cannot chase a moving canister, so the arm without the fade shows what
 * the fade is for, not that no pilot could scoop a drifting one.
 */
export const CANISTER_FADE_S = 10;
/**
 * The share of the wreck's velocity, relative to the local frame, a canister
 * keeps. **A fifth, by the principal's ruling after the third playtest.** It
 * kept all of it, and a fleeing raider dies at the assist cap: its canisters
 * held their range against a ship flying at the same cap, 22 km off for good.
 */
export const CANISTER_KEEP_FRACTION = 0.2;

export interface Canister {
	id: string;
	commodity: string;
	tonnes: number;
	pos: Vec3;
	/** Its velocity now, which falls linearly toward `restVel`. */
	vel: Vec3;
	/** The velocity of the frame it comes to rest in: the player's local frame
	 *  at the kill. */
	restVel: Vec3;
	/** When it is at rest, game-clock seconds. */
	restsAt: number;
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

/**
 * The canisters one kill drops. The same kill always drops the same ones.
 * `vel` is the wreck's, and `frameVel` the local frame the player's assist
 * flies in: a canister keeps `CANISTER_KEEP_FRACTION` of the difference.
 */
export function dropCanisters(kill: {
	systemSeed: number;
	government: number;
	key: CarrierKey;
	killedAt: number;
	pos: Vec3;
	vel: Vec3;
	frameVel: Vec3;
}): Canister[] {
	const drift = add(
		kill.frameVel,
		scale(sub(kill.vel, kill.frameVel), CANISTER_KEEP_FRACTION),
	);
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
	// The circle the canisters leave round: a drawn plane and a drawn start.
	const z = rand() * 2 - 1;
	const around = rand() * Math.PI * 2;
	const q = Math.sqrt(1 - z * z);
	const normal = v3(q * Math.cos(around), q * Math.sin(around), z);
	const a = frameAcross(normal);
	const b = cross(normal, a);
	const start = rand() * Math.PI * 2;
	return Array.from({ length: count }, (_, i) => {
		const angle = start + (2 * Math.PI * i) / count;
		const out = add(scale(a, Math.cos(angle)), scale(b, Math.sin(angle)));
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
			vel: add(drift, scale(out, CANISTER_EJECT_KMS)),
			restVel: kill.frameVel,
			restsAt: kill.killedAt + CANISTER_FADE_S,
			expiresAt: kill.killedAt + CANISTER_LIFETIME_S,
		};
	});
}

/**
 * One canister moved one step, from game time `now`. Its velocity relative to
 * `restVel` falls in a straight line to zero at `restsAt`, and it moves on the
 * mean of the step's two velocities, which is exact for a straight line.
 */
export function driftCanister(c: Canister, dt: number, now: number): Canister {
	const left = c.restsAt - now;
	const share = left > 0 ? Math.max(0, left - dt) / left : 0;
	const vel = add(c.restVel, scale(sub(c.vel, c.restVel), share));
	return { ...c, pos: add(c.pos, scale(add(c.vel, vel), dt / 2)), vel };
}

/** A scoop tried this step: taken into the hold, or refused by a full one. */
export interface CanisterScoop {
	canister: Canister;
	accepted: boolean;
}

/**
 * One step of the canisters in flight: drop the expired ones, let the ship
 * scoop any it passes close and slow, and drift the rest. `accept` puts a
 * canister into the hold and says whether it fitted. A refused canister stays
 * in space and drifts on (sage #330).
 *
 * **The scoop is tested before the drift.** `Game` steps this at the frame's
 * start, before the ship moves. A canister drifted first was a step ahead of
 * the ship it was tested against, and at combat speed that step is wider than
 * the scoop's radius, so a pass right alongside missed.
 */
export function stepCanisters(
	canisters: readonly Canister[],
	ship: { pos: Vec3; vel: Vec3 },
	dt: number,
	now: number,
	accept: (canister: Canister) => boolean,
): { kept: Canister[]; scoops: CanisterScoop[] } {
	const kept: Canister[] = [];
	const tried: CanisterScoop[] = [];
	for (const canister of canisters) {
		if (now >= canister.expiresAt) continue;
		if (scoops(canister, ship)) {
			const accepted = accept(canister);
			tried.push({ canister, accepted });
			if (accepted) continue;
		}
		kept.push(driftCanister(canister, dt, now));
	}
	return { kept, scoops: tried };
}

/** Whether a ship scoops the canister now: close, and slow relative to it. */
export const scoops = (
	canister: Canister,
	ship: { pos: Vec3; vel: Vec3 },
): boolean =>
	length(sub(canister.pos, ship.pos)) <= CANISTER_SCOOP_RADIUS_KM &&
	length(sub(canister.vel, ship.vel)) <= CANISTER_SCOOP_SPEED_KMS;
