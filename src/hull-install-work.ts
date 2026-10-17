import { nextInteriorFrame, runInteriorSlices } from "./interior-install";

/** The interior install's four-ms scheduler, shared by hull preparation.
 * Each geometry/ray operation is indivisible; the budget is checked between
 * them. Headless tools drain the same work without waiting for a browser.
 */
export async function runHullSlices<T>(work: Generator<void, T>): Promise<T> {
	return (await runInteriorSlices(work, {
		yieldFrame:
			typeof document === "undefined"
				? () => Promise.resolve()
				: nextInteriorFrame,
	})) as T;
}

/** Synchronous consumers retain exactly the same geometry calculations. */
export function finishHullWork<T>(work: Generator<void, T>): T {
	let step = work.next();
	while (!step.done) step = work.next();
	return step.value;
}
