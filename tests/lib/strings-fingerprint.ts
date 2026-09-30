/**
 * A fingerprint of the `strings` voice at its defaults and of the orchestra
 * waltz's opening (#547 D16): what the grit parameters must leave exactly as
 * it was when they are at their defaults. Shared by the test and by the
 * script that printed the pinned figures, so the two measure one thing.
 */
import { danubeSong } from "../../src/music-danube";
import { MusicEngine } from "../../src/music-engine";
import type { PartSpec } from "../../src/music-score";
import { resolvePart, VoiceBank } from "../../src/music-voices";

const SR = 48000;
const unity = { gain: () => 1 };

/** Sum of squares and sum of the samples, in stereo, over `frames`. */
function sums(b: VoiceBank, frames: number): [number, number] {
	const z = () => new Float32Array(128);
	const revL = z();
	const revR = z();
	const echo = z();
	let sq = 0;
	let sum = 0;
	for (let f = 0; f < frames; f += 128) {
		const L = new Float32Array(128);
		const R = new Float32Array(128);
		b.render(L, f, unity, {
			right: R,
			sends: [{ revL, revR, echo }],
		});
		for (let i = 0; i < 128; i++) {
			sq += L[i] * L[i] + R[i] * R[i];
			sum += L[i] + R[i];
		}
	}
	return [sq, sum];
}

/** The voice alone: a low note, a mid chord and a legato pair, and the
 *  waltz's first six seconds in the orchestra, its horn call as it was
 *  before the grit. */
export function stringsFingerprint(over: Partial<PartSpec> = {}): number[] {
	const part = resolvePart({ voice: "strings", level: 1, ...over }, SR);
	const out: number[] = [];
	const low = new VoiceBank(8, SR);
	low.noteOn(0, part, 0, 0, 33, 0.8, SR);
	out.push(...sums(low, 1.5 * SR));
	const chord = new VoiceBank(8, SR);
	for (const p of [57, 61, 64]) chord.noteOn(0, part, 0, 0, p, 0.6, SR);
	out.push(...sums(chord, 1.5 * SR));
	const leg = resolvePart(
		{ voice: "strings", level: 1, glideS: 0.03, ...over },
		SR,
	);
	const pair = new VoiceBank(8, SR);
	pair.noteOn(0, leg, 0, 0, 57, 1, SR);
	pair.noteOn(SR - 480, leg, 0, 0, 64, 0.7, SR);
	out.push(...sums(pair, 2 * SR));
	const e = new MusicEngine(SR);
	// The horn call as it was before the grit (D16), pinned here as a
	// literal from 0caa468 rather than derived from the score's desk: the
	// principal tunes that desk in the lab, and a figure built from it would
	// measure the tuning and not the voice.
	const song = danubeSong("orchestra");
	const horn: PartSpec = {
		voice: "strings",
		level: 0.34,
		glideS: 0.03,
		attackS: 0.07,
		releaseS: 0.6,
		unison: 4,
		index: 0.5,
		cutoffHz: 1700,
		envAmount: 1.8,
		vibrato: 0.12,
		pan: -0.35,
		reverb: 0.5,
	};
	e.command(
		{
			type: "load",
			id: "o",
			song: { ...song, parts: { ...song.parts, horn } },
		},
		0,
	);
	e.command({ type: "play", id: "o", at: "bar" }, 0);
	const buf = new Float32Array(128);
	let sq = 0;
	for (let f = 0; f < 6 * SR; f += 128) {
		e.render(buf, f);
		for (const v of buf) sq += v * v;
	}
	out.push(sq);
	return out;
}
