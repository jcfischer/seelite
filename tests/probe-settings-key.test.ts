/**
 * A script may only drive the settings key once the settings screen exists, and
 * it may only claim that it waited by *using* what the wait answered.
 *
 * The timing that makes that a rule — the deferred mount, and what it costs
 * after the first drawn frame — belongs to `waitForSettingsPanel` in
 * `probe-guard.mjs` and is not restated here. What lives here is the check that
 * the rule holds across `scripts/`, in the one tier CI runs: a press counts as
 * covered only by a readiness call whose answer the file reads. An answer that
 * can be ignored will be — #418's own first commit dropped it in two scripts and
 * this scan stayed green on the defect until sage round 1 said otherwise.
 *
 * It is the same shape as `game-url.test.ts`'s navigation scan —
 * a textual scan over `scripts/`, through the suite's one comment stripper, with
 * the same limit: it reads text, not scope. A consumed readiness call anywhere
 * in the file before the press satisfies it, which is sound for one page because
 * a page under measurement is never navigated (#121): once the screen has
 * mounted it does not unmount. What it cannot see is whether a press is *gated*
 * on the answer rather than merely following it. That belongs to the rows: each
 * one names the mount inside its own predicate, so a screen that never arrived
 * is reported as that, and not as the game refusing to open settings.
 */
import { describe, expect, test } from "bun:test";
import { SETTINGS_KEY } from "../src/settings-panel";
import { codeOf, scriptFiles, stripComments } from "./lib/source-scan";

/** `keyboard.press|down|up("<settings key>")`, either case of the character. */
const PRESS = new RegExp(
	`keyboard\\.(?:press|down|up)\\(\\s*["'](?:${SETTINGS_KEY}|${SETTINGS_KEY.toUpperCase()})["']\\s*\\)`,
	"g",
);

/** A line that calls the shared readiness helper from `probe-guard.mjs`. */
const READINESS_LINE = /\bwaitForSettingsPanel\s*\(/;

/** Its own definition, which is a declaration and not a call. */
const READINESS_DECLARATION =
	/^\s*(?:export\s+)?(?:async\s+)?function\s+waitForSettingsPanel/;

/**
 * A readiness call that stands alone as a statement: awaited or not, its answer
 * goes to the floor. Anything with the call nested in an expression — an
 * argument to `check`, a condition, a returned value — does not match, because
 * this requires the call to open the line and the statement to close on it.
 */
const DISCARDED = /^\s*(?:await\s+)?waitForSettingsPanel\s*.*\)\s*;\s*$/;

/** A readiness call whose answer is bound to a name. */
const ASSIGNED =
	/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?waitForSettingsPanel\b/;

/** Why one line makes a file unsafe to drive the settings key. */
type Reason = "press-before-a-wait" | "answer-dropped" | "answer-never-read";

const linesOf = (source: string): string[] => source.split("\n");

/** Every press of the settings key in already-stripped source, with its line. */
const presses = (source: string): number[] =>
	[...source.matchAll(PRESS)].map(
		(m) => source.slice(0, m.index).split("\n").length,
	);

/**
 * What is wrong with each line of `source`, as `{ line, reason }`. A press that
 * precedes every *consumed* readiness call is unsafe, and so is a readiness call
 * whose answer nobody reads — the second is the first wearing a wait's clothes.
 */
const problems = (source: string): { line: number; reason: Reason }[] => {
	const lines = linesOf(source);
	const consumed: number[] = [];
	const found: { line: number; reason: Reason }[] = [];

	lines.forEach((text, index) => {
		const line = index + 1;
		if (!READINESS_LINE.test(text) || READINESS_DECLARATION.test(text)) {
			return;
		}
		if (DISCARDED.test(text)) {
			found.push({ line, reason: "answer-dropped" });
			return;
		}
		const bound = text.match(ASSIGNED);
		if (bound) {
			const usedLater = lines
				.slice(index + 1)
				.some((rest) => new RegExp(`\\b${bound[1]}\\b`).test(rest));
			if (!usedLater) {
				found.push({ line, reason: "answer-never-read" });
				return;
			}
		}
		consumed.push(line);
	});

	const first = consumed.length > 0 ? Math.min(...consumed) : Infinity;
	for (const line of presses(source)) {
		if (line < first) found.push({ line, reason: "press-before-a-wait" });
	}
	return found.sort((a, b) => a.line - b.line);
};

const filesDrivingTheKey: { file: string; lines: number[] }[] = scriptFiles([
	".mjs",
])
	.map((file) => ({ file, lines: presses(codeOf(file)) }))
	.filter((entry) => entry.lines.length > 0)
	.sort((a, b) => a.file.localeCompare(b.file));

describe("the settings key is driven only after the screen exists", () => {
	test("the scripts that drive it are the ones named here", () => {
		// Named rather than counted: an empty scan and a full one both read as
		// "no violations", and the floor has to be distinguishable from the
		// whole check having stopped matching anything.
		expect(filesDrivingTheKey.map((e) => e.file)).toEqual([
			"scripts/probe-boot.mjs",
			// #381 S4 drives it to show it is **dead**: the bootstrap moves
			// `system.settings` off `z` and the row asks that the key no
			// longer opens the screen. The readiness call is what keeps that
			// able to fail in the direction it names — a build where the panel
			// never mounts would satisfy "z did not open it" for the wrong
			// reason.
			"scripts/probe-capture.mjs",
			// Node #691 opens the screen to show it takes the pointer, so a
			// mouse moved behind it orbits nothing.
			"scripts/probe-chase-orbit.mjs",
			"scripts/probe-commander.mjs",
			// Node #703 opens it over a held eject key: the screen empties the
			// held keys, and that must not read as the key being let go.
			"scripts/probe-eject.mjs",
			// #639 selects the mouse-flight layout on the screen, as a player does.
			"scripts/probe-mouse-flight-layout.mjs",
			// Node #640 steps the mouse sensitivity row, as a player does.
			"scripts/probe-mouse-sensitivity.mjs",
			"scripts/probe-pad-panels.mjs",
			"scripts/probe-pointer-lock.mjs",
		]);
	});

	test("every one of them waits, and reads what the wait answered", () => {
		const unsafe = filesDrivingTheKey
			.map(({ file }) => ({ file, problems: problems(codeOf(file)) }))
			.filter((entry) => entry.problems.length > 0);
		expect(unsafe).toEqual([]);
	});
});

describe("the scan fails on the defect it names", () => {
	/** A gate that presses the key with nothing waiting for the mount. */
	const EARLY = `
async function settingsGate() {
	const page = await open();
	await page.keyboard.press("${SETTINGS_KEY}");
}
`;

	test("a press with no readiness call anywhere is a violation", () => {
		expect(problems(stripComments(EARLY))).toEqual([
			{ line: 4, reason: "press-before-a-wait" },
		]);
	});

	test("a press after a readiness call whose answer is checked is not", () => {
		const waited = EARLY.replace(
			"await page.keyboard.press",
			`check(\n\t\t"the settings screen is mounted",\n\t\tawait waitForSettingsPanel(page),\n\t);\n\tawait page.keyboard.press`,
		);
		expect(problems(stripComments(waited))).toEqual([]);
	});

	test("a press after a bound readiness call that the file then reads is not", () => {
		const bound = EARLY.replace(
			"await page.keyboard.press",
			`const mounted = await waitForSettingsPanel(page);\n\tcheck("mounted", mounted);\n\tawait page.keyboard.press`,
		);
		expect(problems(stripComments(bound))).toEqual([]);
	});

	test("a readiness call whose answer is dropped is a violation, and the press stays early", () => {
		// The shape #418 shipped with in two scripts: the wait is present, the
		// answer is on the floor, and the key goes down whether or not the
		// screen exists.
		const dropped = EARLY.replace(
			"await page.keyboard.press",
			`await waitForSettingsPanel(page);\n\tawait page.keyboard.press`,
		);
		expect(problems(stripComments(dropped))).toEqual([
			{ line: 4, reason: "answer-dropped" },
			{ line: 5, reason: "press-before-a-wait" },
		]);
	});

	test("a readiness answer bound and never read is a violation", () => {
		const unread = EARLY.replace(
			"await page.keyboard.press",
			`const mounted = await waitForSettingsPanel(page);\n\tawait page.keyboard.press`,
		);
		expect(problems(stripComments(unread))).toEqual([
			{ line: 4, reason: "answer-never-read" },
			{ line: 5, reason: "press-before-a-wait" },
		]);
	});

	test("a readiness call that comes after the press does not cover it", () => {
		const late = `${EARLY}check("mounted", await waitForSettingsPanel(page));\n`;
		expect(problems(stripComments(late))).toEqual([
			{ line: 4, reason: "press-before-a-wait" },
		]);
	});

	test("a press of some other key is none of this rule's business", () => {
		const other = EARLY.replace(`"${SETTINGS_KEY}"`, '"v"');
		expect(presses(stripComments(other))).toEqual([]);
	});

	test("a commented-out press is not a press", () => {
		const commented = EARLY.replace(
			"await page.keyboard.press",
			`// await page.keyboard.press`,
		);
		expect(presses(stripComments(commented))).toEqual([]);
	});

	test("the helper's own definition is not read as a dropped answer", () => {
		const definition = `
export async function waitForSettingsPanel(page, timeout = 20000) {
	return page.waitForFunction(() => true, null, { timeout }).catch(() => false);
}
`;
		expect(problems(stripComments(definition))).toEqual([]);
	});
});
