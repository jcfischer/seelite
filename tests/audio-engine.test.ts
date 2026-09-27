/**
 * #552's engine plumbing, on a fake context: the five buses (#542 D1), the
 * volume steps and the mute (D2), the voice caps (D4) and the offline seam
 * (D7). Whether a cue *sounds* the same as before is not a headless question;
 * `probe-audio-cues.mjs` bands it, and the principal listens.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	AudioFX,
	BUS_FULL_GAIN,
	CUE_LENGTH_S,
	LIMITER,
	busGain,
} from "../src/audio";
import {
	CUE_BUS,
	CUE_VOICE,
	type Cue,
	VOICE_CAPS,
	VOICE_STEAL_FADE_S,
	type VoicedCueKind,
} from "../src/audio-cue";
import {
	FakeContext,
	type FakeGain,
	reaches,
	withFakeWindow,
} from "./lib/fake-audio";

withFakeWindow(beforeEach, afterEach);

function unlocked() {
	const audio = new AudioFX();
	audio.ensure();
	const ctx = FakeContext.made[0];
	const [master, ship, combat, console_, music] = ctx.gains;
	return {
		audio,
		ctx,
		master,
		limiter: ctx.compressors[0],
		buses: { ship, combat, console: console_, music },
	};
}

describe("the buses", () => {
	test("each cue bus sums into master, and master reaches the speakers only through the limiter", () => {
		const { ctx, master, limiter, buses } = unlocked();
		expect(ctx.compressors).toHaveLength(1);
		expect(master.outputs).toEqual([limiter]);
		expect(limiter.outputs).toEqual([ctx.destination]);
		for (const bus of Object.values(buses))
			expect(bus.outputs).toEqual([master]);
	});

	test("at 100%, every bus gives today's gains: master 0.4 and every other bus 1", () => {
		// The build this replaced had one master gain at 0.4 and nothing else, so
		// every bus at its default is the old mix exactly.
		const { master, buses } = unlocked();
		expect(master.gain.value).toBe(0.4);
		for (const bus of Object.values(buses)) expect(bus.gain.value).toBe(1);
		expect(BUS_FULL_GAIN.master).toBe(0.4);
	});

	test("the limiter's threshold is full scale, which is what gives it no makeup gain", () => {
		const { limiter } = unlocked();
		expect(limiter.threshold.value).toBe(0);
		expect(limiter.knee.value).toBe(0);
		expect(LIMITER.thresholdDb).toBe(0);
	});

	test("each cue plays through the bus CUE_BUS names", () => {
		const cues: Cue[] = [
			{ kind: "laser" },
			{ kind: "explosion" },
			{ kind: "hullHit" },
			{ kind: "dock" },
			{ kind: "scoop" },
			{ kind: "alert" },
			{ kind: "ui" },
		];
		for (const cue of cues) {
			FakeContext.made.length = 0;
			const { audio, ctx, buses } = unlocked();
			const before = ctx.sources.length;
			audio.play(cue);
			const made = ctx.sources.slice(before);
			expect(made.length).toBeGreaterThan(0);
			const want = buses[CUE_BUS[cue.kind] as keyof typeof buses];
			for (const source of made) {
				expect(reaches(source, want)).toBe(true);
				for (const other of Object.values(buses))
					if (other !== want) expect(reaches(source, other)).toBe(false);
			}
		}
	});

	test("the music bus is one input the engine owns, for the synth to connect to", () => {
		const { audio, buses } = unlocked();
		expect(audio.musicInput as unknown).toBe(buses.music);
		expect(new AudioFX().musicInput).toBe(null);
	});
});

describe("the volume rows", () => {
	test("a step is a gain on a squared curve, and Off is exactly zero", () => {
		expect(busGain("ship", 1)).toBe(1);
		expect(busGain("ship", 0.5)).toBe(0.25);
		expect(busGain("master", 0.5)).toBeCloseTo(0.1, 12);
		expect(busGain("combat", 0)).toBe(0);
	});

	test("a level set before there is a context is in place when one opens", () => {
		const audio = new AudioFX();
		audio.setLevel("combat", 0.5);
		audio.ensure();
		const combat = FakeContext.made[0].gains[2];
		expect(combat.gain.value).toBe(0.25);
	});

	test("a level set while playing eases the bus there", () => {
		const { audio, ctx, buses } = unlocked();
		audio.setLevel("ship", 0.75);
		expect(buses.ship.gain.events).toContainEqual([
			"target",
			0.5625,
			ctx.currentTime,
		]);
	});

	test("master Off is the mute: it fades the bed that is already running", () => {
		const { audio, master } = unlocked();
		audio.ambient(1);
		audio.setLevel("master", 0);
		expect(master.gain.target).toBe(0);
	});

	test("master Off builds no cue at all, as mute did", () => {
		const { audio, ctx } = unlocked();
		audio.setLevel("master", 0);
		const before = ctx.gains.length;
		audio.play({ kind: "laser" });
		audio.play({ kind: "alert" });
		audio.ambient(1);
		expect(ctx.gains.length).toBe(before);
	});

	test("a bus at Off silences its own cues and no other", () => {
		const { audio, ctx } = unlocked();
		audio.setLevel("combat", 0);
		const before = ctx.sources.length;
		audio.play({ kind: "laser" });
		expect(ctx.sources.length).toBe(before);
		audio.play({ kind: "alert" });
		expect(ctx.sources.length).toBeGreaterThan(before);
	});

	test("the bed's own level at full throttle is unchanged: 0.16", () => {
		const { audio, ctx } = unlocked();
		const before = ctx.gains.length;
		audio.ambient(1);
		const bedGain = ctx.gains[before] as FakeGain;
		expect(bedGain.gain.target).toBeCloseTo(0.16, 12);
	});
});

describe("the voice caps", () => {
	test("a burst of lasers at one instant holds at the weapons cap", () => {
		const { audio, ctx, buses } = unlocked();
		for (let i = 0; i < 30; i++) audio.play({ kind: "laser" });
		// One voice gain per admitted laser, straight into the combat bus.
		const voices = ctx.gains.filter((g) => g.outputs.includes(buses.combat));
		const sounding = voices.filter((g) => g.gain.target > 0);
		expect(sounding).toHaveLength(VOICE_CAPS.weapons);
		// The rest were stolen, and a steal is a fade rather than a cut.
		for (const stolen of voices.filter((g) => g.gain.target === 0))
			expect(stolen.gain.events).toContainEqual(["target", 0, ctx.currentTime]);
		expect(VOICE_STEAL_FADE_S).toBeGreaterThan(0);
	});

	test("the oldest is the one stolen", () => {
		const { audio, ctx, buses } = unlocked();
		for (let i = 0; i <= VOICE_CAPS.weapons; i++) {
			audio.play({ kind: "laser" });
			ctx.currentTime += 0.001;
		}
		const voices = ctx.gains.filter((g) => g.outputs.includes(buses.combat));
		expect(voices[0].gain.target).toBe(0);
		for (const v of voices.slice(1)) expect(v.gain.target).toBe(1);
	});

	test("a laser that has rung out frees its voice", () => {
		const { audio, ctx, buses } = unlocked();
		for (let i = 0; i < VOICE_CAPS.weapons; i++) audio.play({ kind: "laser" });
		ctx.currentTime += CUE_LENGTH_S.laser + 0.01;
		audio.play({ kind: "laser" });
		const voices = ctx.gains.filter((g) => g.outputs.includes(buses.combat));
		expect(voices.every((g) => g.gain.target === 1)).toBe(true);
	});

	test("every pooled cue has a length", () => {
		for (const kind of Object.keys(CUE_VOICE) as VoicedCueKind[])
			expect(CUE_LENGTH_S[kind]).toBeGreaterThan(0);
	});
});

describe("the offline seam", () => {
	test("an engine attached to a context it was given needs no window", () => {
		(globalThis as { window?: unknown }).window = undefined;
		const ctx = new FakeContext();
		const audio = new AudioFX();
		audio.attach(ctx as unknown as BaseAudioContext);
		audio.play({ kind: "explosion" });
		expect(ctx.sources.length).toBeGreaterThan(0);
		for (const source of ctx.sources)
			expect(reaches(source, ctx.destination)).toBe(true);
	});

	test("a second attach is refused rather than building a second graph", () => {
		const ctx = new FakeContext();
		const audio = new AudioFX();
		audio.attach(ctx as unknown as BaseAudioContext);
		audio.attach(new FakeContext() as unknown as BaseAudioContext);
		expect(FakeContext.made[1].gains).toHaveLength(0);
	});

	test("an attached offline context is not the realtime one, so it is not called audible", () => {
		const audio = new AudioFX();
		audio.attach(new FakeContext() as unknown as BaseAudioContext);
		expect(audio.silent).toBe(true);
	});
});
