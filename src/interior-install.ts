/** Interior assembly gets at most four milliseconds between yield points.
 * A task after rAF lets the game's frame paint before the next slice starts.
 * No hidden-page rAF wait: postcards can finish in a background tab too.
 */
export const INTERIOR_SLICE_MS = 4;
export function nextInteriorFrame(): Promise<void> {
	return new Promise((resolve) => {
		if (document.hidden) setTimeout(resolve, 0);
		else requestAnimationFrame(() => setTimeout(resolve, 0));
	});
}
export async function runInteriorSlices<T>(
	work: Generator<void, T>,
	{
		budgetMs = INTERIOR_SLICE_MS,
		now = () => performance.now(),
		yieldFrame = nextInteriorFrame,
		live = () => true,
	}: {
		budgetMs?: number;
		now?: () => number;
		yieldFrame?: () => Promise<void>;
		live?: () => boolean;
	} = {},
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
