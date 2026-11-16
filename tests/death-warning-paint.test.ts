import { expect, test } from "bun:test";
import {
	warningPaintDiff,
	warningIsPainted,
} from "../scripts/lib/death-warning-paint.mjs";

const pixels = (rgb: number[], count = 300) =>
	new Uint8ClampedArray(
		Array.from({ length: count }, () => [...rgb, 255]).flat(),
	);
const background = pixels([1, 8, 11]);
const still = { moved: 0, amber: 0 };

test("amber warning strokes clear the paint floor and repeat-control noise", () => {
	const paint = warningPaintDiff(background, pixels([243, 187, 105]));
	expect(paint).toEqual({ moved: 300, amber: 300 });
	expect(warningIsPainted(paint, still)).toBe(true);
	expect(warningIsPainted(paint, { moved: 75, amber: 0 })).toBe(false);
	expect(warningIsPainted({ moved: 200, amber: 200 }, still)).toBe(false);
});

test("refusal red, confirmed green, passive cyan and white are not amber", () => {
	for (const colour of [
		[255, 110, 96],
		[150, 255, 190],
		[150, 205, 240],
		[255, 255, 255],
	]) {
		const paint = warningPaintDiff(background, pixels(colour));
		expect(paint.moved).toBe(300);
		expect(paint.amber).toBe(0);
		expect(warningIsPainted(paint, still)).toBe(false);
	}
});

test("an absent warning or missing or resized face fails closed", () => {
	for (const after of [background, null, new Uint8ClampedArray(4)]) {
		const paint = warningPaintDiff(background, after);
		expect(warningIsPainted(paint, still)).toBe(false);
	}
	expect(warningIsPainted(warningPaintDiff(null, background), still)).toBe(
		false,
	);
});
