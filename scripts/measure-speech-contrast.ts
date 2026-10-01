/**
 * How far apart the minimal pairs are, as heard: after the radio, not in the
 * synthesiser's tracks (2026-09-30: *B D G still difficult, S F TH very
 * hard*, after a retune whose every headless row was green).
 *
 * Each word is rendered, aligned on its vowel's onset, and read as log band
 * energies, 250–3400 Hz in 10 ms frames, over the consonant and the start of
 * the vowel. **Contrast** is the mean distance between two words over the
 * mean distance between two renders of the same word on different noise
 * seeds: near 1, the difference is inside the noise, which is what "sounds
 * the same" means. Every band of every frame is floored at what masks it —
 * the noise the radio actually added there, plus 3 dB, or dry and with no
 * hiss, 50 dB under the vowel — so two stretches of hiss compare as equal and
 * a difference nobody can hear does not count. Without the floor, two seeds'
 * hiss in a stop's closure read as a difference and every stop looked
 * inaudible; with a fixed floor at the undocked hiss, the ducked radio's
 * glides were erased; with none at all, a voice bar's residue 40 dB down
 * counted 60 dB of difference. Printed per arm — dry, the radio without its drive,
 * without its hiss, and whole — so a loss can be put on a stage.
 *
 *   bun scripts/measure-speech-contrast.ts
 */
import { RADIO, type RadioSettings, radio } from "../src/radio";
import {
	frameTracks,
	parsePhonemes,
	SPEECH_RATE,
	speak,
	VOICES,
} from "../src/speech";

const SETS: Record<string, string[]> = {
	"B D G": ["B EY1", "D EY1", "G EY1"],
	"S F TH": ["S IH1 N", "F IH1 N", "TH IH1 N"],
	"S SH": ["S IH1 N", "SH IH1 N"],
	"M N": ["M EY1", "N EY1"],
	"P B T": ["P AE1 D", "B AE1 D", "T AE1 D"],
};

type Arm = { name: string; radio: RadioSettings | null };
export const ARMS: Arm[] = [
	{ name: "dry", radio: null },
	{
		name: "radio, no drive",
		radio: { ...RADIO, drive: 0, beepHz: 0, squelch: false },
	},
	{
		name: "radio, no hiss",
		radio: { ...RADIO, hiss: 0, beepHz: 0, squelch: false },
	},
	{ name: "radio", radio: { ...RADIO, beepHz: 0, squelch: false } },
];

const FRAME = 160; // 10 ms
// Frames before the vowel onset: from the closure, never into the squelch
// that opens the carrier before a word (it read as 22–31 dB of noise).
const BEFORE = 6;
const AFTER = 8;
const BANDS = Array.from(
	{ length: 16 },
	(_, i) => 250 * (3400 / 250) ** (i / 16),
);

function finite(x: number, what: string) {
	if (!Number.isFinite(x)) throw new Error(`speech contrast: ${what} is ${x}`);
	return x;
}

/** Log band energies of `x` in the frame starting at `a`. */
function bands(x: Float32Array, a: number): number[] {
	return BANDS.map((lo, i) => {
		const hi = i + 1 < BANDS.length ? BANDS[i + 1] : 3400;
		let e = 1e-12;
		for (let hz = lo; hz < hi; hz += 40) {
			const w = (2 * Math.PI * hz) / SPEECH_RATE;
			let re = 0;
			let im = 0;
			for (let k = 0; k < FRAME; k++) {
				const v = a + k >= 0 && a + k < x.length ? x[a + k] : 0;
				const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / FRAME);
				re += v * win * Math.cos(w * k);
				im += v * win * Math.sin(w * k);
			}
			e += re * re + im * im;
		}
		return finite(10 * Math.log10(e), `band ${i}`);
	});
}

/** The word's features: log band energy per frame around its vowel onset,
 *  each band floored at what masks it. */
export function features(ph: string, arm: Arm, seed: number): number[][] {
	const tokens = parsePhonemes(ph);
	const voice = VOICES.approach;
	const t = frameTracks(tokens, voice);
	const onset = t.role.indexOf("vowel") * 80;
	let x = speak(tokens, voice, seed);
	let noise: Float32Array | null = null;
	let lead = 0;
	if (arm.radio) {
		const out = radio(x, arm.radio, seed + 11, (n) => {
			noise = n;
		});
		lead = arm.radio.squelch ? Math.round(0.09 * SPEECH_RATE) : 0;
		x = out;
	}
	const at = lead + onset;
	// Dry and hissless, the floor is 50 dB under the vowel's loudest band.
	const vowelTop = Math.max(...bands(x, at + 4 * FRAME));
	const rows: number[][] = [];
	for (let f = -BEFORE; f < AFTER; f++) {
		const masked = noise
			? bands(noise, at + f * FRAME).map((v) => Math.max(v + 3, vowelTop - 50))
			: BANDS.map(() => vowelTop - 50);
		rows.push(bands(x, at + f * FRAME).map((v, i) => Math.max(v, masked[i])));
	}
	return rows;
}

/** Mean per-frame Euclidean distance, dB. */
const distance = (a: number[][], b: number[][]) =>
	a.reduce(
		(s, row, f) =>
			s + Math.sqrt(row.reduce((q, v, i) => q + (v - b[f][i]) ** 2, 0)),
		0,
	) / a.length;

/** The weakest pair of a set, as a contrast; and every pair's. */
export function contrast(words: string[], arm: Arm) {
	const A = words.map((w) => features(w, arm, 1));
	const B = words.map((w) => features(w, arm, 2));
	const within =
		words.reduce((s, _, i) => s + distance(A[i], B[i]), 0) / words.length;
	const pairs: { pair: string; c: number }[] = [];
	for (let i = 0; i < words.length; i++)
		for (let j = i + 1; j < words.length; j++)
			pairs.push({
				pair: `${words[i].split(" ")[0]}/${words[j].split(" ")[0]}`,
				c: finite(distance(A[i], A[j]) / within, "contrast"),
			});
	return { min: Math.min(...pairs.map((p) => p.c)), pairs };
}

if (import.meta.main) {
	for (const [name, words] of Object.entries(SETS)) {
		console.log(name);
		for (const arm of ARMS) {
			const { pairs } = contrast(words, arm);
			console.log(
				`  ${arm.name.padEnd(16)} ${pairs.map((p) => `${p.pair} ${p.c.toFixed(2)}`).join("   ")}`,
			);
		}
	}
}
