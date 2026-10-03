import { expect, test } from "bun:test";
import {
	AQUARIUM,
	AQUARIUM_SECONDS,
} from "../../src/music-classical/saint-saens-aquarium";
import { wellFormed } from "./well-formed";

wellFormed(AQUARIUM);

const events = AQUARIUM.sections.flatMap((s) => s.events);
const pitches = (part: string, bar?: number, beatBelow = 4) =>
	events
		.filter(
			(e) =>
				e.part === part &&
				(bar === undefined || e.bar === bar) &&
				e.beat < beatBelow,
		)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat)
		.map((e) => e.pitch);

test("the flute's theme as read off bars 1–2: E5–D#5–E5–D5, E5–A4", () => {
	expect(pitches("flute").slice(0, 6)).toEqual([76, 75, 76, 74, 76, 69]);
});

test("piano I's first figure, an octave above the page: C7 E7 C7 B6 A6 E6", () => {
	expect(pitches("piano", 0, 1)).toEqual([96, 100, 96, 95, 93, 88]);
});

test("the harmonica doubles the theme an octave up, off the beat", () => {
	expect(pitches("harmonica", 0)).toEqual([88, 87, 88, 86]);
	expect(
		events
			.filter((e) => e.part === "harmonica" && e.bar === 0)
			.map((e) => e.beat),
	).toEqual([0.5, 1.5, 2.5, 3.5]);
});

test("the excerpt runs between 40 and 100 seconds", () => {
	expect(AQUARIUM_SECONDS).toBeGreaterThan(40);
	expect(AQUARIUM_SECONDS).toBeLessThan(100);
});
