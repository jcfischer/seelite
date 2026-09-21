/**
 * Which backgrounding switches actually reach Chromium, per window mode (#454).
 *
 * `PROBE_WINDOW_LOCKABLE` returns the caller's options with neither
 * `headless: false` nor `OFFSCREEN_WINDOW_POSITION` and
 * `OFFSCREEN_WINDOW_RUNTIME_FLAGS`. Dropping the position flag is what the mode
 * is *for*; dropping the three backgrounding flags with it needs a reason that
 * is not "there is no window", because `--disable-background-timer-throttling`
 * is about renderers rather than windows. The reason is that Playwright passes
 * all three itself, out of its own `chromiumSwitches`, on every launch — and
 * that is a property of a pinned dependency rather than of this repo, so it is
 * printed by an instrument instead of asserted in a comment that nobody can
 * re-check.
 *
 * It asserts nothing. A table that also gated would be a check deriving itself
 * from its own subject, and the figure is a property of the Playwright version
 * installed rather than of the game.
 *
 * Read the **switches** column: a flag that appears once under `lockable` is
 * Playwright's, and a flag that appears twice under `offscreen` is this
 * module's restating one of Playwright's. A flag that appears under `offscreen`
 * and not at all under `lockable` would be a real drop, which is the reading
 * this instrument exists to make falsifiable.
 *
 *     SEELITE_PROBE_RENDERER=hardware node scripts/measure-launch-switches.mjs
 *
 * `--enable-automation` is added to both launches because Chromium refuses
 * `Browser.getBrowserCommandLine` without it; it is the one switch here that is
 * the instrument's own and it is named in the output for that reason.
 */
import {
	HARDWARE_RENDERER,
	launchChromium,
	OFFSCREEN_WINDOW_POSITION,
	OFFSCREEN_WINDOW_RUNTIME_FLAGS,
	PROBE_RENDERER_ENV,
	PROBE_WINDOW_LOCKABLE,
	probeRendererMode,
} from "./probe-guard.mjs";

/** The instrument's own switch, and the only one it adds. */
const AUTOMATION = "--enable-automation";

/** Every switch this module could have contributed, in the order declared. */
const OURS = [OFFSCREEN_WINDOW_POSITION, ...OFFSCREEN_WINDOW_RUNTIME_FLAGS];

if (probeRendererMode() !== HARDWARE_RENDERER)
	throw new Error(
		`this instrument measures the hardware lane's launches — run it with ${PROBE_RENDERER_ENV}=${HARDWARE_RENDERER}`,
	);

/**
 * The switches Chromium reports for one of this lane's real launches.
 *
 * Through `launchChromium`, not through a raw Playwright call, so what is read
 * back is the launch a probe in that window mode actually gets.
 */
const switchesFor = async (probeWindow) => {
	const browser = await launchChromium({
		channel: "chromium",
		args: [AUTOMATION],
		...(probeWindow ? { probeWindow } : {}),
	});
	const page = await browser.newPage();
	const session = await page.context().newCDPSession(page);
	const { arguments: argv } = await session.send(
		"Browser.getBrowserCommandLine",
	);
	await browser.close();
	return argv;
};

const report = async (label, probeWindow) => {
	const argv = await switchesFor(probeWindow);
	console.log(`\n${label}`);
	for (const flag of [
		...OFFSCREEN_WINDOW_RUNTIME_FLAGS,
		OFFSCREEN_WINDOW_POSITION,
	]) {
		const seen = argv.filter((a) => a === flag).length;
		console.log(
			`  ${seen}×  ${flag}${seen === 0 ? "  (absent)" : seen > 1 ? "  (this module's, restating Playwright's)" : ""}`,
		);
	}
	const ours = argv.filter((a) => OURS.includes(a)).length;
	console.log(
		`  argv ${argv.length} switches; ${ours} of them could be this module's, and ${
			argv.includes(AUTOMATION)
				? "1 is the instrument's own"
				: "the instrument's own is missing"
		}`,
	);
};

await report("lockable — the mode #454 adds", PROBE_WINDOW_LOCKABLE);
await report("offscreen — the lane's default, headed", null);
