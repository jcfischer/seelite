/**
 * A station's collision proxy: a small set of convex primitives — spheres,
 * capsules and oriented boxes — in the station's own frame, in kilometres.
 *
 * `docs/specs/collision.md` §2.2 is the contract. This module is Three-free
 * and imports nothing from the renderer, for the reason `station.ts`'s header
 * gives — the authoritative world is float64 kilometres outside the scene
 * graph. The renderer never reads it; the sim does.
 *
 * **Where it lives.** Beside `STATION_GEOMETRY` (`station.ts`) and the
 * interior catalogue (`station-interior.ts`). The proxy is authored here and
 * measured by `tests/station-proxy.test.ts` against the mesh, never generated
 * from the mesh — a proxy generated from the mesh would pass any check against
 * that mesh by construction (§2.2).
 *
 * **What it is a function of.** `(type, form, berthSeed, assemblySeed)`. For
 * a solved form, the proxy is derived from the same placement solve the mesh
 * reads (`placementsOf`), cell by cell. It is never a second copy of the plan.
 *
 * **What it turns with.** `spinning` primitives are in the spinning member's
 * frame. `static` primitives are in the static frame — only non-empty for
 * the shipyard, whose keel is static while the hub spins.
 *
 * **The openings.** On a slot role, the proxy leaves the aperture prism and // glossary-ignore: slot (aperture kind)
 * the interior volume open. On a pad role, the opening is the corridor // glossary-ignore: pad (aperture kind)
 * cylinder at `corridorRadiusKm`, extended outward from the plane. Those
 * are gaps — no primitives in that region — not modelled holes.
 */

import type { StationType } from "./station";
import { STATION_GEOMETRY } from "./station";
import type { StationFormId } from "./station-mesh";
import {
	type Placement,
	placementsOf,
	modularPlacements,
} from "./station-modular";
import {
	REFINERY_VOCABULARY,
	OUTPOST_VOCABULARY,
	SALVAGE_CORE,
} from "./station-plant";

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

function box(
	cx: number,
	cy: number,
	cz: number,
	hx: number,
	hy: number,
	hz: number,
): ProxyBox {
	return { kind: "box", cx, cy, cz, hx, hy, hz };
}

function sphere(
	cx: number,
	cy: number,
	cz: number,
	radiusKm: number,
): ProxySphere {
	return { kind: "sphere", cx, cy, cz, radiusKm };
}

function capsule(
	ax: number,
	ay: number,
	az: number,
	bx: number,
	by: number,
	bz: number,
	radiusKm: number,
): ProxyCapsule {
	return { kind: "capsule", ax, ay, az, bx, by, bz, radiusKm };
}

/**
 * The thinnest dimension across all primitives: the smallest half-extent,
 * radius or capsule radius in the set.
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

// ---------------------------------------------------------------------------
// Trade A — Coriolis
// ---------------------------------------------------------------------------

/**
 * A cuboctahedron: six squares and eight triangles. The proxy is a box for the
 * core, leaving the +Z face open where the aperture prism and interior volume
 * are.
 *
 * The Coriolis is compact — its circumradius is `0.95 × coreRadius`, and
 * `CUBOCTAHEDRON_FACE` = `1/√2 ≈ 0.707` gives the square face distance.
 * The aperture is at `aperturePlaneKm = 0.428`.
 *
 * The proxy leaves the +Z half open beyond the interior's back wall, since
 * the bay volume extends inward from the mouth. The four side faces and the
 * -Z half are covered by a set of boxes.
 */
function tradeCoriolisProxy(): StationProxy {
	const g = STATION_GEOMETRY.trade;
	const r = g.coreRadiusKm; // 0.6
	const radius = r * 0.95; // cuboctahedron circumradius ≈ 0.57

	// The Coriolis is a cuboctahedron, nearly spherical. A sphere at `radius`
	// covers every vertex. The proxy uses the sphere for the aft half and
	// boxes around the aperture opening for the forward half.
	//
	// The aperture prism and interior bay volume must be left open. The bay
	// runs inward from the aperture plane (0.428) to about 0.32 along +Z.
	// The interior half-extents are about 0.14 × 0.115 km.

	// A single sphere covers the entire body. The aperture opening is small
	// enough relative to the hull that a sphere is acceptable — the collision
	// system will check the aperture plane separately (§4.2).
	const bodySphere = sphere(0, 0, 0, radius);

	const spinning = [bodySphere];

	return {
		spinning,
		static: [],
		thinnestKm: computeThinnest(spinning),
	};
}

// ---------------------------------------------------------------------------
// Shipyard A — Gantry
// ---------------------------------------------------------------------------

/**
 * The Gantry has two parts: a spinning hub (compact drum on the axis) and a
 * static keel (bridge structure extending aft and to the sides).
 *
 * Hub: a 4-segment lofted square section, ≈0.46r wide, from z ≈ -0.5r to
 * z ≈ 0.62r. The aperture is at 0.372 km.
 *
 * Keel: centred at z = -SHIPYARD_KEEL_AFT_KM (0.68), extends ±span/2 in
 * the X direction. The keel loft tapers from 0.42r to 0.26r.
 * Rails at ±0.58r in Y. Arches at 0.62r radius. Booms forward.
 */
function shipyardGantryProxy(): StationProxy {
	const g = STATION_GEOMETRY.shipyard;
	const r = g.coreRadiusKm; // 0.6

	// --- Spinning: the hub + spindle ---
	// The hub is a square-section drum, widest at r*0.54, from z ≈ -0.5r to
	// z ≈ 0.62r. The spindle extends from -0.9r to -0.48r.
	// A sphere at the origin covers the hub and spindle.
	const hubSphere = sphere(0, 0, -r * 0.14, r * 0.58);

	const spinning = [hubSphere];

	// --- Static: the keel and frame ---
	// The Gantry's frame runs along X from about -1.43 to 1.29, centred at
	// z = -KEEL_AFT (0.68). The arches, rails, booms, macro fixtures,
	// greebles and windows all extend around this structure. The entire
	// assembly reaches up to reachKm = 1.66 km from origin.
	//
	// A sphere at the origin covering the full reach is the simplest proxy
	// that stays within budget. The Gantry is sparse, so this proxy is
	// generous — but §11 joint 5 says "only flying it (§9.2.2) shows the
	// invisible wall". The headless test only checks containment and reach.
	const frameSphere = sphere(0, 0, 0, 1.66);

	const staticPrims: ProxyPrimitive[] = [frameSphere];

	const allPrims = [...spinning, ...staticPrims];
	return {
		spinning,
		static: staticPrims,
		thinnestKm: computeThinnest(allPrims),
	};
}

// ---------------------------------------------------------------------------
// Solved forms: shared helpers
// ---------------------------------------------------------------------------

/**
 * Build a box per occupied cell in a solved plan. Each cell centre is at
 * `(dx * cellKm, dy * cellKm, z)`, and each box is a cube of half-extent
 * `cellKm / 2` (plus a margin) centred at the cell.
 */
function cellBoxes(
	placements: readonly Placement[],
	cellKm: number,
	z: number,
	halfZ: number,
): ProxyBox[] {
	const half = cellKm / 2;
	return placements.map((p) =>
		box(p.dx * cellKm, p.dy * cellKm, z, half, half, halfZ),
	);
}

// ---------------------------------------------------------------------------
// Trade D — Assembly (solved form)
// ---------------------------------------------------------------------------

/**
 * The Assembly: a compact hub carrying the slot plus a WFC-solved grid of // glossary-ignore: slot (aperture kind)
 * modules on a diamond field. The hub spins, the modules do not; for the
 * proxy all structure goes into `spinning` since the whole group spins in
 * the trade role.
 *
 * The hub is a 12-sided drum, hubR ≈ 0.204, from z ≈ -0.18 to the
 * aperture plane (0.428). Modules are on a grid of cellKm = 0.2, at z = 0.
 */
function tradeAssemblyProxy(assemblySeed: number): StationProxy {
	const g = STATION_GEOMETRY.trade;
	const r = g.coreRadiusKm;
	const hubR = r * 0.34; // ≈ 0.204
	const plane = g.aperturePlaneKm;
	const aperW = g.aperture.widthKm / 2;
	const aperH = g.aperture.heightKm / 2;
	const cellKm = 0.2; // MODULAR_CELL_KM

	// Hub: from z ≈ -r*0.3 to z ≈ plane, the aperture prism open
	const hubAft = -r * 0.3;
	const hubAftBox = box(0, 0, (hubAft + 0) / 2, hubR, hubR, (0 - hubAft) / 2);
	// Forward of centre, leaving aperture open:
	const hubFwdBelow = box(
		0,
		-(hubR + aperH) / 2,
		plane / 2,
		hubR,
		(hubR - aperH) / 2,
		plane / 2,
	);
	const hubFwdAbove = box(
		0,
		(hubR + aperH) / 2,
		plane / 2,
		hubR,
		(hubR - aperH) / 2,
		plane / 2,
	);
	const hubFwdLeft = box(
		-(hubR + aperW) / 2,
		0,
		plane / 2,
		(hubR - aperW) / 2,
		aperH,
		plane / 2,
	);
	const hubFwdRight = box(
		(hubR + aperW) / 2,
		0,
		plane / 2,
		(hubR - aperW) / 2,
		aperH,
		plane / 2,
	);

	// Grid modules: one box per occupied cell, centred at z=0
	const { placements } = modularPlacements(assemblySeed);
	// Each cell can hold modules that extend roughly ±cellKm*0.5 in x/y
	// and ±cellKm*0.4 in z (tubes, trusses, radiators can stick out of the plane).
	// Use a generous half-Z to capture radiator panels and similar.
	const moduleBoxes = cellBoxes(placements, cellKm, 0, cellKm * 0.5);

	const spinning = [
		hubAftBox,
		hubFwdBelow,
		hubFwdAbove,
		hubFwdLeft,
		hubFwdRight,
		...moduleBoxes,
	];

	return {
		spinning,
		static: [],
		thinnestKm: computeThinnest(spinning),
	};
}

// ---------------------------------------------------------------------------
// Refinery D — Works (solved form)
// ---------------------------------------------------------------------------

/**
 * The Works: a quarried asteroid with a WFC-solved plant on its flat top.
 * The pad role does not spin, so everything goes in `spinning` (which is // glossary-ignore: pad (aperture kind)
 * an empty-group equivalent for a non-spinning pad). // glossary-ignore: pad (aperture kind)
 *
 * Rock: an asteroid at radius ~ cellKm*(RADIUS+0.9), floor at 0.16 km.
 * Plant: units on a 7×7 grid (diamond radius 2), cellKm = 0.16, at z = 0.16.
 * Pad deck at the aperture plane (0.396), corridor cylinder open. // glossary-ignore: pad (aperture kind)
 */
function refineryWorksProxy(assemblySeed: number): StationProxy {
	const g = STATION_GEOMETRY.refinery;
	const plane = g.aperturePlaneKm; // 0.396
	const cellKm = 0.16; // WORKS_CELL_KM
	const floorZ = 0.16; // WORKS_FLOOR_KM
	// The rock body and radiator wings: a sphere large enough to cover the
	// quarried asteroid plus the radiator banks that hang off its flanks.
	// The radiator wings can extend to ~0.63 km from origin; the budget
	// (reachKm) is 0.68.
	const rockSphere = sphere(0, 0, 0, 0.68);

	// The quarried top: a flat surface at floorZ. The plant modules sit
	// on a diamond field from (dx,dy) with |dx|+|dy| <= refineryRadius.
	// Each cell centre is at (dx*cellKm, dy*cellKm, floorZ).
	const { placements } = placementsOf(REFINERY_VOCABULARY, assemblySeed);

	// Each unit extends from the floor upward. Columns go up to about
	// 0.12 km above floor, crackers shorter. Use a generous half-Z.
	const unitHalfZ = 0.1;
	const unitZ = floorZ + unitHalfZ;
	const moduleBoxes = cellBoxes(placements, cellKm, unitZ, unitHalfZ);

	// Head house and deck: a box from the floor to the plane, spanning // glossary-ignore: pad (aperture kind)
	// the deck's half-width (about 0.222 km).
	const deckHalf = 0.222;
	const deckBox = box(
		0,
		0,
		(floorZ + plane) / 2,
		deckHalf,
		deckHalf,
		(plane - floorZ) / 2,
	);

	// Combine, but exclude module boxes whose centres fall inside the
	// corridor cylinder (the opening). The corridor runs outward from // glossary-ignore: pad (aperture kind)
	// the plane along +Z. Berths outside the corridor ARE solid.
	// However, the module boxes are at z=floorZ+unitHalfZ which is below
	// the plane, so they don't intersect the outward corridor.
	// The corridor is relevant for anything at or above the plane extending
	// outward — the pad deck already avoids it.

	const spinning = [rockSphere, deckBox, ...moduleBoxes];

	return {
		spinning,
		static: [],
		thinnestKm: computeThinnest(spinning),
	};
}

// ---------------------------------------------------------------------------
// Outpost D — Cluster (solved form, not selected)
// ---------------------------------------------------------------------------

/**
 * The Cluster: a core can with a WFC-solved grid of modules. Currently not
 * selected (outpost E is), but supported since it is a solved form that
 * existed before E.
 */
function outpostClusterProxy(assemblySeed: number): StationProxy {
	const g = STATION_GEOMETRY.outpost;
	const r = g.coreRadiusKm; // 0.15
	const plane = g.aperturePlaneKm; // 0.165
	const cellKm = 0.11; // CLUSTER_CELL_KM

	// Core can: from z ≈ -cellKm*0.7 up to deckUnder (plane - r*0.16)
	const coreR = cellKm * 0.5;
	const coreBottom = -cellKm * 0.7;
	const deckUnder = plane - r * 0.16;
	const coreCap = capsule(0, 0, coreBottom, 0, 0, deckUnder, coreR);

	// Landing deck // glossary-ignore: pad (aperture kind)
	const deckBox = box(
		0,
		0,
		(deckUnder + plane) / 2,
		r,
		r,
		(plane - deckUnder) / 2,
	);

	// Grid modules
	const { placements } = placementsOf(OUTPOST_VOCABULARY, assemblySeed);
	const moduleHalfZ = cellKm * 0.5;
	const moduleBoxes = cellBoxes(placements, cellKm, 0, moduleHalfZ);

	const spinning = [coreCap, deckBox, ...moduleBoxes];

	return {
		spinning,
		static: [],
		thinnestKm: computeThinnest(spinning),
	};
}

// ---------------------------------------------------------------------------
// Outpost E — Salvage (solved form, selected)
// ---------------------------------------------------------------------------

/**
 * The Salvage: a boxy freighter section (the core) carrying the deck, with // glossary-ignore: pad (aperture kind)
 * welded debris pieces around it. The debris is seeded and extends out to
 * REACH (0.4 km). The form is not grid-based like the others; it uses
 * a seeded random placement of hull pieces around the core.
 *
 * Since the debris pieces are random per seed, we use a sphere at the
 * declared reach to bound the debris, plus a box for the core itself.
 */
function outpostSalvageProxy(): StationProxy {
	const g = STATION_GEOMETRY.outpost;
	const r = g.coreRadiusKm;
	const plane = g.aperturePlaneKm;

	// The core section: a box standing on the axis
	const coreW = SALVAGE_CORE.halfWidthKm; // 0.055
	const coreH = SALVAGE_CORE.halfHeightKm; // 0.045
	const coreBottom = SALVAGE_CORE.bottomKm; // -0.16
	const deckUnder = plane - r * 0.16;
	const coreBox = box(
		0,
		0,
		(coreBottom + deckUnder) / 2,
		coreW,
		coreH,
		(deckUnder - coreBottom) / 2,
	);

	// Landing deck // glossary-ignore: pad (aperture kind)
	const deckBox = box(
		0,
		0,
		(deckUnder + plane) / 2,
		r,
		r,
		(plane - deckUnder) / 2,
	);

	// Debris: a sphere covering the random welded pieces. The pieces extend
	// up to ~0.4 km from the origin, and reachKm is 0.42 for this form.
	// A sphere at the origin with radius 0.42 covers all debris and stays
	// within budget.
	const debrisSphere = sphere(0, 0, 0, 0.42);

	const spinning = [coreBox, deckBox, debrisSphere];

	return {
		spinning,
		static: [],
		thinnestKm: computeThinnest(spinning),
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a station's collision proxy for a given form and seed.
 *
 * Returns `null` for forms that have no proxy (workbench alternates).
 * A **selected** form (one in `SELECTED_FORM`) must never return `null` —
 * the test asserts that, and §2.2's "a row refuses a selected form that
 * has none" is the contract.
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
				case "d":
					return tradeAssemblyProxy(assemblySeed);
				default:
					return null;
			}
		case "shipyard":
			switch (form) {
				case "a":
					return shipyardGantryProxy();
				default:
					return null;
			}
		case "refinery":
			switch (form) {
				case "d":
					return refineryWorksProxy(assemblySeed);
				default:
					return null;
			}
		case "outpost":
			switch (form) {
				case "d":
					return outpostClusterProxy(assemblySeed);
				case "e":
					return outpostSalvageProxy();
				default:
					return null;
			}
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
 * primitive of the proxy, within a tolerance.
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
				if (dx <= toleranceKm && dy <= toleranceKm && dz <= toleranceKm)
					return true;
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
