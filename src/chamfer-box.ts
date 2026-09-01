/**
 * A box with its twelve edges cut back — the cabin's form primitive (#105).
 *
 * **Why the game needs one at all.** The reference cockpits carry their scale
 * on their *edges*: every fitting is a moulding with a thin bright rim where
 * the light catches the cut. A `BoxGeometry` has a hard 90° edge, which under
 * any light is a discontinuity with no width — there is nothing there for a
 * highlight to sit on, so a box reads as a slab however it is lit or textured.
 * The first pass on this node tried to buy that scale with panel lines instead
 * and the principal rejected it against the reference: a cabin lining is a
 * moulding, not sheet steel.
 *
 * **Geometry rather than a shader**, which was the choice #105 put to the
 * principal. `ship-surface.ts` gets its edge wear from `loft.ts`'s per-vertex
 * `crease`, and that is unavailable here twice over: three's primitives write
 * no such attribute, and on a box *every* vertex is on a hard edge, so a crease
 * term computed from face-normal disagreement is uniform and says nothing. A
 * chamfer needs no attribute, no splice and no uniform — the rim falls out of
 * the rig that is already lighting the cabin.
 *
 * **Non-indexed, and normals left flat.** Each run of three vertices is one
 * face, which is what `boxProjectUVs` requires and what keeps the chamfer a
 * distinct facet: smoothing its normal into its neighbours' is exactly the
 * averaging that would erase the rim this exists to create.
 *
 * No material knowledge and no Three.js beyond `BufferGeometry`, so
 * `tests/chamfer-box.test.ts` holds the whole of it.
 */

import * as THREE from "three";

/**
 * The chamfered box: six octagonal faces, twelve edge quads, eight corner
 * triangles.
 *
 * `chamfer` is the cut *depth* along each axis, in the same units as the
 * extents. It is clamped below half the smallest half-extent rather than
 * validated, because the cabin's fittings range from a 32 m deck to a 0.75 m
 * bezel over one shared figure: a chamfer that a thin fitting cannot take
 * should thin out on that fitting, not throw and not invert it. At the clamp
 * the form is still a box with a rim, which is the intent everywhere.
 */
export function chamferedBox(
	width: number,
	height: number,
	depth: number,
	chamfer: number,
): THREE.BufferGeometry {
	const h = [width / 2, height / 2, depth / 2];
	// **A quarter of the smallest half-extent, and half was flown first.** At a
	// half, a thin slab is more chamfer than face: seen at the shallow angle a
	// console is seen at, the rim is most of what is visible and the fitting
	// reads as chrome piping rather than as a moulding with a lit edge. A
	// quarter leaves the flat face three times the width of the cut framing it,
	// which is the proportion the reference frames show.
	const c = Math.min(chamfer, Math.min(...h) / 4);
	const positions: number[] = [];

	/** One vertex of the hull: the corner at `sign`, pulled in by `c` on `axis`
	 *  and left at full extent on the other two. */
	const point = (sign: readonly number[], axis: number) => {
		const v = [sign[0] * h[0], sign[1] * h[1], sign[2] * h[2]];
		v[axis] = sign[axis] * (h[axis] - c);
		return v;
	};

	/**
	 * Emit a polygon as a triangle fan, wound so its normal points away from the
	 * origin.
	 *
	 * **The winding is derived, not asserted.** Getting it from the order the
	 * loops happen to produce is the kind of thing that is right for five of six
	 * faces and inverted on the sixth, where a `FrontSide` material then draws
	 * nothing and the form has a hole in it that only shows from one angle. The
	 * box is convex and centred on the origin, so the outward direction of every
	 * face is simply the direction of its own centroid.
	 */
	const face = (polygon: number[][]) => {
		const centroid = [0, 1, 2].map(
			(k) => polygon.reduce((sum, v) => sum + v[k], 0) / polygon.length,
		);
		const ab = [0, 1, 2].map((k) => polygon[1][k] - polygon[0][k]);
		const ac = [0, 1, 2].map((k) => polygon[2][k] - polygon[0][k]);
		const normal = [
			ab[1] * ac[2] - ab[2] * ac[1],
			ab[2] * ac[0] - ab[0] * ac[2],
			ab[0] * ac[1] - ab[1] * ac[0],
		];
		const outward = normal.reduce((sum, n, k) => sum + n * centroid[k], 0) > 0;
		const ordered = outward ? polygon : [...polygon].reverse();
		for (let i = 1; i + 1 < ordered.length; i++)
			positions.push(...ordered[0], ...ordered[i], ...ordered[i + 1]);
	};

	const SIGNS = [-1, 1];

	// The six flat faces. Each is an octagon: on the +X face, the four vertices
	// pulled in along Y and the four pulled in along Z all lie on x = h[0].
	// Sorted by angle in the face's own plane, because the two families
	// interleave and a polygon taken in generation order is a self-crossing star.
	for (let axis = 0; axis < 3; axis++)
		for (const sign of SIGNS) {
			const [u, v] = [0, 1, 2].filter((k) => k !== axis);
			const polygon: number[][] = [];
			for (const su of SIGNS)
				for (const sv of SIGNS) {
					const corner = [0, 0, 0];
					corner[axis] = sign;
					corner[u] = su;
					corner[v] = sv;
					polygon.push(point(corner, u), point(corner, v));
				}
			polygon.sort((a, b) => Math.atan2(a[v], a[u]) - Math.atan2(b[v], b[u]));
			face(polygon);
		}

	// The twelve edge chamfers. One quad per edge, spanning the full length of
	// the edge's own axis less the two corner cuts.
	for (let along = 0; along < 3; along++) {
		const [i, j] = [0, 1, 2].filter((k) => k !== along);
		for (const si of SIGNS)
			for (const sj of SIGNS) {
				const quad: number[][] = [];
				for (const sk of SIGNS) {
					const corner = [0, 0, 0];
					corner[i] = si;
					corner[j] = sj;
					corner[along] = sk;
					quad.push(point(corner, i), point(corner, j));
				}
				// The two ends contribute (i-pulled, j-pulled) each; taken in that
				// order the quad crosses itself, so the far end is reversed.
				face([quad[0], quad[1], quad[3], quad[2]]);
			}
	}

	// The eight corner cuts: the three points that corner contributes.
	for (const sx of SIGNS)
		for (const sy of SIGNS)
			for (const sz of SIGNS) {
				const corner = [sx, sy, sz];
				face([point(corner, 0), point(corner, 1), point(corner, 2)]);
			}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(positions, 3),
	);
	// A `uv` attribute has to exist before `boxProjectUVs` can overwrite it, and
	// this primitive has no unwrap of its own worth writing: the projection is
	// what gives it one, in kilometres.
	geometry.setAttribute(
		"uv",
		new THREE.Float32BufferAttribute(
			new Float32Array((positions.length / 3) * 2),
			2,
		),
	);
	geometry.computeVertexNormals();
	return geometry;
}
