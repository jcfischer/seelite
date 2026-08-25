/**
 * The swept-superellipse loft every procedural hull in this project is built
 * from — #35's ship roles, and #56's station forms.
 *
 * **Its own module because it now has two callers.** It began inside
 * `ship-mesh.ts`, and a station reaching for it would have dragged 140 kB of
 * hull definitions into the renderer's import graph to get one geometry
 * function. Nothing here knows what a ship or a station is: it takes control
 * stations and returns a `BufferGeometry`.
 *
 * `ship-mesh.ts` re-exports `Ring` and `hullLoft`, so every existing importer
 * and every test that reads them is unchanged.
 */

import * as THREE from "three";

/**
 * One station of a swept hull.
 *
 * `w`/`h`/`b` are half-extents rather than diameters so a station reads as a
 * silhouette measurement straight off the drawing. `e` is the superellipse
 * exponent: 2 is a true ellipse, 4 is a rounded rectangle, and below 2 pinches
 * towards a diamond. Nothing here reaches an exponent that restores a flat
 * wall, which is the shape the round-three review rejected.
 */
export interface Ring {
	readonly z: number;
	readonly w: number;
	readonly h: number;
	readonly b?: number;
	readonly x?: number;
	readonly y?: number;
	readonly e?: number;
	/** End the spline here and start a new one, leaving a crease. */
	readonly hard?: boolean;
}

type SolidRing = Required<Omit<Ring, "hard">>;

export const RING_SEGMENTS = 16;
export const SUBDIVISIONS = 5;

function solid(ring: Ring): SolidRing {
	return {
		z: ring.z,
		w: ring.w,
		h: ring.h,
		b: ring.b ?? ring.h,
		x: ring.x ?? 0,
		y: ring.y ?? 0,
		e: ring.e ?? 2.4,
	};
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
	const t2 = t * t;
	const t3 = t2 * t;
	return (
		0.5 *
		(2 * p1 +
			(-p0 + p2) * t +
			(2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
			(-p0 + 3 * p1 - 3 * p2 + p3) * t3)
	);
}

/**
 * One spline's worth of stations. Half-extents are clamped at zero because
 * Catmull-Rom overshoots an inflection, and a negative half-extent turns the
 * hull inside out at that station.
 */
function run(controls: ReadonlyArray<Ring>, subdivisions: number) {
	const rings = controls.map(solid);
	if (rings.length < 2) return rings;
	const at = (index: number) =>
		rings[Math.min(rings.length - 1, Math.max(0, index))];
	const out: SolidRing[] = [];
	for (let span = 0; span < rings.length - 1; span += 1) {
		const [p0, p1, p2, p3] = [
			at(span - 1),
			at(span),
			at(span + 1),
			at(span + 2),
		];
		for (let step = 0; step < subdivisions; step += 1) {
			const t = step / subdivisions;
			const field = (key: keyof SolidRing) =>
				catmullRom(p0[key], p1[key], p2[key], p3[key], t);
			out.push({
				z: field("z"),
				w: Math.max(0, field("w")),
				h: Math.max(0, field("h")),
				b: Math.max(0, field("b")),
				x: field("x"),
				y: field("y"),
				e: Math.max(1.2, field("e")),
			});
		}
	}
	out.push(rings[rings.length - 1]);
	return out;
}

/**
 * Resample control stations onto a smooth spline, honouring hard shoulders.
 *
 * The curvature the eye reads as "not a box" lives between the stations, not in
 * them: five hand-placed rings joined by straight edges still shade as facets.
 * But smoothing everything is the opposite failure — a hull with no crease
 * anywhere reads as inflated. A `hard` station ends one spline and begins the
 * next, so the two sides meet with different tangents and leave an edge; the
 * runs are swept separately rather than by doubling the station, which would
 * emit a ring of degenerate triangles at every crease.
 */
function sweep(controls: ReadonlyArray<Ring>, subdivisions = SUBDIVISIONS) {
	const groups: Ring[][] = [];
	let current: Ring[] = [];
	for (const ring of controls) {
		current.push(ring);
		if (ring.hard && current.length > 1) {
			groups.push(current);
			current = [ring];
		}
	}
	groups.push(current);
	return groups.flatMap((group, index) => {
		const swept = run(group, subdivisions);
		return index === 0 ? swept : swept.slice(1);
	});
}

/**
 * Sweep a closed superellipse tube through the stations and cap both ends.
 *
 * Ring points run from +Y towards +X so the side quads wind outward; the caps
 * are indexed fans rather than open holes, because an unwound near wall is
 * culled and shows the far wall as a false transparent cone. `userData` records
 * the centreline and the ring size so a test can prove that winding without
 * assuming this function's segment count or that the part points down -Z.
 */
export function hullLoft(
	controls: ReadonlyArray<Ring>,
	options: { segments?: number; subdivisions?: number } = {},
) {
	const segments = options.segments ?? RING_SEGMENTS;
	const rings = sweep(controls, options.subdivisions ?? SUBDIVISIONS);
	const vertices: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	// The sweep's own arc length, so `v` advances with *distance along the hull*
	// rather than with ring index. Without it a run of closely spaced control
	// stations — which is exactly where a crease is authored — stretches the
	// texture over a few millimetres of hull and squeezes it over the long
	// straight sections, and plating drawn that way reads as a smear at the one
	// place the shape has a feature.
	let travelled = 0;
	const arc: number[] = [0];
	for (let i = 1; i < rings.length; i += 1) {
		travelled += Math.hypot(
			rings[i].x - rings[i - 1].x,
			rings[i].y - rings[i - 1].y,
			rings[i].z - rings[i - 1].z,
		);
		arc.push(travelled);
	}
	const span = travelled || 1;
	for (const [index, ring] of rings.entries()) {
		for (let point = 0; point < segments; point += 1) {
			const angle = Math.PI / 2 - (point / segments) * Math.PI * 2;
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			const power = 2 / ring.e;
			vertices.push(
				ring.x + ring.w * Math.sign(cos) * Math.abs(cos) ** power,
				ring.y +
					(sin >= 0 ? ring.h : ring.b) *
						Math.sign(sin) *
						Math.abs(sin) ** power,
				ring.z,
			);
			// `u` wraps the section and `v` runs the length. Both in the surface's
			// own units rather than 0–1, so a `RepeatWrapping` map keeps a constant
			// panel size whatever the part's size — which is the property a plating
			// map needs and a 0–1 unwrap destroys.
			uvs.push(point / segments, arc[index] / span);
		}
	}
	for (let ring = 0; ring < rings.length - 1; ring += 1) {
		for (let point = 0; point < segments; point += 1) {
			const next = (point + 1) % segments;
			const a = ring * segments + point;
			const b = ring * segments + next;
			const c = (ring + 1) * segments + next;
			const d = (ring + 1) * segments + point;
			indices.push(a, d, b, b, d, c);
		}
	}
	const first = rings[0];
	const last = rings[rings.length - 1];
	const front = vertices.length / 3;
	vertices.push(first.x, first.y, first.z);
	uvs.push(0.5, 0);
	const rear = vertices.length / 3;
	vertices.push(last.x, last.y, last.z);
	uvs.push(0.5, 1);
	const rearRing = (rings.length - 1) * segments;
	for (let point = 0; point < segments; point += 1) {
		const next = (point + 1) % segments;
		indices.push(front, point, next);
		indices.push(rear, rearRing + next, rearRing + point);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(vertices, 3),
	);
	geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	geometry.userData.ringSize = segments;
	geometry.userData.axis = rings.map((ring) => [ring.x, ring.y, ring.z]);
	return geometry;
}

/** Revolve a `[radius, z]` profile: a circle is a superellipse with `e === 2`. */
export function revolve(
	profile: ReadonlyArray<readonly [number, number]>,
	segments = RING_SEGMENTS,
) {
	return hullLoft(
		profile.map(([radius, z]) => ({ z, w: radius, h: radius, e: 2 })),
		{ segments, subdivisions: 3 },
	);
}
