import { expect, test } from "bun:test";
import {
	JESU_JOY,
	JESU_JOY_SECONDS,
} from "../../src/music-classical/bach-jesu-joy";
import { wellFormed } from "./well-formed";

wellFormed(JESU_JOY);

const melody = (part: string) =>
	JESU_JOY.sections
		.flatMap((s, i) =>
			s.events
				.filter((e) => e.part === part)
				.map((e) => ({ t: i * 1000 + e.bar * 3 + e.beat, pitch: e.pitch })),
		)
		.sort((a, b) => a.t - b.t)
		.map((e) => e.pitch);

test("the obbligato opens as BGA 30 p. 213 prints it: bars 1–2 in triplets", () => {
	// (rest) G A | B D C | C E D || D G F# | G D B | G A B
	expect(melody("obbligato").slice(0, 17)).toEqual([
		67, 69, 71, 74, 72, 72, 76, 74, 74, 79, 78, 79, 74, 71, 67, 69, 71,
	]);
});

test("the chorale's first line: Wohl mir, dass ich Jesum habe", () => {
	// B C | D D | C B | A A
	expect(melody("chorale").slice(0, 8)).toEqual([
		71, 72, 74, 74, 72, 71, 69, 69,
	]);
});

test("the excerpt lasts between 40 and 100 seconds", () => {
	expect(JESU_JOY_SECONDS).toBeGreaterThan(40);
	expect(JESU_JOY_SECONDS).toBeLessThan(100);
});
