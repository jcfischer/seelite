/**
 * The pulse laser's tracer and shot sound (#324): shown when the gun fired,
 * gone after a hold, and the sound paced so a held trigger is not a buzz.
 */
import { describe, expect, test } from "bun:test";
import {
	type GunFeedback,
	QUIET_GUN,
	SHOT_SOUND_GAP_S,
	TRACER_HOLD_S,
	stepGunFeedback,
} from "../src/gun-feedback";

const DT = 1 / 60;

/** Step `n` times with the same trigger, counting the sounds. */
function run(start: GunFeedback, fired: boolean, n: number) {
	let feedback = start;
	let sounds = 0;
	for (let i = 0; i < n; i++) {
		const step = stepGunFeedback(feedback, fired, DT);
		feedback = step.feedback;
		if (step.cue) sounds++;
	}
	return { feedback, sounds };
}

describe("the tracer", () => {
	test("a quiet gun shows none", () => {
		expect(run(QUIET_GUN, false, 30).feedback.tracerLeftS).toBe(0);
	});

	test("a fired step shows it, and it stays for the hold", () => {
		const shot = stepGunFeedback(QUIET_GUN, true, DT).feedback;
		expect(shot.tracerLeftS).toBe(TRACER_HOLD_S);
		const holdSteps = Math.floor(TRACER_HOLD_S / DT);
		expect(
			run(shot, false, holdSteps - 1).feedback.tracerLeftS,
		).toBeGreaterThan(0);
		expect(run(shot, false, holdSteps + 1).feedback.tracerLeftS).toBe(0);
	});

	test("the hold is longer than one frame, so a single shot is seen", () => {
		expect(TRACER_HOLD_S).toBeGreaterThan(DT);
	});
});

describe("the shot sound", () => {
	test("the first shot sounds at once", () => {
		expect(stepGunFeedback(QUIET_GUN, true, DT).cue).toEqual({ kind: "laser" });
	});

	test("a held trigger sounds once per gap, not once per step", () => {
		const seconds = 1.2;
		const { sounds } = run(QUIET_GUN, true, Math.round(seconds / DT));
		// One at once, then one each time a full gap has passed.
		const expected = 1 + Math.floor((seconds - DT) / SHOT_SOUND_GAP_S);
		expect(Math.abs(sounds - expected)).toBeLessThanOrEqual(1);
		expect(sounds).toBeLessThan(Math.round(seconds / DT) / 2);
	});

	test("a quiet gun never sounds", () => {
		expect(run(QUIET_GUN, false, 120).sounds).toBe(0);
	});
});
