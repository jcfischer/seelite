/**
 * The synth's space (#560, after the principal's first listening on #548):
 * a stereo reverb and a ping-pong echo the voices send into. Arithmetic on
 * buffers, so held headless: the decay time, the width, the repeats and the
 * silence after them. How it sounds is the principal's ear.
 */
import { describe, expect, test } from "bun:test";
import { ECHO_MAX_S, Space } from "../src/music-space";

const SR = 48000;
const BLOCK = 128;

/** Run `seconds` through a space, feeding `feed(frame)` into both sends. */
const run = (
	space: Space,
	seconds: number,
	feed: (f: number) => { rev?: number; echo?: number },
) => {
	const n = Math.round(seconds * SR);
	const L = new Float32Array(n);
	const R = new Float32Array(n);
	const revL = new Float32Array(BLOCK);
	const revR = new Float32Array(BLOCK);
	const echo = new Float32Array(BLOCK);
	for (let f = 0; f < n; f += BLOCK) {
		const m = Math.min(BLOCK, n - f);
		for (let k = 0; k < m; k++) {
			const x = feed(f + k);
			revL[k] = revR[k] = x.rev ?? 0;
			echo[k] = x.echo ?? 0;
		}
		space.process(
			revL.subarray(0, m),
			revR.subarray(0, m),
			echo.subarray(0, m),
			L.subarray(f, f + m),
			R.subarray(f, f + m),
		);
	}
	return { L, R };
};

/** Seconds for the Schroeder decay curve to fall from -5 to -35 dB, doubled:
 *  T30, the standard estimate of the time to fall 60 dB. */
const t30 = (x: Float32Array) => {
	const edc = new Float64Array(x.length);
	let acc = 0;
	for (let i = x.length - 1; i >= 0; i--) {
		acc += x[i] * x[i];
		edc[i] = acc;
	}
	const db = (i: number) => 10 * Math.log10(edc[i] / edc[0]);
	let a = 0;
	while (db(a) > -5) a++;
	let b = a;
	while (b < x.length - 1 && db(b) > -35) b++;
	return (2 * (b - a)) / SR;
};

describe("the reverb", () => {
	test("an impulse decays 60 dB in about the time it is set to", () => {
		for (const rt of [2, 5]) {
			const s = new Space(SR, { reverbS: rt, echoS: 0.3, echoFeedback: 0 });
			const { L } = run(s, rt * 2, (f) => ({ rev: f === 0 ? 1 : 0 }));
			const t = t30(L);
			expect(t).toBeGreaterThan(rt * 0.75);
			expect(t).toBeLessThan(rt * 1.25);
		}
	});

	test("its two sides are not one signal: the tail is wide", () => {
		const s = new Space(SR, { reverbS: 4, echoS: 0.3, echoFeedback: 0 });
		const { L, R } = run(s, 1.5, (f) => ({ rev: f === 0 ? 1 : 0 }));
		let lr = 0;
		let ll = 0;
		let rr = 0;
		for (let i = 0.2 * SR; i < 1.2 * SR; i++) {
			lr += L[i] * R[i];
			ll += L[i] * L[i];
			rr += R[i] * R[i];
		}
		expect(Math.abs(lr / Math.sqrt(ll * rr))).toBeLessThan(0.3);
		expect(ll).toBeGreaterThan(0);
		expect(rr).toBeGreaterThan(0);
	});

	test("after its tail the output is exact silence, not a denormal hiss", () => {
		const s = new Space(SR, { reverbS: 1, echoS: 0.2, echoFeedback: 0.3 });
		const { L, R } = run(s, 6, (f) => ({
			rev: f < 100 ? 1 : 0,
			echo: f < 100 ? 1 : 0,
		}));
		for (let i = 5 * SR; i < 6 * SR; i++) {
			expect(L[i]).toBe(0);
			expect(R[i]).toBe(0);
		}
		expect(s.silent).toBe(true);
	});
});

describe("the echo", () => {
	test("repeats every echo time, left then right, each quieter by the feedback", () => {
		const D = 0.25;
		const s = new Space(SR, { reverbS: 1, echoS: D, echoFeedback: 0.5 });
		// The echo alone: nothing into the reverb, and the echo's own share of
		// the reverb switched off.
		s.echoToReverb = 0;
		const { L, R } = run(s, 1.2, (f) => ({ echo: f === 0 ? 1 : 0 }));
		const peak = (x: Float32Array, at: number) => {
			let m = 0;
			let where = -1;
			for (let i = at - 200; i < at + 400; i++)
				if (Math.abs(x[i]) > m) {
					m = Math.abs(x[i]);
					where = i;
				}
			return { m, where };
		};
		const one = peak(L, D * SR);
		const two = peak(R, 2 * D * SR);
		const three = peak(L, 3 * D * SR);
		expect(Math.abs(one.where - D * SR)).toBeLessThan(40);
		expect(Math.abs(two.where - 2 * D * SR)).toBeLessThan(80);
		// Nothing on the other side where a repeat lands.
		expect(peak(R, D * SR).m).toBeLessThan(one.m * 0.01);
		// Each repeat is darker as well as quieter, so read the fall in energy
		// around it rather than a sample.
		const energy = (x: Float32Array, at: number) => {
			let e = 0;
			for (let i = at - 200; i < at + 1200; i++) e += x[i] * x[i];
			return Math.sqrt(e);
		};
		const r1 = energy(R, 2 * D * SR) / energy(L, D * SR);
		const r2 = energy(L, 3 * D * SR) / energy(R, 2 * D * SR);
		for (const r of [r1, r2]) {
			expect(r).toBeGreaterThan(0.35);
			expect(r).toBeLessThan(0.55);
		}
		expect(three.m).toBeGreaterThan(0);
	});
});

describe("an echo time that moves (#587)", () => {
	/** The largest step between two samples of `x` from `a` to `b`. */
	const maxStep = (x: Float32Array, a: number, b: number) => {
		let m = 0;
		for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
		return m;
	};
	const tone = (f: number) => ({
		echo: Math.sin((2 * Math.PI * 220 * f) / SR),
	});

	test("a new echo time is reached without a step in the output", () => {
		const s = new Space(SR, { reverbS: 1, echoS: 0.3, echoFeedback: 0 });
		s.echoToReverb = 0;
		const at = 0.6 * SR;
		const { L } = run(s, 1.2, (f) => {
			if (f === at) s.setEcho(0.41);
			return tone(f);
		});
		// A steady sine through the echo moves by at most its own slope; a tap
		// jumped between two points on the line steps by up to twice its peak.
		const steady = maxStep(L, 0.4 * SR, at);
		expect(maxStep(L, at, 1.2 * SR)).toBeLessThan(steady * 1.5);
	});

	test("once the glide has run, a repeat lands on the new time", () => {
		const s = new Space(SR, { reverbS: 1, echoS: 0.3, echoFeedback: 0 });
		s.echoToReverb = 0;
		s.setEcho(0.5);
		const pulse = 0.2 * SR;
		const { L } = run(s, 1, (f) => ({ echo: f === pulse ? 1 : 0 }));
		const e = (a: number, b: number) => {
			let v = 0;
			for (let i = Math.round(a * SR); i < Math.round(b * SR); i++)
				v += L[i] * L[i];
			return v;
		};
		expect(e(0.45, 0.55)).toBe(0);
		expect(e(0.7, 0.75)).toBeGreaterThan(0);
	});

	test("an echo time past the line holds at the line's end", () => {
		const s = new Space(SR, { reverbS: 1, echoS: 0.3, echoFeedback: 0 });
		s.echoToReverb = 0;
		s.setEcho(5);
		const { L } = run(s, 2.2, (f) => ({ echo: f === 0 ? 1 : 0 }));
		let first = -1;
		for (let i = 0; i < L.length && first < 0; i++) if (L[i] !== 0) first = i;
		expect(first / SR).toBeGreaterThan(1.99);
		expect(first / SR).toBeLessThanOrEqual(ECHO_MAX_S + 0.01);
	});
});
