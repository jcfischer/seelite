/**
 * `combat-model.md` §3's interdiction contest (node #324 part b).
 *
 * **What every initiator shares.** The initiator holds a lock through a charge;
 * the target breaks it by changing heading to open an angular separation.
 * `stepContest` takes an initiator heading and a target heading and nothing
 * that says which is the player, and `interdictionTurnRate` is the turn cap an
 * initiator flies under while it holds a lock. **Both halves are the contest**:
 * the lock and charge alone are escapable by nobody, because the cap is what
 * lets a nimble target out-turn its pursuer. Today only the NPC path exists and
 * it applies the cap (`encounter.ts`); a player-initiated path must read the
 * same cap while the player holds a lock, and until it is built,
 * `in-system-travel.md` §9 row 7's symmetry is a requirement on that path
 * rather than a property this module can hold by itself.
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
 * or more), so range is checked once, when a contest begins — `stepEncounter`
 * ends an encounter that appears beyond `INTERDICTION_RANGE_KM` as lost.
 *
 * Sim tier: vectors in, vectors out, no Three.js and no world.
 */
import type { FlightPerformance } from "./sim";
import {
	type Vec3,
	add,
	cross,
	dot,
	length,
	normalizeOr,
	scale,
	sub,
	v3,
} from "./vec3";

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

/**
 * A unit vector perpendicular to `nose`, from a reference that is never
 * parallel to it: world up, or world x within about 32° of the pole.
 *
 * One construction for every frame #324 builds around a heading — a roll
 * reference, a drawn offset, a turn plane that has collapsed — because four
 * copies of it were four places a change to the pole threshold had to reach.
 */
export function frameAcross(nose: Vec3): Vec3 {
	const reference = Math.abs(nose.y) < 0.85 ? v3(0, 1, 0) : v3(1, 0, 0);
	return normalizeOr(cross(nose, reference), v3(1, 0, 0));
}

/** The separation between two headings, radians. */
export function headingSeparation(a: Vec3, b: Vec3): number {
	const c = dot(normalizeOr(a, a), normalizeOr(b, b));
	return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** The initiator's lock: its heading within the cone of the target's. */
export const lockHeld = (initiatorNose: Vec3, targetNose: Vec3): boolean =>
	dot(
		normalizeOr(initiatorNose, initiatorNose),
		normalizeOr(targetNose, targetNose),
	) >= LOCK_COS;

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

/** What an initiator can turn while it holds a lock: the contest's cost. */
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
	const from = normalizeOr(nose, nose);
	const want = normalizeOr(wantNose, from);
	const c = Math.max(-1, Math.min(1, dot(from, want)));
	const angle = Math.acos(c);
	const max = Math.max(0, turnRateRadS) * Math.max(0, dt);
	if (!(angle > max)) return want;
	// The turn is in the plane of `from` and `want`; at ~180° that plane is
	// undefined and any perpendicular will do.
	const inPlane = sub(want, scale(from, c));
	const across = length(inPlane) < 1e-12 ? frameAcross(from) : inPlane;
	return normalizeOr(
		add(
			scale(from, Math.cos(max)),
			scale(normalizeOr(across, from), Math.sin(max)),
		),
		from,
	);
}
