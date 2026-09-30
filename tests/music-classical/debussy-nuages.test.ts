import { expect, test } from "bun:test";
import {
	NUAGES,
	NUAGES_SECONDS,
} from "../../src/music-classical/debussy-nuages";
import { wellFormed } from "./well-formed";

wellFormed(NUAGES);

const events = NUAGES.sections[0].events;
const part = (name: string) =>
	events
		.filter((e) => e.part === name)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat || b.pitch - a.pitch);

test("bar 1 as printed: fifths and thirds, B–F#, C#–E, B–F#, Bb–D, A–E, A#–C#", () => {
	const bar1 = part("clarinets").filter((e) => e.bar === 0);
	const dyads = [0, 1, 2, 3, 4, 5].map((q) =>
		bar1.filter((e) => e.beat === q).map((e) => e.pitch),
	);
	expect(dyads).toEqual([
		[78, 71],
		[76, 73],
		[78, 71],
		[74, 70],
		[76, 69],
		[73, 70],
	]);
});

test("bar 7, the whole-tone chord: bassoons F–F, violins A–C#–G–A–A–C#", () => {
	expect(
		part("bassoons")
			.filter((e) => e.bar === 6)
			.map((e) => e.pitch)
			.sort((a, b) => a - b),
	).toEqual([53, 65]);
	expect(
		part("violins")
			.map((e) => e.pitch)
			.sort((a, b) => a - b),
	).toEqual([69, 73, 79, 81, 93, 97]);
});

test("the English horn's call, sounding: C#–D–E–F, E, D, C#–B", () => {
	expect(part("cor").map((e) => e.pitch)).toEqual([
		61, 62, 64, 65, 64, 62, 61, 59, 59,
	]);
});

test("about fifty seconds", () => {
	expect(NUAGES_SECONDS).toBeGreaterThan(40);
	expect(NUAGES_SECONDS).toBeLessThan(100);
});
