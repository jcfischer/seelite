/**
 * A station's collision proxy: a small set of convex primitives — spheres,
 * capsules and axis-aligned boxes — in the station's own frame, in kilometres.
 *
 * `docs/specs/collision.md` §2.2 is the contract. This module is Three-free
 * and imports nothing from the renderer, for the reason `station.ts`'s header
 * gives — the authoritative world is float64 kilometres outside the scene
 * graph. The renderer never reads it. The sim does (node #663): `stepWorld`
 * sweeps the flown hull against the proxy of every station in reach, in the
 * form its system picked for it (node #717), posed by `stationMotions` below,
 * and the docking harness and the collision rows pose it through the same
 * call.
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
 * a red row rather than a surprise. The shipyards', the refineries' and the
 * outpost Salvage's proxies are the exception to "never generated": they are
 * fitted to their authored models (nodes #818, #819, #1031), and their own
 * tests measure the boxes against the drawn triangles rather than against the
 * fit. The sim collides with the authored model whatever is drawn, so none of
 * them reads an assembly seed, though the procedural Salvage that stands in
 * while its model loads is grown from one.
 *
 * **What it turns with.** `spinning` primitives are in the spinning member's
 * frame. `static` primitives are in the static frame: the shipyard's yard
 * and the trade Assembly's cell structure stay still while their hubs spin.
 *
 * **The openings** (§2.2), read from the interior catalogue rather than
 * restated. On a trade station or a shipyard the proxy leaves the bay open over
 * `interiorAxialSpanKm`, and the prism the aperture rectangle sweeps outward
 * from the plane. On a refinery or an outpost it leaves the corridor cylinder
 * at `corridorRadiusKm` open, outward from the plane **and down into the
 * landing well below it** (`padWellDepthKm`, node #663). A static primitive must
 * clear what the rectangle sweeps as the station turns, so the shipyard's keel
 * clears the corridor cylinder and the bay's swept cylinder. The openings are
 * gaps — no primitive holds a point of them — not modelled holes, and a box
 * that would cross one is cut into the pieces around it (`cutAround`).
 */

import type { Pose, Primitive, SolidMotion } from "./collision";
import { type ApertureFrame, frameAtPhase, slotBasis } from "./docking";
import type { StationFormId, StationPlan, StationType } from "./station";
import { STATION_GEOMETRY } from "./station";
import { HULL_SPECS } from "./hull";
import {
	admittedHulls,
	corridorRadiusKm,
	interiorAxialSpanKm,
	stationInterior,
} from "./station-interior";
import {
	PAD_CUE_PROUD_KM,
	PAD_VENT_BANK_KM,
	PAD_VENT_BANK_X_KM,
	REFINERY_PAD_FRAME,
} from "./refinery-pad-frame";
import { OUTPOST_PROXIES, OUTPOST_PROXY_PACK } from "./outpost-proxies";
import { REFINERY_PROXIES, REFINERY_PROXY_PACK } from "./refinery-proxies";
import { SHIPYARD_PROXIES, SHIPYARD_PROXY_PACK } from "./shipyard-proxies";
import {
	buildSphereGrid,
	INDEX_CELL_KM,
	INDEXED_ABOVE,
	querySphereGrid,
	type Sphere,
	type SphereGrid,
} from "./sphere-grid";
import { HUB, modularPlacements } from "./station-modular";
import { type Vec3, cross, v3 } from "./vec3";

// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------

/** A box centred at `centre` with half-extents: axis-aligned, or along
 *  `axes` where it has them (the authored shipyards, node #818). */
export interface ProxyBox {
	readonly kind: "box";
	/** Centre in km, in the relevant frame (spinning or static). */
	readonly cx: number;
	readonly cy: number;
	readonly cz: number;
	/** Half-extents in km, along `axes` when present. */
	readonly hx: number;
	readonly hy: number;
	readonly hz: number;
	/** The box's own axes, unit and orthogonal; absent is the frame's. */
	readonly axes?: readonly [Vec3, Vec3, Vec3];
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
 * with a static structure (the shipyard's yard and the trade Assembly).
 */
export interface StationProxy {
	/** Primitives in the spinning member's frame. */
	readonly spinning: readonly ProxyPrimitive[];
	/** Primitives in the static frame (the shipyard's yard or Assembly's cells). */
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
 * How far a pad's opening runs **below** its plane: the landing well // glossary-ignore: pad
 * (node #663, `collision.md` §2.2 — derived, and the principal's to ratify).
 *
 * **Why a pad needs one and a slot does not.** A docking ship's nose is within // glossary-ignore: pad, slot
 * check 2's 35° of the inward axis, so when its centre reaches the plane the
 * front half of its hull box is already past it. Behind a slot's plane that is // glossary-ignore: slot
 * the open bay (`interiorAxialSpanKm`). Behind a pad's it was solid — the deck // glossary-ignore: pad
 * under its hole, the Works' head house, the Salvage's core and rock all reach
 * the plane on the axis — so with stations solid the nose met the pad before // glossary-ignore: pad
 * the centre could cross, an impact owned every tick (§4.2), and no hull could
 * dock at a pad at all. The docking-computer harness measured it: every hull at // glossary-ignore: pad
 * both pad roles stopped at the deck with no crossing. // glossary-ignore: pad
 *
 * **The depth is the deepest a docking hull can reach**, read off the hulls
 * rather than written down: the half-diagonal of each hull's box plus its
 * offset from the ship's origin (`HULL_SPECS[id].envCentre`), over every hull
 * a berth of this role admits — a hull no berth admits cannot be granted, so
 * it never crosses. That bounds axial reach below the plane at any attitude;
 * lateral fit against `corridorRadiusKm` is a separate question, measured by
 * the seeded physical-fit table and its gated centred-entry rows. An entry
 * off the axis is P1's physical fit: a wing past the corridor meets the deck,
 * as a slot's rim does. // glossary-ignore: slot
 *
 * Zero for a slot role: its bay is the opening behind its plane. // glossary-ignore: slot
 */
export function padWellDepthKm(type: StationType): number {
	if (STATION_GEOMETRY[type].aperture.kind !== "pad") return 0; // glossary-ignore: pad
	const cached = wellDepthCache.get(type);
	if (cached !== undefined) return cached;
	let depth = 0;
	for (const id of admittedHulls(type)) {
		const { env, envCentre } = HULL_SPECS[id];
		const reach =
			Math.hypot(env.lengthKm, env.beamKm, env.heightKm) / 2 +
			Math.hypot(envCentre.rightKm, envCentre.upKm, envCentre.foreKm);
		depth = Math.max(depth, reach);
	}
	wellDepthCache.set(type, depth);
	return depth;
}

const wellDepthCache = new Map<StationType, number>();

/** The floor of a pad's opening: its plane less the well (`padWellDepthKm`). */ // glossary-ignore: pad
export const padOpeningFloorKm = (type: StationType): number =>
	STATION_GEOMETRY[type].aperturePlaneKm - padWellDepthKm(type);

/**
 * What a box may not cross on a refinery or an outpost: the corridor
 * cylinder, as the square prism that circumscribes it, from the landing
 * well's floor outward. A box cut to the square clears the cylinder; the
 * corners it leaves open are open space outside the corridor, and the ring a
 * form carries round the axis covers them.
 */
function corridorHole(type: StationType): Bounds {
	const g = STATION_GEOMETRY[type];
	const r = corridorRadiusKm(g.aperture);
	return axial(r, r, padOpeningFloorKm(type), Infinity);
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
		// Authored roof machinery and masts: the flight asset reaches 520.5 m
		// on +Y, outside the original jack. This arm turns with the hull.
		{ x0: -0.245, x1: 0.245, y0: f, y1: 0.523, z0: -0.065, z1: 0.065 },
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
// Trade B — Ring
// ---------------------------------------------------------------------------

function tradeRingProxy(): StationProxy {
	const r = STATION_GEOMETRY.trade.coreRadiusKm;
	const major = r * 0.92;
	const spinning: ProxyPrimitive[] = [
		...ring(major, 0, r * 0.17, 24),
		...ring(major * 0.56, 0, r * 0.016, 24),
		...cutAround(
			[
				axial(
					r * 0.34,
					r * 0.34,
					-r * 0.42,
					STATION_GEOMETRY.trade.aperturePlaneKm + 0.016,
				),
			],
			bayHoles("trade"),
		),
	];
	// The two face masts carry dishes 90 m above the rim's crown.
	for (const side of [-1, 1])
		spinning.push(
			capsule(
				{ x: side * major, y: 0, z: r * 0.13 },
				{ x: side * major, y: 0, z: r * 0.13 + 0.092 },
				0.015,
			),
		);
	for (let i = 0; i < 4; i++) {
		const theta = (i * Math.PI) / 2;
		for (const side of [-1, 1]) {
			const point = (radial: number, tangent: number): Point => ({
				x: Math.cos(theta) * radial - Math.sin(theta) * tangent,
				y: Math.sin(theta) * radial + Math.cos(theta) * tangent,
				z: 0,
			});
			spinning.push(
				capsule(
					point(r * 0.14, side * r * 0.04),
					point(major - r * 0.13 * 0.94, side * r * 0.15),
					r * 0.026,
				),
			);
		}
	}
	return proxyOf(spinning);
}

// ---------------------------------------------------------------------------
// Trade C — Drum
// ---------------------------------------------------------------------------

function tradeDrumProxy(): StationProxy {
	const r = STATION_GEOMETRY.trade.coreRadiusKm;
	const body = r * 0.46;
	// Twelve-sided barrel, bands, and its flank machinery. Slices narrow at
	// the aft cap so their corners stay within the form's 660 m reach.
	const solid = [
		axial(body * 0.55, body * 0.55, -r * 1.02, -r * 0.86),
		axial(0.29, 0.29, -r * 0.86, -r * 0.5),
		axial(body * 1.18, body * 1.18, -r * 0.5, r * 0.6),
		axial(
			body * 0.8,
			body * 0.8,
			r * 0.6,
			STATION_GEOMETRY.trade.aperturePlaneKm + 0.016,
		),
	];
	return proxyOf(cutAround(solid, bayHoles("trade")));
}

// ---------------------------------------------------------------------------
// Trade D — Assembly: the hub spins; the solved cell structure does not.
// ---------------------------------------------------------------------------

function tradeAssemblyProxy(assemblySeed: number): StationProxy {
	const r = STATION_GEOMETRY.trade.coreRadiusKm;
	const plane = STATION_GEOMETRY.trade.aperturePlaneKm;
	const spinning = cutAround(
		[axial(r * 0.34, r * 0.34, -r * 0.3, plane + 0.016)],
		bayHoles("trade"),
	);
	const bay = stationInterior("trade", plane);
	const [end] = interiorAxialSpanKm(bay);
	const swept = Math.hypot(bay.halfAcrossKm, bay.halfUpKm);
	// Cut the swept bay, not its phase-zero rectangle, from static cells.
	const holes = [axial(swept, swept, end, Infinity)];
	const cells = modularPlacements(assemblySeed)
		.placements.filter((p) => p.module !== HUB)
		.map(
			(p): Bounds => ({
				x0: p.dx * 0.2 - 0.1,
				x1: p.dx * 0.2 + 0.1,
				y0: p.dy * 0.2 - 0.1,
				y1: p.dy * 0.2 + 0.1,
				z0: -0.06,
				z1: 0.1,
			}),
		);
	return proxyOf(spinning, cutAround(cells, holes));
}

// ---------------------------------------------------------------------------
// Trade E — Wheel: both rims, eight spokes, hub, fins and aft mast all spin.
// ---------------------------------------------------------------------------

function tradeWheelProxy(): StationProxy {
	const plane = STATION_GEOMETRY.trade.aperturePlaneKm;
	// The 0.85–0.95 km box-section rims, at z ±0.16 with 0.08 km width.
	// Oriented boxes keep the section rectangular: a round capsule large
	// enough for its corners would put collision beyond the rim's flat faces.
	const spinning: ProxyPrimitive[] = [];
	for (const z of [-0.16, 0.16]) {
		const count = 56;
		const halfAngle = Math.PI / count;
		const inner = 0.85 * Math.cos(halfAngle);
		const outer = 0.95;
		for (let i = 0; i < count; i++) {
			const theta = ((i + 0.5) / count) * 2 * Math.PI;
			const c = Math.cos(theta);
			const s = Math.sin(theta);
			spinning.push({
				kind: "box",
				cx: (c * (inner + outer)) / 2,
				cy: (s * (inner + outer)) / 2,
				cz: z,
				hx: (outer - inner) / 2,
				hy: outer * Math.sin(halfAngle),
				hz: 0.04,
				axes: [v3(c, s, 0), v3(-s, c, 0), v3(0, 0, 1)],
			});
		}
		for (let i = 0; i < 4; i++) {
			const theta = (i * Math.PI) / 2;
			const at = (r: number): Point => ({
				x: Math.cos(theta) * r,
				y: Math.sin(theta) * r,
				z,
			});
			// The root seats in the hub without letting a capsule's rounded
			// end cross the bay's rectangular sides.
			spinning.push(capsule(at(0.18), at(0.859), 0.033));
		}
	}
	// Hub and collars; four diagonal radiator fins between the collars.
	// Every box is cut around the unchanged bay and outward mouth prism.
	const solid: Bounds[] = [axial(0.2, 0.2, -0.24, plane + 0.016)];
	for (const side of [-1, 1])
		spinning.push(
			capsule(
				{ x: side * 0.9, y: 0, z: 0.198 },
				{ x: side * 0.9, y: 0, z: 0.292 },
				0.012,
			),
		);
	for (const sx of [-1, 1])
		for (const sy of [-1, 1])
			solid.push({
				x0: sx < 0 ? -0.29 : 0.12,
				x1: sx < 0 ? -0.12 : 0.29,
				y0: sy < 0 ? -0.29 : 0.12,
				y1: sy < 0 ? -0.12 : 0.29,
				z0: -0.09,
				z1: 0.09,
			});
	spinning.push(
		...cutAround(solid, bayHoles("trade")),
		capsule({ x: 0, y: 0, z: -0.24 }, { x: 0, y: 0, z: -0.51 }, 0.05),
	);
	return proxyOf(spinning);
}

// ---------------------------------------------------------------------------
// Shipyards A–C — the authored yards (node #818)
// ---------------------------------------------------------------------------

/**
 * Gantry Works, Foundry Hangar and Crescent Slipway, as the game loads them. // glossary-ignore: Hangar
 *
 * **The sim always collides with the authored yard, whatever is drawn**
 * (principal, 2026-10-12): a station whose model is still loading, or failed
 * to, draws its procedural stand-in and is solid as the yard it stands in
 * for, so no player's world depends on a download. **And at most 10 m of
 * empty space may collide** (principal, 2026-10-12: 5 m, relaxed to 10 m the
 * same day), so the drum and the yard are oriented boxes fitted to the model's
 * own parts (`src/shipyard-proxies.ts`, generated): no point of a box's faces
 * stands more than 10 m off what is drawn (`tests/shipyard-flight.test.ts`).
 *
 * **Spinning.** The drum's hull, and the sim's bay walled in it: thin walls
 * outside the bay's sides and end, and the mouth wall in front of the plane
 * with the lane cut through it, where the hub face's plates stand. Nothing
 * stands in the bay or the lane.
 *
 * **Static.** The yard, its bearing and the enclosed spine.
 */
const BAY_WALL_KM = 0.005;
const MOUTH_WALL_KM = 0.002;
function bayWalls(): ProxyBox[] {
	const plane = STATION_GEOMETRY.shipyard.aperturePlaneKm;
	const bay = stationInterior("shipyard", plane);
	const [end, mouth] = interiorAxialSpanKm(bay);
	const hx = bay.halfAcrossKm;
	const hy = bay.halfUpKm;
	const w = BAY_WALL_KM;
	const shell = cutAround(
		[axial(hx + w, hy + w, end - w, mouth)],
		[axial(hx, hy, end, mouth)],
	);
	const mouthWall = cutAround(
		[axial(hx + w, hy + w, mouth, mouth + MOUTH_WALL_KM)],
		[axial(bay.laneHalfAcrossKm, bay.laneHalfUpKm, mouth, Infinity)],
	);
	return [...shell, ...mouthWall];
}

function unpack(
	packed: string,
	pack: typeof SHIPYARD_PROXY_PACK = SHIPYARD_PROXY_PACK,
): ProxyBox[] {
	const bytes = Uint8Array.from(atob(packed), (ch) => ch.charCodeAt(0));
	const n = new Int16Array(bytes.buffer);
	const { centreM, halfM, rot } = pack;
	const boxes: ProxyBox[] = [];
	for (let i = 0; i < n.length; i += 10) {
		const [qx, qy, qz, qw] = [n[i + 6], n[i + 7], n[i + 8], n[i + 9]].map(
			(v) => v / rot,
		);
		const norm = Math.hypot(qx, qy, qz, qw);
		const [x, y, z, w] = [qx / norm, qy / norm, qz / norm, qw / norm];
		// The quaternion's rotation matrix, column by column: the box's axes.
		const axes: [Vec3, Vec3, Vec3] = [
			v3(1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)),
			v3(2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)),
			v3(2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)),
		];
		boxes.push({
			kind: "box",
			cx: (n[i] * centreM) / 1000,
			cy: (n[i + 1] * centreM) / 1000,
			cz: (n[i + 2] * centreM) / 1000,
			hx: (n[i + 3] * halfM) / 1000,
			hy: (n[i + 4] * halfM) / 1000,
			hz: (n[i + 5] * halfM) / 1000,
			axes,
		});
	}
	return boxes;
}

/**
 * The drum's boxes, with the axis-aligned ones cut exactly round the sim's bay
 * and lane, as every bay role's drum is. A plate on the hub face is fitted
 * with a minimum thickness either side of it, so its box reaches a little way
 * through the plane into the bay; the cut takes that off.
 */
function outsideTheBay(boxes: ProxyBox[]): ProxyBox[] {
	const holes = bayHoles("shipyard");
	return boxes.flatMap((b) => {
		const bounds = alignedBounds(b);
		return bounds ? cutAround([bounds], holes) : [b];
	});
}
/** A box whose axes are the frame's, in some order, as bounds; else null. */
function alignedBounds(b: ProxyBox): Bounds | null {
	const extent = [b.hx, b.hy, b.hz];
	if (b.axes) {
		const halves = [b.hx, b.hy, b.hz];
		for (let i = 0; i < 3; i++) {
			const a: Vec3 = b.axes[i];
			const c: number[] = [Math.abs(a.x), Math.abs(a.y), Math.abs(a.z)];
			const k = c.indexOf(Math.max(...c));
			if (c[k] < 0.9999) return null;
			extent[k] = halves[i];
		}
	}
	return {
		x0: b.cx - extent[0],
		x1: b.cx + extent[0],
		y0: b.cy - extent[1],
		y1: b.cy + extent[1],
		z0: b.cz - extent[2],
		z1: b.cz + extent[2],
	};
}

const authoredShipyards = new Map<string, StationProxy>();
function authoredShipyardProxy(
	form: keyof typeof SHIPYARD_PROXIES,
): StationProxy {
	let proxy = authoredShipyards.get(form);
	if (!proxy) {
		const { drum, yard } = SHIPYARD_PROXIES[form];
		proxy = proxyOf(
			[...outsideTheBay(unpack(drum)), ...bayWalls()],
			unpack(yard),
		);
		authoredShipyards.set(form, proxy);
	}
	return proxy;
}

/** A shipyard's written boxes as decoded, before the bay is cut from them. */
export function shipyardProxyBoxes(form: keyof typeof SHIPYARD_PROXIES): {
	drum: ProxyBox[];
	yard: ProxyBox[];
} {
	const { drum, yard } = SHIPYARD_PROXIES[form];
	return { drum: unpack(drum), yard: unpack(yard) };
}

// ---------------------------------------------------------------------------
// The authored refineries (node #819)
// ---------------------------------------------------------------------------

/**
 * Warren, Collar, Spar and Works, as the game loads them (node #819).
 *
 * **The sim collides with the authored refinery, whatever is drawn**, as with
 * the shipyards (#818): a station whose model is still loading, or failed to,
 * draws its procedural stand-in and is solid as the refinery it stands in
 * for. Its plant and pad housing keep the shipyards' rule (at most 10 m of
 * empty space collides), fitted to the model's own parts; its rock is filled
 * with 20 m voxels and held within 20 m (principal, 2026-10-13), since a
 * faceted rock fitted part by part took one box a facet
 * (`src/refinery-proxies.ts`, generated; `tests/refinery-flight.test.ts`).
 *
 * **The deck is the sim's**, as a shipyard's bay walls are: the deck the game
 * draws (`stationInterior`), up to the procedural forms' figure above the
 * plane so its berths are solid (`collision.md` §9 obligation 8), cut round
 * the corridor and the landing well. The outpost Salvage's too (node #1031).
 */
const PAD_BERTHS_KM = 0.03;
function padDeck(type: "refinery" | "outpost"): ProxyBox[] {
	const plane = STATION_GEOMETRY[type].aperturePlaneKm;
	const pad = stationInterior(type, plane);
	const depth = pad.stagingAxialKm - pad.mouthAxialKm;
	return cutAround(
		[
			axial(
				pad.halfAcrossKm,
				pad.halfUpKm,
				plane - depth,
				plane + PAD_BERTHS_KM,
			),
		],
		[corridorHole(type)],
	);
}

/**
 * The two vent banks the game stands on an authored refinery's pad frame
 * (`buildRefineryPadCues`, principal 2026-10-13): their nozzles reach 64 m in
 * front of the frame, past the proxy's vertex slack, so they are solid. One
 * box a bank, from `buildVentBank`'s own proportions: the manifold runs
 * −0.34 to 0.38 of its length, is 0.17 of it across, and its nozzles lean
 * 0.35 rad up from the axis for 0.34 of it.
 */
function padVentBanks(): ProxyBox[] {
	const L = PAD_VENT_BANK_KM;
	const across = L * 0.17;
	const { innerKm, outerKm, frontKm } = REFINERY_PAD_FRAME;
	const y = (innerKm + outerKm) / 2;
	const z0 = frontKm + PAD_CUE_PROUD_KM;
	const reach = L * 0.34;
	return PAD_VENT_BANK_X_KM.map((x) =>
		boxOf({
			x0: x - L * 0.34,
			x1: x + L * 0.38,
			y0: y - across * 0.43,
			y1: y + across * 0.64 + reach * Math.sin(0.35),
			z0,
			z1: z0 + across * 1.2 + reach * Math.cos(0.35),
		}),
	);
}

const authoredRefineries = new Map<string, StationProxy>();
function authoredRefineryProxy(
	form: keyof typeof REFINERY_PROXIES,
): StationProxy {
	let proxy = authoredRefineries.get(form);
	if (!proxy) {
		const { rock, plant } = refineryProxyBoxes(form);
		// A refinery does not turn; its primitives are listed as the procedural
		// forms list theirs.
		proxy = proxyOf([...rock, ...plant, ...padDeck("refinery"), ...padVentBanks()]);
		authoredRefineries.set(form, proxy);
	}
	return proxy;
}

/** A refinery's written boxes as decoded, rock and plant apart. */
export function refineryProxyBoxes(form: keyof typeof REFINERY_PROXIES): {
	rock: ProxyBox[];
	plant: ProxyBox[];
} {
	const { rock, plant } = REFINERY_PROXIES[form];
	return {
		rock: unpack(rock, REFINERY_PROXY_PACK),
		plant: unpack(plant, REFINERY_PROXY_PACK),
	};
}

// ---------------------------------------------------------------------------
// The authored outpost Salvage (node #1031)
// ---------------------------------------------------------------------------

/**
 * The Salvage, as the game loads it (node #1031). **The sim collides with the
 * authored outpost, whatever is drawn**, as with the refineries (#819): while
 * its model is loading, or if it failed to, the procedural stand-in is drawn
 * and is solid as the Salvage it stands in for. Its hull keeps the shipyards'
 * rule (at most 10 m of empty space collides), fitted to the model's own parts
 * (`src/outpost-proxies.ts`, generated; `tests/outpost-flight.test.ts`); its
 * deck is the sim's (`padDeck`).
 */
const authoredOutposts = new Map<string, StationProxy>();
function authoredOutpostProxy(form: keyof typeof OUTPOST_PROXIES): StationProxy {
	let proxy = authoredOutposts.get(form);
	if (!proxy) {
		proxy = proxyOf([...outpostProxyBoxes(form), ...padDeck("outpost")]);
		authoredOutposts.set(form, proxy);
	}
	return proxy;
}

/** An outpost's written hull boxes as decoded. */
export function outpostProxyBoxes(
	form: keyof typeof OUTPOST_PROXIES,
): ProxyBox[] {
	return unpack(OUTPOST_PROXIES[form].hull, OUTPOST_PROXY_PACK);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a station's collision proxy for a given form and seed.
 *
 * Returns `null` for a form that has no proxy. Only the forms in play
 * (`formsInPlay`: each role's pool, and the outpost's one form) have one,
 * because only they can be drawn by a running game (§2.2), and the test rows
 * measure only them — an alternate's proxy would be a claim nothing checks. A
 * form in play must never return `null`: the test asserts it for every member
 * of every pool, which is how pooling a form without building its proxy goes
 * red (node #717).
 */
export function stationProxy(
	type: StationType,
	form: StationFormId,
	_berthSeed: number,
	assemblySeed: number,
): StationProxy | null {
	switch (type) {
		case "trade":
			switch (form) {
				case "a":
					return tradeCoriolisProxy();
				case "b":
					return tradeRingProxy();
				case "c":
					return tradeDrumProxy();
				case "d":
					return tradeAssemblyProxy(assemblySeed);
				case "e":
					return tradeWheelProxy();
				default:
					return null;
			}
		case "shipyard":
			switch (form) {
				case "a":
				case "b":
				case "c":
					return authoredShipyardProxy(form);
				default:
					return null;
			}
		case "refinery":
			switch (form) {
				case "a":
				case "b":
				case "c":
				case "d":
					return authoredRefineryProxy(form);
				default:
					return null;
			}
		case "outpost":
			return form === "e" ? authoredOutpostProxy(form) : null;
		default: {
			// Exhaustive at compile time: a station type added later is a type
			// error here, and at runtime it has no proxy.
			const unhandled: never = type;
			void unhandled;
			return null;
		}
	}
}

/**
 * The furthest extent of any primitive in the proxy, in kilometres from the
 * origin. Used by the budget test to check no primitive lies outside
 * `reachKm`, and by the avoidance every step for every station near the ship
 * — so read once per proxy: an authored shipyard's is thousands of boxes
 * (node #818), and measuring it each step made a refinery duel four times
 * slower.
 */
export function proxyReachKm(proxy: StationProxy): number {
	let reach = reachCache.get(proxy);
	if (reach === undefined) {
		reach = measureReachKm(proxy);
		reachCache.set(proxy, reach);
	}
	return reach;
}
const reachCache = new WeakMap<StationProxy, number>();

function measureReachKm(proxy: StationProxy): number {
	let max = 0;
	for (const p of [...proxy.spinning, ...proxy.static]) {
		switch (p.kind) {
			case "box": {
				if (p.axes) {
					// The farthest of its eight corners.
					const [a, b, c] = p.axes;
					for (const i of [-1, 1])
						for (const j of [-1, 1])
							for (const k of [-1, 1])
								max = Math.max(
									max,
									Math.hypot(
										p.cx + i * p.hx * a.x + j * p.hy * b.x + k * p.hz * c.x,
										p.cy + i * p.hx * a.y + j * p.hy * b.y + k * p.hz * c.y,
										p.cz + i * p.hx * a.z + j * p.hy * b.z + k * p.hz * c.z,
									),
								);
					break;
				}
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
 * How far outside a drawn vertex may stand from the proxy, kilometres — the
 * budget's slack (`collision.md` §9.1.11's "declared tolerance").
 *
 * Not float rounding: float32 at a kilometre is about a tenth of a metre. It is
 * what lets a lamp, a greeble or a bay wall sit on or just past a primitive's
 * face without a primitive of its own, and the figure a drawn part is held to:
 * anything further outside the proxy than this is a red row. The proxy is a
 * budget, not a shrinkwrap; §11 joint 5 says what the headless rows cannot
 * see — only flying it shows an invisible wall.
 */
export const PROXY_VERTEX_TOLERANCE_KM = 0.06;

/**
 * Signed distance from a point (in the primitive's frame, km) to one
 * primitive: positive outside, negative inside by the depth to its surface.
 * A box's is the true distance, so a point past two faces at once is further
 * away than either overshoot alone.
 */
export function proxyDistanceKm(
	p: ProxyPrimitive,
	x: number,
	y: number,
	z: number,
): number {
	switch (p.kind) {
		case "box": {
			let [ux, uy, uz] = [x - p.cx, y - p.cy, z - p.cz];
			if (p.axes) {
				const [a, b, c] = p.axes;
				[ux, uy, uz] = [
					ux * a.x + uy * a.y + uz * a.z,
					ux * b.x + uy * b.y + uz * b.z,
					ux * c.x + uy * c.y + uz * c.z,
				];
			}
			const dx = Math.abs(ux) - p.hx;
			const dy = Math.abs(uy) - p.hy;
			const dz = Math.abs(uz) - p.hz;
			return (
				Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) +
				Math.min(Math.max(dx, dy, dz), 0)
			);
		}
		case "sphere":
			return Math.hypot(x - p.cx, y - p.cy, z - p.cz) - p.radiusKm;
		case "capsule": {
			// Distance from the point to the segment (a, b), less the radius
			const abx = p.bx - p.ax;
			const aby = p.by - p.ay;
			const abz = p.bz - p.az;
			const apx = x - p.ax;
			const apy = y - p.ay;
			const apz = z - p.az;
			const ab2 = abx * abx + aby * aby + abz * abz;
			const t =
				ab2 > 0
					? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2))
					: 0;
			return (
				Math.hypot(apx - t * abx, apy - t * aby, apz - t * abz) - p.radiusKm
			);
		}
	}
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
	if (primitives.length <= INDEXED_ABOVE)
		return primitives.some((p) => proxyDistanceKm(p, x, y, z) <= toleranceKm);
	// The authored shipyards' thousands of boxes (node #818): only the ones
	// whose bounding sphere comes within the tolerance can hold the point.
	const grid = indexOf(primitives);
	const reach = Math.max(toleranceKm, 0);
	let found = false;
	querySphereGrid(
		grid,
		x - reach,
		y - reach,
		z - reach,
		x + reach,
		y + reach,
		z + reach,
		(n) => {
			found = proxyDistanceKm(primitives[n], x, y, z) <= toleranceKm;
			return found;
		},
	);
	return found;
}

/**
 * The least `proxyDistanceKm` from a point to any primitive of a list:
 * negative inside. Exact; a long list (node #818) is searched through its
 * grid, in a radius that doubles until a primitive is within it.
 */
export function proxyListDistanceKm(
	primitives: readonly ProxyPrimitive[],
	x: number,
	y: number,
	z: number,
): number {
	let best = Number.POSITIVE_INFINITY;
	if (primitives.length <= INDEXED_ABOVE) {
		for (const p of primitives)
			best = Math.min(best, proxyDistanceKm(p, x, y, z));
		return best;
	}
	const grid = indexOf(primitives);
	for (let r = INDEX_CELL_KM; ; r *= 2) {
		querySphereGrid(grid, x - r, y - r, z - r, x + r, y + r, z + r, (n) => {
			best = Math.min(best, proxyDistanceKm(primitives[n], x, y, z));
		});
		// Every primitive with a surface point within `r` has its bounding
		// sphere in the box just searched.
		if (best <= r) return best;
		if (r > 64) break;
	}
	for (const p of primitives)
		best = Math.min(best, proxyDistanceKm(p, x, y, z));
	return best;
}

const indexes = new WeakMap<readonly ProxyPrimitive[], SphereGrid>();
function indexOf(primitives: readonly ProxyPrimitive[]): SphereGrid {
	let grid = indexes.get(primitives);
	if (!grid) {
		grid = buildSphereGrid(primitives.map(boundOf), INDEX_CELL_KM);
		indexes.set(primitives, grid);
	}
	return grid;
}
function boundOf(p: ProxyPrimitive): Sphere {
	switch (p.kind) {
		case "box":
			return { x: p.cx, y: p.cy, z: p.cz, r: Math.hypot(p.hx, p.hy, p.hz) };
		case "sphere":
			return { x: p.cx, y: p.cy, z: p.cz, r: p.radiusKm };
		case "capsule":
			return {
				x: (p.ax + p.bx) / 2,
				y: (p.ay + p.by) / 2,
				z: (p.az + p.bz) / 2,
				r: Math.hypot(p.bx - p.ax, p.by - p.ay, p.bz - p.az) / 2 + p.radiusKm,
			};
	}
}

// ---------------------------------------------------------------------------
// The proxy in the world (node #663)
// ---------------------------------------------------------------------------

/**
 * The proxy of the form a running game draws for this station: the form its
 * system picked for it (`Station.formId`, node #717), at the station's own
 * seeds. Memoised on the form and the seeds — the refinery's runs the
 * placement solve, and the sim asks every step a station is within reach — so
 * a jump to another system reads new keys rather than stale proxies, and
 * nothing has to be cleared. **The form is in the key**: two stations of one
 * type at one pair of seeds in two forms are two solids, and a key without it
 * would hand the second the first's.
 *
 * Throws on a form with no proxy: the budget row already refuses one in any
 * pool, and a station that silently collided as nothing would be the invisible
 * hole that row exists to prevent.
 */
export function stationProxyOf(station: StationPlan): StationProxy {
	const key = `${station.type}/${station.formId}:${station.berthSeed}:${station.assemblySeed}`;
	const cached = placedCache.get(key);
	if (cached) return cached;
	const proxy = stationProxy(
		station.type,
		station.formId,
		station.berthSeed,
		station.assemblySeed,
	);
	if (!proxy)
		throw new Error(`${station.type} form ${station.formId} has no proxy`);
	// A handful of stations per system; a long session of jumps is bounded by
	// dropping the lot rather than tracking recency.
	if (placedCache.size >= PLACED_CACHE_LIMIT) placedCache.clear();
	placedCache.set(key, proxy);
	return proxy;
}

const PLACED_CACHE_LIMIT = 64;
const placedCache = new Map<string, StationProxy>();

/** One proxy primitive as the collision resolver's (`collision.ts`). */
export function resolverPrimitive(p: ProxyPrimitive): Primitive {
	switch (p.kind) {
		case "box":
			return {
				kind: "box",
				centre: v3(p.cx, p.cy, p.cz),
				axes: p.axes ?? [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)],
				half: [p.hx, p.hy, p.hz],
			};
		case "sphere":
			return {
				kind: "sphere",
				centre: v3(p.cx, p.cy, p.cz),
				radiusKm: p.radiusKm,
			};
		case "capsule":
			return {
				kind: "capsule",
				a: v3(p.ax, p.ay, p.az),
				b: v3(p.bx, p.by, p.bz),
				radiusKm: p.radiusKm,
			};
	}
}

/**
 * The proxy's two frames as resolver primitives. `static` is empty except on
 * the shipyard and trade Assembly; a station that does not spin has one frame, and both lists
 * are posed on it.
 */
export function proxySolids(proxy: StationProxy): {
	spinning: Primitive[];
	static: Primitive[];
} {
	const cached = solidCache.get(proxy);
	if (cached) return cached;
	const out = {
		spinning: proxy.spinning.map(resolverPrimitive),
		static: proxy.static.map(resolverPrimitive),
	};
	solidCache.set(proxy, out);
	return out;
}

const solidCache = new WeakMap<
	StationProxy,
	{ spinning: Primitive[]; static: Primitive[] }
>();

/**
 * Where the proxy's two frames stand in the world, for one aperture frame and
 * the station's centre: **the one posing** the sim, the docking harness and
 * the rows all read (node #663).
 *
 * The proxy's local `z` is the aperture axis, out of the station, and its
 * `x` and `y` are `slotBasis`'s `across` and `up` — the contract the
 * renderer aims a station by (`main.ts`: local X on the phase-zero
 * `across`, local Y on its `up`, `spinner.rotation.z = phaseRad`). So the
 * spinning frame is the basis **at the frame's phase**, and the static frame —
 * the shipyard's keel, which does not turn — is the basis at phase zero.
 * `slotBasis` re-orthogonalises the reference, so `(across, up, axis)` is
 * right-handed by construction (`across × up = axis`).
 */
export function proxyPoses(
	frame: ApertureFrame,
	origin: Vec3,
): { spinning: Pose; static: Pose } {
	const pose = (f: ApertureFrame): Pose => {
		const { across, up } = slotBasis(f);
		return { origin, x: across, y: up, z: cross(across, up) };
	};
	return { spinning: pose(frame), static: pose(frameAtPhase(frame, 0)) };
}

/** One end of a station's step: its aperture frame, centre and velocity. */
export interface StationEnd {
	frame: ApertureFrame;
	origin: Vec3;
	vel: Vec3;
}

/**
 * A station's proxy across one step, as the solids `sweepShip` meets: the
 * spinning member, and the static keel where the form has one. Both carry the
 * station's centre and velocity at the step's two ends, and their axes from
 * `proxyPoses`, so the spinning one turns through the step's phase change and
 * a point on it moves at `ω × r` (`collision.md` §3, §4.1).
 */
export function stationMotions(
	proxy: StationProxy,
	start: StationEnd,
	end: StationEnd,
): SolidMotion[] {
	const solids = proxySolids(proxy);
	const from = proxyPoses(start.frame, start.origin);
	const to = proxyPoses(end.frame, end.origin);
	const motions: SolidMotion[] = [
		{
			primitives: solids.spinning,
			start: from.spinning,
			end: to.spinning,
			velStart: start.vel,
			velEnd: end.vel,
		},
	];
	if (solids.static.length > 0)
		motions.push({
			primitives: solids.static,
			start: from.static,
			end: to.static,
			velStart: start.vel,
			velEnd: end.vel,
		});
	return motions;
}
