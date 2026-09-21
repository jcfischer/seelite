import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CONTROLS } from "../src/controls-catalogue";
import { PUBLIC_PAGES, pageForPath } from "../src/public-site";
import { repoPath } from "./lib/source-scan";

/** One shape for the manual's key markup: the extraction and the strip that
 *  checks nothing escaped it must agree, or widening one silently narrows the
 *  other. */
const KBD = /<kbd data-command="([a-z-]+)">([^<]+)<\/kbd>/g;

describe("the quiet public threshold", () => {
	const manual = PUBLIC_PAGES.find((page) => page.slug === "manual");
	if (!manual) throw new Error("no manual page");

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
	 * The manual prints keys, and the catalogue binds them. A hand-written
	 * `[command, key]` list would be a fourth copy of the binding and could not
	 * see a key added to the page and left out of it — sage round 1 said so, and
	 * it was right. So the page marks every key it prints as
	 * `<kbd data-command="…">`, this row **derives** its pairs from the page, and
	 * a second arm strips the markup and refuses a key name left loose in the
	 * prose.
	 *
	 * **What the second arm reaches, and what it does not.** Its vocabulary is
	 * the catalogue's own multi-character key names plus the ones this game
	 * binds to nothing and a writer could still print, and it matches them
	 * **capitalised**, which is how a key is printed and how `Enter` is told
	 * apart from *before you enter the aperture*. A key printed in lower case
	 * therefore passes it. Sage round 2 named that hole and this is the width
	 * chosen against it, not a claim of completeness.
	 *
	 * **And the pairing is not checked, because the catalogue cannot answer it.**
	 * `pitch` binds `w`, `s`, `arrowup` and `arrowdown` with no sense recorded,
	 * so a page that swapped W for S, or ↑ for ↓, tells the player the wrong
	 * direction and every row here stays green. That is a person's job until a
	 * command records a direction.
	 */
	test("prints only keys the controls catalogue binds, and marks up every one", () => {
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
		const printed = [...manual.content.matchAll(KBD)].map(
			([, id, label]) => [id, asKey(label)] as const,
		);
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

		const prose = manual.content
			.replace(KBD, " ")
			// Decoration by its own declaration — the Play button's chevron is
			// `aria-hidden`, and a screen reader does not say it either.
			.replace(/<span aria-hidden="true">[^<]*<\/span>/g, " ")
			.replace(/<[^>]+>/g, " ");
		const names = new Set(
			CONTROLS.commands
				.flatMap((command) => command.defaultTriggers)
				.flatMap((trigger) =>
					trigger.kind === "key" && trigger.key.length > 1 ? [trigger.key] : [],
				),
		);
		// Not vacuous: the catalogue really does bind named keys, so a refactor
		// that empties this set fails here rather than passing everything.
		expect(names.size).toBeGreaterThan(3);
		for (const unbound of [
			"ctrl",
			"cmd",
			"return",
			"tab",
			"esc",
			"escape",
			"alt",
			"option",
			"space",
			"spacebar",
			"backspace",
			"delete",
			"del",
			"home",
			"end",
			"pageup",
			"pagedown",
		])
			names.add(unbound);
		for (const name of names)
			expect(prose).not.toMatch(
				new RegExp(`\\b${name[0].toUpperCase()}${name.slice(1)}\\b`),
			);
		for (const loose of [
			/(^|\s)[A-Z](\s|[.,;])/,
			/\bF\d{1,2}\b/,
			/[↑↓←→]|&#96;/,
		])
			expect(prose).not.toMatch(loose);
	});

	test("gives a new pilot the controls needed to reach every cockpit panel", () => {
		// The keys themselves are checked by the row above, which derives them
		// from the page; what this one holds is that the sentences naming the
		// four panel moves are still on the page at all.
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
