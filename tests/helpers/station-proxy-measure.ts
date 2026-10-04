/**
 * How a station's drawn vertices are held to its collision proxy
 * (`collision.md` §2.2, §9.1.11). One measurement, used by the rows that gate
 * it in `tests/station-proxy.test.ts` and by `scripts/measure-station-proxy.ts`,
 * which reprints it over a wider seed spread. It lives under `tests/helpers/`
 * for the reason `station-rows.ts` gives: the dependency points from the
 * operator tooling into the gated suite, never the other way — and a script
 * with its own copy of the vertex walk, the opening or the frame rule would be
 * measuring something the test does not.
 */

import * as THREE from "three";
import { STATION_GEOMETRY, type StationType } from "../../src/station";
import {
	corridorRadiusKm,
	interiorAxialSpanKm,
	stationInterior,
} from "../../src/station-interior";
import { STATION_SILHOUETTE_KM } from "../../src/station-mesh";
import {
	type ProxyPrimitive,
	type StationProxy,
	padOpeningFloorKm,
	proxyDistanceKm,
} from "../../src/station-proxy";

/**
 * The berth seeds a vertex measurement pairs with **every** plan: one of each
 * parity, because the outpost's seeded berth stands port on an even seed and
 * starboard on an odd one (`stationInterior`), and a plan measured with its
 * berth on one side says nothing about the other.
 */
export const BERTH_SIDES: readonly number[] = [0, 1];

// ---------------------------------------------------------------------------
// The opening, read from the interior catalogue — never from the proxy
// ---------------------------------------------------------------------------

export interface AxialBox {
	hx: number;
	hy: number;
	z0: number;
	z1: number;
}

export interface AxialCylinder {
	radiusKm: number;
	z0: number;
	z1: number;
}

/**
 * What §2.2 leaves open for one role. A bay role has the bay and the prism in
 * the spinning frame; every role has the corridor and (bay roles) the bay's
 * swept cylinder in the static frame.
 */
export interface Opening {
	/** Open in the spinning frame. */
	boxes: AxialBox[];
	cylinders: AxialCylinder[];
	/** Open in the static frame: what the spinning openings sweep. */
	sweptCylinders: AxialCylinder[];
}

export function openingOf(type: StationType): Opening {
	const g = STATION_GEOMETRY[type];
	const plane = g.aperturePlaneKm;
	const reach = STATION_SILHOUETTE_KM[type];
	const interior = stationInterior(type, plane, 0);
	const corridor: AxialCylinder = {
		radiusKm: corridorRadiusKm(g.aperture),
		z0: plane,
		z1: reach,
	};
	if (interior.presentation !== "bay") {
		// A pad's corridor runs on down into its landing well (node #663): the // glossary-ignore: pad
		// floor is the proxy's own expression, read rather than restated, so
		// the opening this row samples is the one the proxy was cut to.
		const well: AxialCylinder = {
			...corridor,
			z0: padOpeningFloorKm(type),
		};
		return { boxes: [], cylinders: [well], sweptCylinders: [well] };
	}
	const [z0, z1] = interiorAxialSpanKm(interior);
	const bay: AxialBox = {
		hx: interior.halfAcrossKm,
		hy: interior.halfUpKm,
		z0,
		z1,
	};
	const prism: AxialBox = {
		hx: interior.laneHalfAcrossKm,
		hy: interior.laneHalfUpKm,
		z0: plane,
		z1: reach,
	};
	return {
		boxes: [bay, prism],
		cylinders: [],
		sweptCylinders: [
			corridor,
			{ radiusKm: Math.hypot(bay.hx, bay.hy), z0: bay.z0, z1: bay.z1 },
		],
	};
}

const insideBox = (b: AxialBox, v: THREE.Vector3) =>
	Math.abs(v.x) < b.hx && Math.abs(v.y) < b.hy && v.z > b.z0 && v.z < b.z1;

const insideCylinder = (c: AxialCylinder, v: THREE.Vector3) =>
	Math.hypot(v.x, v.y) < c.radiusKm && v.z > c.z0 && v.z < c.z1;

/** Is this vertex strictly inside the spinning frame's opening? */
export function inOpening(opening: Opening, v: THREE.Vector3): boolean {
	return (
		opening.boxes.some((b) => insideBox(b, v)) ||
		opening.cylinders.some((c) => insideCylinder(c, v))
	);
}

/**
 * Coordinates across `[lo, hi]`: cell midpoints about 5 m apart, plus one a
 * millionth of the span inside each end. The grid alone stands 2.5 m off every
 * face, so a primitive that crossed a boundary by less than that would be
 * missed; the end values sit on the boundary for every other coordinate.
 */
function span(lo: number, hi: number): number[] {
	const step = 0.005;
	const n = Math.max(2, Math.ceil((hi - lo) / step));
	const eps = (hi - lo) * 1e-6;
	return [
		lo + eps,
		...Array.from({ length: n }, (_, i) => lo + ((i + 0.5) * (hi - lo)) / n),
		hi - eps,
	];
}

/** Points strictly inside an axial box, faces included. */
function sampleBox(b: AxialBox): THREE.Vector3[] {
	const out: THREE.Vector3[] = [];
	const zs = span(b.z0, b.z1);
	for (const x of span(-b.hx, b.hx))
		for (const y of span(-b.hy, b.hy))
			for (const z of zs) out.push(new THREE.Vector3(x, y, z));
	return out;
}

/** Points strictly inside an axial cylinder, its curved wall included. */
export function sampleCylinder(c: AxialCylinder): THREE.Vector3[] {
	const out: THREE.Vector3[] = [];
	const step = 0.005;
	const radii = span(0, c.radiusKm);
	for (const z of span(c.z0, c.z1)) {
		for (const r of radii) {
			const na = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
			for (let a = 0; a < na; a++) {
				const t = (a / na) * 2 * Math.PI;
				out.push(new THREE.Vector3(r * Math.cos(t), r * Math.sin(t), z));
			}
		}
	}
	return out;
}

/** Sample points across the spinning frame's opening, boundaries included. */
export function spinningOpeningPoints(opening: Opening): THREE.Vector3[] {
	return [
		...opening.boxes.flatMap(sampleBox),
		...opening.cylinders.flatMap(sampleCylinder),
	];
}

// ---------------------------------------------------------------------------
// The built mesh's vertices, in kilometres
// ---------------------------------------------------------------------------

export interface NamedVertex {
	v: THREE.Vector3;
	name: string;
	/** Drawn under the spinning member, so it turns with the station. */
	spun: boolean;
}

/**
 * Visit every drawn vertex of a built station, in kilometres, with the part it
 * belongs to and whether it turns with the station. The vertex is reused
 * between calls; a caller that keeps it clones it.
 */
export function forEachVertex(
	built: { root: THREE.Object3D; spinner: THREE.Object3D },
	type: StationType,
	visit: (vertex: NamedVertex) => void,
): void {
	const { root, spinner } = built;
	root.updateMatrixWorld(true);
	const v = new THREE.Vector3();
	const instance = new THREE.Matrix4();
	const core = STATION_GEOMETRY[type].coreRadiusKm;

	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position) return;
		let spun = false;
		for (let a: THREE.Object3D | null = object; a; a = a.parent)
			if (a === spinner) spun = true;
		const name = object.name || object.type;
		const instanced = object as THREE.InstancedMesh;
		const count = instanced.isInstancedMesh ? instanced.count : 1;
		for (let n = 0; n < count; n++) {
			if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance);
			else instance.identity();
			for (let i = 0; i < position.count; i++) {
				v.fromBufferAttribute(position as THREE.BufferAttribute, i);
				v.applyMatrix4(instance);
				mesh.localToWorld(v);
				// The root is normalised to core radii — convert back to km
				v.multiplyScalar(core);
				visit({ v, name, spun });
			}
		}
	});
}

/** Every drawn vertex of a built station, in kilometres. */
export function extractVertices(
	built: { root: THREE.Object3D; spinner: THREE.Object3D },
	type: StationType,
): NamedVertex[] {
	const out: NamedVertex[] = [];
	forEachVertex(built, type, ({ v, name, spun }) =>
		out.push({ v: v.clone(), name, spun }),
	);
	return out;
}

/**
 * The primitives a vertex is held to: **those of its own frame**. On a station
 * that spins, a vertex drawn under the spinning member is held to
 * `proxy.spinning` alone and every other vertex to `proxy.static` alone: at
 * phase 0 the two frames coincide, so testing against both at once would let
 * a turning part be covered by a primitive that does not turn with it — a
 * contact in the wrong frame once the station moves. A station that does not
 * spin has one frame, and both lists are it.
 */
export function framePrimitives(
	proxy: StationProxy,
	type: StationType,
	spun: boolean,
): readonly ProxyPrimitive[] {
	if (!STATION_GEOMETRY[type].spins)
		return [...proxy.spinning, ...proxy.static];
	return spun ? proxy.spinning : proxy.static;
}

/** Is this vertex inside a primitive of its own frame, within a tolerance? */
export function vertexInsideProxy(
	proxy: StationProxy,
	type: StationType,
	vertex: NamedVertex,
	tolerance: number,
): boolean {
	return vertexOvershootKm(proxy, type, vertex) <= tolerance;
}

/**
 * How far outside the primitives of its own frame a vertex stands, kilometres:
 * negative inside. What `vertexInsideProxy` compares with its tolerance, as a
 * figure an instrument can print.
 */
export function vertexOvershootKm(
	proxy: StationProxy,
	type: StationType,
	{ v, spun }: NamedVertex,
): number {
	let d = Infinity;
	for (const p of framePrimitives(proxy, type, spun))
		d = Math.min(d, proxyDistanceKm(p, v.x, v.y, v.z));
	return d;
}

/**
 * The drawn vertices outside the opening that no primitive of their own frame
 * holds within the tolerance: what the vertex rows count. One copy, so the
 * rows that read it cannot disagree about what the opening exempts.
 */
export function verticesOutsideProxy(
	built: { root: THREE.Object3D; spinner: THREE.Object3D },
	type: StationType,
	proxy: StationProxy,
	opening: Opening,
	tolerance: number,
): NamedVertex[] {
	return extractVertices(built, type).filter(
		(vertex) =>
			!inOpening(opening, vertex.v) &&
			!vertexInsideProxy(proxy, type, vertex, tolerance),
	);
}
