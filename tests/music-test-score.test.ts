/**
 * The test score (#560) compiles, uses every part it declares, and renders
 * through the engine under full scale — so what `npm run sounds` plays for the
 * principal is a score the player can play as written.
 */
import { expect, test } from "bun:test";
import { MusicEngine } from "../src/music-engine";
import type { VoiceKind } from "../src/music-score";
import { compileSong } from "../src/music-sequencer";
import { TEST_SONGS } from "../src/music-test-score";

const SR = 48000;

test.each(Object.keys(TEST_SONGS))("%s compiles", (id) => {
	expect(() => compileSong(TEST_SONGS[id])).not.toThrow();
});

test("between them, the test songs sound every voice", () => {
	const voices = new Set<VoiceKind>(
		Object.values(TEST_SONGS).flatMap((s) =>
			Object.values(s.parts).map((p) => p.voice),
		),
	);
	expect([...voices].sort()).toEqual(["fm", "noise", "pad", "pluck", "tone"]);
});

test.each(Object.keys(TEST_SONGS))(
	"%s plays every part it declares, under full scale",
	(id) => {
		const heard = new Set<string>();
		const e = new MusicEngine(SR, undefined, (_, __, part) => heard.add(part));
		e.command({ type: "load", id, song: TEST_SONGS[id] }, 0);
		e.command({ type: "play", id, at: "bar" }, 0);
		const out = new Float32Array(128);
		let peak = 0;
		let sum = 0;
		const frames = 12 * SR;
		for (let f = 0; f < frames; f += 128) {
			// Into the coda, where the song has one to resolve into.
			if (TEST_SONGS[id].resolve && f === 9 * SR - ((9 * SR) % 128))
				e.command({ type: "resolve", at: "bar" }, f);
			e.render(out, f);
			for (const v of out) {
				peak = Math.max(peak, Math.abs(v));
				sum += v * v;
			}
		}
		expect([...heard].sort()).toEqual(Object.keys(TEST_SONGS[id].parts).sort());
		expect(Math.sqrt(sum / frames)).toBeGreaterThan(0.01);
		expect(peak).toBeLessThan(0.9);
	},
);
