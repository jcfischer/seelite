/**
 * Node #735 — a derelict that looks broken, not only dark.
 *
 * `docs/specs/salvage.md` S26 shipped the dark hull first and left the broken
 * look as its own visual decision. This is that decision, applied to a built
 * roster hull **after** `buildShipMesh` has run, so the live ship look is not
 * touched: a torn part's geometry and material are cloned before anything is
 * cut, because every ship of a hull shares them.
 *
 * A tear is a patch of one lofted part's grid — rings along the part, segments
 * round it — on the fuselage, the dorsal hull or a nacelle, with four things
 * done to it:
 *
 * 1. **The skin is removed** inside a star-shaped outline, so the edge is
 *    ragged and no stranded flake of plating is left inside the hole.
 * 2. **The rim is folded inward**, never outward, by a seeded amount per rim
 *    vertex: the plates round a hole look bent rather than cut.
 * 3. **The rim is scorched**: a vertex colour darkens the skin within two
 *    cells of the hole.
 * 4. **The frame is exposed** — ribs on alternate ring stations and stringers
 *    on two segment lines, built from an inset of the loft's own vertices, so
 *    every member lies under where the skin was and runs on under the intact
 *    skin at its ends. One rib and one stringer are snapped in the middle.
 *
 * A dark liner draws the inside of a torn part, so a hole reads as a cavity
 * and not as space seen through a hull with no far wall.
 *
 * The **envelope does not move**, and the plan is what keeps it so: a tear may
 * not touch a vertex on any face of the hull's drawn box, nor any other part's
 * box, so no extremal ring, cap or attached fitting is cut or left floating.
 * `tests/derelict-tear.test.ts` measures the box from the triangles actually
 * drawn, which `Box3.setFromObject` does not — it reads the whole position
 * array, and a cut index would never move it.
 *
 * The plan is a pure function of the hull id: no RNG stream is drawn, so the
 * same hull tears the same way in every wreck and every view.
 */
import * as THREE from "three";
import type { HullId } from "./hull";

/** Rim vertices fold toward the ring's axis by this much (km). */
const FOLD_MIN_KM = 0.0003;
const FOLD_MAX_KM = 0.0014;
/** A frame member's outer face stands this far under where the skin was. */
const FRAME_INSET_KM = 0.0001;
const RIB = { depthKm: 0.0007, widthKm: 0.00035 };
const STRINGER = { depthKm: 0.0004, widthKm: 0.0003 };
/** Clearance kept between a removed triangle and any other part's box. */
const PART_CLEARANCE_KM = 0.0005;
/** A vertex this close to a face of the hull's box is on the envelope. */
const ENVELOPE_EPS_KM = 1e-7;
/** Skin brightness by grid distance from the hole: on the rim, one cell out, two. */
const SCORCH = [0.22, 0.5, 0.78] as const;
/** Patch half-extents tried, largest first: [rings, segments]. */
const PATCH_SIZES: readonly (readonly [number, number])[] = [
	[4.5, 2.6],
	[3.6, 2.2],
	[2.8, 1.8],
	[2.6, 1.3],
	[2.2, 1.1],
];
/** At most this many tears a hull, and at most one a part. */
const MAX_TEARS = 3;
/** A tear facing down weighs this much against one facing up or out. */
const BELLY_WEIGHT = 0.35;
/** How far the ragged outline can reach, as a multiple of a patch's extent. */
const OUTLINE_AMPLITUDE = 0.3;
const OUTLINE_HARMONICS = 5;
const OUTLINE_REACH =
	1 +
	OUTLINE_AMPLITUDE *
		Array.from({ length: OUTLINE_HARMONICS }, (_, k) => 1 / (k + 1)).reduce(
			(a, b) => a + b,
		);

/** FNV-1a over a string and integers, mapped to [0, 1). No stream is drawn. */
function hash01(id: string, ...values: number[]) {
	let h = 0x811c9dc5;
	const mix = (byte: number) => {
		h ^= byte & 0xff;
		h = Math.imul(h, 0x01000193);
	};
	for (let i = 0; i < id.length; i += 1) mix(id.charCodeAt(i));
	for (const v of values) for (let s = 0; s < 32; s += 8) mix(v >>> s);
	return (h >>> 0) / 0x100000000;
}

export interface TearPatch {
	/** The torn part's name, e.g. `courier-fuselage`. */
	part: string;
	/** Centre on the loft grid: a ring index and a segment index. */
	ring: number;
	segment: number;
	/** Half-extents in rings and segments before the ragged outline. */
	rings: number;
	segments: number;
}

interface Loft {
	mesh: THREE.Mesh;
	geometry: THREE.BufferGeometry;
	rings: number;
	segments: number;
	stride: number;
	axis: THREE.Vector3[];
}

/**
 * A part the tear can read as a loft: `hullLoft`'s side triangles first, in
 * its order, with the part drawn untransformed so its local frame is the
 * hull's. Anything else is left whole rather than guessed at.
 */
function loftOf(mesh: THREE.Object3D): Loft | null {
	if (!(mesh instanceof THREE.Mesh) || !mesh.geometry.index) return null;
	if (!mesh.matrix.equals(new THREE.Matrix4())) return null;
	const geometry = mesh.geometry as THREE.BufferGeometry;
	const ud = geometry.userData as {
		ringSize?: number;
		axis?: [number, number, number][];
	};
	if (!ud.ringSize || !ud.axis || ud.axis.length < 8) return null;
	const segments = ud.ringSize;
	const stride = segments + 1;
	const index = geometry.index as THREE.BufferAttribute;
	if (index.getX(0) !== 0 || index.getX(1) !== stride || index.getX(2) !== 1)
		return null;
	if (index.count < (ud.axis.length - 1) * segments * 6) return null;
	const axis = ud.axis.map(([x, y, z]) => new THREE.Vector3(x, y, z));
	// Rings are planes of constant z; a part swept along another axis is not
	// one this reads.
	const run = axis[axis.length - 1].clone().sub(axis[0]);
	if (Math.abs(run.z) < run.length() * 0.95) return null;
	return { mesh, geometry, rings: axis.length, segments, stride, axis };
}

/** The parts a hull may tear: its fuselage, a dorsal hull, its nacelles. */
function tearableParts(root: THREE.Object3D, hull: HullId): Loft[] {
	const out: Loft[] = [];
	for (const child of root.children) {
		const name = child.name;
		const wanted =
			name === `${hull}-fuselage` ||
			name === `${hull}-dorsal-hull` ||
			(name.startsWith(`${hull}-`) &&
				name.endsWith("-nacelle") &&
				!name.includes("-mount-"));
		if (!wanted) continue;
		const loft = loftOf(child);
		if (loft) out.push(loft);
	}
	return out;
}

/** The box of what a mesh draws: referenced vertices, per instance, in world space. */
export function drawnBoxes(object: THREE.Object3D, out: THREE.Box3[] = []) {
	object.updateWorldMatrix(true, false);
	if (!(object instanceof THREE.Mesh) || !object.visible) return out;
	const geometry = object.geometry as THREE.BufferGeometry;
	const position = geometry.getAttribute("position");
	if (!position) return out;
	const local = new THREE.Box3();
	const v = new THREE.Vector3();
	const index = geometry.index;
	const count = index ? index.count : position.count;
	for (let k = 0; k < count; k += 1) {
		v.fromBufferAttribute(position, index ? index.getX(k) : k);
		local.expandByPoint(v);
	}
	if (local.isEmpty()) return out;
	if (object instanceof THREE.InstancedMesh) {
		const m = new THREE.Matrix4();
		for (let i = 0; i < object.count; i += 1) {
			object.getMatrixAt(i, m);
			out.push(local.clone().applyMatrix4(m).applyMatrix4(object.matrixWorld));
		}
	} else out.push(local.clone().applyMatrix4(object.matrixWorld));
	return out;
}

/**
 * The hull's drawn box: every visible mesh's referenced vertices, in the
 * root's frame. Nav lights are `Points` and are not counted.
 */
export function drawnHullBox(root: THREE.Object3D) {
	const box = new THREE.Box3();
	root.updateWorldMatrix(true, true);
	const inverse = root.matrixWorld.clone().invert();
	root.traverse((object) => {
		for (let o: THREE.Object3D | null = object; o; o = o.parent)
			if (!o.visible) return;
		for (const b of drawnBoxes(object)) box.union(b.applyMatrix4(inverse));
	});
	return box;
}

/**
 * The side triangle of a loft cell: `hullLoft` emits two per quad, ring by
 * ring, so cell (ring, segment)'s pair is `2 × (ring × segments + segment)`.
 */
const triangleOf = (loft: Loft, ring: number, segment: number, second: 0 | 1) =>
	(ring * loft.segments + segment) * 2 + second;

const wrap = (loft: Loft, segment: number) =>
	((segment % loft.segments) + loft.segments) % loft.segments;

/**
 * Whether a cell's first or second triangle falls inside the patch's ragged
 * outline. The outline is star-shaped about the centre — a radius that varies
 * with angle — so the hole is one piece and its edge is ragged.
 */
function inPatch(
	loft: Loft,
	hull: string,
	patch: TearPatch,
	ring: number,
	segment: number,
	second: 0 | 1,
) {
	// The triangle's centroid on the grid: a quad's two triangles sit a third
	// of the way across it from opposite corners.
	const offset = second ? 2 / 3 : 1 / 3;
	let dj = segment + offset - patch.segment;
	dj -= Math.round(dj / loft.segments) * loft.segments;
	const di = (ring + offset - patch.ring) / patch.rings;
	const ds = dj / patch.segments;
	const theta = Math.atan2(ds, di);
	const seed = patch.ring * 31 + patch.segment;
	let radius = 1;
	for (let k = 1; k <= OUTLINE_HARMONICS; k += 1)
		radius +=
			(OUTLINE_AMPLITUDE / k) *
			Math.sin(
				k * 2 * theta + hash01(hull + patch.part, seed, k) * Math.PI * 2,
			);
	return Math.hypot(di, ds) < radius;
}

/** Every side triangle a patch removes, before islands are dropped. */
function patchTriangles(loft: Loft, hull: string, patch: TearPatch) {
	const out: number[] = [];
	const dr = Math.ceil(patch.rings * OUTLINE_REACH);
	const ds = Math.min(
		Math.floor(loft.segments / 2),
		Math.ceil(patch.segments * OUTLINE_REACH),
	);
	for (let ring = patch.ring - dr; ring <= patch.ring + dr; ring += 1) {
		if (ring < 0 || ring >= loft.rings - 1) continue;
		for (let d = -ds; d < ds; d += 1) {
			const segment = wrap(loft, patch.segment + d);
			for (const second of [0, 1] as const)
				if (inPatch(loft, hull, patch, ring, segment, second))
					out.push(triangleOf(loft, ring, segment, second));
		}
	}
	return out;
}

function positionKey(p: THREE.BufferAttribute, i: number) {
	return `${p.getX(i).toFixed(7)},${p.getY(i).toFixed(7)},${p.getZ(i).toFixed(7)}`;
}

/**
 * Drop any retained triangle not connected, edge to edge, to the part's main
 * skin. A ragged outline can strand one; a flake of plating hanging in a hole
 * on nothing is exactly the island the mounting check forbids. Edges are keyed
 * by position, because the loft's seam and its caps duplicate vertices.
 */
function dropIslands(geometry: THREE.BufferGeometry, removed: Set<number>) {
	const index = geometry.index as THREE.BufferAttribute;
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;
	const keys = Array.from({ length: position.count }, (_, i) =>
		positionKey(position, i),
	);
	const edge = (t: number, e: number) => {
		const a = keys[index.getX(t * 3 + e)];
		const b = keys[index.getX(t * 3 + ((e + 1) % 3))];
		return a < b ? `${a}|${b}` : `${b}|${a}`;
	};
	const triangles = index.count / 3;
	const byEdge = new Map<string, number[]>();
	for (let t = 0; t < triangles; t += 1) {
		if (removed.has(t)) continue;
		for (let e = 0; e < 3; e += 1) {
			const key = edge(t, e);
			const list = byEdge.get(key);
			if (list) list.push(t);
			else byEdge.set(key, [t]);
		}
	}
	const component = new Map<number, number>();
	const sizes: number[] = [];
	for (let t = 0; t < triangles; t += 1) {
		if (removed.has(t) || component.has(t)) continue;
		const id = sizes.length;
		let size = 0;
		const stack = [t];
		component.set(t, id);
		while (stack.length) {
			const u = stack.pop() as number;
			size += 1;
			for (let e = 0; e < 3; e += 1)
				for (const w of byEdge.get(edge(u, e)) ?? [])
					if (!component.has(w)) {
						component.set(w, id);
						stack.push(w);
					}
		}
		sizes.push(size);
	}
	const main = sizes.indexOf(Math.max(...sizes));
	for (const [t, id] of component) if (id !== main) removed.add(t);
}

interface Plan {
	patches: TearPatch[];
	/** Removed triangles, by part name. */
	removed: Map<string, Set<number>>;
}

const plans = new Map<HullId, Plan>();

/**
 * Where a hull tears: up to three patches on different parts, each as large as
 * fits, touching no vertex on the envelope and no other part. A nacelle pair
 * tears once, not symmetrically. Weighting the flanks and the back over the
 * belly is a legibility choice — a hole underneath is one nobody sees.
 */
function planTears(root: THREE.Group, hull: HullId, lofts: Loft[]): Plan {
	const cached = plans.get(hull);
	if (cached) return cached;
	const envelope = drawnHullBox(root);
	const onEnvelope = (v: THREE.Vector3) =>
		[0, 1, 2].some(
			(k) =>
				Math.abs(v.getComponent(k) - envelope.min.getComponent(k)) <
					ENVELOPE_EPS_KM ||
				Math.abs(v.getComponent(k) - envelope.max.getComponent(k)) <
					ENVELOPE_EPS_KM,
		);
	const candidates: { patch: TearPatch; tris: number[]; score: number }[] = [];
	for (const loft of lofts) {
		const position = loft.geometry.getAttribute(
			"position",
		) as THREE.BufferAttribute;
		const index = loft.geometry.index as THREE.BufferAttribute;
		const parts: THREE.Box3[] = [];
		for (const child of root.children)
			if (child !== loft.mesh) drawnBoxes(child, parts);
		for (const box of parts) box.expandByScalar(PART_CLEARANCE_KM);
		const triangle = new THREE.Triangle();
		const triBox = new THREE.Box3();
		const area = new Map<number, number>();
		const clear = (t: number) => {
			const corners = [triangle.a, triangle.b, triangle.c];
			for (let k = 0; k < 3; k += 1) {
				corners[k].fromBufferAttribute(position, index.getX(t * 3 + k));
				if (onEnvelope(corners[k])) return false;
			}
			area.set(t, triangle.getArea());
			triBox.setFromPoints(corners);
			return !parts.some((box) => box.intersectsBox(triBox));
		};
		const out = new THREE.Vector3();
		for (const [rings, segments] of PATCH_SIZES) {
			let best: (typeof candidates)[number] | null = null;
			const reach = Math.ceil(rings * OUTLINE_REACH);
			// A tear may not reach the end rings: they are the part's length,
			// and the caps behind them its nose and tail.
			for (let ring = 2 + reach; ring <= loft.rings - 3 - reach; ring += 1)
				for (let segment = 0; segment < loft.segments; segment += 1) {
					const patch = {
						part: loft.mesh.name,
						ring,
						segment,
						rings,
						segments,
					};
					const tris = patchTriangles(loft, hull, patch);
					if (tris.length < 6 || !tris.every(clear)) continue;
					out
						.fromBufferAttribute(position, ring * loft.stride + segment)
						.sub(loft.axis[ring])
						.normalize();
					const removedArea = tris.reduce((s, t) => s + (area.get(t) ?? 0), 0);
					const score =
						removedArea *
						(out.y < -0.5 ? BELLY_WEIGHT : 1) *
						(1 + 0.05 * hash01(hull, ring, segment));
					if (!best || score > best.score) best = { patch, tris, score };
				}
			// The largest size that fits anywhere on this part is its tear.
			if (best) {
				candidates.push(best);
				break;
			}
		}
	}
	candidates.sort((a, b) => b.score - a.score);
	const mirror = (name: string) =>
		name.includes("-port-")
			? name.replace("-port-", "-starboard-")
			: name.replace("-starboard-", "-port-");
	const patches: TearPatch[] = [];
	const removed = new Map<string, Set<number>>();
	for (const candidate of candidates) {
		if (patches.length >= MAX_TEARS) break;
		const part = candidate.patch.part;
		if (patches.some((p) => p.part === mirror(part))) continue;
		patches.push(candidate.patch);
		const set = new Set(candidate.tris);
		const loft = lofts.find((l) => l.mesh.name === part) as Loft;
		dropIslands(loft.geometry, set);
		removed.set(part, set);
	}
	const plan = { patches, removed };
	plans.set(hull, plan);
	return plan;
}

/** A member's cross-section swept along a polyline: a closed box section. */
function section(
	points: readonly THREE.Vector3[],
	outward: readonly THREE.Vector3[],
	across: readonly THREE.Vector3[],
	size: { depthKm: number; widthKm: number },
): THREE.BufferGeometry {
	const vertices: number[] = [];
	const indices: number[] = [];
	for (let k = 0; k < points.length; k += 1) {
		const outer = points[k]
			.clone()
			.addScaledVector(outward[k], -FRAME_INSET_KM);
		const inner = outer.clone().addScaledVector(outward[k], -size.depthKm);
		for (const c of [
			outer.clone().addScaledVector(across[k], size.widthKm / 2),
			inner.clone().addScaledVector(across[k], size.widthKm / 2),
			inner.clone().addScaledVector(across[k], -size.widthKm / 2),
			outer.clone().addScaledVector(across[k], -size.widthKm / 2),
		])
			vertices.push(c.x, c.y, c.z);
	}
	for (let k = 0; k < points.length - 1; k += 1)
		for (let n = 0; n < 4; n += 1) {
			const a = k * 4 + n;
			const b = k * 4 + ((n + 1) % 4);
			indices.push(a, b, b + 4, a, b + 4, a + 4);
		}
	// End caps, so a snapped member shows a section and not a hollow.
	const last = (points.length - 1) * 4;
	indices.push(
		0,
		2,
		1,
		0,
		3,
		2,
		last,
		last + 1,
		last + 2,
		last,
		last + 2,
		last + 3,
	);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(vertices, 3),
	);
	geometry.setIndex(indices);
	// Faceted: a frame member is a rolled section with hard edges, and a box's
	// shared corners would round it into a pipe under smooth normals.
	const flat = geometry.toNonIndexed();
	geometry.dispose();
	flat.computeVertexNormals();
	return flat;
}

/** Where a tear is, in the hull's frame: the patch centre and its outward normal. */
export interface TearSite {
	part: string;
	centre: [number, number, number];
	outward: [number, number, number];
}

export interface TornHull {
	patches: TearPatch[];
	sites: TearSite[];
	removedTriangles: number;
	/** The exposed frame: every member, each anchored under intact skin. */
	frame: THREE.Mesh[];
}

/**
 * Tear a built derelict hull in place. A torn part's geometry and material are
 * replaced by clones, a liner and the frame are added beside it, and every new
 * geometry and material is marked `derelictOwned` for `disposeDerelict`.
 * Returns null for a hull with nothing it can tear, which is left whole.
 */
export function tearHull(root: THREE.Group, hull: HullId): TornHull | null {
	root.updateMatrixWorld(true);
	const lofts = tearableParts(root, hull);
	const plan = planTears(root, hull, lofts);
	if (plan.patches.length === 0) return null;
	const envelope = drawnHullBox(root);
	const frameMaterial = new THREE.MeshStandardMaterial({
		color: 0x9a9284,
		roughness: 0.75,
		metalness: 0.45,
		side: THREE.DoubleSide,
	});
	frameMaterial.userData.derelictOwned = true;
	const linerMaterial = new THREE.MeshStandardMaterial({
		color: 0x0d0c0b,
		roughness: 1,
		metalness: 0,
		side: THREE.BackSide,
	});
	linerMaterial.userData.derelictOwned = true;
	const frame: THREE.Mesh[] = [];
	const sites: TearSite[] = [];
	let removedTriangles = 0;
	for (const patch of plan.patches) {
		const loft = lofts.find((l) => l.mesh.name === patch.part) as Loft;
		const removed = plan.removed.get(patch.part) as Set<number>;
		removedTriangles += removed.size;
		const original = loft.geometry.getAttribute(
			"position",
		) as THREE.BufferAttribute;
		const centre = new THREE.Vector3().fromBufferAttribute(
			original,
			patch.ring * loft.stride + patch.segment,
		);
		sites.push({
			part: patch.part,
			centre: centre.toArray(),
			outward: centre.clone().sub(loft.axis[patch.ring]).normalize().toArray(),
		});
		const geometry = cutSkin(loft, hull, removed, envelope);
		loft.mesh.geometry = geometry;
		loft.mesh.material = scorchedMaterial(loft.mesh.material as THREE.Material);
		const liner = new THREE.Mesh(geometry, linerMaterial);
		liner.name = `${patch.part}-liner`;
		root.add(liner);
		for (const member of exposeFrame(loft, hull, removed, original, envelope)) {
			member.material = frameMaterial;
			root.add(member);
			frame.push(member);
		}
	}
	return { patches: plan.patches, sites, removedTriangles, frame };
}

/** The part's own material, cloned so it can read the scorch's vertex colour. */
function scorchedMaterial(source: THREE.Material) {
	const material = source.clone();
	material.onBeforeCompile = source.onBeforeCompile;
	material.customProgramCacheKey = source.customProgramCacheKey;
	material.vertexColors = true;
	material.userData = { ...source.userData, derelictOwned: true };
	return material;
}

/**
 * The torn skin: a clone of the part's geometry with the patch's triangles
 * gone, the rim folded inward and the skin round it scorched.
 */
function cutSkin(
	loft: Loft,
	hull: string,
	removed: Set<number>,
	envelope: THREE.Box3,
) {
	const source = loft.geometry;
	const geometry = source.clone();
	geometry.userData = { ...source.userData, derelictOwned: true };
	const index = source.index as THREE.BufferAttribute;
	const kept: number[] = [];
	const inHole = new Set<number>();
	for (let t = 0; t < index.count / 3; t += 1) {
		const tri = [
			index.getX(t * 3),
			index.getX(t * 3 + 1),
			index.getX(t * 3 + 2),
		];
		if (removed.has(t)) for (const i of tri) inHole.add(i);
		else kept.push(...tri);
	}
	geometry.setIndex(kept);
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;

	// Grid distance from the hole, for the scorch: 0 on the rim, then outward
	// one ring or segment at a time.
	const gridOf = (i: number) =>
		i < loft.rings * loft.stride
			? {
					ring: Math.floor(i / loft.stride),
					segment: (i % loft.stride) % loft.segments,
				}
			: null;
	const holeCells: { ring: number; segment: number }[] = [];
	for (const i of inHole) {
		const g = gridOf(i);
		if (g) holeCells.push(g);
	}
	const distance = (i: number) => {
		const g = gridOf(i);
		if (!g) return Number.POSITIVE_INFINITY;
		let best = Number.POSITIVE_INFINITY;
		for (const h of holeCells) {
			let ds = Math.abs(h.segment - g.segment);
			ds = Math.min(ds, loft.segments - ds);
			best = Math.min(best, Math.max(Math.abs(h.ring - g.ring), ds));
		}
		return best;
	};
	const colours = new Float32Array(position.count * 3).fill(1);
	const p = new THREE.Vector3();
	const onEnvelope = (q: THREE.Vector3) =>
		[0, 1, 2].some(
			(k) =>
				Math.abs(q.getComponent(k) - envelope.min.getComponent(k)) <
					ENVELOPE_EPS_KM ||
				Math.abs(q.getComponent(k) - envelope.max.getComponent(k)) <
					ENVELOPE_EPS_KM,
		);
	for (let i = 0; i < position.count; i += 1) {
		const d = distance(i);
		if (d < SCORCH.length) {
			const shade = SCORCH[d] * (0.85 + 0.3 * hash01(hull, i, 3));
			colours.fill(Math.min(1, shade), i * 3, i * 3 + 3);
		}
		// Fold the rim inward toward the ring's own axis. The seam twin
		// (segment 0 and segment `segments`) is the same grid point, so it
		// folds by the same seeded amount and the seam stays closed.
		if (d !== 0) continue;
		const g = gridOf(i) as { ring: number; segment: number };
		p.fromBufferAttribute(position, i);
		if (onEnvelope(p)) continue;
		// Drag it part of the way toward one grid neighbour first, so the edge
		// does not run along the cell lines. A step toward another point of
		// the skin, like the fold toward the axis, stays inside the box.
		const pick = hash01(hull, g.ring, g.segment, 11);
		const ring = Math.min(
			loft.rings - 1,
			Math.max(0, g.ring + (pick < 0.25 ? -1 : pick < 0.5 ? 1 : 0)),
		);
		const segment = wrap(
			loft,
			g.segment + (pick < 0.5 ? 0 : pick < 0.75 ? -1 : 1),
		);
		// Read off the uncut source, so the order the rim is walked in, and
		// which of a seam's two twins goes first, cannot change the result.
		const toward = new THREE.Vector3().fromBufferAttribute(
			source.getAttribute("position") as THREE.BufferAttribute,
			ring * loft.stride + segment,
		);
		p.lerp(toward, 0.45 * hash01(hull, g.ring, g.segment, 13));
		const toAxis = loft.axis[g.ring].clone().sub(p);
		const fold = Math.min(
			toAxis.length() * 0.35,
			FOLD_MIN_KM +
				(FOLD_MAX_KM - FOLD_MIN_KM) * hash01(hull, g.ring, g.segment, 7),
		);
		p.addScaledVector(toAxis.normalize(), fold);
		position.setXYZ(i, p.x, p.y, p.z);
	}
	geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
	position.needsUpdate = true;
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return geometry;
}

/**
 * Ribs and stringers under the hole. Each runs on along its line until it ends
 * under a grid point no removed triangle used — skin the tear neither cut nor
 * folded — so it is carried by the hull it was part of. A snapped member is
 * two stubs, each still carried at its own end, the broken ends sagging inward.
 */
function exposeFrame(
	loft: Loft,
	hull: string,
	removed: Set<number>,
	original: THREE.BufferAttribute,
	envelope: THREE.Box3,
): THREE.Mesh[] {
	const vertexAt = (ring: number, segment: number) =>
		new THREE.Vector3().fromBufferAttribute(
			original,
			ring * loft.stride + wrap(loft, segment),
		);
	const outwardAt = (ring: number, segment: number) =>
		vertexAt(ring, segment).sub(loft.axis[ring]).normalize();
	const alongAt = (ring: number) =>
		loft.axis[Math.min(loft.rings - 1, ring + 1)]
			.clone()
			.sub(loft.axis[Math.max(0, ring - 1)])
			.normalize();
	// The hole, cell by cell: for each ring, the segments it removed, written
	// unwrapped round the patch so a hole across the seam stays contiguous.
	const cells: { ring: number; segment: number }[] = [];
	for (const t of removed) {
		const q = Math.floor(t / 2);
		cells.push({
			ring: Math.floor(q / loft.segments),
			segment: q % loft.segments,
		});
	}
	if (cells.length === 0) return [];
	const pivot = cells[0].segment;
	const unwrap = (s: number) => {
		let d = s - pivot;
		d -= Math.round(d / loft.segments) * loft.segments;
		return pivot + d;
	};
	const rows = new Map<number, number[]>();
	const columns = new Map<number, number[]>();
	for (const c of cells) {
		const s = unwrap(c.segment);
		rows.set(c.ring, [...(rows.get(c.ring) ?? []), s]);
		columns.set(s, [...(columns.get(s) ?? []), c.ring]);
	}
	const firstRing = Math.min(...rows.keys());
	const lastRing = Math.max(...rows.keys()) + 1;
	// Grid points a removed triangle used: the hole's own and its rim, which
	// the fold moves. A member never ends on one.
	const used = new Set<number>();
	const sourceIndex = loft.geometry.index as THREE.BufferAttribute;
	for (const t of removed)
		for (let k = 0; k < 3; k += 1) {
			const i = sourceIndex.getX(t * 3 + k);
			used.add(
				Math.floor(i / loft.stride) * loft.segments +
					((i % loft.stride) % loft.segments),
			);
		}
	const intact = (ring: number, segment: number) =>
		!used.has(ring * loft.segments + wrap(loft, segment));
	/** Walk from `start` in `step` until the grid point is intact skin. */
	const runOn = (
		start: number,
		step: 1 | -1,
		at: (n: number) => boolean,
		limit: number,
	) => {
		let n = start;
		while (!at(n) && Math.abs(n - start) < limit) n += step;
		return n;
	};
	const p = new THREE.Vector3();
	const members: THREE.Mesh[] = [];
	const add = (
		name: string,
		points: THREE.Vector3[],
		outward: THREE.Vector3[],
		across: THREE.Vector3[],
		size: { depthKm: number; widthKm: number },
		anchors: "both" | "fore" | "aft",
	) => {
		if (points.length < 2) return;
		const geometry = section(points, outward, across, size);
		// Inside the envelope by construction (an inset toward the axis); the
		// clamp holds the fraction of a section's width a corner can add.
		const at = geometry.getAttribute("position") as THREE.BufferAttribute;
		for (let k = 0; k < at.count; k += 1) {
			p.fromBufferAttribute(at, k).clamp(envelope.min, envelope.max);
			at.setXYZ(k, p.x, p.y, p.z);
		}
		geometry.computeBoundingBox();
		geometry.computeBoundingSphere();
		geometry.userData.derelictOwned = true;
		const mesh = new THREE.Mesh(geometry);
		mesh.name = name;
		// The skin points the member is laid from and to, for the mounting
		// check: an anchored one is intact skin the member reaches.
		mesh.userData.derelictFrame = {
			anchors,
			ends: [points[0].toArray(), points[points.length - 1].toArray()],
		};
		members.push(mesh);
	};
	/** Lay a member along `points`, snapping it in the middle when asked. */
	const lay = (
		name: string,
		points: THREE.Vector3[],
		outward: THREE.Vector3[],
		across: THREE.Vector3[],
		size: { depthKm: number; widthKm: number },
		snap: boolean,
	) => {
		if (!snap || points.length < 5) {
			add(name, points, outward, across, size, "both");
			return;
		}
		const cut = Math.floor(points.length / 2);
		const sag = (k: number, depth: number) =>
			points[k].clone().addScaledVector(outward[k], -depth);
		const head = points.slice(0, cut);
		head[cut - 1] = sag(cut - 1, FOLD_MAX_KM);
		const tail = points.slice(cut + 1);
		tail[0] = sag(cut + 1, FOLD_MAX_KM * 0.6);
		add(
			`${name}-a`,
			head,
			outward.slice(0, cut),
			across.slice(0, cut),
			size,
			"fore",
		);
		add(
			`${name}-b`,
			tail,
			outward.slice(cut + 1),
			across.slice(cut + 1),
			size,
			"aft",
		);
	};

	const ribs: number[] = [];
	for (let ring = firstRing + 1; ring < lastRing; ring += 2) ribs.push(ring);
	const snappedRib =
		ribs.length >= 3 ? ribs[Math.floor(ribs.length / 2)] : null;
	for (const ring of ribs) {
		const spans = [...(rows.get(ring) ?? []), ...(rows.get(ring - 1) ?? [])];
		if (spans.length === 0) continue;
		const points: THREE.Vector3[] = [];
		const outward: THREE.Vector3[] = [];
		const across: THREE.Vector3[] = [];
		const at = (n: number) => intact(ring, n);
		const half = loft.segments / 2;
		const from = runOn(Math.min(...spans), -1, at, half);
		const to = runOn(Math.max(...spans) + 1, 1, at, half);
		for (let s = from; s <= to; s += 1) {
			points.push(vertexAt(ring, s));
			outward.push(outwardAt(ring, s));
			across.push(alongAt(ring));
		}
		lay(
			`${loft.mesh.name}-rib-${ring}`,
			points,
			outward,
			across,
			RIB,
			ring === snappedRib,
		);
	}

	// Two stringers: the segment line nearest the hole's middle, snapped, and
	// one two segments off it, whole.
	const lines = [...columns.keys()].sort((a, b) => a - b);
	const middle = lines[Math.floor(lines.length / 2)];
	const side = hash01(hull, loft.rings, loft.segments) < 0.5 ? -2 : 2;
	for (const [s, snap] of [
		[middle, true],
		[middle + side, false],
	] as const) {
		const along = [...(columns.get(s) ?? []), ...(columns.get(s - 1) ?? [])];
		if (along.length === 0) continue;
		const points: THREE.Vector3[] = [];
		const outward: THREE.Vector3[] = [];
		const across: THREE.Vector3[] = [];
		const at = (n: number) => n <= 1 || n >= loft.rings - 2 || intact(n, s);
		const from = runOn(Math.min(...along), -1, at, loft.rings);
		const to = runOn(Math.max(...along) + 1, 1, at, loft.rings);
		for (let ring = from; ring <= to; ring += 1) {
			points.push(vertexAt(ring, s));
			outward.push(outwardAt(ring, s));
			across.push(
				vertexAt(ring, s + 1)
					.sub(vertexAt(ring, s - 1))
					.normalize(),
			);
		}
		lay(
			`${loft.mesh.name}-stringer-${wrap(loft, s)}`,
			points,
			outward,
			across,
			STRINGER,
			snap,
		);
	}
	return members;
}
