/**
 * Node #754's tangent framing and camera readback. This factory has no imports:
 * the same source is installed in the page and exercised headlessly. Measurement
 * takes the actual camera, never the requested limb fraction or sun elevation.
 * The limb is the solid sphere's tangent at the frame's horizontal centre;
 * the atmosphere above it is deliberately not treated as the surface radius.
 */
/** @typedef {{x: number, y: number, z: number}} Point */
/** Set the complete camera basis, including a half-turn about forward. */
export function setHorizonOrientation(orientation, matrix, forward, up) {
	const right = forward.clone().cross(up).normalize();
	orientation.setFromRotationMatrix(
		matrix.makeBasis(right, up, forward.clone().negate()),
	);
}

export function horizonGeometry() {
	const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
	const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
	const sub = (a, b) => add(a, scale(b, -1));
	const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
	const length = (a) => Math.hypot(a.x, a.y, a.z);
	const norm = (a) => {
		const l = length(a);
		if (!(l > 0)) throw new Error("horizon: degenerate direction");
		return scale(a, 1 / l);
	};
	const cross = (a, b) => ({
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x,
	});
	const rad = Math.PI / 180;
	const aimDepression = (radius, distance, fov) =>
		Math.acos(radius / distance) + Math.atan(0.36 * Math.tan((fov * rad) / 2));
	const lowSunAzimuth = (u, sunUnit, theta, radius, sunDistance) => {
		// Surface normal dot star-centre direction for a ten-degree elevation,
		// including the surface's offset toward the finite star.
		const k = Math.sin(10 * rad);
		const ratio = radius / sunDistance;
		const targetDot =
			ratio * (1 - k * k) + k * Math.sqrt(1 - ratio * ratio * (1 - k * k));
		const us = dot(u, sunUnit);
		const azimuthCos =
			(targetDot - Math.cos(theta) * us) /
			(Math.sin(theta) * Math.sqrt(1 - us * us));
		if (Math.abs(azimuthCos) > 1)
			throw new Error("horizon: low sun cannot be framed from this anchor");
		const e = norm(sub(sunUnit, scale(u, us)));
		return add(
			scale(e, azimuthCos),
			scale(cross(u, e), Math.sqrt(1 - azimuthCos * azimuthCos)),
		);
	};
	const intersection = (p, f, radius) => {
		const b = dot(p, f);
		const disc = b * b - dot(p, p) + radius * radius;
		if (disc < 0) return null;
		const t = -b - Math.sqrt(disc);
		return t > 0 ? add(p, scale(f, t)) : null;
	};
	/**
	 * @param {{centre: Point, radius: number, anchor: Point, sun: Point, radii?: number, standoffKm?: number, fov: number}} input
	 * @returns {{camera: Point, forward: Point, up: Point}}
	 */
	const plan = ({
		centre,
		radius,
		anchor,
		sun,
		radii,
		standoffKm = 4.8,
		fov,
	}) => {
		const radial = norm(sub(anchor, centre));
		let camera =
			radii === undefined
				? { ...anchor }
				: add(centre, scale(radial, radius * radii));
		let forward, up;
		for (let i = 0; i < 8; i++) {
			const rel = sub(camera, centre);
			const distance = length(rel);
			if (!(distance > radius))
				throw new Error("horizon: camera must be outside the surface");
			const u = norm(rel);
			const s = sub(sun, centre);
			const sunDistance = length(s);
			const sunUnit = norm(s);
			// Aim below the tangent by the angle projecting it to 32% from the top.
			const depression = aimDepression(radius, distance, fov);
			const theta =
				Math.asin((distance / radius) * Math.cos(depression)) -
				(Math.PI / 2 - depression);
			const t = lowSunAzimuth(u, sunUnit, theta, radius, sunDistance);
			forward = add(
				scale(u, -Math.sin(depression)),
				scale(t, Math.cos(depression)),
			);
			up = add(scale(u, Math.cos(depression)), scale(t, Math.sin(depression)));
			if (radii === undefined) camera = sub(anchor, scale(forward, standoffKm));
		}
		return { camera, forward, up };
	};
	/** @param {{centre: Point, radius: number, camera: Point, forward: Point, up: Point, sun: Point, fov: number, aspect: number, station?: Point, stationRadius?: number}} input */
	const measure = ({
		centre,
		radius,
		camera,
		forward,
		up,
		sun,
		fov,
		aspect,
		station = undefined,
		stationRadius = 0,
	}) => {
		const p = sub(camera, centre);
		const c = dot(p, p) - radius * radius;
		const pf = dot(p, forward),
			pu = dot(p, up);
		const a = pu * pu - c,
			b = 2 * pf * pu,
			d = pf * pf - c;
		const discriminant = b * b - 4 * a * d;
		const roots =
			discriminant < 0
				? []
				: Math.abs(a) < 1e-10
					? [-d / b]
					: [
							(-b + Math.sqrt(discriminant)) / (2 * a),
							(-b - Math.sqrt(discriminant)) / (2 * a),
						];
		const visible = roots.filter((q) => Number.isFinite(q) && pf + q * pu < 0);
		const tan = Math.tan((fov * rad) / 2);
		const limbFraction = visible.length
			? (1 - Math.max(...visible) / tan) / 2
			: null;
		const hit = intersection(p, forward, radius);
		const sunElevationDeg = hit
			? Math.asin(dot(norm(hit), norm(sub(sun, add(centre, hit))))) / rad
			: null;
		let stationInFrame = null,
			stationRangeKm = null,
			stationIntersectsFrame = null;
		if (station) {
			const rel = sub(station, camera);
			stationRangeKm = length(rel);
			const right = cross(forward, up);
			const z = dot(rel, forward),
				x = dot(rel, right),
				y = dot(rel, up);
			const tx = tan * aspect;
			// All five perspective half-spaces contain the entire silhouette sphere.
			const inFrustum = (r) =>
				z > r &&
				z * tan - Math.abs(y) >= r * Math.hypot(1, tan) &&
				z * tx - Math.abs(x) >= r * Math.hypot(1, tx);
			stationInFrame = inFrustum(stationRadius);
			stationIntersectsFrame = inFrustum(-stationRadius);
			const hostHit = intersection(p, norm(rel), radius);
			if (hostHit && length(sub(hostHit, p)) < stationRangeKm - stationRadius)
				stationInFrame = stationIntersectsFrame = false;
		}
		return {
			limbFraction,
			sunElevationDeg,
			cameraRadii: length(p) / radius,
			stationInFrame,
			stationRangeKm,
			stationIntersectsFrame,
		};
	};
	return { plan, measure };
}

/** Shared capture/probe refusal, including non-finite and missing readbacks. */
export function assertHorizonFacts(facts, shot) {
	const inBand = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
	if (
		!inBand(facts.limbFraction, 0.2, 0.45) ||
		!inBand(facts.sunElevationDeg, 0, 20) ||
		(shot.station
			? facts.stationInFrame !== true || !inBand(facts.stationRangeKm, 1, 10)
			: !inBand(facts.cameraRadii, 1.2 - 1e-8, 1.2 + 1e-8) ||
				!inBand(facts.shipRadii, 1.2, Number.MAX_VALUE) ||
				facts.visibleStations?.length !== 0)
	)
		throw new Error(`horizon framing refused: ${JSON.stringify(facts)}`);
	return facts;
}
