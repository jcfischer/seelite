/**
 * The formant synthesiser and the radio (prototype, 2026-09-30). What is
 * arithmetic is here: every word parses, a vowel's energy sits at its
 * formants, a fricative's above them, and the radio passes its band and
 * little else. Whether a phrase is intelligible is the principal's ear.
 */
import { describe, expect, test } from "bun:test";
import { RADIO, radio } from "../src/radio";
import {
	AntiResonator,
	frameTracks,
	Resonator,
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

	test("fricatives sit inside the radio's band, each in its own place", () => {
		// The first table put S at 5.5 kHz and F and TH near 5: the radio's
		// 300–3400 Hz band took all three and left three gaps.
		const cons = (ph: string) => {
			const tokens = parsePhonemes(`AA1 ${ph} AA1`);
			const t = frameTracks(tokens, VOICES.machine);
			const at = t.role.flatMap((r, i) => (r === "cons" ? [i] : []));
			return {
				x: speak(tokens, VOICES.machine),
				a: at[1] * 80,
				b: at[at.length - 2] * 80,
			};
		};
		const centroid = (h: ReturnType<typeof cons>) => {
			let num = 0;
			let den = 0;
			for (let hz = 300; hz < 7000; hz += 100) {
				const e = bandEnergy(h.x, hz, hz + 100, h.a, h.b);
				num += hz * e;
				den += e;
			}
			return num / den;
		};
		const inBand = (h: ReturnType<typeof cons>) =>
			bandEnergy(h.x, 2500, 3400, h.a, h.b);
		expect(centroid(cons("S"))).toBeGreaterThan(centroid(cons("SH")) + 800);
		expect(centroid(cons("SH"))).toBeLessThan(3400);
		// Beside the same vowel, S is far the loudest hiss in the top of the
		// band, and F and TH are weak.
		expect(inBand(cons("S"))).toBeGreaterThan(4 * inBand(cons("F")));
		expect(inBand(cons("S"))).toBeGreaterThan(4 * inBand(cons("TH")));
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

describe("consonants through the radio band", () => {
	/** The frames of `role` in a phrase's tracks. */
	const framesOf = (ph: string, role: string) => {
		const t = frameTracks(parsePhonemes(ph), VOICES.machine);
		const at = t.role.flatMap((r, i) => (r === role ? [i] : []));
		return { t, at };
	};
	const vowelStartF2 = (ph: string) => {
		const { t, at } = framesOf(ph, "vowel");
		return t.f2[at[0]] / VOICES.machine.tract;
	};

	test("a velar's glide starts where the vowel is, a labial's low, an alveolar's high", () => {
		// The locus rule: a fixed place for G would start both vowels alike.
		expect(vowelStartF2("G IY1")).toBeGreaterThan(2250);
		expect(vowelStartF2("G UW1")).toBeLessThan(1250);
		expect(vowelStartF2("B AA1")).toBeLessThan(1000);
		expect(vowelStartF2("D AA1")).toBeGreaterThan(1350);
	});

	test("B, D and G start apart before the same vowel, in F2 and in F3", () => {
		// The principal's ear, 2026-09-30: *bay, day, gay sound the same*. The
		// first loci started D and G 47 Hz apart in F2 and together in F3.
		const start = (ph: string) => {
			const { t, at } = framesOf(ph, "vowel");
			const k = VOICES.machine.tract;
			return { f2: t.f2[at[0]] / k, f3: t.f3[at[0]] / k };
		};
		const b = start("B EY1");
		const d = start("D EY1");
		const g = start("G EY1");
		expect(d.f2 - b.f2).toBeGreaterThan(250);
		expect(g.f2 - d.f2).toBeGreaterThan(200);
		expect(d.f3 - g.f3).toBeGreaterThan(100);
		expect(d.f3 - b.f3).toBeGreaterThan(200);
	});

	test("a voiceless stop's aspiration carries the start of the glide", () => {
		// An alveolar before AA: the widest F2 glide, falling from about 1420.
		// Held at the vowel's target, as aspiration once was, it would be flat.
		const { t, at } = framesOf("T AA1", "asp");
		const tract = VOICES.machine.tract;
		expect(at.length).toBeGreaterThan(2);
		expect(t.f2[at[0]] / tract).toBeGreaterThan(1090 + 200);
		expect(t.f2[at[at.length - 1]]).toBeLessThan(t.f2[at[0]] - 50);
	});

	test("a velar's voice onset is later than a labial's", () => {
		expect(framesOf("K AA1", "asp").at.length).toBeGreaterThan(
			framesOf("P AA1", "asp").at.length,
		);
	});

	/** The spectral centroid of the burst, Hz. */
	const burstCentroid = (ph: string) => {
		const tokens = parsePhonemes(ph);
		const { at } = framesOf(ph, "burst");
		const x = speak(tokens, VOICES.machine);
		const a = at[0] * 80;
		const b = (at[at.length - 1] + 1) * 80;
		let num = 0;
		let den = 0;
		for (let hz = 200; hz < 6000; hz += 100) {
			const e = bandEnergy(x, hz, hz + 100, a, b);
			num += hz * e;
			den += e;
		}
		return num / den;
	};

	test("a burst sits where its place puts it", () => {
		// A velar's follows the vowel's F2: one fixed band fails the first row.
		// Voiceless, so the burst is not under the voicing.
		expect(burstCentroid("AH0 K IY1")).toBeGreaterThan(
			burstCentroid("AH0 K UW1") + 300,
		);
		expect(burstCentroid("AH0 P AA1")).toBeLessThan(burstCentroid("AH0 T AA1"));
	});
});

describe("the nasal zero", () => {
	test("the antiresonator is the resonator's exact inverse, and off is identity", () => {
		const res = new Resonator();
		const anti = new AntiResonator();
		res.set(1000, 200);
		anti.set(1000, 200);
		const off = new AntiResonator();
		off.set(0, 200);
		let x = 12345;
		let worst = 0;
		let worstOff = 0;
		for (let i = 0; i < 4000; i++) {
			x = (x * 1103515245 + 12345) >>> 0;
			const v = x / 2 ** 31 - 1;
			worst = Math.max(worst, Math.abs(anti.step(res.step(v)) - v));
			worstOff = Math.max(worstOff, Math.abs(off.step(v) - v));
		}
		expect(worst).toBeLessThan(1e-9);
		expect(worstOff).toBe(0);
	});

	test("M's murmur has its hole lower than N's", () => {
		// With no zero, the two murmurs differ only in a damped F2.
		const murmur = (ph: string) => {
			const tokens = parsePhonemes(`AA1 ${ph} AA1`);
			const t = frameTracks(tokens, VOICES.machine);
			const at = t.role.flatMap((r, i) => (r === "cons" ? [i] : []));
			const x = speak(tokens, VOICES.machine);
			const a = at[1] * 80;
			const b = at[at.length - 2] * 80;
			return bandEnergy(x, 900, 1150, a, b) / bandEnergy(x, 1650, 1950, a, b);
		};
		expect(murmur("M")).toBeLessThan(murmur("N"));
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
