/**
 * A script may only drive the settings key once the settings screen exists.
 *
 * `main.ts` mounts the screen from a deferred `import("./settings-panel")`, so
 * its key listener is not on the window at the first drawn frame — it arrives
 * some time after it. `bootedGame` answers at the first frame. A gate that
 * presses `z` in between is pressing a key at nothing, and what it reports is
 * the *game* refusing to open settings: #418's row in `probe-boot.mjs` timed out
 * on `[data-settings-panel]` three runs in three on `main`, and read as a broken
 * settings screen rather than as a probe that arrived early.
 *
 * The rule is held here, in the headless tier, because that is the only tier
 * that runs unattended: the probes do not run in CI, so a rule stated only
 * inside a probe is a rule nothing enforces the next time a script learns to
 * press the key. It is the same shape as `game-url.test.ts`'s navigation scan —
 * a textual scan over `scripts/`, through the suite's one comment stripper, with
 * the same limit: it reads text, not scope, and it is satisfied by a readiness
 * call anywhere in the file *before* the press. That is sound for one page
 * because a page under measurement is never navigated (#121): once the screen
 * has mounted it does not unmount.
 */
import { describe, expect, test } from "bun:test";
import { SETTINGS_KEY } from "../src/settings-panel";
import { codeOf, scriptFiles, stripComments } from "./lib/source-scan";

/** `keyboard.press|down|up("<settings key>")`, either case of the character. */
const PRESS = new RegExp(
	`keyboard\\.(?:press|down|up)\\(\\s*["'](?:${SETTINGS_KEY}|${SETTINGS_KEY.toUpperCase()})["']\\s*\\)`,
	"g",
);

/** The shared readiness call, imported from `probe-guard.mjs`. */
const READINESS = /\bwaitForSettingsPanel\s*\(/;

/** Every press of the settings key in already-stripped source, with its line. */
const presses = (source: string): number[] =>
	[...source.matchAll(PRESS)].map(
		(m) => source.slice(0, m.index).split("\n").length,
	);

/**
 * Lines in `source` where the settings key is driven before anything has waited
 * for the screen to exist. Empty means the file is clean.
 */
const drivesTooEarly = (source: string): number[] => {
	const ready = source.search(READINESS);
	return presses(source).filter((line) => {
		if (ready < 0) return true;
		const readyLine = source.slice(0, ready).split("\n").length;
		return line < readyLine;
	});
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
			"scripts/probe-commander.mjs",
			"scripts/probe-pad-panels.mjs",
			"scripts/probe-pointer-lock.mjs",
		]);
	});

	test("every one of them waits for the panel first", () => {
		const early = filesDrivingTheKey
			.map(({ file }) => ({ file, early: drivesTooEarly(codeOf(file)) }))
			.filter((entry) => entry.early.length > 0);
		expect(early).toEqual([]);
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
		expect(drivesTooEarly(stripComments(EARLY))).toEqual([4]);
	});

	test("the same press after the readiness call is not", () => {
		const waited = EARLY.replace(
			`await page.keyboard.press`,
			`await waitForSettingsPanel(page);\n\tawait page.keyboard.press`,
		);
		expect(drivesTooEarly(stripComments(waited))).toEqual([]);
	});

	test("a readiness call that comes after the press does not cover it", () => {
		const late = `${EARLY}await waitForSettingsPanel(page);\n`;
		expect(drivesTooEarly(stripComments(late))).toEqual([4]);
	});

	test("a press of some other key is none of this rule's business", () => {
		const other = EARLY.replace(`"${SETTINGS_KEY}"`, '"v"');
		expect(presses(stripComments(other))).toEqual([]);
	});

	test("a commented-out press is not a press", () => {
		const commented = EARLY.replace(
			`await page.keyboard.press`,
			`// await page.keyboard.press`,
		);
		expect(presses(stripComments(commented))).toEqual([]);
	});
});
