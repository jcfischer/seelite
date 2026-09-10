/**
 * Probe: the pad is wired to the ship, and the sticks are analog.
 *
 * Adapted from seekolous's `probe-gamepad.mjs` (#249), whose header argued the
 * three claims a unit test cannot reach. They are the same three here:
 *
 *   1. **That `navigator.getGamepads` is read at all.** `tests/pad-bindings.test.ts`
 *      and `tests/gamepad.test.ts` both inject a pad list precisely so they
 *      never touch it, so a `poll()` that had lost its navigator branch passes
 *      every one of them.
 *   2. **That the poll is inside the frame loop** — established by counting
 *      `getGamepads` calls against rendered frames, and again with `rAF`
 *      stubbed out. "The ship turned" would be satisfied by a `setInterval`
 *      just as well.
 *   3. **That the stick is still analog when it reaches the ship.** That is the
 *      whole reason this node exists rather than telling the player to run a
 *      desktop mapper app, which turns a stick into `W` — and it is a claim
 *      about `stepAngular`'s command term, not about the module.
 *
 * ## The mutation that matters, and it is inherited rather than re-derived
 *
 * Seekolous's header records a mutant that **passed**: folding the stick into
 * the key set — the exact thing a mapper app does — sailed through an analog
 * check that measured *distance over a fixed number of frames*, because
 * headless `rAF` paces frames unevenly enough that thirty of them are not
 * thirty of the same length twice running.
 *
 * This probe cannot repeat that mistake, because it does not measure distance
 * at all. `Game.rates` is the **integrated turn rate**, and `stepAngular` eases
 * toward `command × maxRate` — so after enough frames to converge, the ratio of
 * two arms is the ratio of their commands and the frame pacing has divided out.
 * The arms here are a full deflection and 0.6 of one, and the prediction is the
 * deadzone's own arithmetic: `(0.6 − 0.18) / (1 − 0.18)` = 0.512. A binary
 * stick reads 1.00.
 *
 * ## Mutation-checked here
 *
 * Three mutants, run against this tree and each reverted afterwards. Every one
 * reddened its own checks and **nothing else**, which is the half that makes a
 * red informative:
 *
 *   - `Math.sign` on the three stick terms — a binary stick, which is exactly
 *     what a desktop mapper app produces — reds only "a half-pushed stick turns
 *     at half the rate", at a ratio of **1.000** against the real tree's 0.512.
 *   - The triggers read as switches (`held` rather than `values`) reds only
 *     "a light pull trims the throttle more slowly than a full one", at
 *     **0.0000/s** against 1.10/s: a quarter-pull is under the press threshold,
 *     so a switch reports nothing at all.
 *   - `pollPad` moved out of `animate` and onto `setInterval(16)` reds the
 *     wiring pair and only that pair — **6 calls across 10 frames**, and
 *     **125 calls in 2 s** with `rAF` stubbed out against the real tree's 0.
 *
 * Two checks were also wrong before they were right, and both were caught by a
 * red rather than by review. The deadzone check ran *after* the stick arms and
 * read −0.0117 rad/s of the assist's exponential ease-out as a leak, so it runs
 * from rest now and asserts exactly zero. And "a resting trigger holds the
 * throttle" ran with the throttle at its ceiling of 1, where a broken trim
 * reads identically to a working one; it trims down to the middle first.
 *
 * The fake pad is a plain object in the standard mapping, installed before the
 * page's own script runs. Its indices come from a literal table below rather
 * than from `STANDARD_BUTTONS`, because a fake built from the module's own list
 * agrees with the module **by construction** and could not tell either of them
 * that the W3C numbering had moved.
 *
 * Usage:
 *   npm run dev              # in one terminal (default port 5173, or pass one)
 *   node scripts/probe-gamepad.mjs [baseUrl]
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
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=42`;

/** The standard mapping and the fixture, shared by the three pad probes. */
const B = STANDARD_INDEX;

/**
 * Frames per stick arm.
 *
 * `stepAngular` eases toward the commanded rate at a bounded acceleration, so
 * an arm has to be long enough for both arms to have converged — otherwise the
 * ratio is a ratio of accelerations, which is 1.00 for any two commands and
 * would pass the binary-stick mutant. At twenty the measured ratio is 0.512
 * against a predicted 0.512 — three digits, repeatably — and the binary-stick
 * mutant reads 1.000 at the same count.
 */
const FRAMES = 20;

await guardedOrigin(ORIGIN);
const { check, watch, exit } = tally();

const browser = await launchChromium();
try {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 800 },
	});
	watch(page);
	// Before `goto`: the fake has to be in place before the page's own script
	// runs, or the first poll reads a real navigator with no pad on it.
	await page.addInitScript(installFakePad);
	await page.goto(URL, { waitUntil: "load" });
	await bootedGame(page);

	const frames = (n) => page.evaluate((count) => window.__frames(count), n);

	/**
	 * Press a button for a frame or two, then release it and let the release
	 * land.
	 *
	 * Two frames down and two up, because a press is an **edge**: the module
	 * computes `pressed` against the previous poll, so a button that goes down
	 * and up inside one frame is never seen at all.
	 */
	const tapPad = async (index, down = 2, up = 2) => {
		await page.evaluate((i) => window.__pad.hold(i), index);
		await frames(down);
		await page.evaluate((i) => window.__pad.release(i), index);
		await frames(up);
	};

	// --- the pad is seen at all -------------------------------------------

	{
		const before = await page.evaluate(() => window.__pad.calls);
		await frames(3);
		const after = await page.evaluate(() => window.__pad.calls);
		check(
			"navigator.getGamepads is actually read",
			after > before,
			`${after - before} call(s) across 3 frames`,
		);
	}

	// --- the button table acts --------------------------------------------

	{
		const before = await page.evaluate(() => window.__seelite.assist);
		await tapPad(B.x);
		const after = await page.evaluate(() => window.__seelite.assist);
		check(
			"Square toggles the flight assist",
			before !== after,
			`assist ${before} → ${after}`,
		);
		await tapPad(B.x);
	}

	{
		const before = await page.evaluate(() => window.__seelite.targetId);
		await tapPad(B.r1);
		const after = await page.evaluate(() => window.__seelite.targetId);
		check(
			"R1 cycles the target",
			before !== after,
			`target ${before} → ${after}`,
		);
	}

	{
		await tapPad(B.left);
		const looked = await page.evaluate(() => window.__seelite.headLook);
		check(
			"the d-pad turns the head to the port console",
			looked === "left",
			`headLook ${looked}`,
		);
		// **Circle, not d-pad up.** Once a console is open, up and down walk its
		// cursor — that is the whole of the console context — so the way back to
		// the forward view is `back`. This check went red written the other way,
		// which is the design saying so.
		await tapPad(B.b);
		const forward = await page.evaluate(() => window.__seelite.headLook);
		check(
			"…and Circle backs out of it, which is what hands the pad back to the ship",
			forward === "forward",
			`headLook ${forward}`,
		);
	}

	{
		const before = await page.evaluate(() => window.__seelite.view);
		await tapPad(B.r3);
		const after = await page.evaluate(() => window.__seelite.view);
		check("R3 swaps the view", before !== after, `view ${before} → ${after}`);
		await tapPad(B.r3);
	}

	// --- the sticks are analog --------------------------------------------

	// **Before any arm.** The assist eases a rate *out* exponentially, so a ship
	// that has just been turning is still turning a few frames later — the first
	// version of this check ran after the arms below and read −0.0117 rad/s of
	// leftover momentum as a deadzone leak. From rest the assertion can be
	// exactly zero, which is what the module promises.
	{
		const settled = await page.evaluate(() => window.__seelite.rates);
		await page.evaluate(() => window.__pad.axes(0, 0, 0.1, 0.1));
		await frames(6);
		const rate = await page.evaluate(() => window.__seelite.rates);
		await page.evaluate(() => window.__pad.rest());
		await frames(2);
		check(
			"a stick inside the deadzone does not turn the ship",
			Math.abs(settled.yaw) < 1e-9 &&
				Math.abs(rate.yaw) < 1e-9 &&
				Math.abs(rate.pitch) < 1e-9,
			`yaw ${rate.yaw}, pitch ${rate.pitch} (from a settled ${settled.yaw})`,
		);
	}

	/**
	 * Fly one arm and report the settled yaw rate.
	 *
	 * The rate, not a distance: `stepAngular` integrates the command, so after
	 * `FRAMES` of easing the two arms have converged and the frame pacing has
	 * divided out of the ratio.
	 */
	const yawArm = async (deflection) => {
		await page.evaluate((d) => window.__pad.axes(0, 0, d, 0), deflection);
		await frames(FRAMES);
		const rate = await page.evaluate(() => window.__seelite.rates.yaw);
		await page.evaluate(() => window.__pad.rest());
		await frames(3);
		return rate;
	};

	{
		const full = await yawArm(1);
		const part = await yawArm(0.6);
		const ratio = full === 0 ? Number.NaN : part / full;
		// The deadzone is radial and rescaled: 0.6 of travel is
		// (0.6 − 0.18) / (1 − 0.18) of command. The prediction is the arithmetic,
		// not "smaller" — a binary stick reads 1.00 and would pass "smaller than
		// or equal".
		const predicted = (0.6 - 0.18) / (1 - 0.18);
		check(
			"a half-pushed stick turns at half the rate — the stick stays analog",
			Number.isFinite(ratio) && Math.abs(ratio - predicted) < 0.06,
			`ratio ${ratio.toFixed(3)} against a predicted ${predicted.toFixed(3)} (full ${full.toFixed(5)} rad/s)`,
		);
		check(
			"…and a full deflection turns the ship at all",
			Math.abs(full) > 1e-6,
			`yaw rate ${full.toFixed(5)} rad/s`,
		);
	}

	// --- the triggers trim ------------------------------------------------

	/**
	 * Pull one trigger for a fixed number of frames and report how far the
	 * throttle moved **per second of the clock the game integrated**.
	 *
	 * Per second rather than per arm, for the reason seekolous's header
	 * records: headless frames are not the same length twice running, so two
	 * arms of equal frame count are not two arms of equal duration. The game
	 * clock is not exposed, so the wall clock is read around the arm — which is
	 * the surrogate that was wrong there for a *rate* measured over few frames,
	 * and is adequate here only because the two arms are compared as a ratio
	 * over the same number of frames on the same page. It is checked loosely
	 * for that reason: the claim is "more than half again", not a figure.
	 */
	const trimArm = async (value) => {
		await page.evaluate(() => {
			window.__pad.rest();
		});
		await frames(2);
		const before = await page.evaluate(() => window.__seelite.throttleFraction);
		await page.evaluate(({ i, v }) => window.__pad.hold(i, v), {
			i: B.r2,
			v: value,
		});
		const started = Date.now();
		await frames(8);
		const elapsed = (Date.now() - started) / 1000;
		const after = await page.evaluate(() => window.__seelite.throttleFraction);
		await page.evaluate(() => window.__pad.rest());
		await frames(2);
		return { moved: after - before, perSecond: (after - before) / elapsed };
	};

	{
		const full = await trimArm(1);
		const light = await trimArm(0.25);
		check(
			"the right trigger opens the throttle",
			full.moved > 0,
			`throttle moved ${full.moved.toFixed(4)}`,
		);
		check(
			"a light pull trims the throttle more slowly than a full one",
			light.perSecond > 0 && light.perSecond < full.perSecond * 0.6,
			`${light.perSecond.toFixed(4)}/s light against ${full.perSecond.toFixed(4)}/s full`,
		);
	}

	{
		// **Off the clamp first.** The arms above leave the throttle at 1, where
		// "it did not move" is also what a broken trim reads — the ceiling holds
		// it there either way. Trim down to somewhere in the middle, then watch.
		await page.evaluate((i) => window.__pad.hold(i, 1), B.l2);
		await frames(4);
		await page.evaluate(() => window.__pad.rest());
		await frames(2);
		const before = await page.evaluate(() => window.__seelite.throttleFraction);
		await frames(8);
		const after = await page.evaluate(() => window.__seelite.throttleFraction);
		check(
			"a resting trigger holds the throttle where it is, which is the whole of F2",
			before > 0.02 && before < 0.98 && Math.abs(after - before) < 1e-9,
			`throttle ${before.toFixed(4)} → ${after.toFixed(4)}`,
		);
	}

	// --- braking must not accelerate --------------------------------------

	{
		// **The trim is a control input, so it cancels a detour — and the branch
		// that cancels one falls through to full cruise unless the player is
		// working the throttle.** That exemption named only the keyboard, so a
		// left-trigger pull went to 98.3% where `control` leaves 18.3%: braking
		// accelerated. Sage found it, round 4.
		const braked = await page.evaluate(async () => {
			const g = window.__seelite;
			g.setThrottle(0.2);
			// A detour is what makes the branch reachable; the field is the one
			// the cancel reads.
			g.detour = { reason: "probe", legs: [] };
			window.__pad.hold(6, 1); // l2 — throttle down
			await window.__frames(3);
			const throttle = g.throttleFraction;
			window.__pad.rest();
			await window.__frames(2);
			return { throttle, detour: g.detour };
		});
		check(
			"a left-trigger pull that cancels a detour brakes rather than accelerating",
			braked.throttle < 0.2 && braked.detour === null,
			`throttle ${braked.throttle.toFixed(3)} from 0.200, detour ${braked.detour === null ? "cancelled" : "still set"}`,
		);
	}

	// --- the audio notice's promise ---------------------------------------

	{
		// The notice says "press any key or click once to enable sound". Only the
		// pointer path called `ensure`, so a player who did what the line said
		// got no context and no second notice — the once-only flag was spent.
		// Sage found it, round 4. The probe never clicks, so a key is the only
		// unlock it can exercise.
		await page.keyboard.press("KeyP");
		await frames(2);
		const silent = await page.evaluate(() => window.__seelite.audio.silent);
		check(
			"a keystroke unlocks the sound, which is what the pad's notice promises",
			silent === false,
			`audio silent ${silent}`,
		);
	}

	// --- where the poll lives ---------------------------------------------
	//
	// Last, and that is a precondition rather than a preference: the second arm
	// stops the frame loop and there is deliberately no way to start it again —
	// `probe-boot.mjs` fails if `Game` grows one.

	{
		await page.evaluate(() => window.__pad.resetCalls());
		const { frames: rendered } = await frames(10);
		const whileRunning = await page.evaluate(() => window.__pad.calls);
		check(
			// **N or N+1, and the +1 is the measurement's rather than the game's.**
			// The probe's counter is its own `rAF` callback, registered separately
			// from the game's, so the frame at either boundary can carry a poll the
			// counter has not reached yet — this read 11 across 10 on every run.
			// It is still not a tolerance: 2N and N/2 both fail, which is what
			// separates a per-frame poll from a timer that happens to be close.
			// The arm below is the decisive one.
			"the pad is read once per rendered frame",
			whileRunning === rendered || whileRunning === rendered + 1,
			`${whileRunning} call(s) across ${rendered} frames`,
		);

		const stopped = await page.evaluate(async () => {
			// Stub `rAF` rather than cancelling the game's handle, which is
			// private and deliberately so. The loop re-arms itself through this
			// function, so the frame after the stub lands is the last one.
			const real = window.requestAnimationFrame;
			window.requestAnimationFrame = () => 0;
			await new Promise((r) => setTimeout(r, 300));
			window.__pad.resetCalls();
			await new Promise((r) => setTimeout(r, 2000));
			const calls = window.__pad.calls;
			window.requestAnimationFrame = real;
			return calls;
		});
		check(
			"…and not at all once rAF stops, so it is not on a timer",
			stopped === 0,
			`${stopped} call(s) in 2s with requestAnimationFrame stubbed out`,
		);
	}
} finally {
	await browser.close();
}

exit();
