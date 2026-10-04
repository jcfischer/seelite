import { expect, test } from "bun:test";
import {
	continuityAllowanceKm,
	cruiseContinuityResidualKm,
} from "../scripts/lib/traffic-continuity.mjs";

test("continuity uses the adjoining integrated path, not a peak-speed step", () => {
	const prior = {
		phase: "cruise",
		cruiseStartedAtS: 42,
		cruiseDisplacementKm: { x: 1000, y: 0, z: 0 },
		vel: { x: 0, y: 0, z: 0 },
	};
	const route = {
		...prior,
		cruiseDisplacementKm: { x: 1002, y: 0, z: 0 },
		vel: { x: 3325, y: 0, z: 0 },
	};
	expect(continuityAllowanceKm(prior, route)).toBeCloseTo(2.05, 8);
	// A 100 km rewrite was admitted by the old 349 km peak-speed allowance.
	expect(102).toBeGreaterThan(continuityAllowanceKm(prior, route));
	expect(2).toBeLessThan(continuityAllowanceKm(prior, route));
	expect(
		continuityAllowanceKm(
			{ ...prior, cruiseDisplacementKm: { x: NaN, y: 0, z: 0 } },
			route,
		),
	).toBe(0);
});

test("a cruise projection missing integrated motion fails closed", () => {
	const route = { phase: "cruise", vel: { x: 3325, y: 0, z: 0 } };
	expect(continuityAllowanceKm(route, route)).toBe(0);
});

test("a rewrite shorter than the integrated step still fails the vector residual", () => {
	const prior = {
		phase: "cruise",
		cruiseStartedAtS: 42,
		pos: { x: 0, y: 0, z: 0 },
		cruiseDisplacementKm: { x: 0, y: 0, z: 0 },
	};
	const route = {
		...prior,
		pos: { x: 2, y: 0, z: 0 },
		cruiseDisplacementKm: { x: 2, y: 0, z: 0 },
	};
	expect(cruiseContinuityResidualKm(prior, route)).toBe(0);
	expect(
		cruiseContinuityResidualKm(prior, { ...route, pos: { x: 1, y: 0, z: 0 } }),
	).toBe(1);
	expect(
		cruiseContinuityResidualKm(prior, { ...route, pos: { x: 2, y: 1, z: 0 } }),
	).toBe(1);
});
