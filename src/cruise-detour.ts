/**
 * Bounded, deterministic route geometry for cruise detours.
 *
 * This module chooses temporary waypoints only.  It neither advances the ship
 * nor decides collision: every flown segment still goes through advanceCruise's
 * moving-body guard.  Keeping that distinction explicit stops a route preview
 * from becoming a second, weaker collision implementation.
 */
import { HOST_CLEARANCE_KM, SURFACE_MARGIN, type Mass } from "./cruise";
import { type Vec3, add, cross, dot, length, scale, sub, v3 } from "./vec3";

export interface DetourPlan {
	bodyId: string;
	side: -1 | 1;
	waypoints: readonly [Vec3, Vec3];
	/** Two candidates times three segments: a fixed route-work budget. */
	checkedSegments: number;
}

export interface DetourInput {
	from: Vec3;
	target: Vec3;
	blocker: Mass;
	masses: readonly Mass[];
	targetParentId: string | null;
	/** Preserve a valid side across replans rather than oscillating. */
	previousSide?: -1 | 1;
	/** Evaluate mass centres at this linear frame offset without cloning them. */
	projectionS?: number;
}

const ROUTE_MARGIN_KM = 20;
const EPSILON = 1e-9;

const unit = (v: Vec3): Vec3 | null => {
	const n = length(v);
	return n > EPSILON ? scale(v, 1 / n) : null;
};

const liveGuardKm = (mass: Mass, targetParentId: string | null): number =>
	mass.id === targetParentId
		? mass.radiusKm + HOST_CLEARANCE_KM
		: mass.radiusKm * SURFACE_MARGIN;

/** The planner keeps a small extra clearance beyond the live guard. */
const guardKm = (mass: Mass, targetParentId: string | null): number =>
	liveGuardKm(mass, targetParentId) + ROUTE_MARGIN_KM;

/** Squared distance from a finite segment to a point, without allocation. */
function segmentDistanceKm(
	a: Vec3,
	b: Vec3,
	px: number,
	py: number,
	pz: number,
): number {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const abz = b.z - a.z;
	const abSq = abx * abx + aby * aby + abz * abz;
	const apx = px - a.x;
	const apy = py - a.y;
	const apz = pz - a.z;
	if (abSq <= EPSILON) return Math.hypot(apx, apy, apz);
	const t = Math.max(
		0,
		Math.min(1, (apx * abx + apy * aby + apz * abz) / abSq),
	);
	return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
}

/**
 * Whether a preview limb is stopped by the same shell rule as cruise.
 *
 * A ship already within a widened guard shell may leave it freely unless its
 * heading would take it into the real body.  The live integrator owns that
 * release rule; the preview mirrors it only to avoid refusing a safe outward
 * cruise before the integrator can apply it.
 */
function projectedGuardBlocked(
	a: Vec3,
	b: Vec3,
	mass: Mass,
	targetParentId: string | null,
	projectionS: number,
): boolean {
	const vx = mass.vel?.x ?? 0;
	const vy = mass.vel?.y ?? 0;
	const vz = mass.vel?.z ?? 0;
	const centreX = mass.pos.x + vx * projectionS;
	const centreY = mass.pos.y + vy * projectionS;
	const centreZ = mass.pos.z + vz * projectionS;
	const guard = guardKm(mass, targetParentId);
	const liveGuard = liveGuardKm(mass, targetParentId);
	const fromX = a.x - centreX;
	const fromY = a.y - centreY;
	const fromZ = a.z - centreZ;
	const startsInsideLiveGuard =
		fromX * fromX + fromY * fromY + fromZ * fromZ <= liveGuard * liveGuard;
	if (!startsInsideLiveGuard)
		return segmentDistanceKm(a, b, centreX, centreY, centreZ) <= guard;

	const direction = sub(b, a);
	const directionLength = length(direction);
	if (directionLength <= EPSILON)
		return fromX * fromX + fromY * fromY + fromZ * fromZ <= mass.radiusKm ** 2;
	const towardCentre =
		(-fromX * direction.x - fromY * direction.y - fromZ * direction.z) /
		directionLength;
	if (towardCentre <= 0) return false;
	return (
		fromX * fromX + fromY * fromY + fromZ * fromZ - towardCentre ** 2 <
		mass.radiusKm ** 2
	);
}

function segmentIsClear(
	a: Vec3,
	b: Vec3,
	masses: readonly Mass[],
	targetParentId: string | null,
	projectionS = 0,
): boolean {
	return masses.every(
		(mass) => !projectedGuardBlocked(a, b, mass, targetParentId, projectionS),
	);
}

/** The first guarded mass on a direct preview; the live guard remains final. */
export function cruiseRouteBlocker(
	from: Vec3,
	target: Vec3,
	masses: readonly Mass[],
	targetParentId: string | null,
	projectionS = 0,
): Mass | null {
	return (
		masses.find((mass) =>
			projectedGuardBlocked(from, target, mass, targetParentId, projectionS),
		) ?? null
	);
}

function stablePerpendicular(
	radial: Vec3,
	target: Vec3,
	key: string,
): Vec3 | null {
	const normal = unit(cross(radial, target));
	if (normal) return normal;
	// Directly-behind is collinear. Pick a reproducible axis, then remove its
	// radial component so no RNG or frame orientation leaks into the choice.
	const sum = Array.from(key).reduce((n, c) => n + c.charCodeAt(0), 0);
	const axes = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];
	for (let i = 0; i < axes.length; i++) {
		const axis = axes[(sum + i) % axes.length]!;
		const perpendicular = unit(sub(axis, scale(radial, dot(radial, axis))));
		if (perpendicular) return perpendicular;
	}
	return null;
}

/**
 * Return a two-waypoint bypass around one known blocking body, or null if
 * neither side clears every supplied mass.  Candidate geometry is intentionally
 * finite: no search tree, no unbounded orbit following, no target replacement.
 */
export function planCruiseDetour(input: DetourInput): DetourPlan | null {
	const projectionS = input.projectionS ?? 0;
	const blockerPos = {
		x: input.blocker.pos.x + (input.blocker.vel?.x ?? 0) * projectionS,
		y: input.blocker.pos.y + (input.blocker.vel?.y ?? 0) * projectionS,
		z: input.blocker.pos.z + (input.blocker.vel?.z ?? 0) * projectionS,
	};
	const radialFrom = unit(sub(input.from, blockerPos));
	const radialTarget = unit(sub(input.target, blockerPos));
	if (!radialFrom || !radialTarget) return null;
	const lateral = stablePerpendicular(
		radialFrom,
		radialTarget,
		`${input.blocker.id}:${input.targetParentId ?? "none"}`,
	);
	if (!lateral) return null;
	// A point merely on the guard shell is not enough: the incoming chord can
	// still cut through it.  Twice the guarded radius gives the two 45 degree
	// entry/exit chords a positive tangent margin before the real sweep checks
	// the flown segments.
	const radius = guardKm(input.blocker, input.targetParentId) * 2;
	const candidates = ([-1, 1] as const)
		.map((side) => {
			const offset = scale(lateral, side);
			const entry = scale(add(radialFrom, offset), radius / Math.SQRT2);
			const exit = scale(add(radialTarget, offset), radius / Math.SQRT2);
			const waypoints: [Vec3, Vec3] = [
				add(blockerPos, entry),
				add(blockerPos, exit),
			];
			// Keep the reported six-segment work bound honest: all three limbs are
			// evaluated for both candidates, even when an early limb is blocked.
			const clear = [
				segmentIsClear(
					input.from,
					waypoints[0],
					input.masses,
					input.targetParentId,
					projectionS,
				),
				segmentIsClear(
					waypoints[0],
					waypoints[1],
					input.masses,
					input.targetParentId,
					projectionS,
				),
				segmentIsClear(
					waypoints[1],
					input.target,
					input.masses,
					input.targetParentId,
					projectionS,
				),
			].every(Boolean);
			const score =
				length(sub(waypoints[0], input.from)) +
				length(sub(waypoints[1], waypoints[0])) +
				length(sub(input.target, waypoints[1]));
			return { side, waypoints, clear, score };
		})
		.filter((candidate) => candidate.clear);
	if (!candidates.length) return null;
	const retained = candidates.find(
		(candidate) => candidate.side === input.previousSide,
	);
	const chosen =
		retained ??
		candidates.sort((a, b) => a.score - b.score || a.side - b.side)[0]!;
	return {
		bodyId: input.blocker.id,
		side: chosen.side,
		waypoints: chosen.waypoints,
		checkedSegments: 6,
	};
}
