/** A background install gets at most four milliseconds between yield points.
 * A task after rAF lets the game's frame paint before the next slice starts.
 * No hidden-page rAF wait: postcards can finish in a background tab too.
 * Station interiors and authored hulls both slice their preparation here.
 */
export const INSTALL_SLICE_MS = 4;
export function nextInstallFrame(): Promise<void> {
	return new Promise((resolve) => {
		if (document.hidden) setTimeout(resolve, 0);
		else requestAnimationFrame(() => setTimeout(resolve, 0));
	});
}
export interface InstallSliceOptions {
	budgetMs?: number;
	now?: () => number;
	yieldFrame?: () => Promise<void>;
}
/** Without `live` the work always runs to its result. */
export function runInstallSlices<T>(
	work: Generator<void, T>,
	options?: InstallSliceOptions,
): Promise<T>;
/** With `live` the work is abandoned, and yields undefined, once it is false. */
export function runInstallSlices<T>(
	work: Generator<void, T>,
	options: InstallSliceOptions & { live: () => boolean },
): Promise<T | undefined>;
export async function runInstallSlices<T>(
	work: Generator<void, T>,
	{
		budgetMs = INSTALL_SLICE_MS,
		now = () => performance.now(),
		yieldFrame = nextInstallFrame,
		live = () => true,
	}: InstallSliceOptions & { live?: () => boolean } = {},
): Promise<T | undefined> {
	try {
		while (live()) {
			const start = now();
			do {
				const step = work.next();
				if (step.done) return step.value;
			} while (live() && now() - start < budgetMs);
			if (!live()) break;
			await yieldFrame();
		}
		return undefined;
	} finally {
		work.return(undefined as T);
	}
}
