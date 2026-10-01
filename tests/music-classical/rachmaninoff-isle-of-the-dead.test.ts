import { expect, test } from "bun:test";
import {
	ISLE_OF_THE_DEAD,
	ISLE_OF_THE_DEAD_SECONDS,
} from "../../src/music-classical/rachmaninoff-isle-of-the-dead";
import { wellFormed } from "./well-formed";

wellFormed(ISLE_OF_THE_DEAD);

const events = ISLE_OF_THE_DEAD.sections.flatMap((s) => s.events);
const inBar = (part: string, bar: number) =>
	events
		.filter((e) => e.part === part && e.bar === bar)
		.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
		.map((e) => e.pitch);

test("5/8 is five eighths a bar at an eighth of 120 (the printed quarter at 60)", () => {
	expect(ISLE_OF_THE_DEAD.beatsPerBar).toBe(5);
	expect(ISLE_OF_THE_DEAD.tempo[0]?.bpm).toBe(120);
});

test("the oars as read off bar 1: timpani A2–E2, harp A1–E2", () => {
	expect(inBar("timpani", 0)).toEqual([45, 40]);
	expect(inBar("harp", 0)).toEqual([33, 40]);
});

test("the cellos' rising line as read off bars 5, 9 and 13", () => {
	expect(inBar("cellos", 4)).toEqual([45, 48, 47, 52, 57]);
	expect(inBar("cellos", 8)).toEqual([48, 52, 47, 52, 57]);
	expect(inBar("cellos", 12)).toEqual([52, 48, 45, 41, 36]);
});

test("the excerpt runs between 40 and 100 seconds", () => {
	expect(ISLE_OF_THE_DEAD_SECONDS).toBeGreaterThan(40);
	expect(ISLE_OF_THE_DEAD_SECONDS).toBeLessThan(100);
});
