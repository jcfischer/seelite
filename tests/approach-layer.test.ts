import { expect, test } from "bun:test";
import {
	APPROACH_FAR_UNITS,
	APPROACH_NEAR_UNITS,
	APPROACH_SCALE,
	HANDOFF_HYSTERESIS,
	HANDOFF_KM,
	NEAR_FAR_KM,
	NEAR_NEAR_KM,
	massiveLayerFor,
} from "../src/units";

test("massive bodies enter approach scale by surface distance, not centre distance", () => {
	const gasGiantRadiusKm = 60_000;
	const centreDistanceKm = gasGiantRadiusKm + HANDOFF_KM;

	// The centre is outside the 1:1 near layer, but the surface is exactly at the
	// visual handoff. A centre-distance classifier would put the ship inside the
	// sphere before changing scale.
	expect(centreDistanceKm).toBeGreaterThan(NEAR_FAR_KM);
	expect(massiveLayerFor("far", centreDistanceKm - gasGiantRadiusKm)).toBe(
		"approach",
	);
});

test("massive-body approach hysteresis holds until surface distance leaves its band", () => {
	const bandKm = HANDOFF_KM * ((1 + HANDOFF_HYSTERESIS) / 2);
	const outsideKm = HANDOFF_KM * (HANDOFF_HYSTERESIS + 0.1);

	expect(massiveLayerFor("far", bandKm)).toBe("far");
	expect(massiveLayerFor("approach", bandKm)).toBe("approach");
	expect(massiveLayerFor("approach", outsideKm)).toBe("far");
});

test("approach camera reaches the five-kilometre surface floor without spending the near budget", () => {
	expect(APPROACH_NEAR_UNITS / APPROACH_SCALE).toBeLessThanOrEqual(5);
	expect(APPROACH_FAR_UNITS / APPROACH_NEAR_UNITS).toBeLessThanOrEqual(
		NEAR_FAR_KM / NEAR_NEAR_KM,
	);
});
