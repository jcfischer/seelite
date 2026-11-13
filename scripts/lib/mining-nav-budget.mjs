/**
 * https://github.com/jcfischer/seelite/issues/1234 — the Navigation list's frame
 * budget on the populated charted cockpit path, against the paired runs beside
 * it.
 *
 * The budget is the principal's ruling of 2026-11-13 (via #1242): on that path
 * with `?mining=1` the whole frame stays at or under 16.7 ms, paint included,
 * measured on the quiet hardware GPU lane against a paired run of the same path
 * with the flag off. Interaction latency was not ruled on and is reported
 * beside the table.
 *
 * **The whole-frame figure is the interval between `requestAnimationFrame`
 * callbacks with the display's pacing left on**, which is the only view that
 * carries paint and compositing: a frame that fits is presented on the next
 * refresh, and one that does not is presented late or skipped. So a run is
 * judged on two things, not one — its median interval, and the share of
 * intervals that ran past `LATE_FRAME_MS`, which is what a budget overrun
 * looks like from inside the loop. A median alone cannot decide it: on a fast
 * panel half the frames can sit exactly on two refreshes of 8.3 ms and read
 * 16.7 ms while the other half are dropped.
 *
 * **The late share is pooled, never a median of the blocks.** A run whose six
 * equal blocks read `0, 0, 0, 0, 50%, 50%, 50%` dropped one interval in five;
 * the median of those shares is 0% and would certify it. The verdict is about
 * the frames that were actually sampled, so it counts them: every block
 * records how many intervals it read and how many of them ran past
 * `LATE_FRAME_MS`, and the share is the sum of the first over the sum of the
 * second. The control's guard reads the same pooled figure, because a control
 * that dropped a seventh of its frames cannot attribute anything either.
 *
 * Kept here rather than in the instrument so a headless test can watch the
 * refusals fire: an arm with no readings, a reading that is not a cost, a
 * missing arm, a late count that is not a count or exceeds its own frame
 * count, and a budget comparison that has to say which side of 16.7 ms the
 * figure lands on.
 */
import { median, separation } from "./measurement.mjs";

/** The principal's budget, in milliseconds of whole frame. */
export const NAV_FRAME_BUDGET_MS = 16.7;

/**
 * A frame is late when its interval is past one and a half budgets.
 *
 * `1.5 × 16.7` rather than `16.7` itself because a display can only present on
 * its own refresh: on a 120 Hz panel the frame that exactly meets the budget
 * reads 16.7 ms and jitters either side of it, and calling that late would
 * report the budget as blown by a frame that was presented on time.
 */
export const LATE_FRAME_MS = 25;

/** The share of frames a run may miss and still be holding the budget. */
export const LATE_SHARE_TOLERANCE = 0.01;

/** The arms, in the order the receipt prints them. */
export const NAV_ARMS = Object.freeze([
	"nav-mining",
	"nav-off",
	"forward-mining",
]);

/** The meters every arm carries, each one a per-frame cost. */
export const NAV_METERS = Object.freeze([
	"period",
	"task",
	"script",
	"style",
	"layout",
]);

/** The arm that carries no Navigation list and so no list cost to attribute. */
export const NAV_CONTROL = "forward-mining";

function assertArm(raw, arm) {
	const blocks = raw?.[arm];
	if (!blocks) throw new Error(`missing arm: ${arm}`);
	for (const meter of NAV_METERS) {
		const xs = blocks[meter];
		if (!Array.isArray(xs) || xs.length === 0)
			throw new Error(`no ${meter} readings in arm ${arm}`);
		for (const ms of xs)
			if (!Number.isFinite(ms) || ms < 0 || (meter === "period" && ms === 0))
				throw new Error(`invalid ${meter} reading in arm ${arm}: ${ms}`);
	}
	const late = blocks.late;
	const frames = blocks.frames;
	if (!Array.isArray(late) || late.length !== blocks.period.length)
		throw new Error(`no late-frame count per block in arm ${arm}`);
	if (!Array.isArray(frames) || frames.length !== blocks.period.length)
		throw new Error(`no sampled-frame count per block in arm ${arm}`);
	for (let i = 0; i < late.length; i++) {
		const count = late[i];
		if (!Number.isSafeInteger(count) || count < 0)
			throw new Error(`invalid late-frame count in arm ${arm}: ${count}`);
		const sampled = frames[i];
		if (!Number.isSafeInteger(sampled) || sampled < 1)
			throw new Error(`invalid sampled-frame count in arm ${arm}: ${sampled}`);
		if (count > sampled)
			throw new Error(
				`more late frames than frames in arm ${arm}: ${count} of ${sampled}`,
			);
	}
	return blocks;
}

/**
 * The share of a run's sampled frames that were late, over all of them.
 *
 * Summed over blocks rather than averaged over blocks, so a long block cannot
 * be outvoted by a short one, and a single late block cannot be hidden behind
 * a majority of quiet ones.
 */
export function lateShareOf(blocks) {
	let late = 0;
	let frames = 0;
	for (let i = 0; i < blocks.late.length; i++) {
		late += blocks.late[i];
		frames += blocks.frames[i];
	}
	return { lateShare: late / frames, lateFrames: late, frames };
}

function compare(a, b, meter) {
	const mine = median(a[meter]);
	const theirs = median(b[meter]);
	return {
		a: mine,
		b: theirs,
		addedMs: mine - theirs,
		separation: separation(a[meter], b[meter]),
	};
}

/**
 * The table, the paired deltas and the budget verdict.
 *
 * The verdict is read off `nav-mining`, because that is the arm the ruling
 * names. **Exactly at the budget passes**: the ruling says "at or under
 * 16.7 ms". A run that holds the median but drops frames does not pass.
 */
export function summarizeMiningNavBudget(raw) {
	const arms = Object.fromEntries(
		NAV_ARMS.map((arm) => [arm, assertArm(raw, arm)]),
	);
	const counts = new Set(NAV_ARMS.map((arm) => arms[arm].period.length));
	if (counts.size !== 1)
		throw new Error(
			`arms have unequal block counts: ${NAV_ARMS.map(
				(arm) => `${arm}=${arms[arm].period.length}`,
			).join(", ")}`,
		);
	const rows = NAV_ARMS.map((arm) => ({
		arm,
		blocks: arms[arm].period.length,
		...Object.fromEntries(
			NAV_METERS.map((meter) => [meter, median(arms[arm][meter])]),
		),
		...lateShareOf(arms[arm]),
	}));
	const nav = arms["nav-mining"];
	const off = arms["nav-off"];
	const control = arms[NAV_CONTROL];
	const wholeFrameMs = median(nav.period);
	const { lateShare, lateFrames, frames } = lateShareOf(nav);
	const overMs = wholeFrameMs - NAV_FRAME_BUDGET_MS;
	const onTime = wholeFrameMs <= NAV_FRAME_BUDGET_MS;
	const holding = lateShare <= LATE_SHARE_TOLERANCE;
	const withinBudget = onTime && holding;
	return {
		budgetMs: NAV_FRAME_BUDGET_MS,
		lateFrameMs: LATE_FRAME_MS,
		lateShareTolerance: LATE_SHARE_TOLERANCE,
		rows,
		control: { arm: NAV_CONTROL, ...lateShareOf(control) },
		added: {
			overOff: Object.fromEntries(
				NAV_METERS.map((meter) => [meter, compare(nav, off, meter)]),
			),
			overControl: Object.fromEntries(
				NAV_METERS.map((meter) => [meter, compare(nav, control, meter)]),
			),
		},
		verdict: {
			wholeFrameMs,
			lateShare,
			lateFrames,
			frames,
			withinBudget,
			headroomMs: Math.max(0, -overMs),
			overMs: Math.max(0, overMs),
			line: withinBudget
				? `within the ${NAV_FRAME_BUDGET_MS} ms budget by ${(-overMs).toFixed(2)} ms, ${(lateShare * 100).toFixed(1)}% of frames late`
				: onTime
					? `at the ${NAV_FRAME_BUDGET_MS} ms budget, but ${(lateShare * 100).toFixed(1)}% of frames late`
					: `over the ${NAV_FRAME_BUDGET_MS} ms budget by ${overMs.toFixed(2)} ms, ${(lateShare * 100).toFixed(1)}% of frames late`,
		},
	};
}

/**
 * Refuse a run whose control did not hold the frame.
 *
 * The control is the same flight with the head forward, so no list is built
 * and nothing the Navigation tab does is on screen. If *it* drops frames then
 * the machine or the scene was missing the budget, and the Navigation list
 * cannot be named as the cause of anything measured against it.
 */
export function assertControlHeld(summary) {
	if (summary.control.lateShare > LATE_SHARE_TOLERANCE)
		throw new Error(
			`the ${summary.control.arm} control dropped ${(summary.control.lateShare * 100).toFixed(1)}% of its frames, so this run cannot attribute the Navigation list's cost`,
		);
	return summary;
}
