/**
 * Stage 2 of the formant synthesiser (#600): how long each sound lasts, how
 * the pitch moves over a phrase, and the voice's source. Read off the frame
 * tracks the renderer uses and off the rendered sound; whether it sounds
 * natural is the principal's ear.
 */
import { describe, expect, test } from "bun:test";
import {
	flutter,
	frameTracks,
	parsePhonemes,
	SPEECH_RATE,
	type SpeechVoice,
	speak,
	type Token,
	VOICES,
} from "../src/speech";
import { textToTokens } from "../src/speech-lexicon";
import { bandEnergy } from "./lib/audio-measure";

/** The lengths, in frames, of each run of vowel frames, in order. */
const vowelRuns = (tokens: Token[], voice: SpeechVoice = VOICES.approach) => {
	const t = frameTracks(tokens, voice);
	const runs: number[] = [];
	let n = 0;
	t.role.forEach((r) => {
		if (r === "vowel") n++;
		else if (n) {
			runs.push(n);
			n = 0;
		}
	});
	if (n) runs.push(n);
	return runs;
};

/** Words in brackets, one word each, then a full stop. */
const words = (...ws: string[]) =>
	textToTokens(`${ws.map((w) => `[${w}]`).join(" ")} .`).tokens;

describe("durations (Klatt's rules)", () => {
	test("a vowel is shorter before a voiceless stop than before a voiced one", () => {
		expect(vowelRuns(words("B AE1 T"))[0]).toBeLessThan(
			vowelRuns(words("B AE1 D"))[0],
		);
	});

	test("the last vowel of a phrase is lengthened", () => {
		const [first, last] = vowelRuns(words("B AE1 D", "B AE1 D"));
		expect(last).toBeGreaterThan(1.2 * first);
	});

	test("an unstressed vowel is shorter than a stressed one", () => {
		expect(vowelRuns(words("B AE0 D"))[0]).toBeLessThan(
			vowelRuns(words("B AE1 D"))[0],
		);
	});

	test("a vowel in a longer word is shorter", () => {
		const long = vowelRuns(words("B AE1 D AH0", "T UW1"))[0];
		const short = vowelRuns(words("B AE1 D", "T UW1"))[0];
		expect(long).toBeLessThan(short);
	});

	test("words are numbered, and a bracket is one word", () => {
		const { tokens } = textToTokens("Clearance granted [K AA1 B R AH0].");
		const ws = tokens.flatMap((t) => ("ph" in t ? [t.w] : []));
		expect(new Set(ws).size).toBe(3);
		expect(ws[0]).toBe(0);
	});
});

describe("intonation (a hat pattern)", () => {
	const pitchAt = (text: string, voice = VOICES.approach) => {
		const tokens = textToTokens(text).tokens;
		const t = frameTracks(tokens, voice);
		const vowels = t.role.flatMap((r, i) => (r === "vowel" ? [i] : []));
		return { t, vowels };
	};

	test("the pitch rises into the first stressed vowel and falls at the end", () => {
		const { t, vowels } = pitchAt("This is approach control.");
		const first = vowels[0];
		const last = vowels[vowels.length - 1];
		let peak = 0;
		for (let i = first; i < first + 30; i++) peak = Math.max(peak, t.pitch[i]);
		expect(peak).toBeGreaterThan(t.pitch[first] * 1.05);
		expect(t.pitch[last]).toBeLessThan(peak * 0.9);
	});

	test("a question ends rising", () => {
		const statement = pitchAt("You are cleared.");
		const question = pitchAt("You are cleared?");
		const end = (p: typeof statement) =>
			p.t.pitch[p.vowels[p.vowels.length - 1]];
		expect(end(question)).toBeGreaterThan(1.2 * end(statement));
	});

	test("the machine speaks on one pitch", () => {
		const { t, vowels } = pitchAt("This is approach control.", VOICES.machine);
		const ps = vowels.map((i) => t.pitch[i]);
		expect(Math.max(...ps) - Math.min(...ps)).toBeLessThan(0.01);
	});
});

describe("the glottal source", () => {
	/** Energy in `[lo, hi)` Hz over the middle of a held AA. */
	const band = (x: Float32Array, lo: number, hi: number) =>
		bandEnergy(
			x,
			SPEECH_RATE,
			lo,
			hi,
			Math.floor(0.35 * SPEECH_RATE),
			Math.floor(0.5 * SPEECH_RATE),
		);
	const aa = (voice: SpeechVoice) => speak(parsePhonemes(". AA1 ."), voice);

	test("tilt takes energy from the top of the spectrum", () => {
		const flat = aa({ ...VOICES.machine, tilt: 0 });
		const tilted = aa({ ...VOICES.machine, tilt: 12 });
		const ratio = (x: Float32Array) => band(x, 2000, 3400) / band(x, 200, 900);
		expect(ratio(tilted)).toBeLessThan(0.5 * ratio(flat));
	});

	test("flutter is a slow wander of a few percent at most", () => {
		let lo = 1;
		let hi = 1;
		for (let t = 0; t < 3; t += 0.001) {
			const f = flutter(t, 1);
			lo = Math.min(lo, f);
			hi = Math.max(hi, f);
		}
		expect(hi - lo).toBeGreaterThan(0.01);
		expect(hi).toBeLessThan(1.03);
		expect(lo).toBeGreaterThan(0.97);
		expect(flutter(1.234, 0)).toBe(1);
	});

	test("flutter reaches the render", () => {
		const a = aa({ ...VOICES.machine, flutter: 0 });
		const b = aa({ ...VOICES.machine, flutter: 1 });
		expect(b).not.toEqual(a);
	});
});
