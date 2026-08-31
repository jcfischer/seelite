/**
 * The ring between a convex face and a rectangle cut out of it (#155).
 *
 * A station's aperture was never a hole: `buildCuboctahedron` wrote the trade
 * Coriolis's +Z square as two triangles and `hullLoft` caps both ends, so every
 * form drew a lit frame on an uncut surface and a docking ship crossed the
 * station's own face. It read as an opening only while a dark `BackSide` recess
 * stood in front of it, which is what #147 replaced with a bay.
 *
 * **The arithmetic is the same for both callers; the vertex layout is not.** A
 * `PolyhedronGeometry` face is non-indexed and a `hullLoft` cap fan is indexed,
 * and each carries its own winding and UV rule — a helper that owned those
 * would have to know which of the two it was serving, and would be two
 * functions wearing one name. So `cutRing` is shared, the indexed strip is
 * built where the index buffer lives, and the non-indexed surgery is
 * `appendRing` below.
 *
 * **What holds §13.7's *no exterior silhouette change* is not this function.**
 * Every sample `onLoop` returns lies on an edge of the original loop — at a
 * corner's own angle it is that corner, between two corners the point where the
 * ray meets that edge — but it is recomputed through `cos`/`sin` of an `atan2`
 * and a ray-edge solve rather than being the original vertex, so the equality is
 * float-approximate. That was offered as the reason the outline survives, and it
 * is the wrong reason.
 *
 * The outline survives because **the cut is interior to a face whose boundary
 * other geometry already owns**: a lofted cap's rim is also the side wall's last
 * ring, and the cuboctahedron's +Z square shares all four corners with faces
 * that are not cut. A test that lofted the same controls twice and compared
 * reach was written to measure this and **withdrawn** — pulling every outer
 * sample 2% inward left both figures identical, because the side wall supplies
 * them, and a check that cannot go red on the defect it names is not a check.
 * What does bind is the silhouette budget in `tests/station-mesh.test.ts`: no
 * vertex outside each form's declared reach, and a cut adds no vertex anywhere
 * the face did not already reach.
 */

/** A point on a face, in the face's own plane. */
import * as THREE from "three";

export type FacePoint = readonly [number, number];

/** Where a ray from the centre at `angle` leaves a convex loop. */
function onLoop(loop: readonly FacePoint[], angle: number): FacePoint {
	const dx = Math.cos(angle);
	const dy = Math.sin(angle);
	let nearest = Number.POSITIVE_INFINITY;
	for (let i = 0; i < loop.length; i++) {
		const [ax, ay] = loop[i];
		const [bx, by] = loop[(i + 1) % loop.length];
		// Solve `t·d = a + s·(b − a)` for `s ∈ [0, 1]` and `t > 0`.
		const ex = bx - ax;
		const ey = by - ay;
		// Eliminating `t` from `t·d = a + s·e` gives
		// `s·(dy·ex − dx·ey) = dx·ay − dy·ax`. Both signs matter: with the
		// denominator the other way round every `s` comes back negated and the
		// `[0, 1]` test below rejects the segment the ray actually crosses.
		const denominator = dy * ex - dx * ey;
		if (Math.abs(denominator) < 1e-12) continue;
		const s = (dx * ay - dy * ax) / denominator;
		if (s < -1e-9 || s > 1 + 1e-9) continue;
		const x = ax + s * ex;
		const y = ay + s * ey;
		const t = Math.abs(dx) > Math.abs(dy) ? x / dx : y / dy;
		if (t > 1e-12 && t < nearest) nearest = t;
	}
	if (!Number.isFinite(nearest))
		throw new Error(`no boundary at ${angle} — is the loop closed and convex?`);
	return [dx * nearest, dy * nearest];
}

/** The rectangle's own boundary along the same ray. */
function onRectangle(
	halfWidth: number,
	halfHeight: number,
	angle: number,
): FacePoint {
	const dx = Math.cos(angle);
	const dy = Math.sin(angle);
	const t = Math.min(
		Math.abs(dx) < 1e-12 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx),
		Math.abs(dy) < 1e-12 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy),
	);
	return [dx * t, dy * t];
}

/**
 * Two loops of equal length, ready to be strung into a quad strip.
 *
 * **Sampled at the union of both loops' corner angles**, which is what makes it
 * exact rather than approximate on either side. Sample only the face's own
 * corners and the rectangle comes out as an inscribed polygon with its corners
 * cut off — a hole smaller than the aperture, at the four places §13.5's fit
 * check has least margin. Sample only the rectangle's and the face loses its
 * corners, which is a silhouette change.
 *
 * Both loops must be convex and contain the origin, and the rectangle must fit
 * inside the face. All three are checked: a face that fails one produces a
 * self-intersecting strip, which renders as a plausible-looking mess rather
 * than as an error.
 */
export function cutRing(
	outer: readonly FacePoint[],
	halfWidth: number,
	halfHeight: number,
): { outer: FacePoint[]; inner: FacePoint[] } {
	if (outer.length < 3)
		throw new Error(`a face needs 3 points, got ${outer.length}`);
	// **Convex, and containing the origin.** `onLoop` takes the nearest forward
	// crossing, so a re-entrant face returns an inner boundary rather than
	// throwing, and the strip built from it self-intersects — which renders as a
	// plausible-looking mess. Checked here because the docstring above promises
	// it is; the previous version promised three checks and performed one.
	//
	// **Sign agreement rather than a fixed sign**, because the two callers hand
	// loops in opposite directions: a cuboctahedron's square face is written
	// counter-clockwise from +Z and a swept ring runs from +Y towards +X, which
	// is clockwise. A test for one winding rejects the other's every face.
	const cross = (
		[ax, ay]: FacePoint,
		[bx, by]: FacePoint,
		[cx, cy]: FacePoint,
	) => (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
	const ORIGIN: FacePoint = [0, 0];
	let turn = 0;
	let side = 0;
	for (let i = 0; i < outer.length; i++) {
		const a = outer[i];
		const b = outer[(i + 1) % outer.length];
		const c = outer[(i + 2) % outer.length];
		const t = cross(a, b, c);
		const o = cross(a, b, ORIGIN);
		if (Math.abs(t) > 1e-12) {
			if (turn !== 0 && Math.sign(t) !== turn)
				throw new Error(`the face is re-entrant at corner ${i}`);
			turn = Math.sign(t);
		}
		if (Math.abs(o) > 1e-12) {
			if (side !== 0 && Math.sign(o) !== side)
				throw new Error(`the face does not contain the origin, at edge ${i}`);
			side = Math.sign(o);
		}
	}
	if (!(halfWidth > 0) || !(halfHeight > 0))
		throw new Error(
			`aperture half-extents must be positive: ${halfWidth} x ${halfHeight}`,
		);
	const angleOf = ([x, y]: FacePoint) => Math.atan2(y, x);
	const corners: FacePoint[] = [
		[halfWidth, halfHeight],
		[-halfWidth, halfHeight],
		[-halfWidth, -halfHeight],
		[halfWidth, -halfHeight],
	];
	// Every corner of the rectangle must be strictly inside the face, or the
	// "ring" folds through itself. Checked at the corners because they are the
	// rectangle's farthest points from the centre.
	for (const corner of corners) {
		const angle = angleOf(corner);
		const [bx, by] = onLoop(outer, angle);
		if (Math.hypot(corner[0], corner[1]) >= Math.hypot(bx, by))
			throw new Error(
				`aperture ${halfWidth * 2} x ${halfHeight * 2} does not fit inside the face it is cut into`,
			);
	}
	const angles = [...outer, ...corners]
		.map(angleOf)
		.sort((a, b) => a - b)
		.filter((angle, i, all) => i === 0 || angle - all[i - 1] > 1e-9);
	return {
		outer: angles.map((angle) => onLoop(outer, angle)),
		inner: angles.map((angle) => onRectangle(halfWidth, halfHeight, angle)),
	};
}

/**
 * The ring as loose triangles, for a caller whose geometry is non-indexed.
 *
 * `PolyhedronGeometry` writes one run of three vertices per face, which is what
 * lets `boxProjectUVs` give each face its own projection; a cut face appended
 * to it has to arrive in the same shape.
 *
 * Counter-clockwise seen from +Z, matching both loops' own order — the same
 * winding as the two triangles the +Z square is built from, so a cut face
 * faces outward like the one it replaces.
 */
export function ringTriangles(
	outer: readonly FacePoint[],
	inner: readonly FacePoint[],
	z: number,
): number[] {
	if (outer.length !== inner.length)
		throw new Error(
			`loops differ: ${outer.length} outer, ${inner.length} inner`,
		);
	const out: number[] = [];
	const push = ([x, y]: FacePoint) => out.push(x, y, z);
	for (let i = 0; i < outer.length; i++) {
		const next = (i + 1) % outer.length;
		push(outer[i]);
		push(outer[next]);
		push(inner[next]);
		push(outer[i]);
		push(inner[next]);
		push(inner[i]);
	}
	return out;
}

/**
 * Append a ring's loose triangles to a non-indexed geometry, and record the cut.
 *
 * Generic surgery on the shape `PolyhedronGeometry` produces — one run of three
 * vertices per face, which is what lets `boxProjectUVs` give each face its own
 * projection — so it lives beside `ringTriangles` rather than inside a form
 * builder that otherwise only names vertices and materials.
 *
 * The UVs are zeroed rather than computed: every caller re-projects afterwards,
 * and a plausible-looking wrong unwrap is worse than an obviously empty one.
 * The normals are flat +Z, which is what the two triangles a cut face replaces
 * carried.
 */
export function appendRing(
	geometry: THREE.BufferGeometry,
	ring: readonly number[],
	cut: { halfWidth: number; halfHeight: number },
) {
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;
	const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
	const merged = new Float32Array(position.count * 3 + ring.length);
	merged.set(position.array as Float32Array, 0);
	merged.set(ring, position.count * 3);
	const normals = new Float32Array(merged.length);
	normals.set(normal.array as Float32Array, 0);
	for (let i = position.count * 3; i < normals.length; i += 3)
		normals[i + 2] = 1;
	geometry.setAttribute("position", new THREE.BufferAttribute(merged, 3));
	geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
	geometry.setAttribute(
		"uv",
		new THREE.BufferAttribute(new Float32Array((merged.length / 3) * 2), 2),
	);
	// The same record `hullLoft` writes, for the same reader.
	geometry.userData.apertureCut = cut;
}
