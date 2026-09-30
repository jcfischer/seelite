/**
 * The formant synthesiser and the radio (prototype, 2026-09-30). What is
 * arithmetic is here: every word parses, a vowel's energy sits at its
 * formants, a fricative's above them, and the radio passes its band and
 * little else. Whether a phrase is intelligible is the principal's ear.
 */
import { describe, expect, test } from "bun:test";
import { RADIO, radio } from "../src/radio";
import {
	PHONEMES,
	parsePhonemes,
	SPEECH_RATE,
	speak,
	VOICES,
} from "../src/speech";
import { LEXICON, textToTokens } from "../src/speech-lexicon";

/** Energy in `[lo, hi)` Hz over `x[a..b)`, by DFT bins 25 Hz apart. */
function bandEnergy(
	x: Float32Array,
	lo: number,
	hi: number,
	a = 0,
	b = x.length,
) {
	let e = 0;
	const n = b - a;
	for (let hz = lo; hz < hi; hz += 25) {
		const w = (2 * Math.PI * hz) / SPEECH_RATE;
		let re = 0;
		let im = 0;
		for (let i = a; i < b; i++) {
			re += x[i] * Math.cos(w * i);
			im += x[i] * Math.sin(w * i);
		}
		e += (re * re + im * im) / n;
	}
	return e;
}

/** A sustained phoneme, stressed, between pauses, and its middle. */
const held = (ph: string) => {
	const x = speak(parsePhonemes(`. ${ph}1 .`), VOICES.machine);
	return {
		x,
		a: Math.floor(0.35 * SPEECH_RATE),
		b: Math.floor(0.45 * SPEECH_RATE),
	};
};

describe("the synthesiser", () => {
	test("every word in the lexicon parses", () => {
		for (const [word, ph] of Object.entries(LEXICON))
			expect(() => parsePhonemes(ph), word).not.toThrow();
	});

	test("text reads digits one by one and reports what it cannot say", () => {
		const { tokens, unknown } = textToTokens("Bay 4, xyzzy [K AA1 B R AH0].");
		expect(unknown).toEqual(["xyzzy"]);
		const phs = tokens.map((t) => ("ph" in t ? t.ph : "|"));
		expect(phs.join(" ")).toBe("B EY F AO R | K AA B R AH |");
	});

	test("a vowel's energy sits at its formants", () => {
		// IY: F2 near 2.3 kHz; AA: F1 and F2 together near 0.7–1.1 kHz. Relative,
		// because the glottal source falls 12 dB an octave: IY's F2 band is not
		// louder than its lows, but it is far louder than AA's is.
		const iy = held("IY");
		const aa = held("AA");
		const ratio = (h: typeof iy) =>
			bandEnergy(h.x, 1900, 2700, h.a, h.b) /
			bandEnergy(h.x, 600, 1300, h.a, h.b);
		expect(ratio(iy)).toBeGreaterThan(10 * ratio(aa));
	});

	test("an S is noise above the vowels", () => {
		const s = held("S");
		const aa = held("AA");
		const high = (h: typeof s) =>
			bandEnergy(h.x, 4000, 7000, h.a, h.b) /
			bandEnergy(h.x, 100, 7000, h.a, h.b);
		expect(high(s)).toBeGreaterThan(0.5);
		expect(high(aa)).toBeLessThan(0.05);
	});

	test("a phrase is finite, peaks at 0.9 and renders the same twice", () => {
		const { tokens } = textToTokens("Cobra one, clearance granted.");
		const a = speak(tokens, VOICES.control);
		let peak = 0;
		for (const v of a) {
			expect(Number.isFinite(v)).toBe(true);
			peak = Math.max(peak, Math.abs(v));
		}
		expect(peak).toBeCloseTo(0.9, 5);
		expect(speak(tokens, VOICES.control)).toEqual(a);
		expect(a.length / SPEECH_RATE).toBeGreaterThan(1);
		expect(a.length / SPEECH_RATE).toBeLessThan(3);
	});

	test("every phoneme renders on every voice", () => {
		for (const voice of Object.values(VOICES))
			for (const ph of Object.keys(PHONEMES)) {
				const x = speak(parsePhonemes(`AA1 ${ph} AA1`), voice);
				expect(x.every(Number.isFinite), ph).toBe(true);
			}
	});
});

describe("the radio", () => {
	test("it passes its band and little outside it", () => {
		const { tokens } = textToTokens("Commander, this is station control.");
		const x = radio(speak(tokens, VOICES.control), {
			...RADIO,
			hiss: 0,
			squelch: false,
			beepHz: 0,
			drive: 0,
		});
		const inBand = bandEnergy(x, 500, 2500);
		expect(bandEnergy(x, 50, 150) / inBand).toBeLessThan(0.02);
		expect(bandEnergy(x, 5000, 7500) / inBand).toBeLessThan(0.02);
	});

	test("the squelch and the beep lengthen the transmission", () => {
		const v = speak(textToTokens("Roger.").tokens, VOICES.pilot);
		expect(radio(v).length).toBeGreaterThan(v.length + 0.3 * SPEECH_RATE);
		expect(radio(v, { ...RADIO, squelch: false, beepHz: 0 }).length).toBe(
			v.length,
		);
	});
});
