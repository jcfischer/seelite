/** Metres, +Z forward. The fixture rock face is shared by cutter and feet. */
export const MINING = {
	rockZ: 48,
	cutterY: -5,
	ringRadius: 5.6,
	toothReach: 1.4,
	stowedCutterZ: 36,
} as const;
type V = [number, number, number];
const clamp = (x: number) => {
	if (!Number.isFinite(x)) throw Error("Non-finite pose");
	return Math.max(0, Math.min(1, x));
};
export function anchorPose(index: number, deployment: number) {
	if (!Number.isInteger(index) || index < 0 || index > 3)
		throw Error("Unknown anchor");
	const t = clamp(deployment),
		sx = index % 2 === 0 ? -1 : 1,
		sy = index < 2 ? 1 : -1;
	const base: V = [sx * 6, sy * 2, 13];
	const stowed: V = [sx * 8, sy * 3, -5],
		deployed: V = [
			sx * 17,
			MINING.cutterY + sy * 14,
			rockContactZ(sx * 17, MINING.cutterY + sy * 14),
		];
	const a = stowed.map((n, i) => n - base[i]),
		b = deployed.map((n, i) => n - base[i]);
	const la = Math.hypot(...a),
		lb = Math.hypot(...b);
	const raw = a.map((n, i) => (n / la) * (1 - t) + (b[i] / lb) * t),
		norm = Math.hypot(...raw);
	const direction = raw.map((n) => n / norm) as V,
		length = la + (lb - la) * t;
	const foot = base.map((n, i) => n + direction[i] * length) as V;
	return { base, foot: t === 1 ? deployed : foot, direction, length };
}
export function cutterPosition(extension: number) {
	return (
		MINING.stowedCutterZ +
		(MINING.rockZ - MINING.toothReach - MINING.stowedCutterZ) * clamp(extension)
	);
}

export function anchorAssembly(index: number, deployment: number) {
	const p = anchorPose(index, deployment),
		t = Math.max(0, Math.min(1, deployment));
	const elbow = p.base.map((v, i) => v + (p.foot[i] - v) * 0.48) as V;
	elbow[0] += (index % 2 === 0 ? -1 : 1) * 5 * t;
	elbow[1] += (index < 2 ? 1 : -1) * 3 * t;
	const upperLength = Math.hypot(...elbow.map((v, i) => v - p.base[i]));
	const lowerLength = Math.hypot(...p.foot.map((v, i) => v - elbow[i]));
	return { ...p, elbow, upperLength, lowerLength };
}

/** Inclined asteroid facet with a small level cutting seat. Feet adapt to its slope. */
export function rockContactZ(x: number, y: number) {
	const r = Math.hypot(x, y - MINING.cutterY);
	const t = Math.max(0, Math.min(1, (r - 7) / 5));
	return MINING.rockZ - 0.75 * x * t * t * (3 - 2 * t);
}
