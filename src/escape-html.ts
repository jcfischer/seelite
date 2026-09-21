/**
 * One HTML escape table for every string builder in this repo.
 *
 * It was three: `live-cockpit.ts`'s `escapeHtml`, `requests-view.ts`'s `esc`
 * and — for one review round — `hold-view.ts`'s own copy. Three tables of the
 * same five characters drift the day one of them is fixed, and the failure is
 * silent: the module with the older table keeps rendering, and what it renders
 * is markup.
 *
 * **A leaf.** It imports nothing, so a view may take it without taking
 * anything else, and `tests/headless.test.ts` holds that.
 */
const REPLACEMENTS: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

export const escapeHtml = (value: string): string =>
	value.replace(/[&<>"']/g, (c) => REPLACEMENTS[c] as string);
