/**
 * The voice in the music (#600): a numbers station overheard, far off in the
 * calm of the Berlin bed, the sequence school and techno, and not on the two
 * older beds. Over techno it has a drier room than over the school. The director says when and what; the
 * host renders and plays it (`comms-voice.ts`, `AudioFX.speak`).
 */
import { describe, expect, test } from "bun:test";
import { numbersPhrase } from "../src/comms";
import {
	MUSIC_VOICE_SPACE,
	numbersSpace,
	TECHNO_VOICE_SPACE,
} from "../src/comms-voice";
import {
	DEFAULT_MUSIC_ARMS,
	initialMusicState,
	type MusicArms,
	type MusicBed,
	type MusicReading,
	numbersRoom,
	QUIET_READING,
	stepMusic,
	systemBed,
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
	for (const bed of ["school", "school-drive", "berlin"] as const)
		test(`calm on the ${bed} bed hears the system's phrases in order`, () => {
			const heard = listen(VOICE_FIRST_S + VOICE_EVERY_S + 1, calm, {
				...DEFAULT_MUSIC_ARMS,
				bed,
			});
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
		const school = { ...DEFAULT_MUSIC_ARMS, bed: "school" as const };
		const fly = (reading: MusicReading, seconds: number) => {
			for (let i = 0; i < Math.round(seconds / STEP); i++) {
				const step = stepMusic(state, reading, STEP, school);
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

	test("the default bed says them in a school system and in a techno one", () => {
		const seeds = Array.from({ length: 40 }, (_, i) => (i * 2654435761) >>> 0);
		const school = seeds.find((s) => systemBed(s) === "school") ?? 0;
		const techno = seeds.find((s) => systemBed(s) === "techno") ?? 0;
		const hears = (systemSeed: number) =>
			listen(VOICE_FIRST_S + 1, { ...calm, systemSeed }).length;
		expect(hears(school)).toBe(1);
		expect(hears(techno)).toBe(1);
	});

	test("over techno the voice has a short slap, not the school's long wash", () => {
		const room = (bed: MusicBed) =>
			numbersSpace(numbersRoom({ ...DEFAULT_MUSIC_ARMS, bed }, 1234));
		const t = room("techno-dub");
		expect(room("school")).toEqual(MUSIC_VOICE_SPACE);
		expect(room("system")).toEqual(
			numbersSpace(systemBed(1234) === "techno" ? "techno" : "far"),
		);
		expect(t).toEqual(TECHNO_VOICE_SPACE);
		expect(t.echoS).toBeLessThan(MUSIC_VOICE_SPACE.echoS / 2);
		expect(t.feedback).toBeLessThan(MUSIC_VOICE_SPACE.feedback / 2);
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
