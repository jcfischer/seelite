/** Prediction must come from the frozen previous canonical state and endpoint,
 * never the current replay's position or cumulative displacement. */
function validPrediction(prior, route, predicted) {
	return (
		predicted &&
		Number.isFinite(prior.cruiseStartedAtS) &&
		route.cruiseStartedAtS === prior.cruiseStartedAtS &&
		predicted.startedAtS === prior.cruiseStartedAtS &&
		[predicted.pos, prior.pos, route.pos].every(
			(p) => p && [p.x, p.y, p.z].every(Number.isFinite),
		)
	);
}
export function continuityAllowanceKm(prior, route, predicted) {
	if (prior.phase === "cruise" && route.phase === "cruise") {
		if (!validPrediction(prior, route, predicted)) return 0;
		const km = Math.hypot(
			predicted.pos.x - prior.pos.x,
			predicted.pos.y - prior.pos.y,
			predicted.pos.z - prior.pos.z,
		);
		return Number.isFinite(km) ? km + 0.05 : 0;
	}
	const speed = (v) => Math.hypot(v.x, v.y, v.z);
	return Math.max(0.05, (speed(prior.vel) + speed(route.vel)) * 0.1);
}
/** Includes sideways/backwards rewrites even when their distance is plausible. */
export function cruiseContinuityResidualKm(prior, route, predicted) {
	if (prior.phase !== "cruise" || route.phase !== "cruise") return 0;
	if (!validPrediction(prior, route, predicted)) return Infinity;
	return Math.hypot(
		route.pos.x - predicted.pos.x,
		route.pos.y - predicted.pos.y,
		route.pos.z - predicted.pos.z,
	);
}
