/**
 * The GPU timing vocabulary, and which of its members withhold a figure.
 *
 * A `.js` leaf for the same reason `frame-statistics.js` is one: it is read by
 * the browser sampler (`frame-attribution.ts`) **and** by a Node probe, and a
 * probe with its own copy of a constant goes falsely red the day the module
 * changes it. `probe-frame-attribution.mjs` had exactly that copy for a round.
 *
 * **The list is canonical and the TypeScript union is derived from it.** The
 * first version of this leaf carried a second copy of the vocabulary as a
 * JSDoc typedef beside the union in the module, with `checkJs` off so nothing
 * compared them — a seventh status would have been added to one list and not
 * the other, and `isRefusedGpuStatus` takes a `string`, so neither tier would
 * have gone red. `tests/frame-attribution.test.ts` iterates this list and
 * asserts refused ⇔ `medianMs === null` for every member.
 *
 * Imports nothing, so neither tier drags the other in.
 */

/**
 * Every status `FrameAttribution` can report, in no significant order.
 *
 * @type {readonly ["supported", "unavailable", "disjoint", "stale", "untrusted", "implausible"]}
 */
export const GPU_TIMING_STATUSES = Object.freeze([
	"supported",
	"unavailable",
	"disjoint",
	"stale",
	"untrusted",
	"implausible",
]);

/**
 * Statuses under which `medianMs` and `p95Ms` are `null` by contract.
 *
 * `disjoint` and `stale` are **not** among them: those say a sample is missing
 * or old, which is a claim about the samples. These two say the samples cannot
 * be believed, which is a claim about what they mean.
 *
 * @type {readonly ["untrusted", "implausible"]}
 */
export const REFUSED_GPU_STATUSES = Object.freeze(["untrusted", "implausible"]);

/**
 * @param {string} status
 * @returns {boolean}
 */
export const isRefusedGpuStatus = (status) =>
	REFUSED_GPU_STATUSES.includes(
		/** @type {(typeof REFUSED_GPU_STATUSES)[number]} */ (status),
	);
