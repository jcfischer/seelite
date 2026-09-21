import { describe, expect, test } from "bun:test";
import { waitForGalleryClose } from "../scripts/lib/gallery-route.mjs";

/**
 * #464. The gallery's close is a navigation, and the next page then boots. At
 * `bf38973` the navigation committed in 0.13 s on every close — stalled or
 * clean — and the boot that followed blocked the new page's main thread for six
 * to nine seconds on about half of them. The check that asked whether the route
 * had cleared asked it *of the page*, so it waited out the boot and reported a
 * route that had already cleared. Forcing an interval poll rather than
 * `requestAnimationFrame` still stalled 8 closes in 20, so no in-page poller
 * escapes it.
 *
 * So the two halves are answered by two different things, and a page too busy
 * to speak may not redden the half that does not need it.
 */
function timeoutError() {
	// Playwright names its own; the helper re-throws anything else, because a
	// closed page is not a route that failed to clear.
	const error = new Error("timeout");
	error.name = "TimeoutError";
	return error;
}

function stubPage({
	urlLeaves = true,
	galleryDetaches = true,
	pageResponds = true,
	urlAfterMs = 0,
} = {}) {
	const calls: {
		name: string;
		timeout: number;
		waitUntil?: string;
		onGallery?: boolean;
		onFlight?: boolean;
	}[] = [];
	return {
		calls,
		async waitForURL(
			predicate: (url: URL) => boolean,
			options: { timeout: number; waitUntil?: string },
		) {
			calls.push({
				name: "waitForURL",
				timeout: options.timeout,
				waitUntil: options.waitUntil,
				onGallery: predicate(
					new URL("http://seelite.test/?seed=42&hud-gallery=assist-on"),
				),
				onFlight: predicate(new URL("http://seelite.test/?seed=42")),
			});
			if (urlAfterMs)
				await new Promise((resolve) => setTimeout(resolve, urlAfterMs));
			if (!urlLeaves) throw timeoutError();
		},
		async waitForSelector(
			selector: string,
			options: { state: string; timeout: number },
		) {
			calls.push({
				name: `waitForSelector:${selector}:${options.state}`,
				timeout: options.timeout,
			});
			// A blocked main thread answers nothing; the wait ends on its bar.
			if (!pageResponds) {
				await new Promise((resolve) => setTimeout(resolve, options.timeout));
				throw timeoutError();
			}
			if (!galleryDetaches) throw timeoutError();
		},
	};
}

describe("waiting for the gallery close", () => {
	test("a page too busy to answer cannot redden the route", async () => {
		const page = stubPage({ pageResponds: false });
		expect(await waitForGalleryClose(page, { timeoutMs: 50 })).toEqual({
			routeLeft: true,
			galleryGone: false,
		});
	});

	test("the route is asked of the driver, never of the page", async () => {
		const page = stubPage();
		await waitForGalleryClose(page, { timeoutMs: 50 });
		expect(page.calls.map((call) => call.name)).toEqual([
			"waitForURL",
			"waitForSelector:#state-gallery:detached",
		]);
	});

	test("the driver waits for the commit, not for the load", async () => {
		// `waitForURL`'s default is `load`, which waits out the same boot the
		// in-page predicate did: 5.5–6.2 s on all twenty closes at `bf38973`
		// against 0.053–0.140 s at `commit`. The option is the fix.
		const page = stubPage();
		await waitForGalleryClose(page, { timeoutMs: 50 });
		expect(page.calls[0]?.waitUntil).toBe("commit");
	});

	test("the predicate holds off the gallery route and only there", async () => {
		// Without this, an inverted predicate or a mistyped parameter name reads
		// exactly like a working wait.
		const page = stubPage();
		await waitForGalleryClose(page, { timeoutMs: 50 });
		expect(page.calls[0]?.onGallery).toBe(false);
		expect(page.calls[0]?.onFlight).toBe(true);
	});

	test("a route that never clears fails both halves", async () => {
		const page = stubPage({ urlLeaves: false });
		expect(await waitForGalleryClose(page, { timeoutMs: 50 })).toEqual({
			routeLeft: false,
			galleryGone: false,
		});
	});

	test("a gallery left mounted on the flight route fails its own half only", async () => {
		const page = stubPage({ galleryDetaches: false });
		expect(await waitForGalleryClose(page, { timeoutMs: 50 })).toEqual({
			routeLeft: true,
			galleryGone: false,
		});
	});

	test("both halves share one bar rather than taking one each", async () => {
		// Two waits of the full bar would double #201's twenty seconds in silence.
		// The property is "less than the whole bar", not a particular
		// millisecond: a margin of ten would fail on a loaded machine for a
		// reason it does not name.
		const page = stubPage({ urlAfterMs: 200 });
		await waitForGalleryClose(page, { timeoutMs: 1000 });
		const second = page.calls.at(-1);
		expect(second?.name).toBe("waitForSelector:#state-gallery:detached");
		expect(second?.timeout).toBeLessThan(1000);
	});
});
