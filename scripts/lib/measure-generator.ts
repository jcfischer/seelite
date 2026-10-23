/** Drain synchronous work, timing every next call including completion. */
export function measureGenerator<T>(
	work: Generator<void, T>,
	now: () => number = () => performance.now(),
): { value: T; steps: number; worstStepMs: number; ms: number } {
	const started = now();
	let worstStepMs = 0;
	let steps = 0;
	for (;;) {
		const before = now();
		const step = work.next();
		worstStepMs = Math.max(worstStepMs, now() - before);
		if (step.done)
			return { value: step.value, steps, worstStepMs, ms: now() - started };
		steps++;
	}
}
