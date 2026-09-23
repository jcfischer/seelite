/**
 * `docs/gamepad.md`'s binding tables, rendered from the registry (#381 S5).
 *
 * #369 D11 names that file's tables among the copies every printed key name
 * must be derived from. A document cannot read a layout at runtime, so it is
 * the **shipped** layout's — which is what a document about the pad is for —
 * and this renders both tables from `DEFAULT_BINDINGS` through the same
 * `triggerLabel` the game prints with, then requires the file to hold them
 * byte for byte between their markers.
 *
 * **Generate-and-diff rather than a per-row check**, for the reason
 * `tests/public-site.test.ts` gives against a hand-kept pair list: a row list
 * in a test is a fourth copy of the binding and cannot see a row added to the
 * page and left out of it. Here the page's rows *are* the rendering, so a
 * moved default, a new pad command or a renamed one reds this until the file
 * is rewritten — which is:
 *
 *     SEELITE_WRITE_DOCS=1 bun test tests/gamepad-doc.test.ts
 *
 * and then reading the diff, because the words around the tables are not
 * rendered and may have to change with them.
 */
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Binding,
	commandById,
	DEFAULT_BINDINGS,
	type Layout,
	type Trigger,
} from "../src/commands";
import { anyOf, boundNames, triggerLabel } from "../src/controls-reference";
import type { PadContext } from "../src/pad-bindings";

const DOC = join(import.meta.dir, "..", "docs", "gamepad.md");

type PadTrigger = Extract<
	Trigger,
	{ kind: "pad-button" | "pad-stick" | "pad-trigger" | "pad-intent" }
>;

const isPad = (t: Trigger): t is PadTrigger =>
	t.kind === "pad-button" ||
	t.kind === "pad-stick" ||
	t.kind === "pad-trigger" ||
	t.kind === "pad-intent";

/** Inline code, fenced so a backtick key survives: the jump is `` ` ``. */
const code = (text: string) =>
	text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;

/** A key or the mouse: the column a keyboard player reads. */
const atTheDesk = (t: Trigger) => t.kind === "key" || t.kind === "mouse-button";

/**
 * One row per pad trigger live in `context`, in the layout's order.
 *
 * `only` narrows the kinds: the console's table is its grammar — the panel
 * intents — and the buttons that fall through there are the flight table's
 * rows, which the prose under that table says still act.
 */
function table(
	layout: Layout,
	context: PadContext,
	only: (t: PadTrigger) => boolean = () => true,
): string {
	const rows = new Set<string>();
	for (const b of layout as readonly Binding[]) {
		const t = b.trigger;
		if (!isPad(t) || !t.contexts.includes(context) || !only(t)) continue;
		const desk = anyOf(boundNames(layout, b.command, atTheDesk));
		rows.add(
			`| ${triggerLabel(t)} | ${commandById(b.command).name} | ${desk ? code(desk) : "—"} |`,
		);
	}
	return [
		"| on the pad | does | keyboard and mouse |",
		"| --- | --- | --- |",
		...rows,
	].join("\n");
}

const BLOCKS = {
	flight: () => table(DEFAULT_BINDINGS, "flight"),
	console: () =>
		table(DEFAULT_BINDINGS, "console", (t) => t.kind === "pad-intent"),
} as const;

const open = (name: string) =>
	`<!-- generated: ${name} — tests/gamepad-doc.test.ts renders it from DEFAULT_BINDINGS; do not edit by hand -->`;
const close = (name: string) => `<!-- end generated: ${name} -->`;

/** The file with every block between its markers replaced by `render`. */
function rendered(doc: string): string {
	let out = doc;
	for (const [name, render] of Object.entries(BLOCKS)) {
		const start = out.indexOf(open(name));
		const end = out.indexOf(close(name));
		if (start === -1 || end === -1 || end < start)
			throw new Error(`docs/gamepad.md has no ${name} block`);
		out = `${out.slice(0, start + open(name).length)}\n\n${render()}\n\n${out.slice(end)}`;
	}
	return out;
}

test("the pad's binding tables are the shipped layout's", () => {
	const doc = readFileSync(DOC, "utf8");
	const want = rendered(doc);
	if (process.env.SEELITE_WRITE_DOCS === "1" && want !== doc)
		writeFileSync(DOC, want);
	else expect(doc).toBe(want);
});

test("both tables have rows, so a dead filter cannot pass empty", () => {
	// Guarding the guard: a renderer whose predicate matched nothing would
	// render a header and agree with a file holding the same header.
	expect(BLOCKS.flight().split("\n").length).toBeGreaterThan(15);
	expect(BLOCKS.console().split("\n").length).toBeGreaterThan(5);
});
