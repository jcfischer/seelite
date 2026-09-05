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
}

const ROUTE_MARGIN_KM = 20;
const EPSILON = 1e-9;

const unit = (v: Vec3): Vec3 | null => {
	const n = length(v);
	return n > EPSILON ? scale(v, 1 / n) : null;
};

const guardKm = (mass: Mass, targetParentId: string | null): number =>
	mass.id === targetParentId
		? mass.radiusKm + HOST_CLEARANCE_KM + ROUTE_MARGIN_KM
		: mass.radiusKm * SURFACE_MARGIN + ROUTE_MARGIN_KM;

/** Squared distance from a finite segment to a point, without allocation. */
function segmentDistanceKm(a: Vec3, b: Vec3, point: Vec3): number {
	const ab = sub(b, a);
	const abSq = dot(ab, ab);
	if (abSq <= EPSILON) return length(sub(point, a));
	const t = Math.max(0, Math.min(1, dot(sub(point, a), ab) / abSq));
	return length(sub(point, add(a, scale(ab, t))));
}

function segmentIsClear(
	a: Vec3,
	b: Vec3,
	masses: readonly Mass[],
	targetParentId: string | null,
): boolean {
	return masses.every((mass) =>
		segmentDistanceKm(a, b, mass.pos) > guardKm(mass, targetParentId),
	);
}

/** The first guarded mass on a direct preview; the live guard remains final. */
export function cruiseRouteBlocker(
	from: Vec3,
	target: Vec3,
	masses: readonly Mass[],
	targetParentId: string | null,
): Mass | null {
	return (
		masses.find(
			(mass) => segmentDistanceKm(from, target, mass.pos) <= guardKm(mass, targetParentId),
		) ?? null
	);
}

function stablePerpendicular(radial: Vec3, target: Vec3, key: string): Vec3 | null {
	const normal = unit(cross(radial, target));
	if (normal) return normal;
	// Directly-behind is collinear. Pick a reproducible axis, then remove its
	// radial component so no RNG or frame orientation leaks into the choice.
	const sum = Array.from(key).reduce((n, c) => n + c.charCodeAt(0), 0);
	const axis = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)][sum % 3]!;
	return unit(sub(axis, scale(radial, dot(radial, axis))));
}

/**
 * Return a two-waypoint bypass around one known blocking body, or null if
 * neither side clears every supplied mass.  Candidate geometry is intentionally
 * finite: no search tree, no unbounded orbit following, no target replacement.
 */
export function planCruiseDetour(input: DetourInput): DetourPlan | null {
	const radialFrom = unit(sub(input.from, input.blocker.pos));
	const radialTarget = unit(sub(input.target, input.blocker.pos));
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
				add(input.blocker.pos, entry),
				add(input.blocker.pos, exit),
			];
			const clear =
				segmentIsClear(input.from, waypoints[0], input.masses, input.targetParentId) &&
				segmentIsClear(waypoints[0], waypoints[1], input.masses, input.targetParentId) &&
				segmentIsClear(waypoints[1], input.target, input.masses, input.targetParentId);
			const score =
				length(sub(waypoints[0], input.from)) +
				length(sub(waypoints[1], waypoints[0])) +
				length(sub(input.target, waypoints[1]));
			return { side, waypoints, clear, score };
		})
		.filter((candidate) => candidate.clear);
	if (!candidates.length) return null;
	const retained = candidates.find((candidate) => candidate.side === input.previousSide);
	const chosen = retained ?? candidates.sort((a, b) => a.score - b.score || a.side - b.side)[0]!;
	return {
		bodyId: input.blocker.id,
		side: chosen.side,
		waypoints: chosen.waypoints,
		checkedSegments: 6,
	};
}
