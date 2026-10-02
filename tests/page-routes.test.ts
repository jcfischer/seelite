/**
 * The pages that are not the game — the labs, the viewers, the galaxy map —
 * reach `main.ts` from a bare URL (`?voice-lab`). #416's public threshold
 * sent every URL without `boot` or `seed` to the front page, so a lab needed
 * a seed it did not use, and `?voice-lab` alone opened the front page.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isPageRoute, PAGE_ROUTES } from "../src/page-routes";
import { repoPath } from "./lib/source-scan";

describe("a page that is not the game", () => {
	test("every page main.ts routes is listed, and nothing else", () => {
		const main = readFileSync(repoPath("src/main.ts"), "utf8");
		const routed = [
			...main.matchAll(/\} else if \(query\.has\("([a-z-]+)"\)\) \{/g),
		].map((m) => m[1]);
		expect(routed.length).toBeGreaterThan(0);
		expect([...routed].sort()).toEqual([...PAGE_ROUTES].sort());
	});

	test("a bare page parameter is a page; the root and the game are not", () => {
		for (const r of PAGE_ROUTES)
			expect(isPageRoute(new URLSearchParams(`?${r}`))).toBe(true);
		expect(isPageRoute(new URLSearchParams(""))).toBe(false);
		expect(isPageRoute(new URLSearchParams("?boot=space"))).toBe(false);
		expect(isPageRoute(new URLSearchParams("?fps"))).toBe(false);
	});

	test("the entry loads the game module for a page, and counts no launch", () => {
		const entry = readFileSync(repoPath("src/entry.ts"), "utf8");
		const page = entry.indexOf("isPageRoute(query)");
		const publicEntry = entry.indexOf('import("./public-entry")');
		expect(page).toBeGreaterThan(-1);
		// Before the public threshold, which takes everything left.
		expect(page).toBeLessThan(publicEntry);
		expect(entry.match(/countVisit\(/g)).toHaveLength(1);
	});
});
