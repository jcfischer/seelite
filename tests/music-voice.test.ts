/**
 * The voice in the music (#600): a numbers station overheard, far off in the
 * Berlin bed's calm, and nowhere else. The director says when and what; the
 * host renders and plays it (`comms-voice.ts`, `AudioFX.speak`).
 */
import { describe, expect, test } from "bun:test";
import { numbersPhrase } from "../src/comms";
import {
	DEFAULT_MUSIC_ARMS,
	initialMusicState,
	type MusicArms,
	type MusicReading,
	QUIET_READING,
	stepMusic,
	VOICE_EVERY_S,
	VOICE_FIRST_S,
} from "../src/music-director";

const STEP = 0.1;

/** Fly `seconds` on `reading`, and every phrase the director asked for, with
 *  the time it asked. */
function listen(
	seconds: number,
	reading: MusicReading,
	arms: MusicArms = DEFAULT_MUSIC_ARMS,
) {
	let state = initialMusicState();
	const heard: { at: number; text: string }[] = [];
	for (let i = 0; i < Math.round(seconds / STEP); i++) {
		const step = stepMusic(state, reading, STEP, arms);
		state = step.state;
		if (step.voice) heard.push({ at: (i + 1) * STEP, text: step.voice });
	}
	return heard;
}

const calm: MusicReading = { ...QUIET_READING, systemSeed: 1234 };

describe("the numbers in the music", () => {
	test("calm on the Berlin bed hears the system's phrases in order", () => {
		const heard = listen(VOICE_FIRST_S + VOICE_EVERY_S + 1, calm);
		expect(heard.map((h) => h.text)).toEqual([
			numbersPhrase(1234, 0),
			numbersPhrase(1234, 1),
		]);
		expect(heard[0].at).toBeCloseTo(VOICE_FIRST_S, 0);
		expect(heard[1].at - heard[0].at).toBeCloseTo(VOICE_EVERY_S, 0);
	});

	test("a new system starts its own numbers from the first", () => {
		let state = initialMusicState();
		const heard: string[] = [];
		const fly = (reading: MusicReading, seconds: number) => {
			for (let i = 0; i < Math.round(seconds / STEP); i++) {
				const step = stepMusic(state, reading, STEP);
				state = step.state;
				if (step.voice) heard.push(step.voice);
			}
		};
		fly(calm, VOICE_FIRST_S + VOICE_EVERY_S + 1);
		fly({ ...calm, systemSeed: 99 }, VOICE_FIRST_S + 1);
		expect(heard).toEqual([
			numbersPhrase(1234, 0),
			numbersPhrase(1234, 1),
			numbersPhrase(99, 0),
		]);
	});

	test("a fight hears none", () => {
		const arms = { ...DEFAULT_MUSIC_ARMS, force: "combat" as const };
		expect(listen(VOICE_FIRST_S + 5, calm, arms)).toEqual([]);
	});

	test("the older beds hear none", () => {
		for (const bed of ["second", "legacy"] as const)
			expect(
				listen(VOICE_FIRST_S + 5, calm, { ...DEFAULT_MUSIC_ARMS, bed }),
			).toEqual([]);
	});

	test("?voices=off hears none", () => {
		expect(
			listen(VOICE_FIRST_S + 5, calm, { ...DEFAULT_MUSIC_ARMS, voice: false }),
		).toEqual([]);
	});

	test("docked hears none", () => {
		expect(
			listen(VOICE_FIRST_S + 5, {
				...calm,
				scene: "docked",
				stationRole: "trade",
			}),
		).toEqual([]);
	});
});
