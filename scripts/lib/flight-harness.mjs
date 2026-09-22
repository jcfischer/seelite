/**
 * Hold a key and read how far the nose turned — the one copy (#381 S4).
 *
 * `probe-rebind.mjs` wrote this and `probe-binding-store.mjs` copied it, which
 * S3 recorded as a debt binding on this slice: the capture modal's browser
 * rows are the third copy, and a third copy is what should pay for the
 * extraction rather than a second.
 *
 * **Why it was declined twice before that.** No headless gate executes these
 * scripts — `npm test` does not load `scripts/`, and `tsc` parses `.mjs`
 * without checking it — so an extraction here is believed on a probe run and
 * on nothing else. This repo has twice had a share-out of a probe silently
 * delete an adjacent fix. Both copies' comments are carried below for that
 * reason, and the two figures that differ between them are named where they
 * differ rather than averaged into one.
 *
 * ## What it measures
 *
 * The angle the nose turns through while a key is held, in degrees, off
 * `__seelite.nose()`. The caller supplies the arms; this supplies the state
 * each arm starts from, which is the thing an angle measurement owes.
 */

/** The angle between two unit noses, in degrees. */
export const degreesBetween = (a, b) => {
	const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
	return (Math.acos(dot) * 180) / Math.PI;
};

/** How long a key is held, and how long the null arm waits. */
export const HOLD_MS = 400;

/**
 * The key a rebind moves onto, when a probe needs one nothing else claims.
 *
 * `8` on purpose: the shipped layout binds `0` through `3` in the digit row
 * and nothing else, so it is a key with no row at all. A key that merely
 * *looked* free — one the perf panel owns, say — would make a pass ambiguous
 * between the rebind working and the other binding firing.
 */
export const NEW_KEY = "8";

/**
 * The harness for one page.
 *
 * A factory rather than free functions because `restFailed` is state: it
 * shortens later waits once a build's damping has been shown to be broken,
 * and two probes sharing one module-level flag would let the first to run
 * shorten the second's.
 */
export function flightHarness(page) {
	const nose = () => page.evaluate(() => window.__seelite.nose());

	const settle = () =>
		page.evaluate(
			() =>
				new Promise((done) =>
					requestAnimationFrame(() => requestAnimationFrame(done)),
				),
		);

	let restFailed = false;

	/**
	 * Wait until the ship has stopped turning.
	 *
	 * Without this every arm reads the arm before it. A released pitch key
	 * leaves the ship rotating — `stepAngular` damps it over a second or so —
	 * and the first pass of `probe-rebind.mjs` read 8.70° for a key that had
	 * just been unbound, which is a confident red on a build that was working.
	 * An arm that measures an angle owes the state it started from.
	 *
	 * **Shorter once it has already failed.** Nine arms at ten seconds each is
	 * ninety seconds of waiting on a build whose damping broke — long enough
	 * to hit a harness timeout, which is the outcome the reported row exists
	 * to avoid. The first exhaustion is the diagnosis; the rest just have to
	 * finish so the row can print.
	 *
	 * **Reported, not thrown.** A throw at top level in a probe aborts before
	 * `browser.close()` and `exit()`, so a build whose damping broke would
	 * crash the suite rather than name a failing row. `restFailed` is the one
	 * signal: a return value beside it was a second channel nobody read.
	 */
	async function atRest() {
		// One read per tick: the sample that ends this iteration begins the next.
		let prev = await nose();
		const ticks = restFailed ? 40 : 200;
		for (let i = 0; i < ticks; i++) {
			// **The wait comes first, and moving it broke the gate.** A review
			// round suggested sampling before waiting, to save 50 ms on a ship
			// already still. Applied, `prev` and `now` are read back-to-back
			// with nothing between them, they agree by construction, and this
			// returns on the first iteration every time: the next arm read a
			// residual of 10.41° against a floor of 0.16°, and four rows went
			// red at once. The 50 ms is what makes the comparison a comparison
			// (sage round 6 on #486).
			await page.waitForTimeout(50);
			const now = await nose();
			if (degreesBetween(prev, now) < 0.02) return;
			prev = now;
		}
		restFailed = true;
	}

	/**
	 * Hold `key` for `HOLD_MS` and report how far the nose turned. `null`
	 * holds nothing, which is the drift arm.
	 *
	 * **That arm is a residual and not a control**, and it was sold as one for
	 * a round. `atRest` returns only once two samples 50 ms apart agree to
	 * within 0.02° — under 0.4°/s — so a 400 ms wait after it cannot turn much
	 * more than 0.16° whatever the build does. It reports what the rest gate
	 * leaves rather than measuring what the ship does.
	 */
	async function turnedWhileHolding(key) {
		await atRest();
		const before = await nose();
		if (key !== null) await page.keyboard.down(key);
		await page.waitForTimeout(HOLD_MS);
		if (key !== null) await page.keyboard.up(key);
		await settle();
		return degreesBetween(before, await nose());
	}

	return {
		nose,
		settle,
		atRest,
		turnedWhileHolding,
		/** Whether any arm ran its rest gate out. Every caller reports it. */
		restFailed: () => restFailed,
	};
}
