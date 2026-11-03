import { readFileSync } from "node:fs";

/**
 * Which probes `probe-all` runs alone, and why (#1175).
 *
 * A member's assertions measure something a second browser on the machine
 * changes, so it runs only once the pool has drained, one at a time, with
 * nothing else running. The summary prints each member with its reason, so
 * the list is read on every run rather than only here.
 *
 * @type {Map<string, string>} probe file → why it cannot share the machine
 */
export const EXCLUSIVE = new Map([
	[
		"probe-station-interior-kit.mjs",
		"its frame-cost assertions read GPU time a second browser takes (#885)",
	],
	[
		"probe-occlusion.mjs",
		"GPU-bound: 2.9× slower beside another suite (#882 §0)",
	],
	[
		"probe-planet-surfaces.mjs",
		"its same-class repeat noise floor rises under load: red at concurrency 6, green alone (#1175)",
	],
	[
		"probe-live-cockpit.mjs",
		"the one visible-window probe: it needs the screen and the focus",
	],
]);

/**
 * Reads a `probe-all` log into each green probe's seconds.
 *
 * Only the runner's own verdict lines count; a red's seconds measure how far it
 * got, not how long it takes, so reds are left out.
 *
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function parseProbeLog(text) {
	const seconds = new Map();
	for (const line of text.split("\n")) {
		const m = /^ok +(\S+\.mjs) \((\d+(?:\.\d+)?)s\)/.exec(line);
		if (m) seconds.set(m[1], Number(m[2]));
	}
	return seconds;
}

/** Where the recorded durations live: `scripts/record-probe-durations.mjs` writes it. */
export const DURATIONS_FILE = new URL(
	"./probe-durations.json",
	import.meta.url,
);

/**
 * Each probe's seconds from the last recorded full serial run.
 *
 * @type {Map<string, number>}
 */
export const PROBE_SECONDS = new Map(
	Object.entries(JSON.parse(readFileSync(DURATIONS_FILE, "utf8")).seconds),
);

/**
 * The order to start probes in.
 *
 * Longest first, so the tail of a parallel run is short probes rather than one
 * long one that started late. A probe with no recorded duration starts before
 * every timed one, because an unknown may be the longest; ties and unknowns
 * fall back to the file name, so the plan never depends on input order.
 *
 * @param {string[]} files
 * @param {{ seconds?: Map<string, number>, exclusive?: Map<string, string> }} [options]
 * @returns {{ pooled: string[], exclusive: string[] }}
 */
export function schedule(
	files,
	{ seconds = PROBE_SECONDS, exclusive = EXCLUSIVE } = {},
) {
	const ordered = [...files].sort((a, b) => {
		const sa = seconds.get(a) ?? Number.POSITIVE_INFINITY;
		const sb = seconds.get(b) ?? Number.POSITIVE_INFINITY;
		if (sa !== sb) return sb - sa;
		return a < b ? -1 : a > b ? 1 : 0;
	});
	return {
		pooled: ordered.filter((f) => !exclusive.has(f)),
		exclusive: ordered.filter((f) => exclusive.has(f)),
	};
}

/**
 * The summary's lines for the exclusive members that ran.
 *
 * @param {string[]} files
 * @returns {string[]}
 */
export const exclusiveLines = (files) =>
	files.map((f) => `     ${f} ran alone — ${EXCLUSIVE.get(f)}`);
