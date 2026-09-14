/**
 * `combat-model.md` §3's interdiction contest (node #324 part b).
 *
 * **One contest function for every initiator.** The initiator holds a lock
 * through a charge; the target breaks it by changing heading to open an
 * angular separation. `stepContest` takes an initiator heading and a target
 * heading and nothing that says which is the player, which is
 * `in-system-travel.md` §9 row 7's "the identical code path with roles
 * swapped" as a signature rather than a promise.
 *
 * **A heading contest, not a bearing one — the principal's ruling (O1,
 * 2026-09-14).** The first build locked on *bearing* (the initiator's nose on
 * the target's position) and a sweep showed cruise speed deciding it rather
 * than the pilot: below about 3,000 km/s no turn broke the lock, at
 * 10,000 km/s any turn broke it in a fifth of a second, and cruise reaches
 * 23c. Headings do not scale with speed. But a raider out-turns a courier by
 * hull law (1.10 against 0.90 rad/s), so a plain heading match can never be
 * escaped. So **holding a lock costs the initiator turn authority**: it follows
 * at `INTERDICTION_TURN_FACTOR` of its hull's rate, and a nimble target turning
 * hard opens the separation while a sluggish one cannot.
 *
 * Positions are not read during a contest. In cruise the two ships ride a
 * pinned offset (a raider cannot fly a 2 km/s dogfight controller at 100 km/s
 * or more), so range is checked once, when a contest begins, by its caller.
 *
 * Sim tier: vectors in, vectors out, no Three.js and no world.
 */
import type { FlightPerformance } from "./sim";
import { type Vec3, add, cross, dot, length, scale, sub } from "./vec3";

/** The charge a lock must be held through. #48's tuned figure. */
export const INTERDICTION_CHARGE_S = 2.5;
/** The heading separation at which a lock breaks. */
export const INTERDICTION_LOCK_DEG = 25;
/** The share of its hull's turn authority an initiator keeps while it holds a
 *  lock. What makes the contest escapable at all. */
export const INTERDICTION_TURN_FACTOR = 0.5;
/** How long an initiator may try for a first lock before it gives up. */
export const INTERDICTION_ACQUIRE_S = 8;
/** How close a target must be for a contest to begin. Well inside scanner
 *  range, so a contest is only run against a contact the pilot can see. */
export const INTERDICTION_RANGE_KM = 60;

const LOCK_COS = Math.cos((INTERDICTION_LOCK_DEG * Math.PI) / 180);

export type ContestPhase =
	/** No lock yet. */
	| "acquiring"
	/** Locked and charging. */
	| "charging"
	/** Charged: both ships drop out of cruise. */
	| "succeeded"
	/** The target broke a held lock. Terminal. */
	| "broken"
	/** The initiator never got a lock in time. Terminal. */
	| "lost";

export interface Contest {
	phase: ContestPhase;
	/** Seconds of held lock in the current charge. */
	chargeS: number;
	/** Seconds since the contest began. */
	elapsedS: number;
}

export const beginContest = (): Contest => ({
	phase: "acquiring",
	chargeS: 0,
	elapsedS: 0,
});

const unit = (v: Vec3, fallback: Vec3): Vec3 => {
	const m = length(v);
	return m === 0 ? fallback : scale(v, 1 / m);
};

/** The separation between two headings, radians. */
export function headingSeparation(a: Vec3, b: Vec3): number {
	const c = dot(unit(a, a), unit(b, b));
	return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** The initiator's lock: its heading within the cone of the target's. */
export const lockHeld = (initiatorNose: Vec3, targetNose: Vec3): boolean =>
	dot(unit(initiatorNose, initiatorNose), unit(targetNose, targetNose)) >=
	LOCK_COS;

export function stepContest(
	contest: Contest,
	initiatorNose: Vec3,
	targetNose: Vec3,
	dt: number,
): Contest {
	if (
		contest.phase === "succeeded" ||
		contest.phase === "broken" ||
		contest.phase === "lost"
	)
		return contest;
	const step = Math.max(0, dt);
	const elapsedS = contest.elapsedS + step;
	const locked = lockHeld(initiatorNose, targetNose);
	if (contest.phase === "charging" && !locked)
		return { phase: "broken", chargeS: 0, elapsedS };
	if (!locked)
		return {
			phase: elapsedS >= INTERDICTION_ACQUIRE_S ? "lost" : "acquiring",
			chargeS: 0,
			elapsedS,
		};
	const chargeS = contest.chargeS + step;
	return {
		phase: chargeS >= INTERDICTION_CHARGE_S ? "succeeded" : "charging",
		chargeS,
		elapsedS,
	};
}

/**
 * How fast a hull can turn its nose in cruise: the slower of its pitch and yaw
 * ceilings. The player's own turn is bounded by the same figures through
 * `stepAngular`, so initiator and target turn under one rule.
 */
export const cruiseTurnRate = (performance: FlightPerformance): number =>
	Math.min(performance.angularMax.pitch, performance.angularMax.yaw);

/** What an initiator can turn while it holds a lock. */
export const interdictionTurnRate = (performance: FlightPerformance): number =>
	cruiseTurnRate(performance) * INTERDICTION_TURN_FACTOR;

/**
 * Turn `nose` toward `wantNose` by at most `turnRateRadS × dt`. The initiator's
 * half of a contest: it follows the target's heading.
 */
export function followHeading(
	nose: Vec3,
	wantNose: Vec3,
	turnRateRadS: number,
	dt: number,
): Vec3 {
	const from = unit(nose, nose);
	const want = unit(wantNose, from);
	const c = Math.max(-1, Math.min(1, dot(from, want)));
	const angle = Math.acos(c);
	const max = Math.max(0, turnRateRadS) * Math.max(0, dt);
	if (!(angle > max)) return want;
	// The turn is in the plane of `from` and `want`; at ~180° that plane is
	// undefined and any perpendicular will do.
	let across = sub(want, scale(from, c));
	if (length(across) < 1e-12) {
		const reference =
			Math.abs(from.y) < 0.85 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
		across = cross(from, reference);
	}
	return unit(
		add(scale(from, Math.cos(max)), scale(unit(across, from), Math.sin(max))),
		from,
	);
}
