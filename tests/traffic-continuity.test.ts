import { expect, test } from "bun:test";
import {
	continuityAllowanceKm,
	cruiseContinuityResidualKm,
} from "../scripts/lib/traffic-continuity.mjs";
import {
	evaluateTrafficCruise,
	type TrafficCruiseState,
} from "../src/station-route";

const state: TrafficCruiseState = {
	phase: "cruise",
	startedAtS: 42,
	atS: 42,
	workTicks: 0,
	pos: { x: 0, y: 0, z: 0 },
	vel: { x: 0, y: 0, z: 0 },
	nose: { x: 1, y: 0, z: 0 },
	up: { x: 0, y: 1, z: 0 },
	chargeAu: 12,
};
const environment = {
	capacityAu: 12,
	targetParentId: null,
	targetAt: () => ({
		id: "traffic-lane-point",
		pos: { x: 1e8, y: 0, z: 0 },
		radiusKm: 0,
	}),
	massesAt: () => [],
};
const sample = (s: TrafficCruiseState) => ({
	...s,
	cruiseStartedAtS: s.startedAtS,
	cruiseDisplacementKm: s.displacementKm,
});

test("continuity predicts from a retained previous state, rejecting a consistent production cruise rewrite", () => {
	const prior = evaluateTrafficCruise(state, 42.1, environment);
	const retained = structuredClone(prior);
	const predicted = sample(evaluateTrafficCruise(retained, 42.2, environment));
	const baseline = sample(evaluateTrafficCruise(prior, 42.2, environment));
	expect(
		cruiseContinuityResidualKm(sample(prior), baseline, predicted),
	).toBeLessThan(1e-8);
	const rewritten = structuredClone(prior);
	rewritten.pos.y += 1;
	rewritten.displacementKm!.y += 1;
	const live = sample(evaluateTrafficCruise(rewritten, 42.2, environment));
	// Both fields move together in the real integrator, preserving the old gate's equality.
	expect(live.pos.y - prior.pos.y).toBe(
		live.displacementKm!.y - prior.displacementKm!.y,
	);
	expect(live.startedAtS).toBe(prior.startedAtS);
	expect(
		cruiseContinuityResidualKm(sample(prior), live, predicted),
	).toBeGreaterThan(0.05);
	expect(continuityAllowanceKm(sample(prior), live, predicted)).toBeGreaterThan(
		0,
	);
});

test("missing, non-finite or changed-leg predictions fail closed", () => {
	const prior = sample(evaluateTrafficCruise(state, 42.1, environment));
	const next = sample(evaluateTrafficCruise(state, 42.2, environment));
	expect(continuityAllowanceKm(prior, next)).toBe(0);
	expect(cruiseContinuityResidualKm(prior, next)).toBe(Infinity);
	for (const bad of [
		{ ...next, pos: { x: NaN, y: 0, z: 0 } },
		{ ...next, startedAtS: 43 },
	]) {
		expect(continuityAllowanceKm(prior, next, bad)).toBe(0);
		expect(cruiseContinuityResidualKm(prior, next, bad)).toBe(Infinity);
	}
});
