import { expect, test } from "bun:test";
import {
	CATHEDRALE,
	CATHEDRALE_SECONDS,
} from "../../src/music-classical/debussy-cathedrale";
import { wellFormed } from "./well-formed";

wellFormed(CATHEDRALE);

const events = CATHEDRALE.sections[0].events;
const byTime = (part: string) =>
	events
		.filter((e) => e.part === part)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat || a.pitch - b.pitch);

test("bar 14 as printed: the rising chords D–G–D, E–A–E, B–E–B, D–G–D, E–A–E over C", () => {
	const rh = byTime("rh").filter((e) => e.bar === 0);
	const tops = [...new Set(rh.map((e) => e.beat))].map((beat) =>
		Math.max(...rh.filter((e) => e.beat === beat).map((e) => e.pitch)),
	);
	expect(tops).toEqual([74, 76, 83, 86, 88]);
	expect(
		byTime("pedal")
			.filter((e) => e.bar === 0)
			.map((e) => e.pitch),
	).toEqual([24, 31, 36]);
});

test("the chorale opens C major then D minor over the low C", () => {
	const chorale = byTime("chorale").filter((e) => e.bar === 14);
	expect(
		chorale.filter((e) => e.beat === 1 && e.pitch >= 60).map((e) => e.pitch),
	).toEqual([60, 64, 67, 72]);
	expect(
		chorale.filter((e) => e.beat === 2 && e.pitch >= 60).map((e) => e.pitch),
	).toEqual([62, 65, 69, 74]);
});

test("about a minute", () => {
	expect(CATHEDRALE_SECONDS).toBeGreaterThan(40);
	expect(CATHEDRALE_SECONDS).toBeLessThan(100);
});
