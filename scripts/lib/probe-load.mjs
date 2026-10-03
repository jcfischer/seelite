/**
 * The machine load a probe ran under (#84).
 *
 * A browser probe measures frames, so a machine busy with something else — a
 * second suite, a `sage review`, a test run, a dev server left over from a
 * killed run — turns into reds that read like defects. #84 chose to **report**
 * load rather than gate on it: no threshold has been measured, and the macOS
 * load average is a one-minute mean, so a gate on it would refuse late and
 * forgive late. A figure printed beside the red needs neither.
 *
 * The figure is the one-minute load average from `os.loadavg()`, sampled on a
 * timer, and a window's peak includes the last sample taken **before** it
 * opened: a one-minute mean read at the window's start is the load the probe
 * started under, and without it a probe shorter than the sampling period would
 * have no figure at all. The end of a window is sampled as it is read.
 */
import { loadavg } from "node:os";

/** How soon after a window closes a fresh sample still speaks for it. */
const FRESH_MS = 1_000;

/**
 * @param {{
 *   everyMs?: number,
 *   now?: () => number,
 *   read?: () => number | null,
 * }} [options] `everyMs: 0` takes no timed samples, for a test that drives
 *   `sample()` itself.
 */
export function loadSampler({
	everyMs = 5_000,
	now = Date.now,
	read = () => loadavg()[0],
} = {}) {
	/** @type {{ t: number, load: number }[]} */
	const samples = [];
	/** Take a sample; the one taken, or null if nothing could be read. */
	const sample = () => {
		const load = read();
		if (typeof load !== "number" || !Number.isFinite(load)) return null;
		const s = { t: now(), load };
		samples.push(s);
		return s;
	};
	const timer = everyMs > 0 ? setInterval(sample, everyMs) : null;
	// a sampler must never be what keeps a finished run alive
	timer?.unref?.();
	if (everyMs > 0) sample();

	/** @param {{ load: number }[]} list */
	const max = (list) =>
		list.length ? Math.max(...list.map((s) => s.load)) : null;

	return {
		sample,
		/**
		 * The peak from the last sample before `t0` to a fresh one taken now,
		 * when the window closed within `FRESH_MS`. The fresh one is counted by
		 * reference, not by its stamp: a window is read a few milliseconds after
		 * it closes, so a stamp test would drop the very sample taken for it. A
		 * window read later than that gets no fresh sample, because the load now
		 * says nothing about it.
		 */
		peakBetween(/** @type {number} */ t0, /** @type {number} */ t1) {
			const late = now() - t1;
			const fresh = late >= 0 && late <= FRESH_MS ? sample() : null;
			const before = samples.filter((s) => s.t < t0).at(-1);
			const inside = samples.filter((s) => s.t >= t0 && s.t <= t1);
			if (fresh && !inside.includes(fresh)) inside.push(fresh);
			return max(before ? [before, ...inside] : inside);
		},
		/** The largest sample of the whole run. */
		peak() {
			return max(samples);
		},
		stop() {
			if (timer) clearInterval(timer);
		},
	};
}
