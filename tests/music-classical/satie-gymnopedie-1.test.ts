import { expect, test } from "bun:test";
import {
	GYMNOPEDIE,
	GYMNOPEDIE_SECONDS,
} from "../../src/music-classical/satie-gymnopedie-1";
import { wellFormed } from "./well-formed";

wellFormed(GYMNOPEDIE);

const part = (name: string) =>
	GYMNOPEDIE.sections[0].events
		.filter((e) => e.part === name)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat);

test("the melody as printed, bars 5–9: F#5 A5 | G5 F#5 C#5 | B4 C#5 D5 | A4 | F#4", () => {
	const m = part("melody");
	expect(m.slice(0, 10).map((e) => e.pitch)).toEqual([
		78, 81, 79, 78, 73, 71, 73, 74, 69, 66,
	]);
	expect([m[0].bar, m[0].beat]).toEqual([4, 1]);
});

test("the introduction: G2 under B3–D4–F#4, then D2 under A3–C#4–F#4", () => {
	const at = (bar: number) =>
		GYMNOPEDIE.sections[0].events
			.filter((e) => e.bar === bar && e.part !== "melody")
			.map((e) => e.pitch)
			.sort((a, b) => a - b);
	expect(at(0)).toEqual([43, 59, 62, 66]);
	expect(at(1)).toEqual([38, 57, 61, 66]);
});

test("about a minute", () => {
	expect(GYMNOPEDIE_SECONDS).toBeGreaterThan(40);
	expect(GYMNOPEDIE_SECONDS).toBeLessThan(100);
});
