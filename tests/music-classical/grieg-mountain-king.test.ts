import { expect, test } from "bun:test";
import {
	MOUNTAIN_KING,
	MOUNTAIN_KING_SECONDS,
} from "../../src/music-classical/grieg-mountain-king";
import { wellFormed } from "./well-formed";

wellFormed(MOUNTAIN_KING);

const melody = (part: string, section: string) =>
	(MOUNTAIN_KING.sections.find((s) => s.name === section)?.events ?? [])
		.filter((e) => e.part === part)
		.map((e) => ({ t: e.bar * 4 + e.beat, pitch: e.pitch }))
		.sort((a, b) => a.t - b.t || a.pitch - b.pitch)
		.map((e) => e.pitch);

test("the cellos' pizzicato theme opens as Peters p. 24 prints it", () => {
	// B C# D E F# D F# | E# C# E# E C E
	expect(melody("pizz", "pianissimo").slice(0, 13)).toEqual([
		47, 49, 50, 52, 54, 50, 54, 53, 49, 53, 52, 48, 52,
	]);
});

test("the answer in F-sharp: F# G# A# B C# A# C#", () => {
	expect(melody("pizz", "pianissimo").slice(26, 33)).toEqual([
		54, 56, 58, 59, 61, 58, 61,
	]);
});

test("the excerpt lasts between 40 and 100 seconds", () => {
	expect(MOUNTAIN_KING_SECONDS).toBeGreaterThan(40);
	expect(MOUNTAIN_KING_SECONDS).toBeLessThan(100);
});
