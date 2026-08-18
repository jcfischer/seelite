/**
 * Simplex noise (2D) implementation, no dependencies.
 * Classic algorithm by Gustavson / based on Stefan Gustavson's public-domain
 * simplex noise. Deterministic, seeded via permutation table.
 *
 * Vendored verbatim from seekolous (`src/noise.ts`) apart from this note. Seed
 * it through `seedFor`/`mix` from `rng.ts` rather than with a raw world seed,
 * so two noise fields never share a permutation table by accident.
 */

import { seededRand } from "./rng";

const GRAD3 = new Float32Array([
	1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0,
	-1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

function makePerm(seed: number): Uint8Array {
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	// Deterministic shuffle, from `rng.ts`'s generator rather than a private copy
	// of the same recurrence. One primitive is the point: in seekolous this file
	// and two others had each grown their own copy of it, and copies drift.
	const rand = seededRand(seed);
	for (let i = 255; i > 0; i--) {
		const n = Math.floor(rand() * (i + 1));
		const tmp = p[i];
		p[i] = p[n];
		p[n] = tmp;
	}
	// double the table so perm[j + 1] etc. never read out of bounds
	const doubled = new Uint8Array(512);
	for (let i = 0; i < 512; i++) doubled[i] = p[i & 255];
	return doubled;
}

export class SimplexNoise {
	private perm: Uint8Array;
	private permMod12: Uint8Array;

	constructor(seed = 0) {
		this.perm = makePerm(seed);
		this.permMod12 = new Uint8Array(512);
		for (let i = 0; i < 512; i++) {
			this.permMod12[i] = this.perm[i] % 12;
		}
	}

	noise2D(xin: number, yin: number): number {
		const permMod12 = this.permMod12;
		const perm = this.perm;
		let n0 = 0,
			n1 = 0,
			n2 = 0;
		const s = (xin + yin) * F2;
		const i = Math.floor(xin + s);
		const j = Math.floor(yin + s);
		const t = (i + j) * G2;
		const X0 = i - t;
		const Y0 = j - t;
		const x0 = xin - X0;
		const y0 = yin - Y0;
		let i1, j1;
		if (x0 > y0) {
			i1 = 1;
			j1 = 0;
		} else {
			i1 = 0;
			j1 = 1;
		}
		const x1 = x0 - i1 + G2;
		const y1 = y0 - j1 + G2;
		const x2 = x0 - 1 + 2 * G2;
		const y2 = y0 - 1 + 2 * G2;
		const ii = i & 255;
		const jj = j & 255;

		let t0 = 0.5 - x0 * x0 - y0 * y0;
		if (t0 >= 0) {
			const gi0 = permMod12[ii + perm[jj]] * 3;
			t0 *= t0;
			n0 = t0 * t0 * (GRAD3[gi0] * x0 + GRAD3[gi0 + 1] * y0);
		}
		let t1 = 0.5 - x1 * x1 - y1 * y1;
		if (t1 >= 0) {
			const gi1 = permMod12[ii + i1 + perm[jj + j1]] * 3;
			t1 *= t1;
			n1 = t1 * t1 * (GRAD3[gi1] * x1 + GRAD3[gi1 + 1] * y1);
		}
		let t2 = 0.5 - x2 * x2 - y2 * y2;
		if (t2 >= 0) {
			const gi2 = permMod12[ii + 1 + perm[jj + 1]] * 3;
			t2 *= t2;
			n2 = t2 * t2 * (GRAD3[gi2] * x2 + GRAD3[gi2 + 1] * y2);
		}
		return 70 * (n0 + n1 + n2);
	}

	/** Fractal Brownian motion — layered octaves of this simplex noise. */
	fbm(x: number, y: number, octaves = 4, lacunarity = 2.0, gain = 0.5): number {
		let amp = 1;
		let freq = 1;
		let sum = 0;
		let norm = 0;
		for (let i = 0; i < octaves; i++) {
			sum += amp * this.noise2D(x * freq, y * freq);
			norm += amp;
			amp *= gain;
			freq *= lacunarity;
		}
		return sum / norm;
	}
}
