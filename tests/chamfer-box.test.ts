/**
 * The cabin's form primitive: does it still bound the box it replaces, and does
 * it actually have a rim?
 *
 * The two failures worth catching are opposite. A chamfer that does nothing
 * leaves the slab the principal rejected, and nothing else in the repo would
 * notice — the form still renders, still plates, still passes every probe. A
 * chamfer that overshoots eats the face it was meant to frame, or inverts a
 * thin fitting inside out. Both are measured here against the box's own
 * extents, which is the only thing a headless tier can see.
 *
 * What it cannot check is whether the rim *reads*, which is the contact
 * sheet's and the principal's — #104's finding, unchanged.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { chamferedBox } from "../src/chamfer-box";

/** Every vertex, as triples. */
function vertices(geometry: THREE.BufferGeometry) {
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;
	const out: [number, number, number][] = [];
	for (let i = 0; i < position.count; i++)
		out.push([position.getX(i), position.getY(i), position.getZ(i)]);
	return out;
}

/** The distinct outward face normals, rounded so coplanar faces collapse. */
function normals(geometry: THREE.BufferGeometry) {
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	const normal = new THREE.Vector3();
	const seen = new Set<string>();
	for (let i = 0; i < position.count; i += 3) {
		a.fromBufferAttribute(position, i);
		b.fromBufferAttribute(position, i + 1);
		c.fromBufferAttribute(position, i + 2);
		normal.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
		seen.add(
			`${normal.x.toFixed(3)},${normal.y.toFixed(3)},${normal.z.toFixed(3)}`,
		);
	}
	return seen;
}

describe("the chamfered box", () => {
	const W = 0.032;
	const H = 0.0016;
	const D = 0.022;

	test("stays inside the box it replaces, and reaches its faces", () => {
		// A chamfer cuts material away, so nothing may leave the original box —
		// a fitting that grew would poke through the console it sits in. And the
		// flat faces must still touch the original planes, or the form has
		// silently shrunk and every dimension in `buildCockpit` now means
		// something else.
		// **Relative rather than absolute**, because positions land in a
		// `Float32BufferAttribute`: 0.016 comes back 7.6e-10 heavy, which is one
		// ulp and not a geometry error. An absolute epsilon that passes on the
		// 0.0008 bezel is far too tight on the 0.032 deck.
		const v = vertices(chamferedBox(W, H, D, 0.0004));
		const EPS = 1e-6;
		for (const [x, y, z] of v) {
			expect(Math.abs(x)).toBeLessThanOrEqual((W / 2) * (1 + EPS));
			expect(Math.abs(y)).toBeLessThanOrEqual((H / 2) * (1 + EPS));
			expect(Math.abs(z)).toBeLessThanOrEqual((D / 2) * (1 + EPS));
		}
		const reach = (index: 0 | 1 | 2) =>
			Math.max(...v.map((p) => Math.abs(p[index])));
		expect(reach(0) / (W / 2)).toBeCloseTo(1, 6);
		expect(reach(1) / (H / 2)).toBeCloseTo(1, 6);
		expect(reach(2) / (D / 2)).toBeCloseTo(1, 6);
	});

	test("has faces a box does not — the rim is the whole point", () => {
		// **The assertion that separates it from `BoxGeometry`.** A box has six
		// distinct face normals; a chamfered box has six plus twelve edges plus
		// eight corners. A chamfer silently tuned to zero would pass every other
		// check in this file and leave the slab that was rejected.
		const box = normals(new THREE.BoxGeometry(W, H, D).toNonIndexed());
		const chamfered = normals(chamferedBox(W, H, D, 0.0004));
		expect(box.size).toBe(6);
		expect(chamfered.size).toBe(6 + 12 + 8);
	});

	test("every face is wound outward", () => {
		// A single inverted face is a hole in the form visible from one angle
		// only, because a hull material here is `FrontSide` — the repo has
		// shipped that class of defect twice (#155, #147). The box is convex and
		// centred, so an outward normal is one that agrees with its own centroid.
		const geometry = chamferedBox(W, H, D, 0.0004);
		const position = geometry.getAttribute("position") as THREE.BufferAttribute;
		const a = new THREE.Vector3();
		const b = new THREE.Vector3();
		const c = new THREE.Vector3();
		const centroid = new THREE.Vector3();
		const normal = new THREE.Vector3();
		for (let i = 0; i < position.count; i += 3) {
			a.fromBufferAttribute(position, i);
			b.fromBufferAttribute(position, i + 1);
			c.fromBufferAttribute(position, i + 2);
			centroid.copy(a).add(b).add(c).divideScalar(3);
			normal.copy(b).sub(a).cross(c.clone().sub(a));
			expect(normal.dot(centroid)).toBeGreaterThan(0);
		}
	});

	test("a thin fitting keeps a face rather than becoming all rim", () => {
		// The cabin runs one chamfer figure over a 32 m deck and a 0.75 m bezel.
		// Unclamped, the bezel's 0.4 m cut exceeds its own half-height and the
		// form turns inside out; clamped to half, it keeps a flat face at least
		// as wide as the cut framing it.
		const [w, hgt, d] = [0.0308, 0.00075, 0.0008];
		const thin = chamferedBox(w, hgt, d, 0.0004);
		const v = vertices(thin);
		const EPS = 1e-6;
		for (const [x, y, z] of v) {
			expect(Math.abs(x)).toBeLessThanOrEqual((w / 2) * (1 + EPS));
			expect(Math.abs(y)).toBeLessThanOrEqual((hgt / 2) * (1 + EPS));
			expect(Math.abs(z)).toBeLessThanOrEqual((d / 2) * (1 + EPS));
		}
		// The clamp: 0.4 m asked for against a 0.375 m half-height, so the cut is
		// a quarter of the smallest half-extent and the flat top survives with an
		// inset half-width of h − c on its narrowest axis — three times the cut
		// that frames it, which is what stops a thin fitting reading as piping.
		const c = Math.min(hgt, d) / 2 / 4;
		const top = v.filter(([, y]) => Math.abs(y - hgt / 2) < hgt * EPS);
		expect(top.length).toBeGreaterThan(0);
		// The *inner* extent of the octagon, which is the flat face's own
		// half-width — its outer extent is still the full half-extent, because
		// the vertices cut back along x keep their z.
		expect(
			Math.min(...top.map(([, , z]) => Math.abs(z))) / (d / 2 - c),
		).toBeCloseTo(1, 6);
		expect(d / 2 - c).toBeGreaterThan(0);
	});

	test("carries the uv attribute the plate projection overwrites", () => {
		// `boxProjectUVs` writes into an existing attribute and does not create
		// one; without this the cabin's fittings would go through
		// `plateCockpitUVs` and come out with no UVs at all, which renders as one
		// texel stretched over the whole form.
		const geometry = chamferedBox(W, H, D, 0.0004);
		const uv = geometry.getAttribute("uv");
		const position = geometry.getAttribute("position");
		expect(uv).toBeDefined();
		expect(uv.count).toBe(position.count);
	});
});
