import { expect, test } from "bun:test";
import {
	STEPPES,
	STEPPES_SECONDS,
} from "../../src/music-classical/borodin-steppes";
import { wellFormed } from "./well-formed";

wellFormed(STEPPES);

const events = STEPPES.sections.flatMap((s) => s.events);
const pitchesOf = (part: string) =>
	events
		.filter((e) => e.part === part)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat || a.pitch - b.pitch)
		.map((e) => e.pitch);

test("the clarinet's song as read off bars 5–9, sounding: E5–D5–C#5, B4–C#5, A4–E4", () => {
	expect(pitchesOf("clarinet").slice(0, 7)).toEqual([
		76, 74, 73, 71, 73, 69, 64,
	]);
});

test("the horn's song as read off bars 17–19, sounding: G4–F4–E4, D4–E4, C4–G3", () => {
	expect(pitchesOf("horn").slice(0, 7)).toEqual([67, 65, 64, 62, 64, 60, 55]);
});

test("the caravan's cellos open A#2–B2 on the beat, and the violas an octave up off it", () => {
	expect(pitchesOf("cellos").slice(0, 4)).toEqual([46, 47, 46, 47]);
	expect(pitchesOf("violas").slice(0, 2)).toEqual([58, 59]);
});

test("the excerpt runs between 40 and 100 seconds", () => {
	expect(STEPPES_SECONDS).toBeGreaterThan(40);
	expect(STEPPES_SECONDS).toBeLessThan(100);
});
