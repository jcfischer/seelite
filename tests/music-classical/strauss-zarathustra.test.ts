import { expect, test } from "bun:test";
import {
	ZARATHUSTRA,
	ZARATHUSTRA_SECONDS,
} from "../../src/music-classical/strauss-zarathustra";
import { wellFormed } from "./well-formed";

wellFormed(ZARATHUSTRA);

const events = ZARATHUSTRA.sections.flatMap((s) => s.events);
const pitchesOf = (part: string) =>
	events
		.filter((e) => e.part === part)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat || a.pitch - b.pitch)
		.map((e) => e.pitch);

test("the trumpets' call as read off pages 3–4: C–G–C, E into E♭, then E♭ into E, then E into F major's A", () => {
	expect(pitchesOf("call")).toEqual([
		60, 67, 72, 76, 75, 60, 67, 72, 75, 76, 60, 67, 72, 76, 81,
	]);
});

test("the violins' climb from bar 16 to the C7 of bars 19–21", () => {
	expect(pitchesOf("melody").slice(0, 12)).toEqual([
		81, 83, 84, 86, 88, 89, 91, 88, 89, 91, 93, 95,
	]);
	expect(pitchesOf("melody").slice(12)).toEqual([96, 96, 96, 96, 96]);
});

test("the pedal opens on low C", () => {
	const first = events.filter((e) => e.bar === 0 && e.beat === 0);
	expect(first.map((e) => e.pitch).sort((a, b) => a - b)).toEqual([24, 36, 36]);
});

test("the excerpt runs between 40 and 100 seconds", () => {
	expect(ZARATHUSTRA_SECONDS).toBeGreaterThan(40);
	expect(ZARATHUSTRA_SECONDS).toBeLessThan(100);
});
