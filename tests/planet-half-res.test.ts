import { describe, expect, test } from "bun:test";
import {
	HALF_RES_RADIUS_PX,
	halfTargetSize,
	useHalfResolution,
} from "../src/planet-half-res";

describe("planet surface half-resolution policy", () => {
	test("high quality engages only for a filling approach-layer planet", () => {
		expect(
			useHalfResolution("approach", "terran", "high", HALF_RES_RADIUS_PX - 1),
		).toBe(false);
		expect(
			useHalfResolution("approach", "terran", "high", HALF_RES_RADIUS_PX),
		).toBe(true);
		expect(
			useHalfResolution("far", "terran", "high", HALF_RES_RADIUS_PX * 2),
		).toBe(false);
		expect(
			useHalfResolution("approach", "star", "high", HALF_RES_RADIUS_PX * 2),
		).toBe(false);
	});

	test("low quality uses the half target throughout the approach layer", () => {
		expect(useHalfResolution("approach", "airless", "low", 1)).toBe(true);
		expect(useHalfResolution("approach", "jovian", "low", 1)).toBe(true);
		expect(useHalfResolution("far", "terran", "low", 1000)).toBe(false);
	});

	test("odd drawing buffers round up and never allocate zero", () => {
		expect(halfTargetSize(1441, 901)).toEqual({ width: 721, height: 451 });
		expect(halfTargetSize(1, 1)).toEqual({ width: 1, height: 1 });
	});
});
