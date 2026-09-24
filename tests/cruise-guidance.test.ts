import { describe, expect, test } from "bun:test";
import type { Mass } from "../src/cruise";
import {
	beginCruiseGuidance,
	stepCruiseGuidance,
} from "../src/cruise-guidance";

const blocker: Mass = {
	id: "planet",
	kind: "planet",
	pos: { x: 100, y: 0, z: 0 },
	vel: { x: 0, y: 0, z: 0 },
	radiusKm: 20,
};

describe("shared pure cruise guidance", () => {
	test("a clear player leg keeps manual nose authority", () => {
		const begun = beginCruiseGuidance({
			from: { x: 0, y: 0, z: 0 },
			target: { id: "station", pos: { x: 200, y: 0, z: 0 } },
			masses: [],
			targetParentId: null,
		});
		expect(begun).toEqual({ guidance: null, error: null });
		const stepped = stepCruiseGuidance({
			guidance: null,
			pos: { x: 0, y: 0, z: 0 },
			nose: { x: 0, y: 1, z: 0 },
			target: { id: "station", pos: { x: 200, y: 0, z: 0 } },
			masses: [],
			targetParentId: null,
			dt: 0.1,
			speedKms: 0,
			steerDirect: false,
		});
		expect(stepped.nose).toEqual({ x: 0, y: 1, z: 0 });
		expect(stepped.throttle).toBe(1);
	});

	test("an obstructed leg plans waypoints and turns the visible nose", () => {
		const begun = beginCruiseGuidance({
			from: { x: 0, y: 0, z: 0 },
			target: { id: "station", pos: { x: 200, y: 0, z: 0 } },
			masses: [blocker],
			targetParentId: null,
		});
		expect(begun.error).toBeNull();
		expect(begun.guidance?.bodyId).toBe("planet");
		const stepped = stepCruiseGuidance({
			guidance: begun.guidance,
			pos: { x: 0, y: 0, z: 0 },
			nose: { x: 1, y: 0, z: 0 },
			target: { id: "station", pos: { x: 200, y: 0, z: 0 } },
			masses: [blocker],
			targetParentId: null,
			dt: 0.1,
			speedKms: 10,
			steerDirect: true,
		});
		expect(stepped.error).toBeNull();
		expect(stepped.nose).not.toEqual({ x: 1, y: 0, z: 0 });
		expect(stepped.throttle).toBe(0);
	});

	test("guidance detours around the planet approach boundary, not its old shell", () => {
		const begun = beginCruiseGuidance({
			from: { x: 0, y: 0, z: 0 },
			target: { id: "station", pos: { x: 200, y: 0, z: 0 } },
			masses: [{ ...blocker, pos: { x: 100, y: 22, z: 0 } }],
			targetParentId: "planet",
		});
		expect(begun.error).toBeNull();
		expect(begun.guidance?.bodyId).toBe("planet");
	});

	test("guidance rejects a route deeper from inside a planet approach boundary", () => {
		const begun = beginCruiseGuidance({
			from: { x: 123, y: 0, z: 0 },
			target: { id: "station", pos: { x: 122, y: 0, z: 0 } },
			masses: [blocker],
			targetParentId: "planet",
		});
		expect(begun.guidance).toBeNull();
		expect(begun.error).toEqual({
			kind: "detour-unavailable",
			blockerId: "planet",
		});
	});
});
