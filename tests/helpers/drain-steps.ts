/** A `run` for step generators that calls `onStep` at every yield, then resumes. */
export function drainWith(onStep: () => void | Promise<void>) {
	return async <T>(work: Generator<void, T>): Promise<T> => {
		let step = work.next();
		while (!step.done) {
			await onStep();
			step = work.next();
		}
		return step.value;
	};
}
