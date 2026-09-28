import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	CHANGELOG,
	HOME_CHANGELOG_COUNT,
	changelogDate,
	changelogList,
} from "../src/changelog";
import { PUBLIC_PAGES } from "../src/public-site";
import { repoPath } from "./lib/source-scan";

function page(slug: string) {
	const found = PUBLIC_PAGES.find((candidate) => candidate.slug === slug);
	if (!found) throw new Error(`no page ${slug}`);
	return found;
}

/** Every entry's text, in the order a page prints it. */
function printed(content: string): string[] {
	return [
		...content.matchAll(/<span class="changelog-text">([^<]*)<\/span>/g),
	].map((match) => match[1] ?? "");
}

describe("the changelog (#573)", () => {
	test("every entry has a real date, one plain sentence and an optional node", () => {
		expect(CHANGELOG.length).toBeGreaterThan(0);
		for (const entry of CHANGELOG) {
			expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			// A calendar date, not only the shape of one: 2026-02-30 fails here.
			expect(
				new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10),
			).toBe(entry.date);
			expect(entry.text).toBe(entry.text.trim());
			expect(entry.text).toMatch(/^[A-Z].*\.$/);
			// One sentence: no full stop before the last character.
			expect(entry.text.slice(0, -1)).not.toMatch(/[.!?]\s/);
			// The text goes into markup unescaped by design, so it may not carry any.
			expect(entry.text).not.toMatch(/[<>&"]/);
			if (entry.node !== undefined) {
				expect(Number.isInteger(entry.node)).toBe(true);
				expect(entry.node).toBeGreaterThan(0);
			}
		}
	});

	test("lists the newest entry first", () => {
		const dates = CHANGELOG.map((entry) => entry.date);
		expect(dates).toEqual([...dates].sort().reverse());
	});

	test("prints a date from its string, never through the local clock", () => {
		expect(changelogDate("2026-09-28")).toBe("28 Sep 2026");
		expect(changelogDate("2026-01-01")).toBe("1 Jan 2026");
		expect(changelogDate("2025-12-31")).toBe("31 Dec 2025");
		expect(() => changelogDate("2026-13-01")).toThrow();
	});

	test("marks each entry with a machine-readable date", () => {
		const html = changelogList(CHANGELOG.slice(0, 1));
		const first = CHANGELOG[0];
		if (!first) throw new Error("empty changelog");
		expect(html).toContain(
			`<time datetime="${first.date}">${changelogDate(first.date)}</time>`,
		);
	});

	test("the home threshold shows the latest few and links to the full list", () => {
		const home = page("").content;
		const expected = CHANGELOG.slice(0, HOME_CHANGELOG_COUNT).map(
			(entry) => entry.text,
		);
		expect(HOME_CHANGELOG_COUNT).toBeLessThanOrEqual(3);
		expect(printed(home)).toEqual(expected);
		expect(home).toContain('href="/field-notes/"');
	});

	test("Field Notes carries every entry, in order", () => {
		const notes = page("field-notes").content;
		expect(printed(notes)).toEqual(CHANGELOG.map((entry) => entry.text));
	});

	/** The repo is private, so a link to a node is a 404 for a player (#573 D4). */
	test("no page prints a node number or a link to the tracker", () => {
		for (const candidate of PUBLIC_PAGES) {
			expect(candidate.content).not.toContain("github.com");
			for (const entry of CHANGELOG)
				if (entry.node !== undefined)
					expect(candidate.content).not.toContain(`#${entry.node}`);
		}
	});

	test("the changelog module is a leaf", () => {
		const source = readFileSync(repoPath("src/changelog.ts"), "utf8");
		expect(source).not.toMatch(/^import\s/m);
	});
});
