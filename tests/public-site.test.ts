import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PUBLIC_PAGES, pageForPath } from "../src/public-site";
import { repoPath } from "./lib/source-scan";

describe("the quiet public threshold", () => {
	test("names exactly the approved static destinations", () => {
		expect(PUBLIC_PAGES.map((page) => page.slug)).toEqual([
			"",
			"about",
			"field-notes",
			"manual",
			"trust",
			"credits",
		]);
		for (const page of PUBLIC_PAGES) {
			const route = page.slug === "" ? "/" : `/${page.slug}/`;
			expect(pageForPath(route)).toBe(page);
			const entry = readFileSync(repoPath(page.entry), "utf8");
			if (page.slug === "") expect(entry).toContain('src="/src/entry.ts"');
			else expect(entry).toContain(`data-public-page="${page.slug}"`);
		}
	});

	test("keeps the home threshold private and hands play to the existing game boot", () => {
		const source = readFileSync(repoPath("src/public-site.ts"), "utf8");
		expect(source).toContain('href="/?boot=overlay"');
		expect(source).toContain("No accounts. No tracking. No analytics.");
		expect(source).toContain("No runtime network calls.");
		expect(source).not.toMatch(/\bfetch\s*\(|WebSocket|EventSource/);
	});
});
