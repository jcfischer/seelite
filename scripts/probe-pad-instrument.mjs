/**
 * Probe: the pad drives the frame instrument, and the instrument is not modal.
 *
 * #283's sixth surface, in its own file for one reason: it is the only check
 * that needs `?perf`, and `check-launcher-wiring.mjs` refuses that URL to every
 * probe but a named few. The refusal exists because the panel binds a plain
 * `window` keydown listener, so a probe that mounted it would have its own
 * keystrokes toggling bloom and shells under checks that measure what is drawn.
 *
 * **This file sends no keys at all.** Everything below is the pad, which the
 * panel's key listener cannot see, so the exception holds for the same reason
 * `probe-frame-attribution.mjs` has one: the diagnostic is the subject rather
 * than accidental contamination of some other assertion.
 *
 * ## Mutation-checked
 *
 * `PerfPanelHandle.setFocused` made a no-op reds "d-pad down hands the pad to
 * the frame instrument" and the toggle after it, and nothing else.
 *
 * Usage:
 *   npm run dev
 *   node scripts/probe-pad-instrument.mjs [baseUrl]
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { STANDARD_INDEX, installFakePad } from "./lib/fake-pad.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";

/** The W3C standard mapping, as literals — see `probe-gamepad.mjs` on why. */
const B = STANDARD_INDEX;

await guardedOrigin(ORIGIN);
const { check, watch, exit } = tally();

const browser = await launchChromium();
try {
	const perf = await browser.newPage({
		viewport: { width: 1280, height: 860 },
	});
	watch(perf, "perf");
	await perf.addInitScript(installFakePad);
	await perf.goto(`${ORIGIN}/?seed=42&perf`, { waitUntil: "load" });
	await bootedGame(perf);
	await perf.waitForSelector("[data-perf-panel]", { timeout: 30000 });

	const frames = (n) => perf.evaluate((count) => window.__frames(count), n);
	const tap = async (index) => {
		await perf.evaluate((i) => window.__pad.hold(i), index);
		await frames(2);
		await perf.evaluate((i) => window.__pad.release(i), index);
		await frames(2);
	};

	await tap(B.down);
	const held = await perf.evaluate(
		() =>
			document.querySelector("[data-perf-panel]")?.dataset.perfPadFocus ?? null,
	);
	check(
		"d-pad down hands the pad to the frame instrument",
		held === "true",
		`perfPadFocus ${held}`,
	);

	const before = await perf.evaluate(
		() => window.__seelite.bloom?.enabled ?? null,
	);
	await tap(B.a);
	const after = await perf.evaluate(
		() => window.__seelite.bloom?.enabled ?? null,
	);
	check(
		"Cross toggles the focused switch",
		before !== null && after === !before,
		`bloom ${before} → ${after}`,
	);

	// **Circle gives it back, not down again.** While the instrument holds the
	// pad the context is a console's, so down walks its rows — which is what the
	// cursor is for. Written the other way this check went red, and the branch it
	// was written against turned out to be unreachable; it is gone.
	await tap(B.b);
	const released = await perf.evaluate(
		() =>
			document.querySelector("[data-perf-panel]")?.dataset.perfPadFocus ?? null,
	);
	check(
		"…and Circle gives it back",
		released === "false",
		`perfPadFocus ${released}`,
	);

	// **Fly the ship *while* the instrument holds the pad.** The first version of
	// this check read `headLook` and `view` after Circle had already released
	// it, which is green whether or not the axes were suspended during ownership
	// — it asserted nothing about the claim in its own name. Sage found that,
	// round 1. Take the instrument again, deflect a stick, and read the rate.
	await tap(B.down);
	await perf.evaluate(() => window.__pad.axes(0, 0, 1, 0));
	await frames(12);
	const flownWhileHeld = await perf.evaluate(() => ({
		yaw: window.__seelite.rates.yaw,
		held:
			document.querySelector("[data-perf-panel]")?.dataset.perfPadFocus ?? null,
	}));
	await perf.evaluate(() => window.__pad.axes(0, 0, 0, 0));
	await tap(B.b);
	check(
		"the instrument is not modal: the stick still flies the ship while it holds the pad",
		flownWhileHeld.held === "true" && Math.abs(flownWhileHeld.yaw) > 1e-6,
		`perfPadFocus ${flownWhileHeld.held}, yaw ${flownWhileHeld.yaw.toFixed(5)} rad/s`,
	);
} finally {
	await browser.close();
}

exit();
