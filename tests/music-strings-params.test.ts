/**
 * The strings' parameter table and its grit (#547 D15, D16). One table is
 * the voice's defaults and the lab's sliders; the grit parameters are new,
 * and at their defaults the voice is the one the principal has heard.
 */
import { describe, expect, test } from "bun:test";
import type { PartSpec } from "../src/music-score";
import { resolvePart, VoiceBank } from "../src/music-voices";
import { STRINGS_PARAMS, stringsDefaults } from "../src/strings-params";
import { stringsFingerprint } from "./lib/strings-fingerprint";

const SR = 48000;
const unity = { gain: () => 1 };

/**
 * Printed by `stringsFingerprint()` at 0caa468, before the table and the
 * grit existed: a low note, a chord, a legato pair (each sum of squares and
 * sum), and the orchestra waltz's first six seconds.
 */
const BEFORE = [
	10805.313043792608, -2.3023751249580453, 29758.83958776035,
	-0.4221282423375605, 30572.349482173435, -12.82323937297383,
	757.8299731662067,
];

describe("the table", () => {
	test("at every default, the voice renders exactly as before the grit", () => {
		expect(stringsFingerprint()).toEqual(BEFORE);
	});

	test("every entry is a PartSpec field with a range that holds its default", () => {
		const keys = new Set<string>();
		for (const p of STRINGS_PARAMS) {
			expect(keys.has(p.key)).toBe(false);
			keys.add(p.key);
			expect(p.min).toBeLessThan(p.max);
			expect(p.step).toBeGreaterThan(0);
			expect(p.def).toBeGreaterThanOrEqual(p.min);
			expect(p.def).toBeLessThanOrEqual(p.max);
			expect(p.label.length).toBeGreaterThan(0);
			expect(p.help.length).toBeGreaterThan(0);
		}
	});

	test("the knobs the principal asked for are all there", () => {
		const keys = STRINGS_PARAMS.map((p) => p.key);
		for (const k of [
			"unison",
			"detune",
			"attackS",
			"releaseS",
			"index",
			"bowS",
			"vibratoHz",
			"vibrato",
			"vibratoOnsetS",
			"vibratoRiseS",
			"cutoffHz",
			"envAmount",
			"swell",
			"glideS",
			"spread",
			"level",
			"reverb",
			"echo",
			"drive",
			"keyTrack",
			"rosin",
			"rosinLow",
		] as const)
			expect(keys).toContain(k);
	});

	test("the voice's defaults are the table's", () => {
		const d = stringsDefaults();
		for (const p of STRINGS_PARAMS) expect(d[p.key]).toBe(p.def);
	});
});

/** A low note (A1) in mono, 1 s, from 0.3 s: the held part. */
function low(over: Partial<PartSpec>, pitch = 33): Float32Array {
	const b = new VoiceBank(8, SR);
	const p = resolvePart(
		{ voice: "strings", level: 1, vibrato: 0, drift: 0, ...over },
		SR,
	);
	b.noteOn(0, p, 0, 0, pitch, 0.8, 2 * SR);
	const out = new Float32Array(1.3 * SR);
	for (let f = 0; f < out.length; f += 128)
		b.render(out.subarray(f, f + 128), f, unity);
	return out.subarray(0.3 * SR);
}

/** Rms of the second difference over rms: how much of it is high. */
const highs = (x: Float32Array) => {
	let d = 0;
	let e = 0;
	for (let i = 2; i < x.length; i++) {
		d += (x[i] - 2 * x[i - 1] + x[i - 2]) ** 2;
		e += x[i] ** 2;
	}
	return Math.sqrt(d / e);
};
/** Rms of the first difference over rms: a centroid's rough stand-in. */
const centroid = (x: Float32Array) => {
	let d = 0;
	let e = 0;
	for (let i = 1; i < x.length; i++) {
		d += (x[i] - x[i - 1]) ** 2;
		e += x[i] ** 2;
	}
	return Math.sqrt(d / e);
};

describe("grit (D16)", () => {
	test("drive raises the upper harmonics of a low note", () => {
		expect(highs(low({ drive: 0.8 }))).toBeGreaterThan(
			1.15 * highs(low({ drive: 0 })),
		);
	});

	test("key tracking opens the lowpass for a low note", () => {
		expect(centroid(low({ keyTrack: 1 }))).toBeGreaterThan(
			1.2 * centroid(low({ keyTrack: 0 })),
		);
	});

	test("key tracking leaves a note at A4 and above alone", () => {
		const a = low({ keyTrack: 1 }, 69);
		const b = low({ keyTrack: 0 }, 69);
		for (let i = 0; i < a.length; i += 97) expect(a[i]).toBeCloseTo(b[i], 9);
	});

	test("rosin adds noise under a low note, more of it low than high", () => {
		const aperiodic = (x: Float32Array, period: number) => {
			const P = Math.round(period);
			let d = 0;
			let e = 0;
			for (let i = 0; i + P < x.length; i++) {
				d += (x[i + P] - x[i]) ** 2;
				e += x[i] ** 2;
			}
			return d / e;
		};
		const clean = { unison: 1, detune: 0, index: 0 };
		const lowP = SR / 55;
		const highP = SR / 880;
		const lowGain =
			aperiodic(low({ ...clean, rosin: 0.5, rosinLow: 1 }), lowP) /
			aperiodic(low({ ...clean, rosin: 0 }), lowP);
		expect(lowGain).toBeGreaterThan(3);
		const hi = (r: number) =>
			aperiodic(low({ ...clean, rosin: r, rosinLow: 1 }, 81), highP);
		const highGain = hi(0.5) / hi(0);
		expect(lowGain).toBeGreaterThan(highGain);
	});

	test.each(["drive", "keyTrack", "rosin"] as const)(
		"%s changes the output",
		(k) => {
			expect(stringsFingerprint({ [k]: 0.5 })).not.toEqual(BEFORE);
		},
	);
});
