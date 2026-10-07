/**
 * The piano versions of the four piano works (`src/music-classical/piano.ts`):
 * each is well formed, keeps every note of its source but the parts it says
 * it drops, and puts every part on the piano's sample set.
 */
import { expect, test } from "bun:test";
import { CATHEDRALE } from "../../src/music-classical/debussy-cathedrale";
import { CATHEDRALE_PIANO } from "../../src/music-classical/debussy-cathedrale-piano";
import { CLAIR_DE_LUNE } from "../../src/music-classical/debussy-clair-de-lune";
import { CLAIR_DE_LUNE_PIANO } from "../../src/music-classical/debussy-clair-de-lune-piano";
import { PIANO_SET, pedal } from "../../src/music-classical/piano";
import { GNOSSIENNE } from "../../src/music-classical/satie-gnossienne-1";
import { GNOSSIENNE_PIANO } from "../../src/music-classical/satie-gnossienne-1-piano";
import { GYMNOPEDIE } from "../../src/music-classical/satie-gymnopedie-1";
import { GYMNOPEDIE_PIANO } from "../../src/music-classical/satie-gymnopedie-1-piano";
import type { Song } from "../../src/music-score";
import { wellFormed } from "./well-formed";

const PAIRS: [Song, Song, string[]][] = [
	[GYMNOPEDIE, GYMNOPEDIE_PIANO, []],
	[GNOSSIENNE, GNOSSIENNE_PIANO, []],
	[CLAIR_DE_LUNE, CLAIR_DE_LUNE_PIANO, []],
	[CATHEDRALE, CATHEDRALE_PIANO, ["toll"]],
];

const notes = (song: Song, drop: string[] = []) =>
	song.sections
		.flatMap((s, i) =>
			s.events
				.filter((e) => !drop.includes(e.part))
				.map((e) => `${i}:${e.bar}:${e.beat}:${e.pitch}`),
		)
		.sort();

for (const [source, piano, dropped] of PAIRS) {
	wellFormed(piano);
	test(`${piano.name}: every note of the page, at its time and pitch`, () => {
		expect(notes(piano)).toEqual(notes(source, dropped));
	});
	test(`${piano.name}: every part is the piano`, () => {
		for (const p of Object.values(piano.parts)) {
			expect(p.voice).toBe("sampler");
			expect(p.samples).toBe(PIANO_SET);
		}
	});
}

test("the pedal holds a note to its bar line, or to the next stroke of its key", () => {
	const e = (beat: number, pitch: number, dur: number) => ({
		part: "lh",
		bar: 0,
		beat,
		pitch,
		dur,
		vel: 0.5,
	});
	const out = pedal(
		[e(0, 40, 1), e(1, 52, 0.5), e(2, 52, 0.5)],
		new Set(["lh"]),
		3,
	);
	expect(out.map((n) => n.dur)).toEqual([3, 1, 1]);
	// Another part is left alone.
	expect(
		pedal([{ ...e(0, 40, 1), part: "rh" }], new Set(["lh"]), 3)[0].dur,
	).toBe(1);
});
