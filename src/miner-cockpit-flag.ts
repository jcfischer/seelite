/**
 * Review flag for node #1143 (https://github.com/jcfischer/seelite/issues/1143):
 * `?cockpit=miner` flies the miner cockpit study in place of the courier cabin.
 * The study is served from `spikes/` by the dev server only, so a built deploy
 * ignores the flag.
 */
export const minerCockpitOn = (dev: unknown, search: string): boolean =>
	dev === true && new URLSearchParams(search).get("cockpit") === "miner";

/** The flag for this page. */
export const MINER_COCKPIT = minerCockpitOn(
	// Stryker disable next-line OptionalChaining: bun and Vite both define import.meta.env, so the chain never short-circuits under test.
	import.meta.env?.DEV,
	// Stryker disable next-line StringLiteral: with no location there is no query, and any fallback string without cockpit=miner reads the same.
	typeof location === "undefined" ? "" : location.search,
);
