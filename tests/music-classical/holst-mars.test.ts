import { expect, test } from "bun:test";
import { MARS, MARS_SECONDS } from "../../src/music-classical/holst-mars";
import { wellFormed } from "./well-formed";

wellFormed(MARS);

const events = MARS.sections.flatMap((s) => s.events);
const pitchesOf = (part: string) =>
	events
		.filter((e) => e.part === part)
		.sort((a, b) => a.bar - b.bar || a.beat - b.beat || a.pitch - b.pitch)
		.map((e) => e.pitch);

test("the call as read off bars 3–6: G held, D; D♭, C", () => {
	expect(pitchesOf("call").slice(0, 4)).toEqual([43, 50, 49, 48]);
});

test("the ostinato's first bar: 3 + 1 + 1 + 2 + 1 strokes on G", () => {
	const bar0 = events
		.filter((e) => e.bar === 0 && e.part === "ostinato" && e.pitch === 55)
		.map((e) => e.beat);
	expect(bar0).toEqual([0, 1 / 3, 2 / 3, 1, 2, 3, 3.5, 4]);
});

test("the excerpt runs between 40 and 100 seconds", () => {
	expect(MARS_SECONDS).toBeGreaterThan(40);
	expect(MARS_SECONDS).toBeLessThan(100);
});
