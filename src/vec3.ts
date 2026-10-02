/**
 * float64 vector arithmetic in kilometres. A leaf, and that is its job.
 *
 * These lived in `sim.ts` while `sim.ts` was the only module with positions in
 * it. It is not any more: `galaxy.ts` measures light years and `system.ts`
 * places bodies on orbits, and both imported `Vec3`, `dot` and `lengthSq` from
 * the simulation. That was survivable only as long as the arrow pointed one way.
 *
 * Wiring the real generator into the world reverses it — `sim.ts` now builds its
 * system from `galaxy.ts` and `system.ts` — and the two arrows together are an
 * import cycle. ESM resolves that cycle at runtime today because every use is
 * inside a function body, which is precisely the kind of "works until someone
 * adds a top-level call" that is not worth keeping.
 *
 * So the shared half moves down here, beside `units.ts`, and everything imports
 * it rather than each other. Like `units.ts` this file imports nothing, and the
 * property is what matters rather than the prose.
 */

/** A float64 position or velocity in kilometres (or km/s). */
export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 =>
	v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 =>
	v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, k: number): Vec3 =>
	v3(a.x * k, a.y * k, a.z * k);
export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));

/**
 * The two allocation-free primitives, which is why they are here rather than
 * spelled out at each call site.
 *
 * `galaxy.ts` and `system.ts` both need a dot product and a squared length in
 * loops that run per system pair and per body — `length(sub(a, b))` would be
 * the tidy spelling and allocates a `Vec3` every time, which is the wrong trade
 * inside an O(n²) scan. These compose into that spelling without the garbage.
 */
export const dot = (a: Vec3, b: Vec3): number =>
	a.x * b.x + a.y * b.y + a.z * b.z;

export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;

/**
 * The right-handed cross product.
 *
 * Here rather than spelled out per consumer for the reason the leaf exists: a
 * second spelling of a primitive is a second sign convention, and the one place
 * it had been re-spelled was a HUD cue whose whole job is to tell a pilot which
 * way to roll. Adds no imports — the leaf is still a leaf.
 */
export const cross = (a: Vec3, b: Vec3): Vec3 =>
	v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/**
 * `a` scaled to unit length, or `fallback` when `a` has none.
 *
 * Here for the reason `cross` is: #324 added three verbatim copies of this
 * beside two older ones, and a second spelling of a primitive is a second
 * answer to what a zero vector normalises to.
 */
export const normalizeOr = (a: Vec3, fallback: Vec3): Vec3 => {
	const m = length(a);
	return m === 0 ? fallback : scale(a, 1 / m);
};

/**
 * A unit vector perpendicular to `nose`, from a reference that is never
 * parallel to it: world up, or world x within about 32° of the pole.
 *
 * One construction for every frame #324 builds around a heading — a roll
 * reference, a drawn offset, a turn plane that has collapsed — because four
 * copies of it were four places a change to the pole threshold had to reach.
 * Here beside `normalizeOr` rather than in `interdiction.ts`, so the duel does
 * not depend on the contest for a vector primitive (sage round 2).
 */
export const frameAcross = (nose: Vec3): Vec3 =>
	normalizeOr(
		cross(nose, Math.abs(nose.y) < 0.85 ? v3(0, 1, 0) : v3(1, 0, 0)),
		v3(1, 0, 0),
	);

/** Rodrigues: spin `v` about a unit `axis` by `angle`. One copy since #619,
 *  where the raider and the attitude hold each carried their own. */
export const rotateAbout = (v: Vec3, axis: Vec3, angle: number): Vec3 => {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return add(
		add(scale(v, c), scale(cross(axis, v), s)),
		scale(axis, dot(axis, v) * (1 - c)),
	);
};

/** `v` held to `[lo, hi]`. */
export const clamp = (v: number, lo: number, hi: number): number =>
	Math.min(hi, Math.max(lo, v));
