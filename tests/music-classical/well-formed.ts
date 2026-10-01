/**
 * The checks every #589 set-piece owes: it compiles, every event names a
 * part and sits inside its section and bar, and it never asks the synth for
 * more voices than it has. `MUSIC_VOICE_CAP` steals the oldest voice without
 * a word, so a score over it loses notes silently.
 */
import { expect, test } from "bun:test";
import { MUSIC_VOICE_CAP, type Song } from "../../src/music-score";
import { compileSong } from "../../src/music-sequencer";

/** Voices left free for release tails: a note's body may use the rest. */
export const TAIL_HEADROOM = 4;

/** The most notes whose bodies (onset to onset + dur) overlap, in beats
 *  counted across the song's sections in order. */
export function peakBodies(song: Song): number {
	const edges: [number, number][] = [];
	let offset = 0;
	for (const s of song.sections) {
		for (const e of s.events) {
			const t = offset + e.bar * song.beatsPerBar + e.beat;
			edges.push([t, 1], [t + e.dur, -1]);
		}
		offset += s.bars * song.beatsPerBar;
	}
	edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	let now = 0;
	let peak = 0;
	for (const [, d] of edges) {
		now += d;
		peak = Math.max(peak, now);
	}
	return peak;
}

export function wellFormed(song: Song) {
	test(`${song.name}: compiles`, () => {
		expect(() => compileSong(song)).not.toThrow();
	});
	test(`${song.name}: every event names a part and sits inside its bar`, () => {
		for (const s of song.sections)
			for (const e of s.events) {
				expect(song.parts[e.part]).toBeDefined();
				expect(e.beat).toBeGreaterThanOrEqual(0);
				expect(e.beat).toBeLessThan(song.beatsPerBar);
				expect(e.bar).toBeGreaterThanOrEqual(0);
				expect(e.bar).toBeLessThan(s.bars);
				expect(e.dur).toBeGreaterThan(0);
				expect(e.vel).toBeGreaterThan(0);
				expect(e.vel).toBeLessThanOrEqual(1);
			}
	});
	test(`${song.name}: never more than the synth's voices at once`, () => {
		expect(peakBodies(song)).toBeLessThanOrEqual(
			MUSIC_VOICE_CAP - TAIL_HEADROOM,
		);
	});
	test(`${song.name}: no brass, which the principal heard as bad (#547 D14)`, () => {
		for (const p of Object.values(song.parts))
			expect(p.voice).not.toBe("brass");
	});
}
