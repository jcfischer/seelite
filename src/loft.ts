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
import { cutRing } from "./face-cut";

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
 * What a geometry's `uv` attribute is measured in.
 *
 * `"km"` is what `hullLoft` writes — chord distance round the section and
 * distance along the sweep — and `"plate"` is what it becomes once a consumer
 * has divided by its own panel size. A three-module state machine in an untyped
 * bag is how the *previous* marker went wrong: `plateUVs` gated on `ringSize`,
 * a field recording where the cap fans are, and any producer that omitted it
 * would silently have kept kilometre UVs. A typo in a string literal is the same
 * failure with the same silence, so the two values and the two accessors are
 * declared once, here, and every writer and reader goes through them.
 */
export type UvUnits = "km" | "plate";

export const uvUnitsOf = (
	geometry: THREE.BufferGeometry,
): UvUnits | undefined => geometry.userData.uvUnits as UvUnits | undefined;

/**
 * Record a geometry's UV units **on a fresh `userData`**.
 *
 * `BufferGeometry.copy` assigns `userData` by reference, so a clone and its
 * source share one object while owning separate UV buffers. Mutating the shared
 * field would tell a clone taken before its source was divided that it had
 * already been done, and it would keep kilometre UVs — plates 125 times too
 * large on one side of a mirrored part. Replacing the object leaves the
 * sibling's alone.
 */
export function setUvUnits(geometry: THREE.BufferGeometry, units: UvUnits) {
	geometry.userData = { ...geometry.userData, uvUnits: units };
}

/**
 * Multiply a geometry's UVs in place. Returns whether there were any.
 *
 * Pure UV arithmetic and no material knowledge, so it lives beside the module
 * that writes the UVs rather than beside the one that consumes them: `hoop`
 * scales three's normalised torus unwrap up into kilometres and `plateUVs`
 * scales kilometres down into plates, which is one pass with two factors.
 */
export function scaleUVs(
	geometry: THREE.BufferGeometry,
	sx: number,
	sy: number,
) {
	const uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
	if (!uv) return false;
	for (let i = 0; i < uv.count; i++)
		uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
	uv.needsUpdate = true;
	return true;
}

/**
 * How far below a face's own normal the *shading* normal has been averaged —
 * per vertex, 0 on a smooth surface and 1 on a hard edge.
 *
 * #101 needed a wear term that lands on a hull's **edges**, and no map in UV
 * space can know where those are: a texture is a picture of a plate and has
 * never been told which plates meet. The geometry has been. A `hard` station
 * ends one spline and starts the next, and a superellipse with a high exponent
 * turns a chine round the section — both leave adjacent faces disagreeing about
 * which way the surface points, and `computeVertexNormals` has just averaged
 * that disagreement away into one vertex normal. The size of what it averaged
 * away is the measurement.
 *
 * So this is one number per vertex: the largest angle between the vertex normal
 * and any face meeting there, as `1 − cos`. It is read by `ship-surface.ts` to
 * roughen and scuff an edge, and it is written **for every lofted geometry**
 * including a station's — the cost is one pass over the index buffer at load,
 * and an attribute no material reads costs a few kilobytes and nothing else.
 * One rule beats a flag that has to be remembered.
 *
 * **The floor and the knee are set against the smooth case, not chosen.** At 16
 * segments a tube's adjacent faces differ by 22.5°, so a vertex normal sits
 * about 11.25° off each of them — `1 − cos` of 0.019. A right-angle crease is
 * 45° off, which is 0.293. The floor is above the first and the knee below the
 * second by enough margin that neither reading is near an edge of the band, and
 * `tests/surface.test.ts` asserts both directions: a smooth taper's tube must
 * read near zero while the same sweep with one shoulder marked hard must not.
 * A constant fails one or the other.
 */
const CREASE_FLOOR = 0.05;
const CREASE_KNEE = 0.25;

function computeCrease(geometry: THREE.BufferGeometry) {
	const index = geometry.getIndex();
	// Before the allocation, not after: a non-indexed geometry was buying a
	// float per vertex and throwing it away on the next line.
	if (!index) return;
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;
	const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
	const out = new Float32Array(position.count);
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	const face = new THREE.Vector3();
	const edge = new THREE.Vector3();
	const vertex = new THREE.Vector3();
	// Hoisted above the loop, not merely unrolled: a closure declared inside it
	// is an allocation per triangle exactly as the array it replaced was. It
	// reads `face` and `out` from here, both of which the loop rewrites.
	const lean = (v: number) => {
		vertex.fromBufferAttribute(normal, v);
		out[v] = Math.max(out[v], 1 - vertex.dot(face));
	};
	for (let i = 0; i < index.count; i += 3) {
		const ia = index.getX(i);
		const ib = index.getX(i + 1);
		const ic = index.getX(i + 2);
		a.fromBufferAttribute(position, ia);
		b.fromBufferAttribute(position, ib);
		c.fromBufferAttribute(position, ic);
		face.copy(b).sub(a);
		edge.copy(c).sub(a);
		face.cross(edge);
		// A degenerate triangle — the ring point that closes a cap fan onto a
		// zero-radius station — has no normal, and normalising it would put a
		// NaN into the attribute and take every vertex of the fan with it.
		if (face.lengthSq() === 0) continue;
		face.normalize();
		lean(ia);
		lean(ib);
		lean(ic);
	}
	for (let i = 0; i < out.length; i++)
		out[i] = Math.max(
			0,
			Math.min(1, (out[i] - CREASE_FLOOR) / (CREASE_KNEE - CREASE_FLOOR)),
		);
	geometry.setAttribute("crease", new THREE.BufferAttribute(out, 1));
}

/**
 * A rectangle cut out of a lofted hull's cap, in the same units as `Ring.w`
 * and `Ring.h` (#155).
 *
 * Exported so `station-mesh.ts`'s `shell` forwards the whole option rather than
 * a structural copy of two of its three fields: the copy compiled only because
 * an object literal passed straight through has no excess-property check, and
 * its type said the second face is never cut while three callers relied on it
 * being cut.
 */
export interface ApertureCut {
	halfWidth: number;
	halfHeight: number;
	/**
	 * `"last"` for a solid the ship stops inside, `"both"` for a **plate it
	 * passes through** — a pad deck, a refinery terrace. A hole in one face of a
	 * 24 m plate is not a hole, and the surface 24 m behind it reads on the
	 * instrument exactly as the uncut face did.
	 */
	ends?: "last" | "both";
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
	options: {
		segments?: number;
		subdivisions?: number;
		/**
		 * Cut a rectangle out of the **last** ring's cap, leaving a ring of
		 * quads round the opening rather than a closed fan (#155).
		 *
		 * Half-extents, in the same units as `Ring.w` and `Ring.h`. The last
		 * ring rather than a choice of end, because that is the +Z end every
		 * station form sweeps towards and the end the aperture is cut into;
		 * nothing has wanted the other one, and an option nothing exercises is
		 * an untested branch that reads as a capability.
		 *
		 * A cut cap has **no centre vertex**, so the matching `userData.caps`
		 * field is `null` on a geometry built this way — `null` rather than
		 * `-1`, so a reader that forgets the case indexes nothing and fails
		 * loudly instead of reading vertex `-1`. Ships are never cut, which is
		 * why the two readers of that field are unaffected today.
		 */
		aperture?: ApertureCut;
	} = {},
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
	/**
	 * **`segments + 1` points a ring, not `segments`.**
	 *
	 * The last duplicates the first's position and carries `u` at the ring's
	 * full circumference. Without it the closing quad wraps `u` from the whole
	 * perimeter back to zero, so one facet of every lofted part — every ship
	 * hull and every station shell — draws the whole texture compressed and
	 * mirrored into a single quad. It is a seam rather than a smear, which is
	 * why it survived the change that removed the smearing.
	 *
	 * The cap fans still index `segments` points of a ring, so
	 * `userData.ringSize` keeps meaning "triangles in a cap fan" and the
	 * winding test that reads it is unaffected.
	 */
	const stride = segments + 1;
	for (const [index, ring] of rings.entries()) {
		const start = vertices.length / 3;
		let round = 0;
		for (let point = 0; point <= segments; point += 1) {
			const angle = Math.PI / 2 - ((point % segments) / segments) * Math.PI * 2;
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
			if (point > 0) {
				const a = (start + point) * 3;
				const b = (start + point - 1) * 3;
				round += Math.hypot(
					vertices[a] - vertices[b],
					vertices[a + 1] - vertices[b + 1],
				);
			}
			// **UVs in kilometres, not normalised.** `u` is the chord distance
			// round this ring's own section and `v` the distance travelled along
			// the sweep, both in the units the hull is authored in. A caller then
			// picks a panel *size* by dividing, rather than a panel *count* by
			// multiplying — and a count is what gives a 1.5 km keel and a 0.12 km
			// terrace the same six bands, so one is coarse and the other a smear.
			//
			// It also lets the end caps carry their own planar unwrap at the same
			// scale, which a normalised parameterisation cannot: a cap has no
			// circumference and no length to normalise against.
			uvs.push(round, arc[index]);
		}
	}
	for (let ring = 0; ring < rings.length - 1; ring += 1) {
		for (let point = 0; point < segments; point += 1) {
			const a = ring * stride + point;
			const b = a + 1;
			const c = (ring + 1) * stride + point + 1;
			const d = (ring + 1) * stride + point;
			indices.push(a, d, b, b, d, c);
		}
	}
	const first = rings[0];
	const last = rings[rings.length - 1];
	const capRing = (ring: SolidRing, source: number, v: number) => {
		const start = vertices.length / 3;
		for (let point = 0; point < segments; point += 1) {
			const at = (source + point) * 3;
			vertices.push(vertices[at], vertices[at + 1], vertices[at + 2]);
			// Planar in the cap's own axes, offset so the two caps do not sample
			// the identical patch of a repeating map and look mirrored.
			uvs.push(vertices[at] + v * 0.5, vertices[at + 1]);
		}
		const centre = vertices.length / 3;
		vertices.push(ring.x, ring.y, ring.z);
		uvs.push(ring.x + v * 0.5, ring.y);
		return { start, centre };
	};
	/**
	 * The last ring's cap as a ring of quads round an opening, instead of a fan.
	 *
	 * The outer loop is sampled at the union of its own corner angles and the
	 * rectangle's, so **every outer point is an original ring point or a point
	 * exactly on the edge between two of them** — the cap's outline, and
	 * therefore the hull's silhouette, is unchanged by the cut.
	 *
	 * **The winding is the loops' own, not the fan's.** `cutRing` returns both
	 * loops at ascending angle — counter-clockwise seen from +Z — while a
	 * swept ring runs from +Y towards +X, which is clockwise. Substituting the
	 * fan's own `(centre, next, point)` order into a counter-clockwise strip
	 * turns every quad inside out, and an inside-out cap is culled rather than
	 * visibly wrong: it shows the far wall through the near one.
	 */
	const capOpening = (
		ring: SolidRing,
		source: number,
		v: number,
		aperture: { halfWidth: number; halfHeight: number },
		end: "front" | "rear" = "rear",
	) => {
		const loop: [number, number][] = [];
		for (let point = 0; point < segments; point += 1) {
			const at = (source + point) * 3;
			loop.push([vertices[at] - ring.x, vertices[at + 1] - ring.y]);
		}
		const cut = cutRing(loop, aperture.halfWidth, aperture.halfHeight);
		const emit = (points: readonly (readonly [number, number])[]) => {
			const start = vertices.length / 3;
			for (const [x, y] of points) {
				vertices.push(x + ring.x, y + ring.y, ring.z);
				// The same planar unwrap in the cap's own axes the fan uses, so
				// the plate pattern runs continuously across the cut edge.
				uvs.push(x + ring.x + v * 0.5, y + ring.y);
			}
			return start;
		};
		const outer = emit(cut.outer);
		const inner = emit(cut.inner);
		for (let point = 0; point < cut.outer.length; point += 1) {
			const next = (point + 1) % cut.outer.length;
			if (end === "rear") {
				indices.push(outer + point, outer + next, inner + next);
				indices.push(outer + point, inner + next, inner + point);
			} else {
				indices.push(outer + next, outer + point, inner + point);
				indices.push(outer + next, inner + point, inner + next);
			}
		}
	};

	let frontCentre: number | null = null;
	if (options.aperture?.ends === "both") {
		// The front fan is wound `(centre, point, next)` — the mirror of the
		// rear's — so its strip is the mirror too.
		capOpening(first, 0, 0, options.aperture, "front");
	} else {
		const frontCap = capRing(first, 0, 0);
		frontCentre = frontCap.centre;
		for (let point = 0; point < segments; point += 1) {
			const next = (point + 1) % segments;
			indices.push(
				frontCap.centre,
				frontCap.start + point,
				frontCap.start + next,
			);
		}
	}
	let rearCentre: number | null = null;
	if (options.aperture) {
		capOpening(last, (rings.length - 1) * stride, 1, options.aperture);
	} else {
		const rearCap = capRing(last, (rings.length - 1) * stride, 1);
		rearCentre = rearCap.centre;
		for (let point = 0; point < segments; point += 1) {
			const next = (point + 1) % segments;
			indices.push(rearCap.centre, rearCap.start + next, rearCap.start + point);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(vertices, 3),
	);
	geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	computeCrease(geometry);
	/**
	 * **What the `uv` attribute is measured in**, declared rather than inferred.
	 *
	 * `plateUVs` used to gate on `ringSize`, a marker this function sets to
	 * record where the cap fans are — an unrelated fact that happened to be
	 * present on every lofted geometry. A later producer omitting it, or a
	 * non-loft geometry adopting it, would have got the wrong plate size
	 * silently. This says the thing the consumer actually needs to know.
	 */
	setUvUnits(geometry, "km");
	geometry.userData.ringSize = segments;
	// Where the two cap fans' centre vertices ended up. Recorded rather than
	// left to be inferred: they were the last two vertices until the caps gained
	// their own rings, and `tests/ship-mesh.test.ts` was reading them that way —
	// a layout assumption that goes quietly wrong rather than loudly.
	geometry.userData.caps = { front: frontCentre, rear: rearCentre };
	// **What was cut, recorded on the thing that was cut** (#155). The gate
	// needs to name the surfaces the ruling is about — a form's own outermost
	// face — and a depth band cannot: the trade Coriolis's frame stands 25 m
	// proud of its face while an outpost's tower leg crosses the lane at 30 m,
	// so no band separates the cut from the traffic behind it.
	if (options.aperture) geometry.userData.apertureCut = options.aperture;
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
