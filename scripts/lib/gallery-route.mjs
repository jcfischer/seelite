const FAILED = { routeLeft: false, galleryGone: false };
const isTimeout = (error) => error?.name === "TimeoutError";

/**
 * Whether the gallery's close left the route, and whether the gallery is gone —
 * two questions, answered by two different things (#464).
 *
 * `.sg-close` calls `location.assign`, so the close is a navigation and the
 * flight page then boots. Measured at `bf38973`: the navigation commits in
 * 0.13 s on every close, stalled or clean, and the boot that follows blocks the
 * new page's main thread for six to nine seconds on about half of them. A
 * predicate evaluated *in* the page therefore answers at the first gap in that
 * boot rather than when the route clears — 5.9 to 9.1 s against a route that
 * had cleared in a seventh of a second. Forcing `polling: 100` instead of
 * `requestAnimationFrame` still stalled 8 closes in 20 — a second poller with
 * its own clock, stalling on the same boot, which is two configurations rather
 * than a proof about every possible one.
 *
 * `waitForURL` reads the driver's own navigation events rather than the page —
 * measured at 0 closes in 20 over a second where the in-page predicate stalled
 * 10 in 20, on one machine, one ref, SwiftShader, **and only at `commit`**. Its default is `load`, and
 * measured on the same twenty closes at `bf38973` that default waits out the
 * boot on every one of them, 5.5 to 6.2 s, which is worse than the in-page
 * predicate it replaced. At `commit` the same twenty read 0.053 to 0.140 s. So
 * the option is the fix and the call is not.
 *
 * The DOM half still needs the page, so it still meets that boot sometimes:
 * end to end at `bf38973` this helper is over a second on **3 closes in 40**,
 * worst 5.256 s, median 0.082 — against the in-page predicate's 10 in 20. The
 * route half's 0 in 20 is the standalone arm, so attributing all three of those
 * stalls to the DOM half is inference across arms and not a per-half timing.
 * The composite is better, it is not free, and it is bounded by the one bar the
 * two halves share. Note what it is and is not evidence
 * of: while the close navigates, a new document cannot carry the old one's
 * `#state-gallery`, so this half is satisfied by construction and not by an
 * unmount. It goes red on a close that stops navigating — measured, by making
 * `.sg-close` call `history.replaceState` instead: both viewports failed
 * `no gallery on the flight route` at 98/100 while the route half stayed green.
 * That is the regression it guards, and it is the half that knows the
 * difference.
 *
 * @param {{ waitForURL: Function, waitForSelector: Function }} page
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ routeLeft: boolean, galleryGone: boolean, error?: string }>}
 */
export async function waitForGalleryClose(page, { timeoutMs = 20_000 } = {}) {
	const deadline = Date.now() + timeoutMs;
	try {
		await page.waitForURL((url) => !url.searchParams.has("hud-gallery"), {
			timeout: timeoutMs,
			waitUntil: "commit",
		});
	} catch (error) {
		// A wait that crashed has not shown the route cleared, so the check
		// still fails — but it failed for a different reason, and `error`
		// carries it so the probe can print what happened beside the red row.
		// Carried rather than thrown: a throw here skips the second viewport's
		// checks and the tally, so the run would end with no pass/fail line.
		if (!isTimeout(error)) return { ...FAILED, error: String(error) };
		return FAILED;
	}
	const remaining = deadline - Date.now();
	if (remaining <= 0) return { routeLeft: true, galleryGone: false };
	try {
		await page.waitForSelector("#state-gallery", {
			state: "detached",
			timeout: remaining,
		});
		return { routeLeft: true, galleryGone: true };
	} catch (error) {
		const left = { routeLeft: true, galleryGone: false };
		return isTimeout(error) ? left : { ...left, error: String(error) };
	}
}
