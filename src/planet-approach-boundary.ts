import { dot, length, lengthSq, scale, sub } from "./vec3";
import type { Vec3 } from "./vec3";

/** Inward approach boundary multiplier for planets. */
export const PLANET_APPROACH_RADIUS = 1.2;

/**
 * First inward crossing of a moving planet's approach boundary.
 *
 * A ship already inside may leave or graze it; only a heading that gets deeper
 * is stopped. That is the same release rule cruise needs after a proximity
 * stop, and prevents a boundary contact from becoming a permanent pin.
 */
export function planetApproachEntryTime(input: {
	from: Vec3;
	velocity: Vec3;
	duration: number;
	centre: Vec3;
	centreVelocity: Vec3;
	radiusKm: number;
	allowanceKm?: number;
}): number | null {
	const boundaryKm = input.radiusKm * PLANET_APPROACH_RADIUS;
	const radiusKm = boundaryKm + (input.allowanceKm ?? 0);
	const relativeVelocity = sub(input.velocity, input.centreVelocity);
	const relativeSpeed = length(relativeVelocity);
	const startsInside =
		lengthSq(sub(input.centre, input.from)) <= boundaryKm * boundaryKm;
	if (input.duration < 0) return null;
	if (relativeSpeed === 0) return null;
	const nose = scale(relativeVelocity, 1 / relativeSpeed);
	if (startsInside) {
		const toCentre = sub(input.centre, input.from);
		const ahead = dot(toCentre, nose);
		if (ahead <= 0) return null;
		return lengthSq(toCentre) - ahead * ahead < radiusKm * radiusKm ? 0 : null;
	}
	const toCentre = sub(input.centre, input.from);
	const closestAt = dot(toCentre, nose);
	if (closestAt < 0) return null;
	const startKm = length(toCentre);
	const missSq = startKm * startKm - closestAt * closestAt;
	const boundaryHalfChordSq = boundaryKm * boundaryKm - missSq;
	// Tangency is a grazing pass, not an inward crossing. Keep this check on the
	// policy boundary rather than the widened numerical sweep envelope.
	if (boundaryHalfChordSq <= 0) return null;
	const sweepHalfChordSq = radiusKm * radiusKm - missSq;
	const entryKm = closestAt - Math.sqrt(sweepHalfChordSq);
	return entryKm <= relativeSpeed * input.duration
		? Math.max(0, entryKm) / relativeSpeed
		: null;
}
