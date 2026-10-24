import { nextInstallFrame, runInstallSlices } from "./install-slices";

/** The shared four-ms install scheduler, applied to hull preparation.
 * Each geometry/ray operation is indivisible; the budget is checked between
 * them. Headless tools drain the same work without waiting for a browser.
 */
export function runHullSlices<T>(work: Generator<void, T>): Promise<T> {
	return runInstallSlices(work, {
		yieldFrame:
			typeof document === "undefined"
				? () => Promise.resolve()
				: nextInstallFrame,
	});
}

/** Synchronous consumers retain exactly the same geometry calculations. */
export function finishHullWork<T>(work: Generator<void, T>): T {
	let step = work.next();
	while (!step.done) step = work.next();
	return step.value;
}
