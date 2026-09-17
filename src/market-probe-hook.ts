import { PRICE_STEP_CR, bidCutAtTl } from "./market";

/**
 * The spread's law, put somewhere a browser probe can read it.
 *
 * #196's market check has to tell a row whose bid the *cut* removed from a row §3's
 * *price floor* had already pinned at one price step, and the two look identical on
 * the glass. A probe with its own copy of the step goes falsely red the day the
 * module moves it — the standing objection to restating a constant in a probe — so
 * the figure is read off the page instead, beside `boot` and `save`.
 *
 * It lives in its own module because **there are two entries that render a market and
 * a probe visits both**: `main.ts` for a live flight, and the `?hud-gallery=` designer
 * route, which draws a station console with no flight behind it. The first version of
 * this hook was assigned in `main.ts` alone, and `probe-station-console.mjs` — which
 * spends most of its pass on the gallery, because that is the only place a station of
 * each type can be named — read `undefined` and threw. One function called from both
 * entries is what keeps the second entry from being forgotten again.
 */
export const exposeMarketLaw = (): void => {
	if (typeof window === "undefined") return;
	// Assigned onto whatever `__seelite` already is. In the live game that object is
	// the `Game` — `main.ts` publishes it first, and `boot`, `save` and `commanderBoot`
	// ride on the same object for the same reason — and on the designer route there is
	// no game, so this starts the object. Claiming `marketLaw` was already present
	// would be a cast that asserts the thing the function exists to do.
	const host = window as unknown as { __seelite?: Record<string, unknown> };
	host.__seelite ??= {};
	host.__seelite.marketLaw = {
		priceStepCr: PRICE_STEP_CR,
		bidCutAtTl,
	};
};
