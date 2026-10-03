import { expect, test } from "bun:test";
import {
	CLAIR_DE_LUNE,
	CLAIR_DE_LUNE_SECONDS,
} from "../../src/music-classical/debussy-clair-de-lune";
import { wellFormed } from "./well-formed";

wellFormed(CLAIR_DE_LUNE);

const melody = () =>
	CLAIR_DE_LUNE.sections[0].events
		.filter((e) => e.part === "melody")
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat);

test("the opening top line as printed, bars 1–4", () => {
	// Bars 1–3 of page 2: Ab5 F5 | (F5) Eb5 F5 Eb5 | (Eb5) Db5 Eb5 Db5 F5 F5 Db5.
	expect(
		melody()
			.slice(0, 12)
			.map((e) => e.pitch),
	).toEqual([80, 77, 75, 77, 75, 73, 75, 73, 77, 73, 72, 73]);
});

test("the thirds: the first chord is F–A-flat, after two eighth rests", () => {
	const first = CLAIR_DE_LUNE.sections[0].events.filter(
		(e) => e.bar === 0 && (e.part === "melody" || e.part === "inner"),
	);
	expect(first[0].beat).toBeCloseTo(2 / 3);
	expect(first.map((e) => e.pitch).sort()).toContain(77);
});

test("about a minute", () => {
	expect(CLAIR_DE_LUNE_SECONDS).toBeGreaterThan(40);
	expect(CLAIR_DE_LUNE_SECONDS).toBeLessThan(100);
});
