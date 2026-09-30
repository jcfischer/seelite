import { expect, test } from "bun:test";
import { SATURN, SATURN_SECONDS } from "../../src/music-classical/holst-saturn";
import { wellFormed } from "./well-formed";

wellFormed(SATURN);

const events = SATURN.sections.flatMap((s) => s.events);
const pitchesOf = (part: string) =>
	events
		.filter((e) => e.part === part)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat || a.pitch - b.pitch)
		.map((e) => e.pitch);

test("the ostinato's first bar: A3–F4–B4 on beat 2, G3–E♭4–A♭4 on beat 4", () => {
	const bar0 = events
		.filter(
			(e) => e.bar === 0 && (e.part === "flutes" || e.part === "bassFlute"),
		)
		.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
		.map((e) => [e.beat, e.pitch]);
	expect(bar0).toEqual([
		[1, 57],
		[1, 65],
		[1, 71],
		[3, 55],
		[3, 63],
		[3, 68],
	]);
});

test("the basses' line as read off bars 4–7: F, B–C, C–B, B", () => {
	expect(pitchesOf("basses").slice(0, 6)).toEqual([29, 35, 36, 36, 35, 35]);
});

test("the strings' unison and the oboe's phrase", () => {
	expect(pitchesOf("strings")).toEqual([59, 60, 59]);
	expect(pitchesOf("oboe")).toEqual([72, 74, 74, 72]);
});

test("the excerpt runs between 40 and 100 seconds", () => {
	expect(SATURN_SECONDS).toBeGreaterThan(40);
	expect(SATURN_SECONDS).toBeLessThan(100);
});
