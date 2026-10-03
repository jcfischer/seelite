import { expect, test } from "bun:test";
import {
	GNOSSIENNE,
	GNOSSIENNE_SECONDS,
} from "../../src/music-classical/satie-gnossienne-1";
import { wellFormed } from "./well-formed";

wellFormed(GNOSSIENNE);

const part = (name: string) =>
	GNOSSIENNE.sections[0].events
		.filter((e) => e.part === name)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat);

test("the opening line as printed: C5 Eb5 D5 C5 | B4 B4 | C5 Eb5 D5 C5 | F5 F5", () => {
	expect(
		part("melody")
			.slice(0, 12)
			.map((e) => e.pitch),
	).toEqual([72, 75, 74, 72, 71, 71, 72, 75, 74, 72, 77, 77]);
});

test("the graces: C5 before each B-natural 4, E-natural 5 before each F5", () => {
	expect(
		part("grace")
			.slice(0, 4)
			.map((e) => e.pitch),
	).toEqual([72, 72, 76, 76]);
});

test("the left hand's grid: F2, then the F minor chord on beats 2 and 4", () => {
	const bar0 = GNOSSIENNE.sections[0].events.filter(
		(e) => e.bar === 0 && (e.part === "bass" || e.part === "chords"),
	);
	expect(bar0.filter((e) => e.part === "bass").map((e) => e.pitch)).toEqual([
		41,
	]);
	expect([
		...new Set(bar0.filter((e) => e.part === "chords").map((e) => e.beat)),
	]).toEqual([1, 3]);
});

test("between 40 and 100 seconds", () => {
	expect(GNOSSIENNE_SECONDS).toBeGreaterThan(40);
	expect(GNOSSIENNE_SECONDS).toBeLessThan(100);
});
