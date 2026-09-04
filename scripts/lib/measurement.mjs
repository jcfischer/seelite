/**
 * The statistics a frame-cost instrument needs, in one place.
 *
 * Extracted in #201, when a second instrument was written to the design
 * `measure-light-cost.mjs` arrived at — and arrived at by getting it wrong
 * several times, which is exactly why the two must not drift. Each function
 * below carries the failure it was shaped by, because a copy without the
 * argument is a copy that will be simplified back into the bug.
 */

/** The middle block, which is what an instrument reports. A mean lets one
 *  interrupted block — the machine doing something else for 300 ms — carry a
 *  row that twelve good blocks agree about. */
export function median(xs) {
	const sorted = [...xs].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Of every (a, b) pairing, how often a is slower — the Mann-Whitney count.
 *
 * A difference of two medians the size of the blocks' own spread says nothing
 * on its own, and this is the statistic that does not need a reader to eyeball
 * two rows: it assumes nothing about either distribution's shape, and one
 * outlier can move it by at most a block's worth.
 *
 * **It replaced "how many clear the worst"**, which is dominated by a single
 * block: one slow block in the quiet arm dropped that count from 10/12 to 4/12
 * between two runs of one build while the medians barely moved.
 */
export function separation(a, b) {
	let slower = 0;
	for (const x of a) for (const y of b) if (x > y) slower++;
	const pairs = a.length * b.length;
	return `${slower}/${pairs} (${((slower / pairs) * 100).toFixed(0)}%)`;
}

/**
 * A seeded shuffler, and the seed is printed by every caller.
 *
 * **Arms must not run in a fixed order.** `measure-light-cost.mjs` ran 0, 2, 4
 * then dither-on, dither-off twelve times over, so a thermal drift *inside* a
 * round was perfectly confounded with the arm — the last arm always ran on a
 * hotter machine than the first. It reported the dither at 0.12–0.14 ms with
 * **144/144** pairings separated; shuffling dropped the same term to −0.002 and
 * +0.066 ms at 61/144 and 101/144, which is a coin toss and a lean.
 *
 * Shuffling breaks the correlation without changing the pairing statistics
 * above, which assume nothing about order. Seeded so a suspicious run can be
 * repeated exactly.
 */
export function seededShuffler(seed) {
	let state = seed >>> 0;
	const next = () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 4294967296;
	};
	return (xs) => {
		const out = [...xs];
		for (let i = out.length - 1; i > 0; i--) {
			const j = Math.floor(next() * (i + 1));
			[out[i], out[j]] = [out[j], out[i]];
		}
		return out;
	};
}
