import { median, separation } from "./measurement.mjs";

export function summarizeStationRockCost(quality, times) {
	if (quality !== "high" && quality !== "low")
		throw new Error(`unknown quality: ${quality}`);
	for (const arm of ["field", "none"])
		if (
			!Array.isArray(times[arm]) ||
			times[arm].length === 0 ||
			times[arm].some((ms) => !Number.isFinite(ms) || ms <= 0)
		)
			throw new Error(`invalid timing blocks: ${arm}`);
	if (times.field.length !== times.none.length)
		throw new Error("unpaired timing blocks");
	const addedFrameMs = median(times.field) - median(times.none);
	const budgetMs = quality === "high" ? 1 : 0.4;
	const gapMs = Math.max(0, addedFrameMs - budgetMs);
	return {
		addedFrameMs,
		budgetMs,
		gapMs,
		separation: separation(times.field, times.none),
		verdict:
			gapMs > 0
				? "over budget; principal acceptance required"
				: "within budget on this run",
	};
}
