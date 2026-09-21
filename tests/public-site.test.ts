import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CONTROLS } from "../src/controls-catalogue";
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

	/**
	 * The manual prints keys, and the catalogue binds them. A hand-written table
	 * of pairs would be a fourth copy of the binding and could not see a key
	 * added to the page and left out of the table — sage round 1 said so, and it
	 * was right. So the page marks every key it prints as
	 * `<kbd data-command="…">`, this row **derives** the pairs from the page, and
	 * a second arm reads the prose with every `<kbd>` cut out and refuses a key
	 * name left loose in it. A rebind turns the first arm red; a key printed
	 * without markup turns the second red.
	 */
	test("prints only keys the controls catalogue binds, and marks up every one", () => {
		const manual = PUBLIC_PAGES.find((page) => page.slug === "manual");
		if (!manual) throw new Error("no manual page");
		/** A printed label as `KeyboardEvent.key` reads it. */
		const asKey = (label: string) =>
			(
				({
					ctrl: "control",
					"↑": "arrowup",
					"↓": "arrowdown",
					"←": "arrowleft",
					"→": "arrowright",
					"&#96;": "`",
				}) as Record<string, string>
			)[label.toLowerCase()] ?? label.toLowerCase();
		const printed = [
			...manual.content.matchAll(
				/<kbd data-command="([a-z-]+)">([^<]+)<\/kbd>/g,
			),
		].map(([, id, label]) => [id, asKey(label)] as const);
		expect(printed.length).toBeGreaterThan(20);
		for (const [id, key] of printed) {
			const command = CONTROLS.commands.find((c) => c.id === id);
			if (!command) throw new Error(`manual names no such command: ${id}`);
			expect(
				command.defaultTriggers.flatMap((trigger) =>
					trigger.kind === "key" ? [trigger.key] : [],
				),
			).toContain(key);
		}
		// Every key on the page is inside a `<kbd>`, so the prose around them
		// holds no bare key name. Without this arm the row above only checks
		// what someone remembered to mark up.
		const prose = manual.content
			.replace(/<kbd data-command="[a-z-]+">[^<]+<\/kbd>/g, " ")
			// Decoration by its own declaration — the Play button's chevron is
			// `aria-hidden`, and a screen reader does not say it either.
			.replace(/<span aria-hidden="true">[^<]*<\/span>/g, " ")
			.replace(/<[^>]+>/g, " ");
		for (const loose of [
			/(^|\s)[A-Z](\s|[.,;])/,
			/\b(Shift|Ctrl|Enter)\b/,
			/[↑↓←→]|&#96;/,
		])
			expect(prose).not.toMatch(loose);
	});

	test("gives a new pilot the controls needed to reach every cockpit panel", () => {
		// The keys themselves are checked by the row above, which derives them
		// from the page; what this one holds is that the sentences naming the
		// four panel moves are still on the page at all.
		const manual = PUBLIC_PAGES.find((page) => page.slug === "manual");
		if (!manual) throw new Error("no manual page");
		for (const shown of [
			"to open the Controls tab",
			"opens the left panel",
			"faces the forward panel",
			"opens the right panel",
		])
			expect(manual.content).toContain(shown);
		for (const id of [
			"controls-reference",
			"head-left",
			"head-forward",
			"head-right",
		])
			expect(manual.content).toContain(`<kbd data-command="${id}">`);
	});
});
