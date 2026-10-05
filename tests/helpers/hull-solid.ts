import { type Primitive, hullBox } from "../../src/collision";
import { HULL_SPECS, type HullId } from "../../src/hull";

/** The selected hull's measured box, including its offset from the origin. */
export function hullSolid(hull: HullId): Primitive[] {
	const { env, envCentre } = HULL_SPECS[hull];
	return [hullBox(env, envCentre)];
}
