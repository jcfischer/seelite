/** Integrated motion for adjoining samples of one physical cruise leg. */
export function continuityAllowanceKm(prior, route) {
	if (prior.phase === "cruise" && route.phase === "cruise") {
		if (
			!route.cruiseDisplacementKm ||
			!prior.cruiseDisplacementKm ||
			!Number.isFinite(route.cruiseStartedAtS) ||
			route.cruiseStartedAtS !== prior.cruiseStartedAtS
		)
			return 0;
		const a = prior.cruiseDisplacementKm,
			b = route.cruiseDisplacementKm;
		// Fractional display queries replay their canonical prefix, so subtract
		// independently integrated vectors rather than scalar arc lengths.
		const integratedKm = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
		return Number.isFinite(integratedKm) ? integratedKm + 0.05 : 0;
	}
	// Terminal traversal and moving-station motion retain the existing
	// endpoint-velocity gate, including transitions out of cruise.
	const speed = (v) => Math.hypot(v.x, v.y, v.z);
	return Math.max(0.05, (speed(prior.vel) + speed(route.vel)) * 0.1);
}

/** Catch sideways and backwards rewrites as well as excess distance. */
export function cruiseContinuityResidualKm(prior, route) {
	if (prior.phase !== "cruise" || route.phase !== "cruise") return 0;
	if (continuityAllowanceKm(prior, route) === 0) return Infinity;
	const a = prior.cruiseDisplacementKm,
		b = route.cruiseDisplacementKm;
	return Math.hypot(
		route.pos.x - prior.pos.x - (b.x - a.x),
		route.pos.y - prior.pos.y - (b.y - a.y),
		route.pos.z - prior.pos.z - (b.z - a.z),
	);
}
