/**
 * The pirate relay's glass cue (node #43): strength in fifths, a bearing,
 * never a position until identification.
 */
import { describe, expect, test } from "bun:test";
import {
	type RelayCue,
	relayCueKey,
	relayCueMarkup,
	strengthBars,
} from "../src/relay-cue";

const cue = (over: Partial<RelayCue> = {}): RelayCue => ({
	phase: "signal",
	strength: 0.55,
	offNoseDeg: 34.4,
	arrowDeg: 90,
	watched: "ARTEQUGE",
	km: null,
	condition: "operational",
	...over,
});

describe("strength bars", () => {
	test("are five, lit in proportion", () => {
		expect(strengthBars(0)).toBe("▯▯▯▯▯");
		expect(strengthBars(0.5)).toBe("▮▮▮▯▯");
		expect(strengthBars(1)).toBe("▮▮▮▮▮");
		expect(strengthBars(2)).toBe("▮▮▮▮▮");
		expect(strengthBars(-1)).toBe("▯▯▯▯▯");
	});
});

describe("the markup", () => {
	test("a signal gives strength, bearing and the search region, and no range", () => {
		const html = relayCueMarkup(cue());
		expect(html).toContain("SIGNAL");
		expect(html).toContain("▮▮▮▯▯");
		expect(html).toContain("34° off nose");
		expect(html).toContain("rotate(90deg)");
		expect(html).toContain("ARTEQUGE");
		expect(html).not.toMatch(/\d km/);
	});
	test("identified gives the condition and the range", () => {
		const html = relayCueMarkup(
			cue({ phase: "identified", km: 1234.6, strength: 1 }),
		);
		expect(html).toContain("IDENTIFIED");
		expect(html).toContain("OPERATIONAL");
		expect(html).toContain("1,235 km");
	});
	test("down says so, with the route unwatched", () => {
		const html = relayCueMarkup(
			cue({ phase: "down", km: 12, condition: "destroyed" }),
		);
		expect(html).toContain("DESTROYED");
		expect(html).toContain("unwatched");
	});
	test("escapes the watched station's name", () => {
		expect(relayCueMarkup(cue({ watched: "<b>" }))).not.toContain("<b>");
	});
	test("draws no arrow when the relay is on the glass", () => {
		expect(relayCueMarkup(cue({ arrowDeg: null }))).not.toContain("rotate(");
	});
});

describe("the key", () => {
	test("is empty with no cue, and moves only on what the eye can see", () => {
		expect(relayCueKey(null)).toBe("");
		expect(relayCueKey(undefined)).toBe("");
		expect(relayCueKey(cue({ offNoseDeg: 34.4 }))).toBe(
			relayCueKey(cue({ offNoseDeg: 34.2 })),
		);
		expect(relayCueKey(cue({ strength: 0.55 }))).toBe(
			relayCueKey(cue({ strength: 0.58 })),
		);
		expect(relayCueKey(cue({ offNoseDeg: 34 }))).not.toBe(
			relayCueKey(cue({ offNoseDeg: 36 })),
		);
		expect(relayCueKey(cue({ strength: 0.2 }))).not.toBe(
			relayCueKey(cue({ strength: 0.8 })),
		);
	});
});
