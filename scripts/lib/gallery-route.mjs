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
 * `requestAnimationFrame` still stalled 8 closes in 20, so this is not a rAF
 * quirk and no in-page poller escapes it.
 *
 * `waitForURL` reads the driver's own navigation events, which a busy main
 * thread cannot delay — **but only at `commit`**. Its default is `load`, and
 * measured on the same twenty closes at `bf38973` that default waits out the
 * boot on every one of them, 5.5 to 6.2 s, which is worse than the in-page
 * predicate it replaced. At `commit` the same twenty read 0.053 to 0.140 s. So
 * the option is the fix and the call is not.
 *
 * The DOM half still needs the page — a gallery left mounted on the flight
 * route is a real failure and only the page can report it — so it is still paid
 * for at the boot's price, bounded by the one bar it shares. What it no longer
 * does is redden the route.
 *
 * @param {{ waitForURL: Function, waitForSelector: Function }} page
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ routeLeft: boolean, galleryGone: boolean }>}
 */
export async function waitForGalleryClose(page, { timeoutMs = 20_000 } = {}) {
	const deadline = Date.now() + timeoutMs;
	try {
		await page.waitForURL((url) => !url.searchParams.has("hud-gallery"), {
			timeout: timeoutMs,
			waitUntil: "commit",
		});
	} catch {
		return { routeLeft: false, galleryGone: false };
	}
	const remaining = deadline - Date.now();
	if (remaining <= 0) return { routeLeft: true, galleryGone: false };
	try {
		await page.waitForSelector("#state-gallery", {
			state: "detached",
			timeout: remaining,
		});
		return { routeLeft: true, galleryGone: true };
	} catch {
		return { routeLeft: true, galleryGone: false };
	}
}
