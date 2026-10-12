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
 * a red row rather than a surprise. For the refinery's solved form the proxy
 * reads the same placement solve the mesh reads (`placementsOf`), cell by
 * cell, and a row shows the cells carry the plant. The outpost's Salvage is
 * **grown, not solved** (§2.2): `buildOutpostSalvage` accretes it from its own
 * draw, and that plan exists only inside the renderer. So its proxy does not
 * follow a plan; it is one seed-independent envelope sized to contain the
 * plans it was measured over, and it is only as good as that measurement.
 *
 * **Which plans that is.** `npm test` gates every row on `ASSEMBLY_SEEDS`,
 * twelve plans, and the vertex row builds each with the berth on both sides.
 * The hand-run half is `scripts/measure-station-proxy.ts`, which shares the
 * test's vertex walk, opening and frame rule. Run as
 * `bun scripts/measure-station-proxy.ts 1200 <0|1200> <refinery|outpost>` —
 * four runs over assembly seeds 0–2399. The figures are not restated here:
 * `docs/findings/station-proxy-wide-sweep.md` records the commit they were
 * taken on, the commands and the output verbatim, and a re-run replaces it. A
 * plan outside the range it names is not measured.
 *
 * **What it turns with.** `spinning` primitives are in the spinning member's
 * frame. `static` primitives are in the static frame — only non-empty for the
 * shipyard, whose keel is static while the drum spins.
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
import { SHIPYARD_PROXIES, SHIPYARD_PROXY_PACK } from "./shipyard-proxies";
import {
	buildSphereGrid,
	querySphereGrid,
	type Sphere,
	type SphereGrid,
} from "./sphere-grid";
import { placementsOf } from "./station-modular";
import {
	REFINERY,
	REFINERY_VOCABULARY,
	SALVAGE_CORE,
	WORKS_CELL_KM,
	WORKS_FLOOR_KM,
} from "./station-plant";
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
// Shipyards A–C — the authored yards (node #818)
// ---------------------------------------------------------------------------

/**
 * Gantry Works, Foundry Hangar and Crescent Slipway, as the game loads them. // glossary-ignore: Hangar
 *
 * **The sim always collides with the authored yard, whatever is drawn**
 * (principal, 2026-10-12): a station whose model is still loading, or failed
 * to, draws its procedural stand-in and is solid as the yard it stands in
 * for, so no player's world depends on a download. **And at most 5 m of empty
 * space may collide** (principal, 2026-10-12), so the drum and the yard are
 * oriented boxes fitted to the model's own parts (`src/shipyard-proxies.ts`,
 * generated): each stands no more than 4.5 m off what is drawn.
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

function unpack(packed: string): ProxyBox[] {
	const bytes = Uint8Array.from(atob(packed), (ch) => ch.charCodeAt(0));
	const n = new Int16Array(bytes.buffer);
	const { centreM, halfM, rot } = SHIPYARD_PROXY_PACK;
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
// Refinery A–C — rock, plant and radiator wings
// ---------------------------------------------------------------------------

/** The three flat panels and spine of each authored radiator wing. The
 * rotation is about Z; these boxes bound each panel separately rather than
 * turning the gaps between wings into a solid envelope. */
function refineryRadiators(
	span: number,
	wings: readonly (readonly [number, number])[],
): ProxyBox[] {
	const boxes: Bounds[] = [];
	for (const [tilt, z] of wings) {
		const c = Math.cos(tilt);
		const s = Math.sin(tilt);
		const panel = (
			x: number,
			hx: number,
			hy: number,
			cz: number,
			hz: number,
		) => {
			const dx = Math.abs(c) * hx + Math.abs(s) * hy;
			const dy = Math.abs(s) * hx + Math.abs(c) * hy;
			boxes.push({
				x0: x * c - dx,
				x1: x * c + dx,
				y0: x * s - dy,
				y1: x * s + dy,
				z0: cz - hz,
				z1: cz + hz,
			});
		};
		panel(span * 0.225, span * 0.225, span * 0.07, z, span * 0.07);
		panel(span * 0.46, span * 0.05, span * 0.03, z, span * 0.53);
		for (const i of [-1, 0, 1])
			panel(
				span * 0.82,
				span * 0.45,
				span * 0.015,
				z + i * span * 0.46,
				span * 0.21,
			);
	}
	return cutAround(boxes, [corridorHole("refinery")]);
}

/** The Warren's carved rock, terraces, loading arm and two vent banks.
 * The spherical body ends below the landing well; flank capsules carry the
 * rock's equatorial lumps. The terraces and deck are cut round the same well
 * as the Works, without changing the role's aperture or berth catalogue. */
function refineryWarrenProxy(): StationProxy {
	const r = STATION_GEOMETRY.refinery.coreRadiusKm;
	const plane = STATION_GEOMETRY.refinery.aperturePlaneKm;
	const rock = sphere({ x: 0, y: 0, z: -0.16 }, 0.4);
	const plant = cutAround(
		[
			axial(r * 0.78, r * 0.78 * 0.86, r * 0.5, r * 0.94),
			axial(0.22, 0.22, plane - 0.045, plane + 0.03),
			{ x0: -0.16, x1: 0.3, y0: -0.25, y1: -0.15, z0: 0.04, z1: 0.25 },
			{ x0: 0.18, x1: 0.54, y0: 0.18, y1: 0.32, z0: 0.06, z1: 0.37 },
			{ x0: -0.46, x1: -0.1, y0: 0.25, y1: 0.4, z0: 0.06, z1: 0.37 },
		],
		[corridorHole("refinery")],
	);
	const cranes = [-1, 1].flatMap((side) =>
		[0, -0.064].map((drop) =>
			capsule(
				{ x: side * 0.36, y: 0.18 + drop, z: 0.27 },
				{ x: side * 0.59, y: 0.4 + drop, z: 0.23 },
				0.02,
			),
		),
	);
	const masts = [-0.048, 0.048].map((x) =>
		capsule({ x, y: 0.38, z: -0.08 }, { x, y: 0.57, z: -0.08 }, 0.02),
	);
	return proxyOf([
		rock,
		...ring(0.38, -0.04, 0.2),
		...ring(0.36, 0.16, 0.19),
		...plant,
		...cranes,
		...masts,
		...refineryRadiators(r * 1.45, [
			[0.5, 0],
			[Math.PI - 0.45, -r * 0.5],
			[Math.PI * 1.42, -r * 0.15],
		]),
	]);
}

/** The Collar's waist band and clamps surround a carved rock. Its boss and
 * vent banks sit forward of the band; the three radiator wings stay separate. */
function refineryCollarProxy(): StationProxy {
	const r = STATION_GEOMETRY.refinery.coreRadiusKm;
	const plane = STATION_GEOMETRY.refinery.aperturePlaneKm;
	const major = r * 1.16 * 1.15 + r * 0.15 * 0.55;
	const body = sphere({ x: 0, y: 0, z: -0.12 }, 0.4);
	const plant = cutAround(
		[
			axial(0.22, 0.22, r * 0.5, plane + 0.03),
			...[-1, 1].map(
				(side): Bounds => ({
					x0: side * major * 0.82 - 0.16,
					x1: side * major * 0.82 + 0.16,
					y0: 0.1,
					y1: 0.25,
					z0: -0.08,
					z1: 0.21,
				}),
			),
		],
		[corridorHole("refinery")],
	);
	return proxyOf([
		body,
		...ring(0.33, 0.13, 0.19),
		...ring(major, 0, r * 0.15 + 0.015, 20),
		...plant,
		...refineryRadiators(r * 1.4, [
			[Math.PI * 0.42, -r * 0.3],
			[Math.PI * 1.1, -r * 0.3],
			[Math.PI * 1.62, -r * 0.3],
		]),
	]);
}

/** The Spar: an axial processing shaft, three tanks at its aft end, and a
 * carved rock around the shaft. The forward cap carries the same landing deck as the
 * other refinery forms; separate wing boxes preserve the space between them. */
function refinerySparProxy(): StationProxy {
	const r = STATION_GEOMETRY.refinery.coreRadiusKm;
	const plane = STATION_GEOMETRY.refinery.aperturePlaneKm;
	const rock = sphere({ x: 0, y: 0, z: -0.12 }, 0.38);
	const shaft = cutAround(
		[
			axial(0.13, 0.13, -r * 1.7, r * 0.9),
			axial(0.22, 0.22, r * 0.9, plane + 0.03),
			...[-1, 1].map(
				(side): Bounds => ({
					x0: side * r * 0.8 - 0.15,
					x1: side * r * 0.8 + 0.15,
					y0: 0.05,
					y1: 0.2,
					z0: 0.17,
					z1: 0.43,
				}),
			),
		],
		[corridorHole("refinery")],
	);
	const tanks = [0, 1, 2].map((i) => {
		const theta = (i / 3) * Math.PI * 2;
		const x = Math.cos(theta) * r * 0.42;
		const y = Math.sin(theta) * r * 0.42;
		const z = -r * 1.42 + i * r * 0.06;
		return boxOf({
			x0: x - r * 0.19,
			x1: x + r * 0.19,
			y0: y - r * 0.19,
			y1: y + r * 0.19,
			z0: z - r * 0.24,
			z1: z + r * 0.24,
		});
	});
	return proxyOf([
		rock,
		...ring(0.3, 0.08, 0.19),
		...shaft,
		...tanks,
		...refineryRadiators(r * 1.4, [
			[0.4, -r * 0.75],
			[Math.PI - 0.4, -r * 0.75],
			[Math.PI * 1.5, -r * 0.75],
		]),
	]);
}

// ---------------------------------------------------------------------------
// Refinery D — Works (solved form)
// ---------------------------------------------------------------------------

/**
 * `STATION_SILHOUETTE_KM.refinery`, which lives in the renderer and so cannot
 * be imported here — the map's #28 keeps the display budget in the renderer
 * module on purpose, so that docking reading it is a fact about imports. The
 * reach row holds every primitive to the real figure, so a copy that drifted
 * above it is a red row rather than a quiet overshoot.
 */
const WORKS_REACH_KM = 0.68;

/**
 * How far above the floor each unit the plant can place stands, kilometres —
 * the tallest part `buildRefineryWorks` draws on that module's cell: a
 * column's cap, a flare's vent bank, the headframe's sheave and lamp, a
 * cracker's stacks. The head house is the block the deck stands on, so its
 * cell runs to the plane and the deck above it is the deck's.
 */
const WORKS_UNIT_TOP_KM: Readonly<Record<number, number>> = {
	[REFINERY.PIPE_X]: 0.05,
	[REFINERY.PIPE_Y]: 0.05,
	[REFINERY.COLUMN]: 0.37,
	[REFINERY.CRACKER]: 0.27,
	[REFINERY.SHAFT]: 0.29,
	[REFINERY.TANKS]: 0.09,
	[REFINERY.FLARE]: 0.39,
	[REFINERY.RADIATOR]: 0.09,
};

/** Every unit is drawn from 0.05 km under its cell's centre. */
const WORKS_UNIT_FOOT_KM = 0.05;

/**
 * The plant, cell by cell from the placement solve the mesh reads: one box per
 * occupied cell, a cell wide, from the foot of its unit to the top of the
 * unit that cell holds — trimmed, at the field's outer cells, to where its
 * outer corner meets the reach. Cut round the corridor, which the tall units
 * beside the head house would otherwise cross.
 *
 * Exported for the row that holds the cells to carrying the plant: without
 * them the rock and the deck leave the tall units outside the proxy.
 */
export function refineryPlantProxy(assemblySeed: number): ProxyBox[] {
	const plane = STATION_GEOMETRY.refinery.aperturePlaneKm;
	const half = WORKS_CELL_KM / 2;
	const { placements } = placementsOf(REFINERY_VOCABULARY, assemblySeed);
	const cells = placements.map((p): Bounds => {
		const x = p.dx * WORKS_CELL_KM;
		const y = p.dy * WORKS_CELL_KM;
		const corner = Math.hypot(Math.abs(x) + half, Math.abs(y) + half);
		const unitTop =
			p.module === REFINERY.HEAD
				? plane
				: WORKS_FLOOR_KM + (WORKS_UNIT_TOP_KM[p.module] ?? 0);
		const z0 = WORKS_FLOOR_KM - WORKS_UNIT_FOOT_KM;
		// A cell whose outer corner stands at or past the reach, or whose trim
		// would put its top under its foot, is a plan this proxy cannot hold:
		// skipping it would drop coverage without a word, and a NaN box would
		// poison `thinnestKm`. Neither can happen inside `REFINERY_RADIUS` 2,
		// whose worst corner is about 0.41 km; this is the tripwire for the day
		// the field grows.
		const headroom = WORKS_REACH_KM ** 2 - corner ** 2;
		const z1 =
			headroom > 0 ? Math.min(unitTop, Math.sqrt(headroom)) : Number.NaN;
		if (!(z1 > z0))
			throw new Error(
				`refinery plan at assembly seed ${assemblySeed}: the cell at ` +
					`(${p.dx}, ${p.dy}) has no room inside the ${WORKS_REACH_KM} km reach`,
			);
		return {
			x0: x - half,
			x1: x + half,
			y0: y - half,
			y1: y + half,
			z0,
			z1,
		};
	});
	return cutAround(cells, [corridorHole("refinery")]);
}

/**
 * The Works: a quarried asteroid with a WFC-solved plant on its flat top and
 * the deck at the 0.396 km plane. It does not spin; everything goes in
 * `spinning`, which for a station that does not turn is its one frame.
 *
 * - **The rock** is a sphere centred below the origin, as large as the reach
 *   allows with its top under the plane, plus a ring of capsules round its
 *   flanks where the lumps stand furthest out. Neither reaches the tall
 *   units; those are the plant's.
 * - **The plant** is `refineryPlantProxy`: the solve, cell by cell.
 * - **The deck** is a slab at the plane round the head house, cut round the
 *   corridor, and it carries the berths that stand on it.
 */
function refineryWorksProxy(assemblySeed: number): StationProxy {
	const plane = STATION_GEOMETRY.refinery.aperturePlaneKm;

	// Its top stands on the landing well's floor rather than over it: the one
	// primitive here a cut cannot shorten.
	const ROCK_Z = -0.15;
	const rock = sphere(
		{ x: 0, y: 0, z: ROCK_Z },
		Math.min(0.53, padOpeningFloorKm("refinery") - ROCK_Z),
	);
	const flanks = ring(0.4, 0, 0.27);
	const DECK_HALF = 0.215;
	const deck = cutAround(
		[axial(DECK_HALF, DECK_HALF, plane - 0.045, plane + 0.03)],
		[corridorHole("refinery")],
	);

	return proxyOf([
		rock,
		...flanks,
		...refineryPlantProxy(assemblySeed),
		...deck,
	]);
}

// ---------------------------------------------------------------------------
// Outpost E — Salvage (grown form, selected)
// ---------------------------------------------------------------------------

/**
 * The Salvage: a boxy freighter section (the core) carrying the deck, with
 * welded debris round it. The debris is grown from the assembly seed by the
 * form's own generator rather than solved on a placement grid, and that plan
 * lives only in the renderer, so the proxy is one set of primitives sized to
 * the plans the module header names, rather than one that follows a plan:
 *
 * - the core section as a box from its keel to the underside of the deck;
 * - a sphere centred below the origin, its top under the plane, for the
 *   debris welded round the core;
 * - a ring of capsules round its flanks for the hull sections that stand
 *   furthest out;
 * - a ring round the corridor for the deck, its inner edge outside
 *   `corridorRadiusKm`, and a wider one under it for the sections welded at
 *   deck height.
 */
function outpostSalvageProxy(): StationProxy {
	const g = STATION_GEOMETRY.outpost;
	const r = g.coreRadiusKm;
	const plane = g.aperturePlaneKm;

	const deckUnder = plane - r * 0.16;
	const core = cutAround(
		[
			axial(
				SALVAGE_CORE.halfWidthKm,
				SALVAGE_CORE.halfHeightKm,
				SALVAGE_CORE.bottomKm,
				deckUnder,
			),
		],
		[corridorHole("outpost")],
	);
	// The debris and the flank ring stand on the landing well's floor rather
	// than over it, as the Works' rock does: neither can be cut.
	const floor = padOpeningFloorKm("outpost");
	const DEBRIS_Z = -0.1275;
	const debris = sphere(
		{ x: 0, y: 0, z: DEBRIS_Z },
		Math.min(0.2925, floor - DEBRIS_Z),
	);
	const FLANK_TUBE = 0.17;
	const flanks = ring(0.24, Math.min(-0.05, floor - FLANK_TUBE), FLANK_TUBE);
	const deck = ring(0.2, plane + 0.005, 0.11);
	const deckRim = ring(0.28, plane - 0.025, 0.1);

	return proxyOf([...core, debris, ...flanks, ...deck, ...deckRim]);
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
			return form === "a" ? tradeCoriolisProxy() : null;
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
					return refineryWarrenProxy();
				case "b":
					return refineryCollarProxy();
				case "c":
					return refinerySparProxy();
				case "d":
					return refineryWorksProxy(assemblySeed);
				default:
					return null;
			}
		case "outpost":
			return form === "e" ? outpostSalvageProxy() : null;
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

/** A list longer than this is searched through a grid: the authored
 *  shipyards' 490 to 2,800 boxes a list (node #818). Every other proxy is
 *  tens of primitives and stays a plain walk — refinery/a's 66, big rock
 *  spheres among them, took 27 s through the grid in the vertex row and
 *  0.4 s without it. */
const INDEXED_ABOVE = 128;
const INDEX_CELL_KM = 0.05;
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
 * the shipyard; a station that does not spin has one frame, and both lists
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
