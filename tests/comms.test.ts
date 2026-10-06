/**
 * The game's spoken lines (#600): which event says what, that every line can
 * be said, how a line is played on a bus, and the `?voices=` arm. How a line
 * sounds is the principal's ear; that it reaches a bus is here.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearanceTone } from "../src/console-sound";
import type { Clearance } from "../src/docking";
import {
	COMMS_LINES,
	clearanceLine,
	type CommsLineId,
	ejectWarningLine,
	numbersPhrase,
	voiceArms,
} from "../src/comms";
import {
	aheadReady,
	renderLine,
	renderNumbers,
	prewarmFirst,
	prewarmNeural,
	renderNumbersAhead,
	sayLine,
	sayNumbers,
	stationVoices,
	takeNumbers,
	useNeuralVoice,
} from "../src/comms-voice";
import type { AudioFX } from "../src/audio";
import {
	type NeuralVoice,
	type NeuralVoiceId,
	SPEAKER_VOICES,
} from "../src/neural-voice";
import { RADIO, RADIO_NEURAL, radio } from "../src/radio";
import { neuralWanted } from "../src/neural-voice";
import { textToTokens } from "../src/speech-lexicon";
import { SPEECH_ECHO_MAX_TAIL_S } from "../src/audio";
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

	test("approach control speaks on a change of answer, as the console sounds", () => {
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
		expect(clearanceLine(none, denied("closed"))).toBe("deniedClosed");
		expect(clearanceLine(denied("hostile"), denied("hostile"))).toBeNull();
		expect(clearanceLine(granted, none)).toBeNull();
	});

	test("approach control speaks exactly when the console sounds", () => {
		// Round 2: `clearanceLine` reads `clearanceTone`, and every pair of
		// answers is held to it, so the two cannot drift apart.
		const answers: Clearance[] = [
			none,
			granted,
			{ kind: "granted", expiresAtS: 90 },
			queued,
			{ kind: "queued", position: 1 },
			denied("hostile"),
			denied("contraband"),
			denied("no berth that fits"),
			denied("closed"),
		];
		for (const prev of answers)
			for (const next of answers)
				expect(
					clearanceLine(prev, next) !== null,
					`${JSON.stringify(prev)} -> ${JSON.stringify(next)}`,
				).toBe(clearanceTone(prev, next) !== null);
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
		// Round 2 of #600's review: the first form of this test passed with
		// `renderNumbersAhead` a no-op. It reads the cache now.
		const text = numbersPhrase(4242, 7);
		renderNumbersAhead(text);
		// Not inside the call that asked: headless, a timer stands in for the
		// page's idle callback.
		expect(aheadReady(text)).toBe(false);
		await new Promise((r) => setTimeout(r, 5));
		expect(aheadReady(text)).toBe(true);
		const taken = takeNumbers(text);
		expect(aheadReady(text)).toBe(false);
		expect(taken).toEqual(renderNumbers(text));
	});
});

describe("the natural voice through the radio", () => {
	// A line as Kokoro hands it over: a vowel at Kokoro's measured peak.
	const natural = Float32Array.from(
		{ length: 4000 },
		(_, i) => 0.6 * Math.sin((2 * Math.PI * 440 * i) / 16000),
	);
	const fake = {
		state: { kind: "ready" },
		kept: async () => natural,
		line: async () => natural,
	} as unknown as NeuralVoice;
	const heard: Float32Array[] = [];
	const fx = {
		speak: (x: Float32Array) => heard.push(x),
	} as unknown as AudioFX;
	afterEach(() => {
		useNeuralVoice(null);
		heard.length = 0;
	});

	test("its speaker is driven less hard than the formant voice's", () => {
		expect(RADIO_NEURAL.drive).toBeLessThan(RADIO.drive);
		expect({ ...RADIO_NEURAL, drive: RADIO.drive, gain: RADIO.gain }).toEqual(
			RADIO,
		);
	});

	test("a comms line goes through the natural voice's radio", async () => {
		useNeuralVoice(fake);
		await sayLine(fx, "granted");
		expect(heard).toHaveLength(1);
		expect(heard[0]).toEqual(radio(natural, RADIO_NEURAL));
	});

	test("a numbers phrase goes through it too, with no beep", async () => {
		useNeuralVoice(fake);
		const text = numbersPhrase(77, 3);
		renderNumbersAhead(text);
		await new Promise((r) => setTimeout(r, 5));
		await sayNumbers(fx, text);
		expect(heard).toHaveLength(1);
		expect(heard[0]).toEqual(radio(natural, { ...RADIO_NEURAL, beepHz: 0 }));
	});
});

describe("the background preparation (O1, 2026-10-02)", () => {
	// A ready voice whose preparations are recorded, and held until released,
	// so a test can change the system between two of them.
	const prepared: string[] = [];
	let release: (() => void) | null = null;
	const fake = {
		state: { kind: "ready" },
		prepare: (text: string, voice: NeuralVoiceId) => {
			prepared.push(`${voice}|${text}`);
			return new Promise<void>((r) => {
				release = r;
			});
		},
	} as unknown as NeuralVoice;
	const step = async () => {
		const r = release;
		release = null;
		r?.();
		await new Promise((r) => setTimeout(r, 0));
	};
	const lines = Object.keys(COMMS_LINES).length;
	afterEach(() => {
		useNeuralVoice(null);
		prewarmFirst(() => []);
		prepared.length = 0;
	});

	test("the current system's voices are prepared first, every line of them", async () => {
		useNeuralVoice(fake);
		prewarmFirst(() => ["bm_fable", "af_sarah"]);
		const done = prewarmNeural();
		for (let i = 0; i < SPEAKER_VOICES.length * lines; i++) await step();
		await done;
		const voices = prepared.map((k) => k.split("|")[0]);
		expect(voices.slice(0, lines).every((v) => v === "bm_fable")).toBe(true);
		expect(voices.slice(lines, 2 * lines).every((v) => v === "af_sarah")).toBe(
			true,
		);
		// And then every other voice, each pair once.
		expect(new Set(prepared).size).toBe(SPEAKER_VOICES.length * lines);
		expect(prepared).toHaveLength(SPEAKER_VOICES.length * lines);
	});

	test("the voices prepared first are the ones the stations speak in", async () => {
		// `stationVoices` is what the game prepares first; this is what
		// `sayLine` actually asks the voice for, line by line.
		const asked: NeuralVoiceId[] = [];
		const listener = {
			state: { kind: "ready" },
			kept: async (_t: string, who: NeuralVoiceId) => {
				asked.push(who);
				return null;
			},
			line: async () => null,
		} as unknown as NeuralVoice;
		const fx = { speak: () => 0 } as unknown as AudioFX;
		useNeuralVoice(listener);
		const stations = ["station-trade", "station-refinery", "station-shipyard"];
		const station = (Object.keys(COMMS_LINES) as CommsLineId[]).filter(
			(id) => COMMS_LINES[id].voice === "approach",
		);
		expect(station.length).toBeGreaterThan(0);
		for (const system of [1, 7919, 104729]) {
			const first = stationVoices(system, stations);
			for (const [i, id] of stations.entries())
				for (const line of station) {
					asked.length = 0;
					await sayLine(fx, line, { system, id });
					expect(asked).toEqual([first[i]]);
				}
		}
	});

	test("a jump to another system moves its voices to the front", async () => {
		useNeuralVoice(fake);
		let system: NeuralVoiceId[] = ["bm_fable"];
		prewarmFirst(() => system);
		const done = prewarmNeural();
		await step();
		await step();
		system = ["am_puck"];
		await step();
		expect(prepared[3].split("|")[0]).toBe("am_puck");
		for (let i = 0; i < SPEAKER_VOICES.length * lines; i++) await step();
		await done;
		expect(new Set(prepared).size).toBe(SPEAKER_VOICES.length * lines);
	});
});

describe("the ?voices= arm", () => {
	test("on by default; off silences both; each can go alone", () => {
		const base = { engine: "setting" as const, ask: false };
		expect(voiceArms(null, true)).toEqual({
			comms: true,
			music: true,
			...base,
		});
		expect(voiceArms("off", true)).toEqual({
			comms: false,
			music: false,
			...base,
		});
		expect(voiceArms("nocomms", true)).toEqual({
			comms: false,
			music: true,
			...base,
		});
		expect(voiceArms("nomusic", true)).toEqual({
			comms: true,
			music: false,
			...base,
		});
		// #604: the engine over the player's setting, and the question on a
		// direct boot.
		expect(voiceArms("neural", true).engine).toBe("neural");
		expect(voiceArms("formant,nomusic", true)).toEqual({
			comms: true,
			music: false,
			engine: "formant",
			ask: false,
		});
		expect(voiceArms("ask", true).ask).toBe(true);
		// Off a dev server, a link cannot start the download (sage round 1 on
		// #606); the formant arm downloads nothing and stays.
		expect(voiceArms("neural", false).engine).toBe("setting");
		expect(voiceArms("formant", false).engine).toBe("formant");
	});

	test("#604: the natural voice starts on a yes, never on Ask", () => {
		// The row decides unless an arm forces an engine.
		expect(neuralWanted("neural", "setting")).toBe(true);
		expect(neuralWanted("ask", "setting")).toBe(false);
		expect(neuralWanted("formant", "setting")).toBe(false);
		// `?voices=neural` downloads whatever the row says; `formant` never.
		for (const row of ["ask", "neural", "formant"] as const) {
			expect(neuralWanted(row, "neural")).toBe(true);
			expect(neuralWanted(row, "formant")).toBe(false);
		}
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

	test("an echo that would never fall is still taken apart", () => {
		const { audio, ctx } = unlocked();
		audio.speak(new Float32Array(1600), 16000, "music", {
			echoS: 0.42,
			feedback: 1,
			level: 0.3,
		});
		const src = ctx.sources.at(-1) as unknown as { onended: () => void };
		const saved = globalThis.setTimeout;
		let waited = Number.NaN;
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
		expect(Number.isFinite(waited)).toBe(true);
		expect(waited).toBeLessThanOrEqual(SPEECH_ECHO_MAX_TAIL_S * 1000);
	});
});

describe("the eject warning's line (#660 D12, node #704)", () => {
	test("names the key the glass names, and none it cannot say", () => {
		expect(COMMS_LINES[ejectWarningLine("hold Backspace")].text).toContain(
			"backspace",
		);
		expect(COMMS_LINES[ejectWarningLine("hold Home")].text).toContain("home");
		const rebound = COMMS_LINES[ejectWarningLine("hold 8")].text;
		expect(rebound).toContain("Eject");
		expect(textToTokens(rebound).unknown).toEqual([]);
	});
});
