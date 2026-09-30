import { expect, test } from "bun:test";
import {
	WACHET_AUF,
	WACHET_AUF_SECONDS,
} from "../../src/music-classical/bach-wachet-auf";
import { wellFormed } from "./well-formed";

wellFormed(WACHET_AUF);

const melody = (part: string) =>
	WACHET_AUF.sections
		.flatMap((s, i) =>
			s.events
				.filter((e) => e.part === part)
				.map((e) => ({ t: i * 1000 + e.bar * 4 + e.beat, pitch: e.pitch })),
		)
		.sort((a, b) => a.t - b.t)
		.map((e) => e.pitch);

test("the ritornello opens as BGA 25 p. 63 prints it: the anacrusis and bar 1", () => {
	// Bb3 | Eb4 F4 G4 G4 F4 Ab4 G4 Bb3 Ab3
	expect(melody("ritornello").slice(0, 10)).toEqual([
		58, 63, 65, 67, 67, 65, 68, 67, 58, 56,
	]);
});

test("the cantus firmus enters in bar 13: Eb G | Bb Bb Bb Bb | C Bb", () => {
	expect(melody("cantus").slice(0, 8)).toEqual([
		51, 55, 58, 58, 58, 58, 60, 58,
	]);
});

test("the pedal sounds at 16': bar 1's E-flats are Eb1", () => {
	expect(melody("pedal").slice(0, 4)).toEqual([27, 27, 27, 31]);
});

test("the excerpt lasts between 40 and 100 seconds", () => {
	expect(WACHET_AUF_SECONDS).toBeGreaterThan(40);
	expect(WACHET_AUF_SECONDS).toBeLessThan(100);
});
