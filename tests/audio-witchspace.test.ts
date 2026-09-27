/**
 * #532's audio half: D3's two witchspace cues and the stop that a cancelled
 * charge owes. The schedule — when each cue fires — is `witchspace.ts`'s and is
 * tested there; this file tests that the cues can be *taken back*.
 *
 * A fake `AudioContext` (`lib/fake-audio.ts`) records the graph. Nothing here asserts on a waveform:
 * the sounds are the principal's to judge, the plumbing is not.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AudioFX } from "../src/audio";
import { FakeContext, reaches, withFakeWindow } from "./lib/fake-audio";

withFakeWindow(beforeEach, afterEach);

const HUM = { kind: "witchspaceHum", seconds: 1.6 } as const;
const SWEEP = { kind: "witchspaceSweep" } as const;
const STOP = { kind: "witchspaceStop" } as const;

function unlocked() {
	const audio = new AudioFX();
	audio.ensure();
	const ctx = FakeContext.made[0];
	// The graph `attach` builds first: limiter, master, then the four buses in
	// `BUSES` order after master. Ship is the one the witchspace cues use (D1).
	const ship = ctx.gains[1];
	return { audio, ctx, ship };
}

describe("the witchspace cues", () => {
	test("the sweep and the hum each sound through a group of their own, on the ship bus", () => {
		const { audio, ctx, ship } = unlocked();
		const master = ctx.gains[0];
		const before = ctx.gains.length;
		audio.play(HUM);
		audio.play(SWEEP);
		const groups = ctx.gains
			.slice(before)
			.filter((g) => g.outputs.includes(ship));
		expect(groups.length).toBe(2);
		// No longer straight to master: #542 D1 moves them under ship.
		expect(
			ctx.gains.slice(before).some((g) => g.outputs.includes(master)),
		).toBe(false);
		// Every voice reaches the ship bus only through one of the two groups.
		for (const source of ctx.sources) {
			expect(reaches(source, ship)).toBe(true);
			expect(groups.some((g) => reaches(source, g))).toBe(true);
		}
	});

	test("stop ramps both groups to silence and lets them go", () => {
		const { audio, ctx, ship } = unlocked();
		audio.play(HUM);
		audio.play(SWEEP);
		const groups = ctx.gains.filter((g) => g.outputs.includes(ship));
		audio.play(STOP);
		for (const g of groups)
			expect(g.gain.events).toContainEqual(["target", 0, ctx.currentTime]);
	});

	test("a second stop, with nothing sounding, schedules nothing", () => {
		const { audio, ctx } = unlocked();
		audio.play(SWEEP);
		audio.play(STOP);
		const count = ctx.gains.map((g) => g.gain.events.length);
		audio.play(STOP);
		expect(ctx.gains.map((g) => g.gain.events.length)).toEqual(count);
	});

	test("with master Off, neither cue builds anything", () => {
		const { audio, ctx } = unlocked();
		audio.setLevel("master", 0);
		const before = ctx.gains.length;
		audio.play(HUM);
		audio.play(SWEEP);
		expect(ctx.gains.length).toBe(before);
	});

	test("before a gesture there is no context, and every cue is a no-op", () => {
		const audio = new AudioFX();
		audio.play(HUM);
		audio.play(SWEEP);
		audio.play(STOP);
		expect(FakeContext.made.length).toBe(0);
	});
});
