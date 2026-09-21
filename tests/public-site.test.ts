import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CONTROLS } from "../src/controls-catalogue";
import { PUBLIC_PAGES, pageForPath } from "../src/public-site";
import { codeOf, repoPath, srcFiles } from "./lib/source-scan";

/** One shape for the manual's key markup: the extraction and the strip that
 *  checks nothing escaped it must agree, or widening one silently narrows the
 *  other. */
const KBD = /<kbd data-command="([a-z-]+)">([^<]+)<\/kbd>/g;

/** A printed label as `KeyboardEvent.key` reads it. */
const KEY_LABELS: Record<string, string> = {
	ctrl: "control",
	"↑": "arrowup",
	"↓": "arrowdown",
	"←": "arrowleft",
	"→": "arrowright",
	"&#96;": "`",
};

/**
 * Key names the catalogue never produces: keys this game binds to nothing, and
 * alternate spellings of ones it does — `ctrl` is here for a key bound as
 * `control`, which is why this is not "unbound" as it once said.
 *
 * Every entry should read as a key and as nothing else, which is the bar sage
 * round 3 set: `Return`, `Space`, `End`, `Home` and `Delete` were here and are
 * gone, because a sentence about a space game may open with *Space is large*
 * and this row would then go red about unmarked keys. Dropping them is a real
 * loss of reach — an unmarked `Space` now passes — and the second row's
 * docblock counts it among the holes.
 *
 * **`tab` does not quite clear that bar and is kept anyway.** This page writes
 * *the Controls tab*, and a later edit capitalising that UI name would turn
 * the row red about an unmarked key it is not. Kept because `Tab` is a key a
 * manual is likely to print and the collision is one word away from being
 * avoided; noted here so the red is read correctly when it comes.
 */
const UNBOUND_KEY_NAMES = [
	"alt",
	"backspace",
	"cmd",
	"ctrl",
	"esc",
	"escape",
	"pagedown",
	"pageup",
	"tab",
];

/** How many keys the manual prints, as a literal. A floor lets a whole
 *  section's keys be deleted silently; this does not. */
const MANUAL_KEY_COUNT = 28;

/** The manual page, resolved per row rather than in the `describe` body — a
 *  throw there aborts the file, including the row that names the slugs and
 *  would have explained it. */
function manualPage() {
	const page = PUBLIC_PAGES.find((candidate) => candidate.slug === "manual");
	if (!page) throw new Error("no manual page");
	return page;
}

/** The manual's prose with every key, and every `aria-hidden` decoration,
 *  taken out — what is left must name no key at all. */
function manualProse(content: string) {
	return (
		content
			.replace(KBD, " ")
			// Decoration by its own declaration — the Play button's chevron is
			// `aria-hidden`, and a screen reader does not say it either.
			.replace(/<span aria-hidden="true">[^<]*<\/span>/g, " ")
			.replace(/<[^>]+>/g, " ")
	);
}

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
	 * **The promise is about the whole game, so the check has to be too.** The
	 * row above scans one file, and #459 leaned on it to say "nothing in this
	 * repo implements opt-in reports" while deleting the sentence that described
	 * them — a repo-wide claim from a one-file scan, which sage round 4 named.
	 * This reads every module the page can load, with comments stripped so a
	 * paragraph about not fetching is not mistaken for a fetch.
	 */
	test("no module the page loads can reach the network", () => {
		const reaches =
			/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|sendBeacon/;
		const offenders = srcFiles().filter((rel) => reaches.test(codeOf(rel)));
		expect(offenders).toEqual([]);
		// Not vacuous: there are modules to scan, and they are this game's.
		expect(srcFiles().length).toBeGreaterThan(50);
	});

	/**
	 * The manual prints keys, and the catalogue binds them. A hand-written
	 * `[command, key]` list would be a fourth copy of the binding and could not
	 * see a key added to the page and left out of it — sage round 1 said so, and
	 * it was right. So the page marks every key it prints as
	 * `<kbd data-command="…">` and this row **derives** its pairs from the page.
	 *
	 * **The pairing is not checked, because the catalogue cannot answer it.**
	 * `pitch` binds `w`, `s`, `arrowup` and `arrowdown` with no sense recorded,
	 * so a page that swapped W for S, or ↑ for ↓, tells the player the wrong
	 * direction and this row stays green. Run and confirmed, not assumed. That
	 * is a person's job until a command records a direction — and so is whether
	 * the *sentence* around a key describes the command it points at, which no
	 * arm here reads.
	 */
	test("marks every printed key for a command that binds it", () => {
		const manual = manualPage();
		const printed = [...manual.content.matchAll(KBD)].map(
			([, id, label]) =>
				[id, KEY_LABELS[label.toLowerCase()] ?? label.toLowerCase()] as const,
		);
		expect(printed.length).toBe(MANUAL_KEY_COUNT);
		for (const [id, key] of printed) {
			const command = CONTROLS.commands.find((c) => c.id === id);
			if (!command) throw new Error(`manual names no such command: ${id}`);
			expect(
				command.defaultTriggers.flatMap((trigger) =>
					trigger.kind === "key" ? [trigger.key] : [],
				),
			).toContain(key);
		}
	});

	/**
	 * Every key on the page is inside a `<kbd>`, so the prose around them holds
	 * no key name at all. Without this the row above only checks what someone
	 * remembered to mark up.
	 *
	 * **Its vocabulary** is the catalogue's own multi-character key names plus
	 * `UNBOUND_KEY_NAMES`, matched **capitalised** — which is how a key is
	 * printed, and how `Enter` is told apart from *before you enter the
	 * aperture*.
	 *
	 * **Three holes, each run rather than reasoned about.** A key printed in
	 * lower case passes. A named key dropped from `UNBOUND_KEY_NAMES` for
	 * reading as ordinary English — `Space`, `Return`, `End`, `Home`, `Delete`
	 * — passes. And a single letter is caught only where a non-word character
	 * follows it, which is every punctuation mark but not the end of a word.
	 */
	test("leaves no key name loose in the manual's prose", () => {
		const prose = manualProse(manualPage().content);
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
		for (const unbound of UNBOUND_KEY_NAMES) names.add(unbound);
		for (const name of names) {
			// Escaped: the names come from the catalogue, and a future key
			// carrying a metacharacter would otherwise change the pattern or
			// throw instead of being looked for.
			const capitalised = (name[0].toUpperCase() + name.slice(1)).replace(
				/[.*+?^${}()|[\]\\]/g,
				"\\$&",
			);
			expect(prose).not.toMatch(new RegExp(`\\b${capitalised}\\b`));
		}
		for (const loose of [
			/(^|[^\w<])[A-Z](?![\w])/,
			/\bF\d{1,2}\b/,
			/[↑↓←→]|&#96;/,
		])
			expect(prose).not.toMatch(loose);
	});

	test("gives a new pilot the controls needed to reach every cockpit panel", () => {
		const manual = manualPage();
		// The keys themselves are checked by the rows above, which derive them
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
