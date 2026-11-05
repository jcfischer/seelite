/** Count changed amber texels on the warning's cockpit face (node #1170). */
export function warningPaintDiff(before, after) {
	if (!before || !after || before.length !== after.length)
		return { moved: 0, amber: 0 };
	let moved = 0;
	let amber = 0;
	for (let i = 0; i < before.length; i += 4) {
		const d =
			Math.abs(after[i] - before[i]) +
			Math.abs(after[i + 1] - before[i + 1]) +
			Math.abs(after[i + 2] - before[i + 2]) +
			Math.abs(after[i + 3] - before[i + 3]);
		if (d < 24) continue;
		moved += 1;
		if (after[i] > after[i + 2] + 60 && after[i] >= after[i + 1]) amber += 1;
	}
	return { moved, amber };
}

/** Retain the shipped area floor and fourfold repeat-control margin. */
export function warningIsPainted(painted, jitter) {
	return painted.amber > Math.max(200, jitter.moved * 4);
}
