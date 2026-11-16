import { describe, expect, test } from "bun:test";
import type { PartSpec } from "../src/music-score";
import { resolvePart, VoiceBank } from "../src/music-voices";

const SR = 48000;
const unity = { gain: () => 1 };

const held = (over: Partial<PartSpec> = {}) =>
	resolvePart(
		{
			voice: "analog",
			level: 1,
			sustain: 1,
			attackS: 0.01,
			envAmount: 0,
			cutoffHz: 4000,
			unison: 1,
			...over,
		},
		SR,
	);

const render = (p: ReturnType<typeof held>, seconds: number) => {
	const b = new VoiceBank(4, SR);
	b.noteOn(0, p, 0, 0, 48, 1, seconds * SR);
	const out = new Float32Array(seconds * SR);
	for (let f = 0; f < out.length; f += 128)
		b.render(out.subarray(f, Math.min(out.length, f + 128)), f, unity);
	return out;
};

const windowRms = (x: Float32Array, from: number) => {
	const rms: number[] = [];
	for (let a = from; a + 2400 <= x.length; a += 2400) {
		let e = 0;
		for (let i = a; i < a + 2400; i++) e += x[i] * x[i];
		rms.push(Math.sqrt(e / 2400));
	}
	return rms;
};

const swing = (rms: number[]) => Math.max(...rms) / Math.min(...rms);

describe("the phaser", () => {
	test("a held note's level moves as the notches sweep its harmonics", () => {
		const dry = swing(windowRms(render(held(), 4), 0.2 * SR));
		const phased = swing(
			windowRms(render(held({ phaser: 1, phaserS: 2 }), 4), 0.2 * SR),
		);
		expect(phased - 1).toBeGreaterThan(3 * (dry - 1));
	});

	test("it stays bounded with its feedback", () => {
		const x = render(held({ phaser: 1, phaserS: 1 }), 3);
		expect(Math.max(...x.map(Math.abs))).toBeLessThan(2);
		expect(x.every(Number.isFinite)).toBe(true);
	});

	test("depth 0 leaves the voice as it was", () => {
		expect(render(held({ phaser: 0, phaserS: 2 }), 1)).toEqual(
			render(held(), 1),
		);
	});
});
