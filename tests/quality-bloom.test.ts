import { describe, expect, test } from "bun:test";
import { LIGHT_RIG } from "../src/light-rig";

describe("quality owns bloom", () => {
	test("high keeps the bloom pass", () => {
		expect(LIGHT_RIG.quality.high.bloom).toBe(true);
	});

	test("low drops the bloom pass", () => {
		expect(LIGHT_RIG.quality.low.bloom).toBe(false);
	});
});
