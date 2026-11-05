import { expect, test } from "bun:test";
import { beamClearsCutter } from "../src/mount-beam";
import { v3 } from "../src/vec3";

const cutter = { radiusKm: 1, downKm: 2, bowKm: 10, feedTravelKm: 5 };
const clears = (x: number, y: number, z: number) =>
	beamClearsCutter(v3(x, y, z), cutter);
const e = 1e-6;

test("a beam from inside the deployed cutter's cross-section and short of its face runs through the drill", () => {
	expect(clears(0, -2, -12)).toBe(false);
	expect(clears(0, -2, 5)).toBe(false);
});

test("each edge of the cutter's box is inside it, and a hair beyond clears", () => {
	for (const x of [1, -1]) expect(clears(x, -2, -12)).toBe(false);
	expect(clears(1 + e, -2, -12)).toBe(true);
	expect(clears(-1 - e, -2, -12)).toBe(true);
	expect(clears(0, -3, -12)).toBe(false);
	expect(clears(0, -1, -12)).toBe(false);
	expect(clears(0, -3 - e, -12)).toBe(true);
	expect(clears(0, -1 + e, -12)).toBe(true);
	expect(clears(0, -2, -15)).toBe(false);
	expect(clears(0, -2, -15 - e)).toBe(true);
});
