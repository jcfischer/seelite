/**
 * Driving the game's own loop from a probe, and waiting on it.
 *
 * Headless Chromium throttles `requestAnimationFrame` to roughly two frames a
 * second whatever the scene contains, so a probe that waits on wall time waits
 * on the harness rather than on the simulation. Both helpers here run the real
 * rAF loop instead — the game's frame, not a clock the probe made up.
 *
 * **What this does not deduplicate.** Ten probes in `scripts/` define a local
 * `pump`; two — `probe-demolish` and `probe-build-costs` — also had a
 * `pumpUntil`, written twice with the same defaults, and those two are what
 * moved here (#186). The other eight keep their copies. Migrating them is a
 * sweep with a re-run of the whole suite behind it and no failing case pushing
 * it, which is a different piece of work from this one; saying so is cheaper
 * than a comment claiming the duplication is gone.
 */

/**
 * Build the pair for one page.
 *
 * A factory rather than two functions taking `page`, so a probe writes
 * `const { pump, pumpUntil } = makePump(page)` once and its call sites read the
 * way the local copies did.
 */
export function makePump(page) {
	/** Drive the loop for `ms` of wall time. The renderer is usually stubbed by
	 *  the caller first; this only turns frames. */
	const pump = (ms) =>
		page.evaluate(async (ms) => {
			const t0 = performance.now();
			while (performance.now() - t0 < ms)
				await new Promise((r) => requestAnimationFrame(r));
		}, ms);

	/**
	 * Pump until `done()` reports true, or `cap` ms have passed. Returns whether
	 * it finished, so a caller can `die()` on a board that never reached the
	 * state rather than assert against one.
	 *
	 * Bounded rather than fixed, and `probe-demolish` records why: how long a
	 * dismantle takes depends on how far the crew has to walk to it, which moves
	 * run to run. A bounded wait tests "it finishes", which is the claim; a
	 * duration is reported separately and deliberately not asserted to a number.
	 */
	const pumpUntil = async (done, cap = 40000, step = 2000) => {
		const t0 = Date.now();
		while (Date.now() - t0 < cap) {
			await pump(step);
			if (await done()) return true;
		}
		return false;
	};

	return { pump, pumpUntil };
}
