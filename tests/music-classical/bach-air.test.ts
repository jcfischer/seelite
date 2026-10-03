import { expect, test } from "bun:test";
import { BACH_AIR, BACH_AIR_SECONDS } from "../../src/music-classical/bach-air";
import { wellFormed } from "./well-formed";

wellFormed(BACH_AIR);

const part = (name: string, section = 0) =>
	BACH_AIR.sections[section].events
		.filter((e) => e.part === name)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat);

test("violin I as printed, bars 1–2: F#5 | B5 G5 E5 D5 C#5 D5 C#5 A4", () => {
	expect(
		part("violin1")
			.slice(0, 9)
			.map((e) => e.pitch),
	).toEqual([78, 83, 79, 76, 74, 73, 74, 73, 69]);
});

test("the continuo's first bar walks D3 D4 C#4 C#3 B2 B3 A3 A2", () => {
	expect(
		part("continuo")
			.slice(0, 8)
			.map((e) => e.pitch),
	).toEqual([50, 62, 61, 49, 47, 59, 57, 45]);
});

test("the repeat: bars 1–5 twice, first- then second-time bar", () => {
	expect(BACH_AIR.sections.map((s) => s.name)).toEqual([
		"a",
		"first-time",
		"a-repeat",
		"second-time",
	]);
	// The second-time bar closes on A: A2, C#4, E4, A4.
	const last = BACH_AIR.sections[3].events
		.filter((e) => e.beat === 2 && e.dur > 2)
		.map((e) => e.pitch)
		.sort((a, b) => a - b);
	expect(last).toEqual([45, 61, 64, 69]);
});

test("between 40 and 100 seconds", () => {
	expect(BACH_AIR_SECONDS).toBeGreaterThan(40);
	expect(BACH_AIR_SECONDS).toBeLessThan(100);
});
