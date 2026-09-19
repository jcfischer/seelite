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

	test("gives a new pilot the controls needed to reach every cockpit panel", () => {
		const source = readFileSync(repoPath("src/public-site.ts"), "utf8");
		expect(source).toContain("Press ? to open the Controls tab");
		expect(source).toContain(
			"1 opens the left panel, 2 faces the forward panel, and 3 opens the right panel",
		);
	});
});
