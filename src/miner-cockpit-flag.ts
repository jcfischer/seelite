/**
 * Review flag for node #1143 (https://github.com/jcfischer/seelite/issues/1143):
 * `?cockpit=miner` flies the miner cockpit study in place of the courier cabin.
 * The study is served from `spikes/` by the dev server only, so a built deploy
 * ignores the flag.
 */
export const MINER_COCKPIT =
	import.meta.env?.DEV === true &&
	typeof location !== "undefined" &&
	new URLSearchParams(location.search).get("cockpit") === "miner";
