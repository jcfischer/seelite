import { expect, test } from "bun:test";
import { SEVEN_SHIP_FILES } from "../scripts/lib/shipped-seven-ships";
import { VIEWS } from "../scripts/lib/view-set.mjs";
import { DOCKABLE_HULL_IDS, HULL_SPECS } from "../src/hull";
import { isAuthoredHullModel, modelLoaders } from "../src/model-catalog";
import { HULL_REACH_KM } from "../src/ship-mesh";

test("node #1035 ships five hulls and leaves Pilgrim for oversized visits", () => {
	expect(Object.keys(SEVEN_SHIP_FILES)).toEqual([
		"patrol",
		"raider",
		"carrier",
		"prospector",
		"dreadnought",
	]);
	expect(isAuthoredHullModel("explorer")).toBe(false);
	expect("explorer" in modelLoaders).toBe(false);
	expect(DOCKABLE_HULL_IDS).toContain("explorer");
	expect(HULL_REACH_KM.explorer).toBe(0.044);
	const explorer = HULL_SPECS.explorer;
	expect(explorer.env).toEqual({
		lengthKm: 0.0738,
		beamKm: 0.0385,
		heightKm: 0.0397,
	});
	expect(explorer.envCentre).toEqual({
		rightKm: 0,
		upKm: 0.0008,
		foreKm: -0.0044,
	});
	expect(explorer.ventShares).toEqual({
		main: 1,
		retro: 0.5,
		strafe: 0.416667,
		pitch: 0.00929064,
		yaw: 0.0091665,
		roll: 0.00777541,
	});
	expect(explorer.ventPlacement).toEqual({
		retroX: 0.5,
		strafeZ: 0.25,
		yaw: { y: 0, fore: 0.9975, aft: 0.9975 },
		pitch: { x: 0, fore: 0.9975, aft: 0.9975 },
		roll: { z: -0.125, port: 0.995, starboard: 0.995 },
	});
});

test("each shipped hull has its own canonical chase inspection", () => {
	const views = VIEWS.filter((view) => view.covers.includes(1035));
	expect(views.map((view) => view.shot.inspectHull)).toEqual([
		"patrol",
		"raider",
		"prospector",
		"carrier",
		"dreadnought",
	]);
	for (const view of views) {
		expect(view.shot.view).toBe("chase");
		expect(view.shot.hull).toBeUndefined();
		expect(view.shot.inspectZoom ?? 1).toBe(
			["carrier", "dreadnought"].includes(view.shot.inspectHull ?? "") ? 4 : 1,
		);
	}
});
