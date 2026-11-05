/** Select the PR corpus or the original manual measurement, retaining the leg budget. */
export function cruiseDetourCorpus(args) {
	const maxSteps = 12000;
	if (args.length === 0)
		return { mode: "gate", seeds: [1, 2, 7, 17], maxSteps };
	if (args.length === 1 && args[0] === "--full")
		return {
			mode: "full",
			seeds: Array.from({ length: 20 }, (_, i) => i + 1),
			maxSteps,
		};
	const count = Number(args[0]);
	const first = Number(args[1] ?? 1);
	if (
		args.length > 2 ||
		!Number.isSafeInteger(count) ||
		count < 1 ||
		!Number.isSafeInteger(first) ||
		first < 1 ||
		!Number.isSafeInteger(first + count - 1)
	)
		throw new Error(
			"Use --full or a positive integer seed count and optional first seed",
		);
	return {
		mode: "custom",
		seeds: Array.from({ length: count }, (_, i) => first + i),
		maxSteps,
	};
}
