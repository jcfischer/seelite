/**
 * The game's spoken lines (#600): which event says what, that every line can
 * be said, how a line is played on a bus, and the `?voices=` arm. How a line
 * sounds is the principal's ear; that it reaches a bus is here.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Clearance } from "../src/docking";
import {
	COMMS_LINES,
	clearanceLine,
	type CommsLineId,
	numbersPhrase,
	voiceArms,
} from "../src/comms";
import {
	renderLine,
	renderNumbers,
	renderNumbersAhead,
	takeNumbers,
} from "../src/comms-voice";
import { textToTokens } from "../src/speech-lexicon";
import { reaches, unlocked, withFakeWindow } from "./lib/fake-audio";

withFakeWindow(beforeEach, afterEach);

const none: Clearance = { kind: "none" };
const granted: Clearance = { kind: "granted", expiresAtS: 60 };
const queued: Clearance = { kind: "queued", position: 2 };
const denied = (
	reason: Extract<Clearance, { kind: "denied" }>["reason"],
): Clearance => ({ kind: "denied", reason });

describe("the lines", () => {
	test("every line is said from the lexicon, with no word skipped", () => {
		for (const [id, line] of Object.entries(COMMS_LINES))
			expect(textToTokens(line.text).unknown, id).toEqual([]);
	});

	test("every line renders through the radio, finite and not silent", () => {
		for (const id of Object.keys(COMMS_LINES) as CommsLineId[]) {
			const x = renderLine(id);
			let peak = 0;
			for (const v of x) {
				expect(Number.isFinite(v)).toBe(true);
				peak = Math.max(peak, Math.abs(v));
			}
			expect(peak, id).toBeGreaterThan(0.1);
		}
		expect(renderLine("granted")).toBe(renderLine("granted"));
	});

	test("station control speaks on a change of answer, as the console sounds", () => {
		expect(clearanceLine(none, granted)).toBe("granted");
		expect(clearanceLine(queued, granted)).toBe("granted");
		expect(clearanceLine(granted, granted)).toBeNull();
		expect(clearanceLine(none, queued)).toBe("queued");
		expect(clearanceLine(queued, { kind: "queued", position: 1 })).toBeNull();
		expect(clearanceLine(none, denied("hostile"))).toBe("deniedHostile");
		expect(clearanceLine(none, denied("contraband"))).toBe("deniedContraband");
		expect(clearanceLine(none, denied("no berth that fits"))).toBe(
			"deniedNoBerth",
		);
		expect(clearanceLine(denied("hostile"), denied("hostile"))).toBeNull();
		expect(clearanceLine(granted, none)).toBeNull();
	});

	test("the numbers are the system's own, and move on", () => {
		const a = numbersPhrase(1234, 0);
		expect(a).toBe(numbersPhrase(1234, 0));
		expect(a).not.toBe(numbersPhrase(1234, 1));
		expect(a).not.toBe(numbersPhrase(99, 0));
		expect(a).toMatch(/^(\d \d \d \d\. ){2}\d \d \d \d\.$/);
		expect(textToTokens(a).unknown).toEqual([]);
	});
});

describe("rendering off the frame", () => {
	test("the next phrase is rendered ahead, not when it is asked, and taken once", async () => {
		const text = numbersPhrase(4242, 7);
		renderNumbersAhead(text);
		// Headless there is no idle callback, so a timer stands in for it: the
		// render has not happened inside the call that asked for it.
		const early = takeNumbers(text);
		await new Promise((r) => setTimeout(r, 5));
		renderNumbersAhead(text);
		await new Promise((r) => setTimeout(r, 5));
		const taken = takeNumbers(text);
		expect(taken).toEqual(renderNumbers(text));
		expect(early).toEqual(taken);
		// Taken once: the next ask renders afresh.
		expect(takeNumbers(text)).not.toBe(taken);
	});
});

describe("the ?voices= arm", () => {
	test("on by default; off silences both; each can go alone", () => {
		expect(voiceArms(null)).toEqual({ comms: true, music: true });
		expect(voiceArms("off")).toEqual({ comms: false, music: false });
		expect(voiceArms("nocomms")).toEqual({ comms: false, music: true });
		expect(voiceArms("nomusic")).toEqual({ comms: true, music: false });
	});
});

describe("a spoken line on the engine", () => {
	test("a comms line plays through the console bus", () => {
		const { audio, ctx, buses } = unlocked();
		const s = audio.speak(renderLine("granted"), 16000, "console");
		expect(s).toBeGreaterThan(0.5);
		const src = ctx.sources.at(-1);
		expect(src && reaches(src, buses.console)).toBe(true);
		expect(src && reaches(src, buses.music)).toBe(false);
	});

	test("a line waits for the one speaking, and a newer waiting line replaces it", () => {
		const { audio, ctx } = unlocked();
		const x = new Float32Array(16000); // one second
		audio.speak(x, 16000, "console");
		audio.speak(x, 16000, "console");
		const second = ctx.sources.at(-1) as unknown as { startedAt: number[] };
		expect(second.startedAt[0]).toBeCloseTo(ctx.currentTime + 1, 5);
		audio.speak(x, 16000, "console");
		const third = ctx.sources.at(-1) as unknown as { startedAt: number[] };
		expect(third.startedAt[0]).toBeCloseTo(ctx.currentTime + 1, 5);
		// The replaced one is stopped before it starts.
		expect(
			(second as unknown as { stoppedAt: number[] }).stoppedAt.length,
		).toBe(1);
	});

	test("a voice in the music is far off: through an echo, on the music bus", () => {
		const { audio, ctx, buses } = unlocked();
		audio.speak(new Float32Array(1600), 16000, "music", {
			echoS: 0.42,
			feedback: 0.5,
			level: 0.3,
		});
		const src = ctx.sources.at(-1);
		expect(src && reaches(src, buses.music)).toBe(true);
		expect(src && reaches(src, buses.console)).toBe(false);
		expect(ctx.delays.length).toBe(1);
	});

	test("a far-off voice's echo is taken apart after the line and its tail", () => {
		const { audio, ctx } = unlocked();
		audio.speak(new Float32Array(1600), 16000, "music", {
			echoS: 0.42,
			feedback: 0.5,
			level: 0.3,
		});
		const src = ctx.sources.at(-1) as unknown as { onended: () => void };
		const delay = ctx.delays[0];
		expect(delay.disconnected).toBe(false);
		// The tail is seconds long: run the timer at once.
		const saved = globalThis.setTimeout;
		let waited = 0;
		globalThis.setTimeout = ((fn: () => void, ms: number) => {
			waited = ms;
			fn();
			return 0;
		}) as unknown as typeof setTimeout;
		try {
			src.onended();
		} finally {
			globalThis.setTimeout = saved;
		}
		expect(delay.disconnected).toBe(true);
		// 60 dB of a 0.5 feedback every 0.42 s: about ten repeats.
		expect(waited).toBeGreaterThan(4000);
		expect(waited).toBeLessThan(4500);
	});
});
