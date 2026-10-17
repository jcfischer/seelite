/** Shared catalogue arithmetic; the instrument alone measures handling. */
export * from "../../src/module-catalog";
import { HULL_SPECS, type HullId } from "../../src/hull";
import { flightPerformance } from "../../src/sim";
export function massImpact(hull: HullId, moduleMassT: number, cargoT = 0) {
	const own = HULL_SPECS[hull].massT;
	const bare = flightPerformance(hull).thrustKms2;
	const fitted = flightPerformance(
		hull,
		{},
		own + moduleMassT + cargoT,
	).thrustKms2;
	return { bare, fitted, lossPct: 100 * (1 - fitted / bare) };
}
