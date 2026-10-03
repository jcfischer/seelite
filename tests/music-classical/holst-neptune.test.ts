import { expect, test } from "bun:test";
import {
	NEPTUNE,
	NEPTUNE_SECONDS,
} from "../../src/music-classical/holst-neptune";
import { wellFormed } from "./well-formed";

wellFormed(NEPTUNE);

const first = NEPTUNE.sections[0].events;
const barPitches = (part: string, bar: number) =>
	first
		.filter((e) => e.part === part && e.bar === bar)
		.sort((a, b) => a.beat - b.beat)
		.map((e) => e.pitch);

test("flute I's opening bar as read off page 162: G E G E | D# G# B G#", () => {
	expect(barPitches("flute", 0)).toEqual([67, 64, 67, 64, 63, 68, 71, 68]);
});

test("the bass flute sounds a fourth below the page: B G B G | G# B D# C#", () => {
	expect(barPitches("bassFlute", 0)).toEqual([59, 55, 59, 55, 56, 59, 63, 61]);
});

test("bar 3: the trombones' A minor under the oboes' G#–B", () => {
	const low = first
		.filter((e) => e.part === "low")
		.map((e) => e.pitch)
		.sort();
	expect(low).toEqual([45, 52, 60]);
});

test("the excerpt runs between 40 and 100 seconds", () => {
	expect(NEPTUNE_SECONDS).toBeGreaterThan(40);
	expect(NEPTUNE_SECONDS).toBeLessThan(100);
});
