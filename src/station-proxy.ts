/**
 * A station's collision proxy: a small set of convex primitives — spheres,
 * capsules and axis-aligned boxes — in the station's own frame, in kilometres.
 *
 * `docs/specs/collision.md` §2.2 is the contract. This module is Three-free
 * and imports nothing from the renderer, for the reason `station.ts`'s header
 * gives — the authoritative world is float64 kilometres outside the scene
 * graph. The renderer never reads it; the sim does.
 *
 * **Where it lives.** Beside `STATION_GEOMETRY` (`station.ts`) and the
 * interior catalogue (`station-interior.ts`). Each form's solid is written down
 * here first, as primitives a reader can check against the form's own
 * constants, and then measured by `tests/station-proxy.test.ts` against the
 * built mesh in both directions: every drawn vertex inside the proxy within a
 * stated tolerance, and no primitive inside the opening. It is never generated
 * from the mesh — a proxy generated from the mesh would pass any check against
 * that mesh by construction (§2.2).
 *
 * **What it is a function of.** §2.2 writes `(type, form, berthSeed,
 * assemblySeed)`, and the signature carries all four. **No selected form reads
 * `berthSeed`**: it decides only which side the outpost's seeded berth stands
 * on, and both sides lie inside the same primitives. A test row asserts the
 * proxy is identical across berth seeds, so a form that starts to read it is
 * a red row rather than a surprise. For the refinery's solved form the proxy
 * reads the same placement solve the mesh reads (`placementsOf`), cell by
 * cell. The outpost's Salvage is solved from its own draw rather than from a
 * placement grid, and its proxy bounds every plan instead of following one.
 *
 * **What it turns with.** `spinning` primitives are in the spinning member's
 * frame. `static` primitives are in the static frame — only non-empty for the
 * shipyard, whose keel is static while the drum spins.
 *
 * **The openings** (§2.2), read from the interior catalogue rather than
 * restated. On a trade station or a shipyard the proxy leaves the bay open over
 * `interiorAxialSpanKm`, and the prism the aperture rectangle sweeps outward
 * from the plane. On a refinery or an outpost it leaves the corridor cylinder
 * at `corridorRadiusKm` open, outward from the plane. A static primitive must
 * clear what the rectangle sweeps as the station turns, so the shipyard's keel
 * clears the corridor cylinder and the bay's swept cylinder. The openings are
 * gaps — no primitive holds a point of them — not modelled holes, and a box
 * that would cross one is cut into the pieces around it (`cutAround`).
 */

import type { StationType } from "./station";
import { STATION_GEOMETRY } from "./station";
import {
	corridorRadiusKm,
	interiorAxialSpanKm,
	stationInterior,
} from "./station-interior";
import type { StationFormId } from "./station-mesh";
import { type Placement, placementsOf } from "./station-modular";
import { REFINERY_VOCABULARY, SALVAGE_CORE } from "./station-plant";

// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------

/** An axis-aligned box centred at `centre` with half-extents. */
export interface ProxyBox {
	readonly kind: "box";
	/** Centre in km, in the relevant frame (spinning or static). */
	readonly cx: number;
	readonly cy: number;
	readonly cz: number;
	/** Half-extents in km. */
	readonly hx: number;
	readonly hy: number;
	readonly hz: number;
}

/** A sphere centred at `centre` with `radiusKm`. */
export interface ProxySphere {
	readonly kind: "sphere";
	readonly cx: number;
	readonly cy: number;
	readonly cz: number;
	readonly radiusKm: number;
}

/** A capsule: a cylinder with hemispherical end-caps, along a segment. */
export interface ProxyCapsule {
	readonly kind: "capsule";
	/** Start point of the axis segment (centre of one hemisphere). */
	readonly ax: number;
	readonly ay: number;
	readonly az: number;
	/** End point of the axis segment (centre of the other hemisphere). */
	readonly bx: number;
	readonly by: number;
	readonly bz: number;
	/** Radius of the cylinder and hemispherical caps. */
	readonly radiusKm: number;
}

export type ProxyPrimitive = ProxyBox | ProxySphere | ProxyCapsule;

/**
 * A station's collision proxy.
 *
 * Both primitive lists are in kilometres. `spinning` is in the spinning
 * member's frame (rotated by the phase from `slotPhaseRad`). `static` is
 * in the station's non-rotating frame; it is non-empty only for forms
 * with a static structure (the shipyard's keel).
 */
export interface StationProxy {
	/** Primitives in the spinning member's frame. */
	readonly spinning: readonly ProxyPrimitive[];
	/** Primitives in the static frame (the shipyard's keel). */
	readonly static: readonly ProxyPrimitive[];
	/**
	 * The thinnest primitive in the proxy, kilometres — the figure §4.1's
	 * sub-step bound reads to cap motion per sub-step.
	 */
	readonly thinnestKm: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A point in the station's frame, kilometres. */
interface Point {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/** A box by its bounds rather than its centre — what the cuts work in. */
interface Bounds {
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
	readonly z0: number;
	readonly z1: number;
}

function boxOf(b: Bounds): ProxyBox {
	return {
		kind: "box",
		cx: (b.x0 + b.x1) / 2,
		cy: (b.y0 + b.y1) / 2,
		cz: (b.z0 + b.z1) / 2,
		hx: (b.x1 - b.x0) / 2,
		hy: (b.y1 - b.y0) / 2,
		hz: (b.z1 - b.z0) / 2,
	};
}

/** A box symmetric about the axis in x and y. */
const axial = (hx: number, hy: number, z0: number, z1: number): Bounds => ({
	x0: -hx,
	x1: hx,
	y0: -hy,
	y1: hy,
	z0,
	z1,
});

function sphere(c: Point, radiusKm: number): ProxySphere {
	return { kind: "sphere", cx: c.x, cy: c.y, cz: c.z, radiusKm };
}

function capsule(a: Point, b: Point, radiusKm: number): ProxyCapsule {
	return {
		kind: "capsule",
		ax: a.x,
		ay: a.y,
		az: a.z,
		bx: b.x,
		by: b.y,
		bz: b.z,
		radiusKm,
	};
}

/**
 * `box` minus `hole`, as at most six boxes that cover the rest and hold no
 * point of the hole. Slices off what lies beyond the hole in x, then in y,
 * then in z; a box the hole does not reach comes back whole.
 */
function cutBox(box: Bounds, hole: Bounds): Bounds[] {
	const misses =
		box.x1 <= hole.x0 ||
		box.x0 >= hole.x1 ||
		box.y1 <= hole.y0 ||
		box.y0 >= hole.y1 ||
		box.z1 <= hole.z0 ||
		box.z0 >= hole.z1;
	if (misses) return [box];
	const out: Bounds[] = [];
	if (box.x0 < hole.x0) out.push({ ...box, x1: hole.x0 });
	if (box.x1 > hole.x1) out.push({ ...box, x0: hole.x1 });
	const mx = {
		...box,
		x0: Math.max(box.x0, hole.x0),
		x1: Math.min(box.x1, hole.x1),
	};
	if (mx.y0 < hole.y0) out.push({ ...mx, y1: hole.y0 });
	if (mx.y1 > hole.y1) out.push({ ...mx, y0: hole.y1 });
	const my = {
		...mx,
		y0: Math.max(mx.y0, hole.y0),
		y1: Math.min(mx.y1, hole.y1),
	};
	if (my.z0 < hole.z0) out.push({ ...my, z1: hole.z0 });
	if (my.z1 > hole.z1) out.push({ ...my, z0: hole.z1 });
	return out;
}

/** Every box minus every hole, as primitives. */
function cutAround(
	boxes: readonly Bounds[],
	holes: readonly Bounds[],
): ProxyBox[] {
	let pieces = [...boxes];
	for (const hole of holes) pieces = pieces.flatMap((b) => cutBox(b, hole));
	return pieces.map(boxOf);
}

/**
 * A horizontal ring of `count` capsules: a polygon of radius `radiusKm` about
 * the axis at height `z`, each edge a capsule of `tubeKm`. What a rock or a
 * deck round an open axis needs and a box cannot give: the ring's inner edge
 * stands at `radiusKm × cos(π / count) − tubeKm` from the axis.
 */
function ring(
	radiusKm: number,
	z: number,
	tubeKm: number,
	count = 16,
): ProxyCapsule[] {
	const corner = (i: number): Point => {
		const t = (i / count) * 2 * Math.PI;
		return { x: radiusKm * Math.cos(t), y: radiusKm * Math.sin(t), z };
	};
	return Array.from({ length: count }, (_, i) =>
		capsule(corner(i), corner(i + 1), tubeKm),
	);
}

/**
 * The thinnest dimension across all primitives: the smallest full extent,
 * diameter or capsule diameter in the set.
 */
function computeThinnest(primitives: readonly ProxyPrimitive[]): number {
	let min = Infinity;
	for (const p of primitives) {
		switch (p.kind) {
			case "box":
				min = Math.min(min, p.hx, p.hy, p.hz);
				break;
			case "sphere":
				min = Math.min(min, p.radiusKm);
				break;
			case "capsule":
				min = Math.min(min, p.radiusKm);
				break;
		}
	}
	return min * 2; // thinnest full extent, not half-extent
}

function proxyOf(
	spinning: readonly ProxyPrimitive[],
	staticPrims: readonly ProxyPrimitive[] = [],
): StationProxy {
	return {
		spinning,
		static: staticPrims,
		thinnestKm: computeThinnest([...spinning, ...staticPrims]),
	};
}

// ---------------------------------------------------------------------------
// The openings, read from the interior catalogue
// ---------------------------------------------------------------------------

/**
 * What a box may not cross on a trade station or a shipyard: the bay over
 * `interiorAxialSpanKm`, and the aperture rectangle swept outward from the
 * plane without end.
 */
function bayHoles(type: StationType): Bounds[] {
	const plane = STATION_GEOMETRY[type].aperturePlaneKm;
	const interior = stationInterior(type, plane);
	const [end, mouth] = interiorAxialSpanKm(interior);
	return [
		axial(interior.halfAcrossKm, interior.halfUpKm, end, mouth),
		axial(interior.laneHalfAcrossKm, interior.laneHalfUpKm, plane, Infinity),
	];
}

/**
 * What a box may not cross on a refinery or an outpost: the corridor
 * cylinder, as the square prism that circumscribes it, outward from the plane.
 * A box cut to the square clears the cylinder; the corners it leaves open are
 * open space outside the corridor, and the ring a form carries round the axis
 * covers them.
 */
function corridorHole(type: StationType): Bounds {
	const g = STATION_GEOMETRY[type];
	const r = corridorRadiusKm(g.aperture);
	return axial(r, r, g.aperturePlaneKm, Infinity);
}

// ---------------------------------------------------------------------------
// Trade A — Coriolis
// ---------------------------------------------------------------------------

/**
 * The Coriolis's half-width: the cuboctahedron's square faces stand at
 * `CUBOCTAHEDRON_FACE × circumradius`, and its twelve vertices at
 * `(±face, ±face, 0)` and their permutations — 0.570 km out against a 0.62 km
 * reach.
 */
const CORIOLIS_FACE_KM = 0.403;

/**
 * A cuboctahedron is `max(|x|, |y|, |z|) ≤ f` and `|x| + |y| + |z| ≤ 2f`, so
 * it is covered by a jack — three boxes, each full length on one axis and
 * `JACK_HALF` on the other two — plus a small sphere at each of its twelve
 * vertices, which are the only points two coordinates past the jack reach.
 * `JACK_HALF` is the widest a box's corner allows inside the 0.62 km reach.
 *
 * A fourth, longer arm carries the dishes and strobes standing off the ±x
 * faces, and a shallow box in front of the +Z face carries the docking collar
 * and the face's windows. Every box is cut round the bay and the prism.
 */
function tradeCoriolisProxy(): StationProxy {
	const f = CORIOLIS_FACE_KM;
	const JACK_HALF = 0.333;
	const ARM_HALF = 0.25;
	const ARM_REACH = 0.5;
	const COLLAR_FRONT = 0.46;
	const COLLAR_HALF = 0.25;

	const solid: Bounds[] = [
		axial(f, JACK_HALF, -JACK_HALF, JACK_HALF),
		axial(JACK_HALF, f, -JACK_HALF, JACK_HALF),
		axial(JACK_HALF, JACK_HALF, -f, f),
		axial(ARM_REACH, ARM_HALF, -ARM_HALF, ARM_HALF),
		axial(COLLAR_HALF, COLLAR_HALF, f, COLLAR_FRONT),
	];

	const VERTEX_RADIUS = 0.05;
	const vertices: Point[] = [];
	for (const a of [-f, f])
		for (const b of [-f, f])
			vertices.push(
				{ x: a, y: b, z: 0 },
				{ x: a, y: 0, z: b },
				{ x: 0, y: a, z: b },
			);

	return proxyOf([
		...cutAround(solid, bayHoles("trade")),
		...vertices.map((v) => sphere(v, VERTEX_RADIUS)),
	]);
}

// ---------------------------------------------------------------------------
// Shipyard A — Gantry
// ---------------------------------------------------------------------------

/**
 * The Gantry: a drum on the spin axis that turns, and a keel behind it that
 * does not.
 *
 * **Spinning.** The drum (`core`, square section to ±0.324 km, aft face
 * -0.30 km, forward face at the 0.372 km plane) and the spindle behind it,
 * as one box cut round the bay and the prism.
 *
 * **Static.** The keel runs along x behind the drum (centred
 * `SHIPYARD_KEEL_AFT_KM` aft), carrying seven arches, two rails and the
 * fixtures; two booms run forward from it at ±y outboard of the bay. The keel
 * is a centre box and two end boxes, each as long as its corners allow inside
 * the 1.66 km reach, and the end arches — whose lowest point is beyond the end
 * boxes — are a chain of capsules each. Nothing static stands within the bay's
 * swept cylinder or the corridor, because the booms are 0.37 km off the axis.
 */
function shipyardGantryProxy(): StationProxy {
	const drum = cutAround([axial(0.33, 0.33, -0.55, 0.4)], bayHoles("shipyard"));

	const KEEL_Z = -0.68; // SHIPYARD_KEEL_AFT_KM
	const centre: Bounds = {
		x0: -0.95,
		x1: 0.95,
		y0: -0.55,
		y1: 0.55,
		z0: -1.09,
		z1: -0.29,
	};
	const starboardEnd: Bounds = {
		x0: 0.95,
		x1: 1.29,
		y0: -0.38,
		y1: 0.38,
		z0: -0.9,
		z1: -0.4,
	};
	const portEnd: Bounds = { ...starboardEnd, x0: -1.3, x1: -0.95 };
	const portTip: Bounds = {
		x0: -1.38,
		x1: -1.3,
		y0: -0.14,
		y1: 0.14,
		z0: -0.85,
		z1: -0.5,
	};
	const boom = (sign: number): Bounds => ({
		x0: -0.24,
		x1: 0.24,
		y0: sign > 0 ? 0.37 : -0.58,
		y1: sign > 0 ? 0.58 : -0.37,
		z0: -0.72,
		z1: 1.15,
	});

	// An end arch: a half-ring under the keel at x = ±1.2, from one side's
	// top round the bottom to the other's.
	const ARCH_RADIUS = 0.4;
	const ARCH_TUBE = 0.03;
	const arch = (x: number): ProxyCapsule[] => {
		const point = (deg: number): Point => {
			const t = (deg * Math.PI) / 180;
			return {
				x,
				y: ARCH_RADIUS * Math.sin(t),
				z: KEEL_Z - ARCH_RADIUS * Math.cos(t),
			};
		};
		const steps = [-90, -60, -30, 0, 30, 60, 90];
		return steps
			.slice(1)
			.map((deg, i) => capsule(point(steps[i]), point(deg), ARCH_TUBE));
	};

	const keel = [centre, starboardEnd, portEnd, portTip, boom(1), boom(-1)].map(
		boxOf,
	);
	return proxyOf(drum, [...keel, ...arch(1.196), ...arch(-1.196)]);
}

// ---------------------------------------------------------------------------
// Solved forms: shared helpers
// ---------------------------------------------------------------------------

/**
 * Build a box per occupied cell in a solved plan. Each cell centre is at
 * `(dx * cellKm, dy * cellKm, z)`, and each box is a cell wide and `2 × halfZ`
 * tall, centred at the cell.
 */
function cellBoxes(
	placements: readonly Placement[],
	cellKm: number,
	z: number,
	halfZ: number,
): Bounds[] {
	const half = cellKm / 2;
	return placements.map((p) => ({
		x0: p.dx * cellKm - half,
		x1: p.dx * cellKm + half,
		y0: p.dy * cellKm - half,
		y1: p.dy * cellKm + half,
		z0: z - halfZ,
		z1: z + halfZ,
	}));
}

// ---------------------------------------------------------------------------
// Refinery D — Works (solved form)
// ---------------------------------------------------------------------------

/**
 * The Works: a quarried asteroid with a WFC-solved plant on its flat top and
 * the deck at the 0.396 km plane. It does not spin; everything goes in
 * `spinning`, which for a station that does not turn is its one frame.
 *
 * - **The rock** is a sphere centred below the origin, as large as the reach
 *   allows with its top under the plane, plus a ring of capsules round its
 *   flanks where the lumps stand furthest out.
 * - **The plant** is one box per occupied cell of the placement solve, from
 *   the quarry floor up, cut round the corridor.
 * - **The deck and what stands above it** — head house, sheave, the tall
 *   columns — is a ring of capsules round the corridor, its inner edge outside
 *   `corridorRadiusKm`.
 */
function refineryWorksProxy(assemblySeed: number): StationProxy {
	const g = STATION_GEOMETRY.refinery;
	const plane = g.aperturePlaneKm; // 0.396
	const cellKm = 0.16; // WORKS_CELL_KM
	const floorZ = 0.16; // WORKS_FLOOR_KM

	const ROCK_CENTRE = -0.15;
	const rock = sphere({ x: 0, y: 0, z: ROCK_CENTRE }, 0.53);
	const flanks = ring(0.4, 0, 0.27);

	const { placements } = placementsOf(REFINERY_VOCABULARY, assemblySeed);
	const unitHalfZ = 0.1;
	const plant = cutAround(
		cellBoxes(placements, cellKm, floorZ + unitHalfZ, unitHalfZ),
		[corridorHole("refinery")],
	);

	const deck = ring(0.25, plane + 0.054, 0.13);

	return proxyOf([rock, ...flanks, ...plant, ...deck]);
}

// ---------------------------------------------------------------------------
// Outpost E — Salvage (solved form, selected)
// ---------------------------------------------------------------------------

/**
 * The Salvage: a boxy freighter section (the core) carrying the deck, with
 * welded debris round it. The debris is drawn from the assembly seed by the
 * form's own generator rather than by a placement grid, so the proxy bounds
 * every plan rather than following one:
 *
 * - the core section as a box from its keel to the underside of the deck;
 * - a sphere centred below the origin, its top under the plane, for the
 *   debris welded round the core;
 * - a ring of capsules round its flanks for the hull sections that stand
 *   furthest out;
 * - a ring round the corridor for the deck, its inner edge outside
 *   `corridorRadiusKm`.
 */
function outpostSalvageProxy(): StationProxy {
	const g = STATION_GEOMETRY.outpost;
	const r = g.coreRadiusKm;
	const plane = g.aperturePlaneKm;

	const deckUnder = plane - r * 0.16;
	const core = boxOf(
		axial(
			SALVAGE_CORE.halfWidthKm,
			SALVAGE_CORE.halfHeightKm,
			SALVAGE_CORE.bottomKm,
			deckUnder,
		),
	);
	const debris = sphere({ x: 0, y: 0, z: -0.1275 }, 0.2925);
	const flanks = ring(0.2, 0, 0.12);
	const deck = ring(0.16, plane + 0.005, 0.07);

	return proxyOf([core, debris, ...flanks, ...deck]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a station's collision proxy for a given form and seed.
 *
 * Returns `null` for a form that has no proxy. Only the selected forms
 * (`SELECTED_FORM`) have one, because only they can be drawn by a running
 * game (§2.2), and the test rows measure only them — an alternate's proxy
 * would be a claim nothing checks. A selected form must never return `null`:
 * the test asserts it, which is how selecting an alternate without building
 * its proxy goes red.
 */
export function stationProxy(
	type: StationType,
	form: StationFormId,
	_berthSeed: number,
	assemblySeed: number,
): StationProxy | null {
	switch (type) {
		case "trade":
			return form === "a" ? tradeCoriolisProxy() : null;
		case "shipyard":
			return form === "a" ? shipyardGantryProxy() : null;
		case "refinery":
			return form === "d" ? refineryWorksProxy(assemblySeed) : null;
		case "outpost":
			return form === "e" ? outpostSalvageProxy() : null;
		default:
			return type satisfies never;
	}
}

/**
 * The furthest extent of any primitive in the proxy, in kilometres from the
 * origin. Used by the budget test to check no primitive lies outside
 * `reachKm`.
 */
export function proxyReachKm(proxy: StationProxy): number {
	let max = 0;
	for (const p of [...proxy.spinning, ...proxy.static]) {
		switch (p.kind) {
			case "box": {
				// The box corner farthest from the origin
				const dx = Math.abs(p.cx) + p.hx;
				const dy = Math.abs(p.cy) + p.hy;
				const dz = Math.abs(p.cz) + p.hz;
				max = Math.max(max, Math.sqrt(dx * dx + dy * dy + dz * dz));
				break;
			}
			case "sphere":
				max = Math.max(
					max,
					Math.sqrt(p.cx * p.cx + p.cy * p.cy + p.cz * p.cz) + p.radiusKm,
				);
				break;
			case "capsule": {
				const da =
					Math.sqrt(p.ax * p.ax + p.ay * p.ay + p.az * p.az) + p.radiusKm;
				const db =
					Math.sqrt(p.bx * p.bx + p.by * p.by + p.bz * p.bz) + p.radiusKm;
				max = Math.max(max, da, db);
				break;
			}
		}
	}
	return max;
}

/**
 * Test whether a point (in the proxy's frame, in km) lies inside any
 * primitive of the proxy, within a tolerance. A negative tolerance asks
 * whether the point is strictly inside by at least that much.
 */
export function proxyContains(
	primitives: readonly ProxyPrimitive[],
	x: number,
	y: number,
	z: number,
	toleranceKm: number,
): boolean {
	for (const p of primitives) {
		switch (p.kind) {
			case "box": {
				const dx = Math.abs(x - p.cx) - p.hx;
				const dy = Math.abs(y - p.cy) - p.hy;
				const dz = Math.abs(z - p.cz) - p.hz;
				// Distance outside the box, not the largest axis overshoot: a
				// point past two faces at once is further away than either.
				const outside = Math.hypot(
					Math.max(dx, 0),
					Math.max(dy, 0),
					Math.max(dz, 0),
				);
				const inside = Math.min(Math.max(dx, dy, dz), 0);
				if (outside + inside <= toleranceKm) return true;
				break;
			}
			case "sphere": {
				const dx = x - p.cx;
				const dy = y - p.cy;
				const dz = z - p.cz;
				if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= p.radiusKm + toleranceKm)
					return true;
				break;
			}
			case "capsule": {
				// Distance from point to the line segment (a, b)
				const abx = p.bx - p.ax;
				const aby = p.by - p.ay;
				const abz = p.bz - p.az;
				const apx = x - p.ax;
				const apy = y - p.ay;
				const apz = z - p.az;
				const ab2 = abx * abx + aby * aby + abz * abz;
				const t =
					ab2 > 0
						? Math.max(
								0,
								Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2),
							)
						: 0;
				const cx = p.ax + t * abx;
				const cy = p.ay + t * aby;
				const cz = p.az + t * abz;
				const dx = x - cx;
				const dy = y - cy;
				const dz = z - cz;
				if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= p.radiusKm + toleranceKm)
					return true;
				break;
			}
		}
	}
	return false;
}
