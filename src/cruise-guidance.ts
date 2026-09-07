/** Shared Three.js-free automatic cruise steering for player detours and Traffic. */
import type { Mass } from "./cruise";
import {
	cruiseRouteBlocker,
	type DetourPlan,
	planCruiseDetour,
} from "./cruise-detour";
import { slewToward } from "./docking";
import { dot, length, scale, sub, type Vec3 } from "./vec3";

export interface CruiseGuidanceState extends DetourPlan {
	targetId: string;
	waypoint: 0 | 1 | 2;
}

export interface GuidanceTarget {
	id: string;
	pos: Vec3;
}

export interface CruiseGuidanceError {
	kind: "detour-unavailable";
	blockerId: string;
}

export function beginCruiseGuidance(input: {
	from: Vec3;
	target: GuidanceTarget;
	masses: readonly Mass[];
	targetParentId: string | null;
}): {
	guidance: CruiseGuidanceState | null;
	error: CruiseGuidanceError | null;
} {
	const blocker = cruiseRouteBlocker(
		input.from,
		input.target.pos,
		input.masses,
		input.targetParentId,
	);
	if (!blocker) return { guidance: null, error: null };
	const route = planCruiseDetour({
		from: input.from,
		target: input.target.pos,
		blocker,
		masses: input.masses,
		targetParentId: input.targetParentId,
	});
	return route
		? {
				guidance: { ...route, targetId: input.target.id, waypoint: 0 },
				error: null,
			}
		: {
				guidance: null,
				error: { kind: "detour-unavailable", blockerId: blocker.id },
			};
}

const unit = (direction: Vec3, fallback: Vec3): Vec3 => {
	const magnitude = length(direction);
	return magnitude > 0 ? scale(direction, 1 / magnitude) : fallback;
};

const angleBetween = (a: Vec3, b: Vec3): number =>
	Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

const guidanceBlocker = (
	input: {
		pos: Vec3;
		masses: readonly Mass[];
		targetParentId: string | null;
		dt: number;
	},
	point: Vec3,
) =>
	cruiseRouteBlocker(input.pos, point, input.masses, input.targetParentId) ??
	cruiseRouteBlocker(
		input.pos,
		point,
		input.masses,
		input.targetParentId,
		input.dt,
	);

const replanGuidance = (
	input: {
		pos: Vec3;
		target: GuidanceTarget;
		masses: readonly Mass[];
		targetParentId: string | null;
		dt: number;
	},
	guidance: CruiseGuidanceState,
	blocker: Mass,
): CruiseGuidanceState | null => {
	const replanned = planCruiseDetour({
		from: input.pos,
		target: input.target.pos,
		blocker,
		masses: input.masses,
		targetParentId: input.targetParentId,
		previousSide: blocker.id === guidance.bodyId ? guidance.side : undefined,
		projectionS: input.dt,
	});
	return replanned
		? { ...replanned, targetId: input.target.id, waypoint: 0 }
		: null;
};

export function stepCruiseGuidance(input: {
	guidance: CruiseGuidanceState | null;
	pos: Vec3;
	nose: Vec3;
	target: GuidanceTarget;
	masses: readonly Mass[];
	targetParentId: string | null;
	dt: number;
	speedKms: number;
	steerDirect: boolean;
}): {
	guidance: CruiseGuidanceState | null;
	nose: Vec3;
	throttle: number;
	error: CruiseGuidanceError | null;
} {
	let guidance =
		input.guidance?.targetId === input.target.id ? input.guidance : null;
	let point = input.target.pos;
	if (guidance) {
		point =
			guidance.waypoint === 2
				? input.target.pos
				: guidance.waypoints[guidance.waypoint];
		const blocker = guidanceBlocker(input, point);
		if (blocker) {
			const replanned = replanGuidance(input, guidance, blocker);
			if (!replanned)
				return {
					guidance: null,
					nose: input.nose,
					throttle: 0,
					error: { kind: "detour-unavailable", blockerId: blocker.id },
				};
			guidance = {
				...replanned,
				targetId: input.target.id,
				waypoint: 0,
			};
			point = guidance.waypoints[0];
		}
		if (
			length(sub(point, input.pos)) <
			Math.max(1_000, input.speedKms * input.dt * 2)
		) {
			guidance = {
				...guidance,
				waypoint: guidance.waypoint === 0 ? 1 : guidance.waypoint === 1 ? 2 : 2,
			};
			point =
				guidance.waypoint === 2
					? input.target.pos
					: guidance.waypoints[guidance.waypoint];
			const nextBlocker = guidanceBlocker(input, point);
			if (nextBlocker) {
				const replanned = replanGuidance(input, guidance, nextBlocker);
				if (!replanned)
					return {
						guidance: null,
						nose: input.nose,
						throttle: 0,
						error: {
							kind: "detour-unavailable",
							blockerId: nextBlocker.id,
						},
					};
				guidance = replanned;
				point = guidance.waypoints[0];
			}
		}
	} else if (!input.steerDirect) {
		return {
			guidance: null,
			nose: input.nose,
			throttle: 1,
			error: null,
		};
	}

	const desired = unit(sub(point, input.pos), input.nose);
	const angle = angleBetween(input.nose, desired);
	return {
		guidance,
		nose: slewToward(input.nose, desired, 0.6 * input.dt),
		throttle: angle > 0.1 ? 0 : 1,
		error: null,
	};
}
