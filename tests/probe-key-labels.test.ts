/**
 * A script that presses a key by name says it assumes the shipped layout
 * (#381 S5, #369 D11).
 *
 * D11's rule for the probe tier: every probe that presses a key by name
 * becomes a command-level drive or is explicitly labelled a default-layout
 * probe, because a press of `"v"` is a claim about what `v` is bound to and
 * says so nowhere — and a moved default then turns a probe red for a reason
 * its reader has to rediscover. Leaving them unlabelled re-creates the drift
 * the registry exists to end.
 *
 * **A press counts when its key is one `DEFAULT_BINDINGS` binds.** `Escape`,
 * `Tab`, `Backspace` and typing into a field are the page's and the
 * browser's, not the layout's, and are not asked about. A key built at run
 * time — `keyboard.press(NEW_KEY)`, a name read off the screen — is not a
 * literal and is not either: those probes already know which key they mean
 * and why.
 *
 * The label is {@link LABEL}, anywhere in the file. Both directions are held:
 * a press without it, and a label on a file that no longer presses one, which
 * would be a claim about a layout the file does not touch.
 */
import { describe, expect, test } from "bun:test";
import { codeKey, DEFAULT_BINDINGS } from "../src/commands";
import { codeOf, repoPath, scriptFiles } from "./lib/source-scan";
import { readFileSync } from "node:fs";

/** What a default-layout probe says about itself. */
const LABEL = "default-layout probe (#381 D11)";

/** Every key the shipped layout binds, as `KeyFacts.key` spells it. */
const BOUND = new Set(
	DEFAULT_BINDINGS.flatMap((b) =>
		b.trigger.kind === "key" ? [b.trigger.key] : [],
	),
);

/** Playwright's key names that are not the character they type. */
const PLAYWRIGHT_NAMES: Readonly<Record<string, string>> = {
	space: " ",
	enter: "enter",
	shift: "shift",
	control: "control",
	arrowup: "arrowup",
	arrowdown: "arrowdown",
	arrowleft: "arrowleft",
	arrowright: "arrowright",
	f1: "f1",
};

/**
 * A Playwright key name as the registry spells the key.
 *
 * A chord (`Alt+ArrowLeft`, `Shift+Slash`) is its last key; a single
 * character is itself, lowercased; a code (`KeyW`, `Backquote`) goes through
 * `codeKey`, the registry's own table, so this is not a second one.
 */
function registryKey(name: string): string {
	const last = name.split("+").at(-1) ?? name;
	const lower = last.toLowerCase();
	return (
		PLAYWRIGHT_NAMES[lower] ??
		(last.length === 1 ? lower : (codeKey(last) ?? lower))
	);
}

/** A literal press, and a synthetic keydown or keyup with a literal key. */
const PRESS = /keyboard\.(?:press|down|up)\(\s*(["'`])([^"'`$]+)\1/g;
const EVENT =
	/new KeyboardEvent\(\s*["']key(?:down|up)["']\s*,\s*\{[^}]*?\bkey:\s*(["'`])([^"'`$]+)\1/g;

/** The default-bound keys a file presses by name, out of its code alone. */
function boundPresses(file: string): string[] {
	const code = codeOf(file);
	return [
		...[...code.matchAll(PRESS)].map((m) => m[2]),
		...[...code.matchAll(EVENT)].map((m) => m[2]),
	]
		.map(registryKey)
		.filter((k) => BOUND.has(k));
}

const labelled = (file: string) =>
	readFileSync(repoPath(file), "utf8").includes(LABEL);

const SCRIPTS = scriptFiles([".mjs", ".ts"]);

describe("the probe tier's presses by name (#381 S5)", () => {
	test("the scan finds presses, so a dead pattern cannot pass", () => {
		const total = SCRIPTS.reduce((n, f) => n + boundPresses(f).length, 0);
		expect(total).toBeGreaterThan(50);
		// Each pattern finds something on its own, so one gone dead cannot
		// hide behind the other's count.
		const found = (pattern: RegExp) =>
			SCRIPTS.some((f) => [...codeOf(f).matchAll(pattern)].length > 0);
		expect([found(PRESS), found(EVENT)]).toEqual([true, true]);
		// And the normaliser's three shapes: a character, a Playwright name
		// and a chord.
		expect(registryKey("v")).toBe("v");
		expect(registryKey("Space")).toBe(" ");
		expect(registryKey("Alt+ArrowLeft")).toBe("arrowleft");
	});

	test("every script that presses a bound key by name is labelled", () => {
		const unlabelled = SCRIPTS.filter(
			(f) => boundPresses(f).length > 0 && !labelled(f),
		).map((f) => `${f}: ${[...new Set(boundPresses(f))].join(" ")}`);
		expect(unlabelled).toEqual([]);
	});

	test("and no label is on a script that presses none", () => {
		const stale = SCRIPTS.filter(
			(f) => labelled(f) && boundPresses(f).length === 0,
		);
		expect(stale).toEqual([]);
	});
});
