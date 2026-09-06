/**
 * Which GPU timing statuses withhold a figure rather than report one.
 *
 * A `.js` leaf for the same reason `frame-statistics.js` is one: it is read by
 * the browser sampler (`frame-attribution.ts`) **and** by a Node probe, and a
 * probe with its own copy of a constant goes falsely red the day the module
 * changes it. `probe-frame-attribution.mjs` had exactly that copy for one
 * round, and a third refused status would have reddened it.
 *
 * Imports nothing, so neither tier drags the other in.
 */

/**
 * @typedef {"supported" | "unavailable" | "disjoint" | "stale" | "untrusted"
 *   | "implausible"} GpuTimingStatus
 */

/**
 * Statuses under which `medianMs` and `p95Ms` are `null` by contract.
 *
 * `disjoint` and `stale` are **not** among them: those say a sample is missing
 * or old, which is a claim about the samples. These two say the samples cannot
 * be believed, which is a claim about what they mean.
 *
 * @type {readonly GpuTimingStatus[]}
 */
export const REFUSED_GPU_STATUSES = Object.freeze(["untrusted", "implausible"]);

/**
 * @param {string} status
 * @returns {boolean}
 */
export const isRefusedGpuStatus = (status) =>
	REFUSED_GPU_STATUSES.includes(/** @type {GpuTimingStatus} */ (status));
