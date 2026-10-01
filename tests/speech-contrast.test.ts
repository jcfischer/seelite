/**
 * Minimal pairs as heard: after the radio, by `scripts/measure-speech-
 * contrast.ts` (2026-09-30: *B D G still difficult, S F TH very hard*,
 * after a retune whose every row in `speech.test.ts` was green, because
 * those rows read the synthesiser's tracks and never the radio's output).
 *
 * Contrast is the distance between two words over the distance between two
 * renders of one word, each band floored at the noise that masks it. The
 * threshold is the ear's, from the report it answers: on the synthesiser
 * the principal heard then, through the first radio's hiss, P/T read 1.89
 * and was heard apart, and B/D/G read 0.61–0.99 and were heard as one. The
 * merged synthesiser reads 0.69/1.14/0.72 through that hiss (`radio.ts`), so
 * B/G alone has since crossed 1 — under this threshold still.
 */
import { describe, expect, test } from "bun:test";
import { contrast } from "../scripts/measure-speech-contrast";
import { RADIO } from "../src/radio";

/** Between the ear's two readings: under the lowest pair heard apart (P/T,
 *  1.89) and over the highest heard as one (0.99). At 1.9 this rejected the
 *  very pair it was calibrated on (sage round 3). */
const HEARD_APART = 1.8;
const radio = {
	name: "radio",
	radio: { ...RADIO, beepHz: 0, squelch: false },
};

describe("minimal pairs through the radio", () => {
	for (const words of [
		["B EY1", "D EY1", "G EY1"],
		["P AE1 D", "B AE1 D", "T AE1 D"],
		["M EY1", "N EY1"],
		["S IH1 N", "F IH1 N"],
		["S IH1 N", "TH IH1 N"],
	])
		test(words.join(" / "), () => {
			for (const p of contrast(words, radio).pairs)
				expect(p.c, p.pair).toBeGreaterThan(HEARD_APART);
		});

	test("the instrument hears the masking the principal heard", () => {
		// The first radio's hiss: B and D must read as one, or this file
		// cannot go red on the defect it was written for.
		const first = { name: "first", radio: { ...radio.radio, hiss: 0.03 } };
		expect(contrast(["B EY1", "D EY1"], first).min).toBeLessThan(1);
	});
});
