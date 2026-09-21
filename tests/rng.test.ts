/**
 * Seed derivation — the contract `rng.ts` states about itself.
 *
 * Every claim here is one the module's own docstrings make. That is deliberate:
 * a test that asserts whatever the code currently returns records behaviour, not
 * intent, and passes just as happily after the behaviour breaks in a way nobody
 * meant. The interesting ones are the stream-independence claims, because they
 * are what a reproducible galaxy rests on and they cannot be seen by reading one
 * call site.
 */
import { describe, expect, test } from "bun:test";
import type { StreamName } from "../src/rng";
import { mix, STREAMS, seededRand, seedFor, streamFor } from "../src/rng";

const names = Object.keys(STREAMS) as StreamName[];
const take = (rand: () => number, n: number) =>
	Array.from({ length: n }, () => rand());

describe("seededRand", () => {
	test("the same seed replays the same sequence", () => {
		expect(take(seededRand(42), 16)).toEqual(take(seededRand(42), 16));
	});

	test("different seeds do not", () => {
		expect(take(seededRand(42), 16)).not.toEqual(take(seededRand(43), 16));
	});

	test("every draw is in [0, 1)", () => {
		const draws = take(seededRand(20260818), 5000);
		expect(Math.min(...draws)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...draws)).toBeLessThan(1);
	});

	test("it does not collapse to a short cycle", () => {
		// An LCG whose state is truncated somewhere repeats early, and the symptom
		// downstream is a galaxy that looks patterned rather than random.
		const draws = take(seededRand(7), 4096);
		expect(new Set(draws).size).toBeGreaterThan(4000);
	});
});

describe("STREAMS", () => {
	test("no two systems share an offset", () => {
		// The module: "two systems sharing a value share a stream, which is the
		// coupling this whole file exists to avoid". Asserted here because it costs
		// a millisecond, and because a copy-pasted entry is exactly the kind of
		// mistake that is invisible in review and expensive six months later.
		const values = names.map((n) => STREAMS[n]);
		expect(new Set(values).size).toBe(values.length);
	});

	test("no two systems draw the same sequence from one world seed", () => {
		// The stronger claim, and the one that actually matters: distinct offsets
		// would still collide if `seedFor` mapped them together.
		const heads = names.map((n) => take(streamFor(1234, n), 8).join(","));
		expect(new Set(heads).size).toBe(names.length);
	});

	test("two streams do not open on near-identical draws", () => {
		// The specific failure `avalanche` exists to prevent, and the one a
		// distinctness check does not see: this LCG's *first* output is nearly a
		// linear function of its seed, so two streams whose seeds land close
		// together open with values a few parts in 10⁵ apart — which reads as two
		// systems mysteriously agreeing on their first decision.
		//
		// The bound is loose on purpose. The module reports 9.3e-9 as the closest
		// opening over a 300,000-seed sweep of seekolous's larger table; anything
		// above 1e-6 here means the avalanche step is still doing its job, and a
		// tighter number would be asserting on the sweep rather than on the
		// property.
		for (const seed of [1, 952, 1000, 20260818]) {
			const heads = names.map((n) => streamFor(seed, n)());
			for (let i = 0; i < heads.length; i++)
				for (let j = i + 1; j < heads.length; j++)
					expect(Math.abs(heads[i] - heads[j])).toBeGreaterThan(1e-6);
		}
	});
});

describe("seedFor", () => {
	test("is deterministic", () => {
		expect(seedFor(99, "galaxy")).toBe(seedFor(99, "galaxy"));
	});

	test("avalanches — adjacent world seeds give unrelated stream seeds", () => {
		// The docstring calls this out as the reason `seedFor` exists rather than a
		// naked `seed ^ OFFSET`: consecutive world seeds must not produce
		// consecutive streams, or seed 1 and seed 2 are near-identical galaxies.
		const a = seedFor(1000, "system");
		const b = seedFor(1001, "system");
		expect(Math.abs(a - b)).toBeGreaterThan(1_000_000);
	});

	test("returns a uint32", () => {
		for (const n of names) {
			const s = seedFor(-1, n);
			expect(Number.isInteger(s)).toBe(true);
			expect(s).toBeGreaterThanOrEqual(0);
			expect(s).toBeLessThanOrEqual(0xff_ff_ff_ff);
		}
	});
});

describe("mix", () => {
	test("is deterministic in both terms", () => {
		expect(mix(5, 9)).toBe(mix(5, 9));
	});

	test("distinguishes identity from order", () => {
		// `sim.ts` uses this to give a body a seed that is a function of *which*
		// body it is. If mix were symmetric, two planets would swap seeds by
		// swapping their indices.
		expect(mix(5, 9)).not.toBe(mix(9, 5));
	});

	test("spreads neighbouring identities apart", () => {
		const seeds = Array.from({ length: 64 }, (_, i) => mix(4242, i));
		expect(new Set(seeds).size).toBe(64);
	});
});
