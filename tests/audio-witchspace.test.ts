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
import {
	FakeContext,
	type FakeGain,
	reaches,
	unlocked as engine,
	withFakeWindow,
} from "./lib/fake-audio";

function unlocked() {
	const { audio, ctx, master, buses } = engine();
	return { audio, ctx, master, ship: buses.ship };
}

withFakeWindow(beforeEach, afterEach);

const HUM = { kind: "witchspaceHum", seconds: 1.6 } as const;
const SWEEP = { kind: "witchspaceSweep" } as const;
const STOP = { kind: "witchspaceStop" } as const;
/** #534's four, after the cut. */
const AFTER = [
	{ kind: "witchspaceFlash", voice: "boom" },
	{
		kind: "witchspaceRide",
		voice: "rings",
		seconds: 6.2,
		openS: 0.5,
		ringHz: 3.5,
	},
	{ kind: "witchspaceUnfold", seconds: 1.6 },
	{ kind: "witchspaceRift", seconds: 4.5 },
] as const;

describe("the witchspace cues", () => {
	test("the sweep and the hum each sound through a group of their own, on the ship bus", () => {
		const { audio, ctx, master, ship } = unlocked();
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

describe("after the cut (#534)", () => {
	test("each voice sounds through a group of its own, on the ship bus", () => {
		const { audio, ctx, master, ship } = unlocked();
		const before = ctx.gains.length;
		for (const cue of AFTER) audio.play(cue);
		const groups = ctx.gains
			.slice(before)
			.filter((g) => g.outputs.includes(ship));
		expect(groups.length).toBe(AFTER.length);
		expect(
			ctx.gains.slice(before).some((g) => g.outputs.includes(master)),
		).toBe(false);
		for (const source of ctx.sources) {
			expect(reaches(source, ship)).toBe(true);
			expect(groups.some((g) => reaches(source, g))).toBe(true);
		}
	});

	test("every voice has something in it", () => {
		for (const cue of AFTER) {
			const { audio, ctx } = unlocked();
			audio.play(cue);
			expect([cue.kind, ctx.sources.length > 0]).toEqual([cue.kind, true]);
		}
	});

	test("both ride voices and both flash voices build", () => {
		for (const cue of [
			{ ...AFTER[0], voice: "glass" },
			{ ...AFTER[1], voice: "bed" },
		] as const) {
			const { audio, ctx } = unlocked();
			audio.play(cue);
			expect(ctx.sources.length).toBeGreaterThan(0);
		}
	});

	test("a stop takes every one of them back, with the charge's two", () => {
		const { audio, ctx, ship } = unlocked();
		audio.play(HUM);
		audio.play(SWEEP);
		for (const cue of AFTER) audio.play(cue);
		const groups = ctx.gains.filter((g) => g.outputs.includes(ship));
		expect(groups.length).toBe(2 + AFTER.length);
		audio.play(STOP);
		for (const g of groups)
			expect(g.gain.events).toContainEqual(["target", 0, ctx.currentTime]);
	});

	test("with master Off, none of them builds anything", () => {
		const { audio, ctx } = unlocked();
		audio.setLevel("master", 0);
		const before = ctx.gains.length;
		for (const cue of AFTER) audio.play(cue);
		expect(ctx.gains.length).toBe(before);
	});

	test("the ship bus at Off fades a ride already sounding", () => {
		// The ride runs 3.1 s and the rift 4.5: a mute that only stopped new
		// cues would leave both playing. They sum through the ship bus.
		const { audio, ctx, ship } = unlocked();
		audio.play(AFTER[1]);
		audio.setLevel("ship", 0);
		expect(ship.gain.target).toBe(0);
		for (const source of ctx.sources) expect(reaches(source, ship)).toBe(true);
	});

	test("the ride's close takes its group down over its seconds and lets it go", () => {
		const { audio, ctx, ship } = unlocked();
		audio.play(AFTER[1]);
		const group = ctx.gains.find((g) => g.outputs.includes(ship)) as FakeGain;
		const t = ctx.currentTime;
		audio.play({ kind: "witchspaceRideClose", seconds: 0.7 });
		expect(group.gain.events).toContainEqual(["set", 1, t]);
		expect(group.gain.events).toContainEqual(["exp", 0.0001, t + 0.7]);
		// Its voices stop with the close rather than running on silent to
		// the ride's bound (sage round 2 on #575).
		const stops = ctx.sources.map(
			(s) => (s as unknown as { stoppedAt: number[] }).stoppedAt,
		);
		for (const at of stops)
			expect(Math.min(...at)).toBeLessThanOrEqual(t + 0.7 + 0.05);
		// A stop after the close has nothing left to take.
		const count = group.gain.events.length;
		audio.play(STOP);
		expect(group.gain.events.length).toBe(count);
	});

	test("a close with no ride sounding schedules nothing", () => {
		const { audio, ctx } = unlocked();
		const before = ctx.gains.map((g) => g.gain.events.length);
		audio.play({ kind: "witchspaceRideClose", seconds: 0.7 });
		expect(ctx.gains.map((g) => g.gain.events.length)).toEqual(before);
	});

	test("the swallowed sweep is drawn to silence where the dark closes", () => {
		const { audio, ctx } = unlocked();
		const t = ctx.currentTime;
		audio.play({
			kind: "witchspaceSweep",
			riseS: 1.4,
			swallow: { fromS: 0.2, toS: 1.15 },
		});
		const swallow = ctx.gains.find((g) =>
			g.gain.events.some(([, v, at]) => v <= 0.001 && at === t + 1.15),
		);
		expect(swallow).toBeDefined();
		expect(swallow?.gain.events).toContainEqual(["set", 1, t + 0.2]);
	});

	test("the risen sweep holds its level to the cut, where the plain one has died", () => {
		const held = (cue: Parameters<AudioFX["play"]>[0]) => {
			const { audio, ctx } = unlocked();
			const t = ctx.currentTime;
			audio.play(cue);
			return ctx.gains.some((g) =>
				g.gain.events.some(([, v, at]) => v >= 0.1 && at >= t + 1.3),
			);
		};
		expect(held({ kind: "witchspaceSweep", riseS: 1.4 })).toBe(true);
		expect(held(SWEEP)).toBe(false);
	});

	test("the plain sweep is not swallowed", () => {
		const { audio, ctx } = unlocked();
		const t = ctx.currentTime;
		audio.play(SWEEP);
		expect(
			ctx.gains.some((g) =>
				g.gain.events.some(
					([kind, v, at]) => kind === "set" && v === 1 && at === t + 0.2,
				),
			),
		).toBe(false);
	});
});
