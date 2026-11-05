import { describe, expect, test } from "bun:test";
import { cruiseDetourCorpus } from "../scripts/lib/cruise-detour-corpus.mjs";

describe("cruise detour measurement corpus", () => {
	test("the default PR gate retains full-length legs on a small fixed corpus", () => {
		const corpus = cruiseDetourCorpus([]);
		expect(corpus.mode).toBe("gate");
		expect(corpus.seeds).toEqual([1, 2, 17]);
		expect(corpus.maxSteps).toBe(12000);
	});

	test("the manual full mode keeps every original seed and its step budget", () => {
		expect(cruiseDetourCorpus(["--full"])).toEqual({
			mode: "full",
			seeds: Array.from({ length: 20 }, (_, i) => i + 1),
			maxSteps: 12000,
		});
	});

	test("legacy positional count and first seed still select a custom corpus", () => {
		expect(cruiseDetourCorpus(["3", "16"])).toEqual({
			mode: "custom",
			seeds: [16, 17, 18],
			maxSteps: 12000,
		});
	});

	test("invalid counts and ambiguous modes fail before launching a browser", () => {
		for (const args of [
			["0"],
			["-1"],
			["NaN"],
			["Infinity"],
			["1.5"],
			["1", "0"],
			["1", "1.5"],
			["--ful"],
			["--full", "2"],
			["1", "1", "extra"],
		])
			expect(() => cruiseDetourCorpus(args)).toThrow();
	});
});
