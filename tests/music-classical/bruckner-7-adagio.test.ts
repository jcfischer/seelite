import { expect, test } from "bun:test";
import {
	BRUCKNER_ADAGIO,
	BRUCKNER_ADAGIO_SECONDS,
} from "../../src/music-classical/bruckner-7-adagio";
import { wellFormed } from "./well-formed";

wellFormed(BRUCKNER_ADAGIO);

const events = BRUCKNER_ADAGIO.sections.flatMap((s) => s.events);
const pitchesOf = (part: string) =>
	events
		.filter((e) => e.part === part)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat || a.pitch - b.pitch)
		.map((e) => e.pitch);

test("the violas' theme as read off bar 1: C♯4–G♯3, F𝄪3–A♯3–C♯4–D♯4, then G♯3", () => {
	expect(pitchesOf("viola").slice(0, 7)).toEqual([61, 56, 55, 58, 61, 63, 56]);
});

test("the violins take it on the G string: E4–F♯4, the dotted G♯4s", () => {
	expect(pitchesOf("violins").slice(0, 8)).toEqual([
		64, 66, 68, 63, 64, 68, 66, 67,
	]);
});

test("the double basses open on C♯ and close on A", () => {
	const bass = pitchesOf("bass");
	expect(bass[0]).toBe(37);
	expect(bass.at(-1)).toBe(33);
});

test("the excerpt runs between 40 and 100 seconds", () => {
	expect(BRUCKNER_ADAGIO_SECONDS).toBeGreaterThan(40);
	expect(BRUCKNER_ADAGIO_SECONDS).toBeLessThan(100);
});
