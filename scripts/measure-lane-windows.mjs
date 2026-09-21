/**
 * Does a probe lane open a window? Read off Chromium, per window mode.
 *
 * The lane runs windowless: the default mode adds `HARDWARE_CHANNEL` to a
 * caller's options and nothing else, so Playwright launches new headless and
 * there is no window to take the focus. That claim is the whole point of the
 * change that made it true, and the way to check it is not to read this
 * module's source — it is to ask the browser what it was started with.
 *
 * So this prints, for every mode that survives, whether the launch carries
 * `--headless`, whether anything positions or sizes a window, and which binary
 * answered. A default-mode row without `--headless`, or a row naming
 * `chrome-headless-shell`, is the regression: the first puts a window back on
 * the developer's screen, and the second is the software rasteriser this lane
 * exists not to measure.
 *
 * It asserts nothing, deliberately. Which binary a channel resolves to and what
 * Playwright adds to a launch are properties of the pinned dependency rather
 * than of the game, and a table that also gated would be a check deriving
 * itself from its own subject. The gate that does exist is
 * `assertBrowserRenderer`, which runs on every hardware launch.
 *
 *     SEELITE_PROBE_RENDERER=hardware node scripts/measure-lane-windows.mjs
 *
 * `--enable-automation` is added to each launch because Chromium refuses
 * `Browser.getBrowserCommandLine` without it. It is the instrument's own switch
 * and the only one it contributes, which is why the rows name it.
 */
import {
	HARDWARE_RENDERER,
	launchChromium,
	PROBE_RENDERER_ENV,
	PROBE_WINDOW_LOCKABLE,
	PROBE_WINDOW_VISIBLE,
	probeRendererMode,
} from "./probe-guard.mjs";

/** The instrument's own switch, and the only one it adds. */
const AUTOMATION = "--enable-automation";

/** Anything that would place, size or decorate a window. */
const WINDOWED = /window-position|window-size|--app=|--start-|--kiosk/;

if (probeRendererMode() !== HARDWARE_RENDERER)
	throw new Error(
		`this instrument measures the hardware lane's launches — run it with ${PROBE_RENDERER_ENV}=${HARDWARE_RENDERER}`,
	);

/** What Chromium says it was started with, for one of this lane's real launches. */
const commandLineFor = async (probeWindow) => {
	const browser = await launchChromium({
		args: [AUTOMATION],
		...(probeWindow ? { probeWindow } : {}),
	});
	try {
		const page = await browser.newPage();
		const session = await page.context().newCDPSession(page);
		const { arguments: argv } = await session.send(
			"Browser.getBrowserCommandLine",
		);
		return argv;
	} finally {
		// The read is what is most likely to refuse here, and a browser left open
		// on the first row takes every later row's with it.
		await browser.close();
	}
};

const report = async (label, probeWindow) => {
	const argv = await commandLineFor(probeWindow);
	const headless = argv.filter((a) => a.startsWith("--headless"));
	const windowed = argv.filter((a) => WINDOWED.test(a));
	console.log(`\n${label}`);
	console.log(
		`  headless      ${headless.length ? headless.join(" ") : "(none — this launch has a window)"}`,
	);
	console.log(
		`  window flags  ${windowed.length ? windowed.join(" ") : "(none)"}`,
	);
	console.log(`  binary        ${argv[0].split("/").pop()}`);
	console.log(
		`  argv          ${argv.length} switches, ${argv.includes(AUTOMATION) ? "1 of them the instrument's own" : "the instrument's own missing"}`,
	);
};

await report("default — every probe but one", null);
await report(
	"lockable — the same launch, asked for by name",
	PROBE_WINDOW_LOCKABLE,
);
await report(
	"visible — the one mode that still has a window",
	PROBE_WINDOW_VISIBLE,
);
