/**
 * The shipyards' collision proxies (node #818), computed from the shipped
 * models. `scripts/generate-shipyard-proxies.ts` writes them to
 * `src/shipyard-proxies.ts`, with each model's hash; a refit takes minutes,
 * so `tests/shipyard-flight.test.ts` checks the hashes and measures the
 * written boxes against the meshes instead of refitting.
 *
 * The sim always collides with the authored yard, whatever is drawn, and **at
 * most 10 m of empty space may collide** (principal, 2026-10-12: 5 m, relaxed
 * to 10 m the same day, which cut a yard's boxes by two thirds). Cubes cannot
 * meet that at any sane count (2.5 m cubes took 50,000–120,000 boxes a yard),
 * so the proxy follows the model's own parts. Each station is built as the
 * game builds it (`installShippedShipyards`), in metres in its own frame, and
 * every connected part of the drum and of the yard gets:
 *
 * - **one oriented box**, its axes from the part's largest faces, so a box, a
 *   plate or a beam is held exactly;
 * - **split**, by plane and then along its longest side, while a sample of
 *   the box's faces stands farther from the model than the rule allows (a
 *   bent spine, an arc, a hollow drum);
 * - **absorbed** into a larger box within `ABSORB_M`, and **merged** with a
 *   parallel neighbour, while the grown box still keeps the rule: a plate on
 *   its housing, a row of wall panels.
 *
 * The drum's boxes are its hull; the sim's bay inside it is walled by
 * `station-proxy.ts` from the sim's own figures, so nothing here stands in it.
 */
import * as THREE from "three";
import { SHIPYARD_FORMS } from "../../src/shipyard-flight";
import { AUTHORED_DRUM_NAME } from "../../src/station-visuals";
import { STATION_GEOMETRY } from "../../src/station";
import { stationInterior } from "../../src/station-interior";
import { buildStationForm } from "../../src/station-mesh";
import { installShippedShipyards } from "./shipped-shipyards";

/** The principal's rule: at most this much empty space may collide. */
export const EMPTY_LIMIT_M = 10;
/** A box's faces are measured on a grid this fine. */
export const SAMPLE_SPACING_M = 1;
/** Each sample's limit: a face point lies within half a grid square's
 *  diagonal of its nearest sample. */
export const SAMPLE_LIMIT_M = EMPTY_LIMIT_M - SAMPLE_SPACING_M / Math.SQRT2;
/** Boxes this close merge, if the merged box still keeps the rule. Measured on
 *  form a, 2026-10-12: 1.5 m left 4,339 yard boxes, 3 m 3,450. */
const ABSORB_M = 3;

type Tri = [THREE.Vector3, THREE.Vector3, THREE.Vector3];
export interface Obb {
	c: THREE.Vector3;
	axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
	half: [number, number, number];
}

function axesOf(tris: Tri[]): Obb["axes"] {
	const bins: { n: THREE.Vector3; area: number }[] = [];
	const e1 = new THREE.Vector3();
	const e2 = new THREE.Vector3();
	for (const t of tris) {
		const n = e1
			.subVectors(t[1], t[0])
			.clone()
			.cross(e2.subVectors(t[2], t[0]));
		const area = n.length() / 2;
		if (area < 1e-6) continue;
		n.normalize();
		const bin = bins.find((b) => Math.abs(b.n.dot(n)) > 0.9995);
		if (bin) bin.area += area;
		else bins.push({ n, area });
	}
	bins.sort((a, b) => b.area - a.area);
	const a = bins[0]?.n.clone() ?? new THREE.Vector3(0, 0, 1);
	const second = bins.find((b) => Math.abs(b.n.dot(a)) < 0.02);
	const b2 = second
		? second.n.clone()
		: Math.abs(a.x) < 0.9
			? new THREE.Vector3(1, 0, 0)
			: new THREE.Vector3(0, 1, 0);
	b2.addScaledVector(a, -b2.dot(a)).normalize();
	return [a, b2, new THREE.Vector3().crossVectors(a, b2)];
}

function fit(tris: Tri[], axes: Obb["axes"]): Obb {
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	for (const t of tris)
		for (const v of t)
			for (let i = 0; i < 3; i++) {
				const d = v.dot(axes[i]);
				lo[i] = Math.min(lo[i], d);
				hi[i] = Math.max(hi[i], d);
			}
	const c = new THREE.Vector3();
	for (let i = 0; i < 3; i++) c.addScaledVector(axes[i], (lo[i] + hi[i]) / 2);
	return {
		c,
		axes,
		half: [0, 1, 2].map((i) =>
			Math.max((hi[i] - lo[i]) / 2, 0.25),
		) as Obb["half"],
	};
}

/**
 * The box keeps the rule: as `pack` will write it, every sample of its faces
 * has a triangle of the group being fitted within `SAMPLE_LIMIT_M`, whatever
 * part bounds it. `tests/shipyard-flight.test.ts` measures the written boxes
 * the same way, so a box fitted here cannot fail there.
 */
let nearModel: TriangleGrid | null = null;
function keepsTheRule(o: Obb): boolean {
	if (!nearModel) throw new Error("keepsTheRule: no group is being fitted");
	return !overreaches(packed(o), nearModel);
}

/** True when a sample of the box's faces stands farther than the rule allows. */
export function overreaches(o: Obb, grid: TriangleGrid): boolean {
	return someFacePoint(
		o,
		SAMPLE_SPACING_M,
		(p) => !grid.within(p, SAMPLE_LIMIT_M),
	);
}

/** Each triangle cut by the plane `x·axis = at`, as the triangles on either side. */
function cut(tris: Tri[], axis: THREE.Vector3, at: number): [Tri[], Tri[]] {
	const below: Tri[] = [];
	const above: Tri[] = [];
	const fan = (poly: THREE.Vector3[], into: Tri[]) => {
		for (let i = 1; i + 1 < poly.length; i++)
			into.push([poly[0], poly[i], poly[i + 1]]);
	};
	for (const t of tris) {
		const d = t.map((v) => v.dot(axis) - at);
		if (d.every((x) => x <= 0)) {
			below.push(t);
			continue;
		}
		if (d.every((x) => x >= 0)) {
			above.push(t);
			continue;
		}
		const lo: THREE.Vector3[] = [];
		const hi: THREE.Vector3[] = [];
		for (let i = 0; i < 3; i++) {
			const a = t[i];
			const b = t[(i + 1) % 3];
			const da = d[i];
			const db = d[(i + 1) % 3];
			if (da <= 0) lo.push(a);
			if (da >= 0) hi.push(a);
			if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
				const m = a.clone().lerp(b, da / (da - db));
				lo.push(m);
				hi.push(m);
			}
		}
		if (lo.length >= 3) fan(lo, below);
		if (hi.length >= 3) fan(hi, above);
	}
	return [below, above];
}

/**
 * Space the drum's boxes must leave open: the sim's bay behind the plane and
 * the lane in front of it, metres. Set while the drum is fitted, empty for the
 * yard. A box that meets one, as packed, is moved clear or split; one along
 * the drum's axis lying on the plane is left to `offThePlane` for the bay,
 * and still kept out of the lane.
 */
let keepOut: THREE.Box3[] = [];
const KEEP_OUT_MARGIN_M = 0.05;
function intrudes(o: Obb): boolean {
	// A box along the axis starting at the plane is `offThePlane`'s to move
	// clear of the bay; the lane in front it must keep clear of here.
	const along = o.axes.findIndex((a) => Math.abs(a.z) > 0.9999);
	const onThePlane =
		along >= 0 &&
		keepOut.length > 0 &&
		o.c.z - o.half[along] >= keepOut[0].max.z - 0.5;
	// Measured as `pack` will write it.
	const half = packed(o).half.map((h) => h + KEEP_OUT_MARGIN_M);
	const units = [
		new THREE.Vector3(1, 0, 0),
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(0, 0, 1),
	];
	for (const [n, box] of keepOut.entries()) {
		if (n === 0 && onThePlane) continue;
		const c = box.getCenter(new THREE.Vector3());
		const e = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
		const d = o.c.clone().sub(c);
		const axes = [...units, ...o.axes];
		for (const u of units)
			for (const a of o.axes) {
				const x = u.clone().cross(a);
				if (x.lengthSq() > 1e-10) axes.push(x.normalize());
			}
		const separated = axes.some((L) => {
			const ro = o.axes.reduce(
				(r, a, i) => r + half[i] * Math.abs(a.dot(L)),
				0,
			);
			const rb =
				e.x * Math.abs(L.x) + e.y * Math.abs(L.y) + e.z * Math.abs(L.z);
			return Math.abs(d.dot(L)) >= ro + rb;
		});
		if (!separated) return true;
	}
	return false;
}

/**
 * A box that keeps the rule but meets the keep-out, moved clear of it — a
 * plate lying on the bay's wall meets it by its own thickness, and no split
 * changes that. The smallest move along the station's or the box's axes, a
 * metre at most, that still keeps the rule; `null` when none does, and the
 * box is split instead.
 */
const NUDGE_STEPS_M = [0.1, 0.2, 0.3, 0.45, 0.6, 0.8, 1];
function nudgedClear(o: Obb): Obb | null {
	const directions = [
		new THREE.Vector3(1, 0, 0),
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(0, 0, 1),
		...o.axes,
	].flatMap((d) => [d, d.clone().negate()]);
	for (const step of NUDGE_STEPS_M)
		for (const d of directions) {
			const moved: Obb = {
				c: o.c.clone().addScaledVector(d, step),
				axes: o.axes,
				half: o.half,
			};
			if (!intrudes(moved) && keepsTheRule(moved)) return moved;
		}
	return null;
}

/** Pieces left in the keep-out at the split's floor, for the generator's log. */
export const stranded: Obb[] = [];

/** The box, if it keeps the rule clear of the keep-out, moved if it must be. */
function settled(o: Obb): Obb | null {
	if (!keepsTheRule(o)) return null;
	return intrudes(o) ? nudgedClear(o) : o;
}

/** A flat group's box, its in-plane axes the tightest of its edges'. */
function fitFlat(tris: Tri[], normal: THREE.Vector3): Obb {
	let best: Obb | null = null;
	for (const t of tris)
		for (let i = 0; i < 3; i++) {
			const u = t[(i + 1) % 3].clone().sub(t[i]);
			u.addScaledVector(normal, -u.dot(normal));
			if (u.lengthSq() < 1e-6) continue;
			u.normalize();
			const o = fit(tris, [normal.clone(), u, normal.clone().cross(u)]);
			if (!best || o.half[1] * o.half[2] < best.half[1] * best.half[2])
				best = o;
		}
	return best ?? fit(tris, axesOf(tris));
}

/** One flat group: its box, or the boxes of its halves, cut until each fits. */
function fitPlane(tris: Tri[], normal: THREE.Vector3, depth = 0): Obb[] {
	const o = fitFlat(tris, normal);
	const box = settled(o);
	if (box) return [box];
	// A piece under a metre across is not split again: kept as it is, and
	// counted if it still meets the keep-out.
	if (depth >= 18 || Math.max(o.half[1], o.half[2]) < 0.5) {
		if (intrudes(o)) stranded.push(o);
		return [o];
	}
	const i = o.half[1] >= o.half[2] ? 1 : 2;
	const [a, b] = cut(tris, o.axes[i], o.c.dot(o.axes[i]));
	if (!a.length || !b.length) return [o];
	return [...fitPlane(a, normal, depth + 1), ...fitPlane(b, normal, depth + 1)];
}

/**
 * A part's box, if it keeps the rule — a closed box, a prism, a tube.
 * Otherwise the part's flat faces, grouped by plane, each fitted on its own
 * and cut along its longest side until every piece fits: a hollow drum, a
 * ring, a trapezoid, an L. The triangles are cut, never sorted whole into
 * halves, so no piece reaches across a gap it does not cover.
 */
function fitPart(tris: Tri[]): Obb[] {
	const whole = settled(fit(tris, axesOf(tris)));
	if (whole) return [whole];
	const planes: { n: THREE.Vector3; d: number; tris: Tri[] }[] = [];
	const e1 = new THREE.Vector3();
	const e2 = new THREE.Vector3();
	for (const t of tris) {
		const n = e1
			.subVectors(t[1], t[0])
			.clone()
			.cross(e2.subVectors(t[2], t[0]));
		if (n.lengthSq() < 1e-12) continue;
		n.normalize();
		const d = n.dot(t[0]);
		const plane = planes.find(
			(p) => p.n.dot(n) > 0.9995 && Math.abs(p.d - d) < 0.05,
		);
		if (plane) plane.tris.push(t);
		else planes.push({ n, d, tris: [t] });
	}
	return planes.flatMap((p) => fitPlane(p.tris, p.n));
}

function corners(o: Obb): THREE.Vector3[] {
	const out: THREE.Vector3[] = [];
	for (const a of [-1, 1])
		for (const b of [-1, 1])
			for (const c of [-1, 1])
				out.push(
					o.c
						.clone()
						.addScaledVector(o.axes[0], a * o.half[0])
						.addScaledVector(o.axes[1], b * o.half[1])
						.addScaledVector(o.axes[2], c * o.half[2]),
				);
	return out;
}

const holds = (o: Obb, p: THREE.Vector3, margin: number) => {
	const d = p.clone().sub(o.c);
	return o.axes.every((ax, i) => Math.abs(d.dot(ax)) <= o.half[i] + margin);
};

/** The grid cells a box's bounds touch. */
const CELL_M = 40;
function cellsOf(o: Obb): string[] {
	const b = new THREE.Box3().setFromPoints(corners(o));
	const at = (v: number) => Math.floor(v / CELL_M);
	const out: string[] = [];
	for (let x = at(b.min.x); x <= at(b.max.x); x++)
		for (let y = at(b.min.y); y <= at(b.max.y); y++)
			for (let z = at(b.min.z); z <= at(b.max.z); z++)
				out.push(`${x},${y},${z}`);
	return out;
}

/**
 * Neighbouring boxes with parallel axes become one where the one still keeps
 * the rule and, for the drum, stays clear of the bay and the lane: a row of
 * wall panels, a beam cut in pieces. Repeats while it merges.
 */
function mergeNeighbours(boxes: Obb[]): Obb[] {
	const parallel = (a: Obb, b: Obb) =>
		b.axes.every((bx) => a.axes.some((ax) => Math.abs(ax.dot(bx)) > 0.9999));
	let live = boxes;
	for (let pass = 0; pass < 4; pass++) {
		const grid = new Map<string, Obb[]>();
		for (const o of live)
			for (const cell of cellsOf(o))
				(grid.get(cell) ?? grid.set(cell, []).get(cell)!).push(o);
		const gone = new Set<Obb>();
		let merged = 0;
		for (const a of live) {
			if (gone.has(a)) continue;
			const seen = new Set<Obb>();
			for (const cell of cellsOf(a))
				for (const b of grid.get(cell) ?? []) {
					if (b === a || seen.has(b) || gone.has(b)) continue;
					seen.add(b);
					if (!parallel(a, b)) continue;
					// Only boxes that touch or nearly do.
					if (
						!corners(b).some((p) => holds(a, p, ABSORB_M)) &&
						!corners(a).some((p) => holds(b, p, ABSORB_M))
					)
						continue;
					const union = grownToHold(a, corners(b));
					if (intrudes(union) || !keepsTheRule(union)) continue;
					a.c.copy(union.c);
					a.half = union.half;
					gone.add(b);
					merged++;
				}
		}
		live = live.filter((o) => !gone.has(o));
		if (!merged) break;
	}
	return live;
}

function grownToHold(host: Obb, points: THREE.Vector3[]): Obb {
	const grown: Obb = {
		c: host.c.clone(),
		axes: host.axes,
		half: [...host.half],
	};
	for (const p of points) {
		const d = p.clone().sub(grown.c);
		grown.axes.forEach((ax, i) => {
			const t = d.dot(ax);
			if (Math.abs(t) <= grown.half[i]) return;
			const grow = (Math.abs(t) - grown.half[i]) / 2;
			grown.half[i] += grow;
			grown.c.addScaledVector(ax, Math.sign(t) * grow);
			d.addScaledVector(ax, -Math.sign(t) * grow);
		});
	}
	return grown;
}

/**
 * Small boxes within `ABSORB_M` of a larger one grow it instead — but only
 * while the grown box still keeps the rule. Unchecked, a row of plates a seam
 * apart chained into one box across the drum's bore.
 *
 * Each host takes its candidates together and is checked once; a batch that
 * breaks the rule is halved and each half tried in turn. One at a time, a
 * hall's box was rechecked for every lamp on it: ten minutes for one yard.
 */
function absorb(boxes: Obb[]): Obb[] {
	const volume = (o: Obb) => o.half[0] * o.half[1] * o.half[2];
	boxes.sort((a, b) => volume(b) - volume(a));
	const grid = new Map<string, Obb[]>();
	const hosts: Obb[] = [];
	const pending = new Map<Obb, Obb[]>();
	for (const part of boxes) {
		const cs = corners(part);
		const centreCell = cellsOf({ ...part, half: [0, 0, 0] })[0];
		const host = (grid.get(centreCell) ?? []).find((h) =>
			cs.every((p) => holds(h, p, ABSORB_M)),
		);
		if (host) {
			pending.get(host)?.push(part) ?? pending.set(host, [part]);
			continue;
		}
		hosts.push(part);
		for (const cell of cellsOf(part))
			(grid.get(cell) ?? grid.set(cell, []).get(cell)!).push(part);
	}
	const refused: Obb[] = [];
	const take = (host: Obb, parts: Obb[]) => {
		const grown = grownToHold(host, parts.flatMap(corners));
		if (!intrudes(grown) && keepsTheRule(grown)) {
			host.c.copy(grown.c);
			host.half = grown.half;
			return;
		}
		if (parts.length === 1) {
			refused.push(parts[0]);
			return;
		}
		const half = parts.length >> 1;
		take(host, parts.slice(0, half));
		take(host, parts.slice(half));
	};
	for (const [host, parts] of pending) take(host, parts);
	return [...hosts, ...refused];
}

function inGroup(o: THREE.Object3D, name: string) {
	for (let p: THREE.Object3D | null = o; p; p = p.parent)
		if (p.name === name) return true;
	return false;
}

/** Each connected part's triangles, in metres in the station frame. */
function partsOf(root: THREE.Object3D, group: string): Tri[][] {
	const core = STATION_GEOMETRY.shipyard.coreRadiusKm;
	const parts: Tri[][] = [];
	root.updateMatrixWorld(true);
	root.traverse((o) => {
		if (!(o instanceof THREE.Mesh) || !inGroup(o, group)) return;
		const g = o.geometry as THREE.BufferGeometry;
		const pos = g.getAttribute("position");
		const idx = g.getIndex();
		if (!idx) return;
		const world: THREE.Vector3[] = [];
		const parent = Int32Array.from({ length: pos.count }, (_, i) => i);
		const find = (a: number): number => {
			while (parent[a] !== a) {
				parent[a] = parent[parent[a]];
				a = parent[a];
			}
			return a;
		};
		const seen = new Map<string, number>();
		for (let i = 0; i < pos.count; i++) {
			const w = o
				.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, i))
				.multiplyScalar(core * 1000);
			world.push(w);
			const key = `${w.x.toFixed(2)},${w.y.toFixed(2)},${w.z.toFixed(2)}`;
			const j = seen.get(key);
			if (j === undefined) seen.set(key, i);
			else parent[find(i)] = find(j);
		}
		for (let i = 0; i < idx.count; i += 3) {
			const a = find(idx.getX(i));
			parent[find(idx.getX(i + 1))] = a;
			parent[find(idx.getX(i + 2))] = a;
		}
		const groups = new Map<number, Tri[]>();
		for (let i = 0; i < idx.count; i += 3) {
			const r = find(idx.getX(i));
			(groups.get(r) ?? groups.set(r, []).get(r)!).push([
				world[idx.getX(i)],
				world[idx.getX(i + 1)],
				world[idx.getX(i + 2)],
			]);
		}
		parts.push(...groups.values());
	});
	return parts;
}

/**
 * A drum box lying across the aperture plane from in front — a hub-face
 * plate, fitted with a minimum thickness either side of it — starts
 * `PLANE_CLEARANCE_M` in front of the plane instead, so neither that
 * thickness nor the packing's rounding reaches into the sim's bay. Only one
 * over the bay's section and turned in the plane: an axis-aligned box
 * `station-proxy.ts` cuts round the bay exactly, and one beside the bay —
 * the drum's rim — has no bay to keep out of. Moved regardless, the rim's
 * boxes left its last 4 m behind the plane uncovered.
 */
const PLANE_CLEARANCE_M = 0.3;
function offThePlane(boxes: Obb[]): Obb[] {
	const plane = STATION_GEOMETRY.shipyard.aperturePlaneKm * 1000;
	const bay = stationInterior("shipyard", plane / 1000);
	const overBay = (o: Obb) => {
		const cs = corners(o);
		return (
			Math.min(...cs.map((p) => p.x)) < bay.halfAcrossKm * 1000 &&
			Math.max(...cs.map((p) => p.x)) > -bay.halfAcrossKm * 1000 &&
			Math.min(...cs.map((p) => p.y)) < bay.halfUpKm * 1000 &&
			Math.max(...cs.map((p) => p.y)) > -bay.halfUpKm * 1000
		);
	};
	const aligned = (o: Obb) =>
		o.axes.every(
			(a) => Math.max(Math.abs(a.x), Math.abs(a.y), Math.abs(a.z)) > 0.9999,
		);
	for (const o of boxes) {
		const i = o.axes.findIndex((a) => Math.abs(a.z) > 0.9999);
		if (i < 0 || aligned(o) || !overBay(o)) continue;
		const lo = o.c.z - o.half[i];
		const hi = o.c.z + o.half[i];
		// A sheet on the plane itself (the plates' inner face) counts too.
		if (o.c.z < plane - 0.5 || lo >= plane + PLANE_CLEARANCE_M) continue;
		const from = plane + PLANE_CLEARANCE_M;
		const to = Math.max(hi, from + 0.4);
		o.half[i] = (to - from) / 2;
		o.c.z = (to + from) / 2;
	}
	// A tilted sheet at the slot's edge dips a corner behind the plane; within
	// the bay's section, carry it forward along the axis, a metre at most.
	for (const o of boxes) {
		if (o.c.z < plane - 1) continue;
		const cs = corners(o);
		const low = Math.min(...cs.map((p) => p.z));
		if (low >= plane + PLANE_CLEARANCE_M) continue;
		const inSection = cs.some(
			(p) =>
				Math.abs(p.x) < bay.halfAcrossKm * 1000 &&
				Math.abs(p.y) < bay.halfUpKm * 1000,
		);
		const lift = plane + PLANE_CLEARANCE_M - low;
		if (inSection && lift <= 1) o.c.z += lift;
	}
	return boxes;
}

export interface FittedProxy {
	drum: Obb[];
	yard: Obb[];
	/** Every triangle, metres, for a check that measures the boxes against them. */
	drumTris: Tri[];
	yardTris: Tri[];
}

export async function fitShipyardProxies(): Promise<
	Record<string, FittedProxy>
> {
	await installShippedShipyards();
	const out: Record<string, FittedProxy> = {};
	const only = process.env.SHIPYARD_FORMS?.split(",");
	const log = process.env.SHIPYARD_PROXY_LOG ? console.log : () => {};
	for (const form of SHIPYARD_FORMS) {
		if (only && !only.includes(form)) continue;
		const built = buildStationForm("shipyard", form, 0x888888, 0, 0);
		const drumParts = partsOf(built.root, AUTHORED_DRUM_NAME);
		const yardParts = partsOf(built.root, "shipyard-yard");
		const plane = STATION_GEOMETRY.shipyard.aperturePlaneKm * 1000;
		const bay = stationInterior("shipyard", plane / 1000);
		keepOut = [
			new THREE.Box3(
				new THREE.Vector3(
					-bay.halfAcrossKm * 1000,
					-bay.halfUpKm * 1000,
					bay.endAxialKm * 1000,
				),
				new THREE.Vector3(bay.halfAcrossKm * 1000, bay.halfUpKm * 1000, plane),
			),
			new THREE.Box3(
				new THREE.Vector3(
					-bay.laneHalfAcrossKm * 1000,
					-bay.laneHalfUpKm * 1000,
					plane,
				),
				new THREE.Vector3(
					bay.laneHalfAcrossKm * 1000,
					bay.laneHalfUpKm * 1000,
					plane + 3000,
				),
			),
		];
		const staged = (name: string, parts: Tri[][]) => {
			let t = performance.now();
			const lap = (stage: string, n: number) => {
				log(
					`${form} ${name} ${stage}: ${n} boxes, ${Math.round(performance.now() - t)} ms`,
				);
				t = performance.now();
			};
			nearModel = new TriangleGrid(parts.flat());
			const fitted = parts.flatMap((p) => fitPart(p));
			lap(`fit (${stranded.length} stranded so far)`, fitted.length);
			const kept = absorb(fitted);
			lap("absorb", kept.length);
			const merged = mergeNeighbours(kept);
			lap("merge", merged.length);
			nearModel = null;
			return merged;
		};
		const drum = offThePlane(staged("drum", drumParts));
		keepOut = [];
		out[form] = {
			drum,
			yard: staged("yard", yardParts),
			drumTris: drumParts.flat(),
			yardTris: yardParts.flat(),
		};
		built.dispose();
	}
	return out;
}

// --- Packing: 16-bit integers, conservative -------------------------------

/** Centre resolution and half-extent resolution, metres; rotation per unit. */
export const PACK = { centreM: 0.1, halfM: 0.05, rot: 32767 } as const;

/** The box as `pack` writes it, at its largest: every half grown by the
 *  slack and the half-step rounding, and the centre's rounding. */
function packed(o: Obb): Obb {
	const grow = packSlack(o) + PACK.halfM + PACK.centreM;
	return {
		c: o.c,
		axes: o.axes,
		half: o.half.map((h) => h + grow) as Obb["half"],
	};
}

/** A quantised quaternion turns the box by up to ~1/16384 rad. */
function packSlack(o: Obb): number {
	return PACK.centreM + Math.max(...o.half) / 16384;
}

/** Ten 16-bit numbers a box: centre, half-extent (rounded up, plus the
 *  centre's rounding and the rotation's), and its rotation as a quaternion. */
export function pack(boxes: Obb[]): string {
	const out = new Int16Array(boxes.length * 10);
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	boxes.forEach((o, n) => {
		m.makeBasis(o.axes[0], o.axes[1], o.axes[2]);
		q.setFromRotationMatrix(m).normalize();
		if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
		const slack = packSlack(o);
		const base = n * 10;
		[o.c.x, o.c.y, o.c.z].forEach((v, i) => {
			out[base + i] = Math.round(v / PACK.centreM);
		});
		o.half.forEach((h, i) => {
			out[base + 3 + i] = Math.ceil((h + slack) / PACK.halfM);
		});
		[q.x, q.y, q.z, q.w].forEach((v, i) => {
			out[base + 6 + i] = Math.round(v * PACK.rot);
		});
	});
	return Buffer.from(out.buffer).toString("base64");
}

// --- Measuring: how far a box's surface stands from the model -------------

/**
 * Each form's triangles as the game draws them, metres in the station's
 * frame: the drum's and the yard's, for a check that measures written boxes
 * against them.
 */
export async function shipyardTriangles(
	form: (typeof SHIPYARD_FORMS)[number],
): Promise<{ drum: Tri[]; yard: Tri[] }> {
	await installShippedShipyards();
	const built = buildStationForm("shipyard", form, 0x888888, 0, 0);
	const out = {
		drum: partsOf(built.root, AUTHORED_DRUM_NAME).flat(),
		yard: partsOf(built.root, "shipyard-yard").flat(),
	};
	built.dispose();
	return out;
}

/** One number per grid cell, for cells within ±10,000 of the origin. */
const cellKey = (i: number, j: number, k: number) =>
	((i + 10_000) * 20_000 + (j + 10_000)) * 20_000 + (k + 10_000);

/** Triangles in a uniform grid, for "is any within this distance" queries. */
export class TriangleGrid {
	private readonly cells = new Map<number, number[]>();
	private readonly stamps: Uint32Array;
	private stamp = 0;
	private readonly triangle = new THREE.Triangle();
	private readonly q = new THREE.Vector3();
	constructor(
		private readonly tris: Tri[],
		private readonly cell = 10,
	) {
		this.stamps = new Uint32Array(tris.length);
		const bounds = new THREE.Box3();
		tris.forEach((t, n) => {
			bounds.setFromPoints(t);
			for (let i = this.at(bounds.min.x); i <= this.at(bounds.max.x); i++)
				for (let j = this.at(bounds.min.y); j <= this.at(bounds.max.y); j++)
					for (let k = this.at(bounds.min.z); k <= this.at(bounds.max.z); k++) {
						const key = cellKey(i, j, k);
						const list = this.cells.get(key);
						if (list) list.push(n);
						else this.cells.set(key, [n]);
					}
		});
	}
	private at(v: number) {
		return Math.floor(v / this.cell);
	}
	/** True when some triangle lies within `limit` of `p`. */
	within(p: THREE.Vector3, limit: number): boolean {
		const s = ++this.stamp;
		const limitSq = limit * limit;
		for (let i = this.at(p.x - limit); i <= this.at(p.x + limit); i++)
			for (let j = this.at(p.y - limit); j <= this.at(p.y + limit); j++)
				for (let k = this.at(p.z - limit); k <= this.at(p.z + limit); k++)
					for (const n of this.cells.get(cellKey(i, j, k)) ?? []) {
						if (this.stamps[n] === s) continue;
						this.stamps[n] = s;
						const t = this.tris[n];
						this.triangle.set(t[0], t[1], t[2]).closestPointToPoint(p, this.q);
						if (this.q.distanceToSquared(p) <= limitSq) return true;
					}
		return false;
	}
}

/**
 * True when `test` holds for some point of a grid over the box's six faces,
 * no further apart than `spacingM`; it stops at the first. One point is
 * reused, so a caller that keeps it clones it: a hall's box holds most of a
 * million samples.
 */
export function someFacePoint(
	o: Obb,
	spacingM: number,
	test: (p: THREE.Vector3) => boolean,
): boolean {
	const steps = o.half.map((h) => Math.max(1, Math.ceil((2 * h) / spacingM)));
	const p = new THREE.Vector3();
	for (let a = 0; a < 3; a++) {
		const b = (a + 1) % 3;
		const c = (a + 2) % 3;
		for (const side of [-1, 1])
			for (let i = 0; i <= steps[b]; i++)
				for (let j = 0; j <= steps[c]; j++) {
					p.copy(o.c)
						.addScaledVector(o.axes[a], side * o.half[a])
						.addScaledVector(o.axes[b], ((2 * i) / steps[b] - 1) * o.half[b])
						.addScaledVector(o.axes[c], ((2 * j) / steps[c] - 1) * o.half[c]);
					if (test(p)) return true;
				}
	}
	return false;
}
