import { expect, test } from "bun:test";
import { nebulaBakeStrips } from "../src/nebula-bake";

test("arrival strips cover each row once and bound each draw to 16384 pixels", () => {
	for (const width of [512, 1024, 2048, 4096]) {
		let next = 0;
		for (const strip of nebulaBakeStrips(width, width / 2)) {
			expect(strip.y).toBe(next);
			expect(strip.height * width).toBeLessThanOrEqual(16384);
			expect(strip.height).toBeGreaterThan(0);
			next += strip.height;
		}
		expect(next).toBe(width / 2);
	}
});
