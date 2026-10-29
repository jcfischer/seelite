/**
 * https://github.com/jcfischer/seelite/issues/920
 * The frame the assist, the cruise drop and the speed readout hold. Inside an
 * asteroid field's ellipsoid it is the field centre's motion, because a field
 * is a display contact rather than a body and a rare field has no body near it;
 * then a body's within `NEAR_FAR_KM`; else the star's. Prototype copy for the
 * drill branch; the main-line fix is node #1139.
 */
import {
	FIELD_PROFILE,
	type FieldPlan,
	fieldCentre,
	fieldCentreVelocity,
	rotateByQuat,
} from "./asteroid-field";
import { sub, type Vec3, v3 } from "./vec3";

/** How far past its ellipsoid a field's frame still holds, km: a rock's radius and a margin. */
export const FIELD_FRAME_MARGIN_KM = 2;

/** Which frame is local, and its velocity at any game time. */
export interface LocalFrame {
	kind: "field" | "body" | "star";
	id: string | null;
	velocityAt: (gameTime: number) => Vec3;
}

/** Whether `pos` lies inside `plan`'s ellipsoid grown by `FIELD_FRAME_MARGIN_KM`. */
export function insideField(
	plan: FieldPlan,
	pos: Vec3,
	gameTime: number,
): boolean {
	const q = plan.rotation;
	const d = rotateByQuat(
		{ x: -q.x, y: -q.y, z: -q.z, w: q.w },
		sub(pos, fieldCentre(plan, gameTime)),
	);
	const [a, b, c] = FIELD_PROFILE[plan.profile].semiKm.map(
		(s) => s + FIELD_FRAME_MARGIN_KM,
	);
	return (d.x / a) ** 2 + (d.y / b) ** 2 + (d.z / c) ** 2 <= 1;
}

/** The local frame: a field's that holds the ship, then the nearest body's, else the star's. */
export function localFrameAt(a: {
	fields: readonly FieldPlan[];
	shipPos: Vec3;
	gameTime: number;
	body: { id: string; velocityAt: (gameTime: number) => Vec3 } | null;
}): LocalFrame {
	const field = a.fields.find((p) => insideField(p, a.shipPos, a.gameTime));
	if (field)
		return {
			kind: "field",
			id: field.id,
			velocityAt: (t) => fieldCentreVelocity(field, t),
		};
	if (a.body)
		return { kind: "body", id: a.body.id, velocityAt: a.body.velocityAt };
	return { kind: "star", id: null, velocityAt: () => v3() };
}
