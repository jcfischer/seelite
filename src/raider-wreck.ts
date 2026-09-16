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
import { carrierKeySeed } from "./carrier-standing";
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
export const raiderDestruction = (
	systemIndex: number,
	now: number,
): TransitionEvent =>
	playerKillDestruction(systemIndex, now, raiderReplacementActor(systemIndex));

/**
 * A player's kill of any carrier (`combat-model.md` §4): destroyed for
 * `RAIDER_WRECK_S`, repairing for `RAIDER_REPAIR_S`, then replaced by
 * `replacedBy`. The raider and ordinary traffic (#362) differ only in who
 * does the replacing, so the lifecycle figures live here once.
 */
export function playerKillDestruction(
	systemIndex: number,
	now: number,
	replacedBy: Provenance,
): TransitionEvent {
	return {
		kind: "destroy",
		occurredAt: now,
		cause: PLAYER_KILL,
		schedule: {
			startsAt: now + RAIDER_WRECK_S,
			completesAt: now + RAIDER_WRECK_S + RAIDER_REPAIR_S,
			consequenceArea: `system:${systemIndex}`,
			cause: replacedBy,
		},
	};
}

/** How long a canister drifts before it is gone. */
export const CANISTER_LIFETIME_S = 300;
export const CANISTER_TONNES = 1;
export const CANISTER_COUNT = { min: 1, max: 3 } as const;
/** How close a ship must pass to scoop one. */
export const CANISTER_SCOOP_RADIUS_KM = 0.05;
/** How big one is: a two-metre drum. This is the contact's display size and
 *  never the scoop gate, which is a distance a ship has to close to. */
export const CANISTER_RADIUS_KM = 0.002;
/** The green a canister is drawn and listed in, as one number, and the same
 *  green for the 2D overlay — derived rather than written out again, so the
 *  diamond and the contact cannot drift apart. Here beside the canister rather
 *  than in `display-contact.ts`, which owns the shared *shape* and not one
 *  producer's presentation (sage #353); a string keeps this module Three-free. */
export const CARGO_CONTACT_COLOUR = 0x96f0aa;
export const CARGO_CONTACT_CSS = `rgba(${(CARGO_CONTACT_COLOUR >> 16) & 255}, ${
	(CARGO_CONTACT_COLOUR >> 8) & 255
}, ${CARGO_CONTACT_COLOUR & 255}, 0.9)`;
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
	/** Its velocity now, which falls linearly toward the velocity of its own
	 *  frame body (`frameBodyId`), as that frame stands each step. Not "the
	 *  local frame": this repo uses that for `localFrame()`, the *observer's*,
	 *  which is what `frameBodyId` exists to rule out. It held the frame's
	 *  velocity *at the kill* until the sixth playtest: a station's frame keeps
	 *  turning, so a canister that froze one flew off the curve the pilot's
	 *  assist holds them on, and never came to rest beside them. */
	vel: Vec3;
	/**
	 * The body whose frame this canister comes to rest in — the one the kill
	 * happened beside — or `null` for the star frame.
	 *
	 * **Its own, not the observer's** (sage #355). Resting in the *player's*
	 * local frame works only while the player stays beside the same body: fly
	 * past `NEAR_FAR_KM` and that frame becomes the star's, so every canister
	 * left at the station would snap from ~29 km/s to rest and be gone long
	 * before the five minutes are up.
	 */
	frameBodyId: string | null;
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
	/** The body the kill happened beside, whose frame the canisters rest in. */
	frameBodyId: string | null;
}): Canister[] {
	const { second, rand } = dropStream(kill);
	const span = CANISTER_COUNT.max - CANISTER_COUNT.min + 1;
	const count =
		CANISTER_COUNT.min + Math.min(span - 1, Math.floor(rand() * span));
	const weights = cargoWeights(kill.government);
	const eject = ejectionRing(kill, rand, count);
	return eject.map((vel, i) => {
		const good = weights[pickWeightedIndex(weights, rand)].good;
		return canisterAt(kill, second, i, {
			commodity: good.name,
			tonnes: CANISTER_TONNES,
			vel,
		});
	});
}

/**
 * One weighted draw: the index whose weight the draw lands in, the last when
 * rounding leaves it past the end. One draw from `rand`. Shared by a raider's
 * drop and an ordinary carrier's manifest, which both pick over `cargoWeights`.
 */
export function pickWeightedIndex(
	weights: readonly { weight: number }[],
	rand: () => number,
): number {
	const total = weights.reduce((sum, w) => sum + w.weight, 0);
	let pick = rand() * total;
	for (let i = 0; i < weights.length; i++) {
		if (pick < weights[i].weight) return i;
		pick -= weights[i].weight;
	}
	return weights.length - 1;
}

/** A kill's own stream, split by the carrier and the second of the kill, so no
 *  two kills share a draw. */
function dropStream(kill: {
	systemSeed: number;
	key: CarrierKey;
	killedAt: number;
}): { second: number; rand: () => number } {
	const second = Math.floor(kill.killedAt) >>> 0;
	return {
		second,
		rand: stream(
			mix(carrierKeySeed(kill.systemSeed, kill.key), second),
			DOMAIN.CARGO_DROP,
		),
	};
}

/**
 * What a destroyed **ordinary** carrier drops (`civilian-combat.md` H11): one
 * canister per line of the manifest a scan would have shown, each holding its
 * line's tonnes. The goods are not drawn here — `carrierManifest` is the one
 * draw of a hold, so what drops cannot differ from what was scanned. Only the
 * ejection is drawn, on the kill's own stream as a raider's is.
 */
export function dropManifestCanisters(kill: {
	systemSeed: number;
	key: CarrierKey;
	manifest: readonly { good: string; tonnes: number }[];
	killedAt: number;
	pos: Vec3;
	vel: Vec3;
	frameVel: Vec3;
	frameBodyId: string | null;
}): Canister[] {
	if (kill.manifest.length === 0) return [];
	const { second, rand } = dropStream(kill);
	return ejectionRing(kill, rand, kill.manifest.length).map((vel, i) =>
		canisterAt(kill, second, i, {
			commodity: kill.manifest[i].good,
			tonnes: kill.manifest[i].tonnes,
			vel,
		}),
	);
}

/**
 * Each canister's velocity leaving the wreck: the frame's, plus
 * `CANISTER_KEEP_FRACTION` of the wreck's own relative to it, plus
 * `CANISTER_EJECT_KMS` out round a drawn circle, evenly spaced.
 */
function ejectionRing(
	kill: { vel: Vec3; frameVel: Vec3 },
	rand: () => number,
	count: number,
): Vec3[] {
	const drift = add(
		kill.frameVel,
		scale(sub(kill.vel, kill.frameVel), CANISTER_KEEP_FRACTION),
	);
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
		return add(drift, scale(out, CANISTER_EJECT_KMS));
	});
}

const canisterAt = (
	kill: {
		key: CarrierKey;
		killedAt: number;
		pos: Vec3;
		frameBodyId: string | null;
	},
	second: number,
	i: number,
	{ commodity, tonnes, vel }: { commodity: string; tonnes: number; vel: Vec3 },
): Canister => ({
	id: `${kill.key}#canister-${second}-${i}`,
	commodity,
	tonnes,
	pos: kill.pos,
	vel,
	frameBodyId: kill.frameBodyId,
	restsAt: kill.killedAt + CANISTER_FADE_S,
	expiresAt: kill.killedAt + CANISTER_LIFETIME_S,
});

/**
 * One canister moved one step, from game time `now`. Its velocity relative to
 * `frameVel` falls in a straight line to zero at `restsAt`. It moves with
 * `frameVel` for the whole step, and with the fading part on that part's mean
 * only until it reaches rest, so the step that crosses `restsAt` is exact too
 * (sage #346: it had moved on the mean for the whole step and overshot).
 *
 * **`frameVel` is the canister's own frame — the body in `frameBodyId` — as it
 * stands: not a snapshot taken at the kill, and not the observer's
 * `localFrame()`.** A canister carried its own copy of the kill's frame until the sixth
 * playtest reported cargo "on trajectories much longer than 10s". It was: the
 * fade finished on time, but beside a station the frame keeps turning, so the
 * frozen straight line peeled away from the curve the pilot's assist parks
 * them on — 55 km out and still opening at 0.94 km/s two minutes after resting
 * on a **synthesized** drop beside a station
 * (`scripts/measure-canister-drift.mjs`). A flown kill cannot reach that case:
 * interdictions happen on cruise legs, 1e8 km from anything, where both rules
 * give the star frame. See `combat-model.md` §4.1 on what this does and does
 * not explain.
 */
export function driftCanister(
	c: Canister,
	dt: number,
	now: number,
	frameVel: Vec3,
): Canister {
	const left = c.restsAt - now;
	const fading = Math.min(dt, Math.max(0, left));
	const share = left > 0 ? (left - fading) / left : 0;
	const relative = sub(c.vel, frameVel);
	const pos = add(
		add(c.pos, scale(frameVel, dt)),
		scale(relative, ((1 + share) / 2) * fading),
	);
	return { ...c, pos, vel: add(frameVel, scale(relative, share)) };
}

/** A scoop tried this step: taken into the hold, or refused by a full one. */
export interface CanisterScoop {
	canister: Canister;
	accepted: boolean;
	/** Tonnes taken. Less than the canister holds when the hold had less room
	 *  (`civilian-combat.md` H11), and the rest stays in the canister. */
	tonnes: number;
}

/**
 * One step of the canisters in flight: drop the expired ones, let the ship
 * scoop any it passes close and slow, and drift the rest. `accept` puts what
 * fits of a canister into the hold and returns the tonnes it took. A refused
 * canister stays in space and drifts on (sage #330), and so does what is left
 * of one the hold could only partly take (H11).
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
	accept: (canister: Canister) => number,
	/**
	 * The frame **this canister** comes to rest in, this step. Per canister and
	 * not one vector for all of them: the frame belongs to the body the kill
	 * happened beside, and the observer may be anywhere (sage #355). Required
	 * for `FlightPerformance`'s reason — a caller that forgot would silently
	 * bring every canister to rest in star coordinates.
	 */
	frameVelFor: (canister: Canister) => Vec3,
): { kept: Canister[]; scoops: CanisterScoop[] } {
	const kept: Canister[] = [];
	const tried: CanisterScoop[] = [];
	for (const canister of canisters) {
		if (now >= canister.expiresAt) continue;
		let left = canister;
		if (scoops(canister, ship)) {
			const tonnes = Math.max(0, Math.min(canister.tonnes, accept(canister)));
			tried.push({ canister, accepted: tonnes > 0, tonnes });
			if (tonnes >= canister.tonnes) continue;
			if (tonnes > 0) left = { ...canister, tonnes: canister.tonnes - tonnes };
		}
		kept.push(driftCanister(left, dt, now, frameVelFor(canister)));
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
