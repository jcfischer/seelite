/**
 * https://github.com/jcfischer/seelite/issues/920
 * The frame the assist, the cruise drop and the speed readout hold: the
 * nearest of the bodies and the asteroid fields within `NEAR_FAR_KM` of the
 * ship, centre to ship, as node #1139 (PR #1140) rules for main. A field is a
 * display contact rather than a body, and a rare field has no body near it.
 * Prototype copy for the drill branch.
 */
import {
	type FieldPlan,
	fieldCentre,
	fieldCentreVelocity,
} from "./asteroid-field";
import { NEAR_FAR_KM } from "./units";
import { length, sub, type Vec3, v3 } from "./vec3";

/** Which frame is local, and its velocity at any game time. */
export interface LocalFrame {
	kind: "field" | "body" | "star";
	id: string | null;
	velocityAt: (gameTime: number) => Vec3;
}

/** The local frame: a field whose centre is nearer than the nearest body and within `NEAR_FAR_KM`, else that body's, else the star's. */
export function localFrameAt(a: {
	fields: readonly FieldPlan[];
	shipPos: Vec3;
	gameTime: number;
	body: {
		id: string;
		distKm: number;
		velocityAt: (gameTime: number) => Vec3;
	} | null;
}): LocalFrame {
	let field: FieldPlan | null = null;
	let bestKm = a.body ? Math.min(a.body.distKm, NEAR_FAR_KM) : NEAR_FAR_KM;
	for (const plan of a.fields) {
		const km = length(sub(fieldCentre(plan, a.gameTime), a.shipPos));
		if (km < bestKm) {
			field = plan;
			bestKm = km;
		}
	}
	if (field) {
		const chosen = field;
		return {
			kind: "field",
			id: chosen.id,
			velocityAt: (t) => fieldCentreVelocity(chosen, t),
		};
	}
	if (a.body)
		return { kind: "body", id: a.body.id, velocityAt: a.body.velocityAt };
	return { kind: "star", id: null, velocityAt: () => v3() };
}
