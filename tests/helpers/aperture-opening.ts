/**
 * What a docking ship actually crosses on the way into a station (#155).
 *
 * One measurement, used by the test that gates it and by the instrument that
 * reprints its table. It lives under `tests/helpers/` for the reason
 * `station-rows.ts` gives: the dependency points from the operator tooling into
 * the guarded tier, never the other way. The first version of #155's figures
 * came out of a throwaway script, and a figure a receipt states as measured owes
 * a shipped mode that reprints it (the map's constraint from #118).
 *
 * **Both questions live here now** (#165). What is *in* the opening and what is
 * in front of it were two measurements in two files, and a pad role has no
 * opening at all — its gate is the corridor in front of the plane and nothing
 * else. Keeping the corridor cast in `tests/station-mesh.test.ts` would have
 * left `scripts/measure-aperture-cut.ts` unable to print a row for six of the
 * twelve forms, which is the same "a figure a receipt states as measured owes a
 * shipped mode that reprints it" this file's docstring already answers for.
 */

import * as THREE from "three";
import { STATION_GEOMETRY, type StationType } from "../../src/station";
import type { StationInterior } from "../../src/station-interior";

/**
 * The bay's own parts — what lies beyond the opening on purpose.
 *
 * Its five shell slabs (§13.1), its fittings, the bulkhead shield a parked ship
 * reads, and the berth furniture the traversal parks against.
 */
const BAY_PART = /^(interior-|bay-|berth-|station-nameplate)/;

/**
 * The aperture's own frame and the fixtures mounted on it.
 *
 * All of these stand **proud of the surface** the opening is cut into, by
 * construction: the four bars straddle it, the trade Coriolis's coaming spans
 * #128's 6% stand-off, and an outpost's floods and heat ring sit on its deck.
 * `collarSurfaces` asks which *hull* surface surrounds the opening, so a light
 * in front of it is the wrong answer rather than a failing one.
 */
const FRAME_PART = /^(aperture|coaming|heat-glow|bay-flood)/;

/**
 * Raycast against **geometry rather than shading**.
 *
 * A hull is `FrontSide` and the bay's shell is `DoubleSide`, so a cast that
 * honoured `side` would report a different set of surfaces depending on which
 * way each one happens to face — and `CLAUDE.md` records the failure that comes
 * of it: *nothing headless can see geometry poking through a hull*, because a
 * ray cast from inside a `FrontSide` mesh passes straight through and reports
 * nothing at all.
 *
 * The materials are **restored afterwards**. They are shared per
 * `(type, colour)` and cached by `flatCloneOf`, so leaving them two-sided would
 * hand the next caller a different scene from the one the game builds.
 */
function twoSided<T>(root: THREE.Object3D, body: () => T): T {
	// **Keyed by material, not a list of pairs.** `hullMaterial` and
	// `flatCloneOf` are module-level caches, so one material reaches many meshes;
	// a list saves it a second time *after* the first mutation and the last
	// restore writes `DoubleSide` back for good. Measured on `refinery a`: 9 of
	// 42 materials kept the changed side, and the leak outlives the call because
	// the cache does.
	const saved = new Map<THREE.Material, THREE.Side>();
	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		if (!mesh.isMesh) return;
		const materials = Array.isArray(mesh.material)
			? mesh.material
			: [mesh.material];
		for (const material of materials) {
			if (!material) continue;
			if (!saved.has(material)) saved.set(material, material.side);
			material.side = THREE.DoubleSide;
		}
	});
	try {
		return body();
	} finally {
		for (const [material, side] of saved) material.side = side;
	}
}

/**
 * One ray straight down −Z through `(xKm, yKm)`, and every surface it meets
 * from the bay's back wall outward.
 *
 * Shared by both gate rows: they differ in where they sample and in what they
 * exclude, and nothing else. Two copies of the cast could drift on the origin
 * offset or on `far` and leave the rows measuring different things.
 */
function castDown(
	root: THREE.Object3D,
	xKm: number,
	yKm: number,
	coreKm: number,
	band: THREE.Box3,
): THREE.Intersection[] {
	const ray = new THREE.Raycaster(
		new THREE.Vector3(xKm / coreKm, yKm / coreKm, band.max.z + 20),
		new THREE.Vector3(0, 0, -1),
	);
	ray.far = 100;
	// **From the back wall outward, with no ceiling.** An upper bound at the
	// mouth reads a surface lying exactly *in* the mouth plane — which is where
	// ten of the twelve forms put theirs — as inside or outside on float32
	// noise, and it silently reported two forms clear that were not. Anything
	// drawn across the rectangle in front of the mouth is an obstruction too, so
	// there is nothing to bound.
	return ray
		.intersectObject(root, true)
		.filter((hit) => hit.point.z >= band.min.z);
}

/**
 * The band a ship traverses, in mesh units: the drawn bay's own z extent.
 *
 * **Off the drawn bay, not off the table.** An alternate form cuts its aperture
 * where its own silhouette wants — `buildTradeRing` puts one at `r * 0.34`
 * against a table figure of 0.428 — so a band derived from `STATION_GEOMETRY`
 * would be measuring somewhere the workbench's forms have no opening at all.
 * Measured, the box's front face is the aperture bars' own plane on all twelve
 * forms, and its back face is the wall a parked ship stops short of.
 */
export function bayBand(root: THREE.Object3D): THREE.Box3 {
	// **Updated here rather than by the caller.** A stale world matrix gives a
	// box in the wrong units — the first version of the instrument read a trade
	// Coriolis's mouth at 0.257 km against its true 0.428 — and both the band
	// and every figure derived from it come out silently wrong rather than
	// missing.
	root.updateMatrixWorld(true);
	const box = new THREE.Box3();
	let slabs = 0;
	root.traverse((object) => {
		if (!/^interior-shell/.test(object.name)) return;
		box.expandByObject(object);
		slabs++;
	});
	if (slabs === 0) throw new Error("no bay shell to measure the band from");
	return box;
}

/**
 * Does this form draw an enclosed bay at all?
 *
 * **A pad role draws none** (#165). `bayBand` throws rather than returning an
 * empty box, because every figure downstream of it is measured *from* that box
 * and a zero-size one would report a form as trivially clear. So the callers
 * that must answer for all twelve forms ask this first, and the ones that must
 * not be allowed to pass vacuously — `crossings` and the gate that reads it —
 * still throw.
 */
export function hasBay(root: THREE.Object3D): boolean {
	let found = false;
	root.traverse((object) => {
		if (/^interior-shell/.test(object.name)) found = true;
	});
	return found;
}

/**
 * **Strictly past the plane, by more than float32 can move a vertex.** Since
 * #128 the aperture plane *is* the surface the slot is cut into, so a hull's
 * own face and the plane are the same number reached by different paths — a
 * float64 constant against a `Float32Array` position — and the wall the
 * aperture is cut into lands a hair either side of it. A hundred millimetres is
 * four orders under anything `docking.md` talks about and four orders over the
 * noise (~3e-5 m at 0.4 km).
 */
export const WALL_EPSILON_KM = 1e-4;

/**
 * The docking corridor: the aperture's own footprint, extended outward along
 * +Z from the front of its mouth, as the deepest intrusion per part.
 *
 * A ship arrives down this axis — it is the one approach every type shares
 * (`docking.md` §4) — so anything of the station sitting in it is something the
 * pilot has to fly through. The failure that produced this check was the
 * refinery's asteroid: **noise does not know where the dock is**, and a rock is
 * the one body in the pool whose surface is not authored. Measured, the
 * Warren's rock rose 131 m past its own pad mouth and the Collar's 74 m.
 *
 * Written generally rather than against the rock, because the same failure has
 * other shapes — a flare boom swung across the approach, a gantry rib carried
 * too far forward — and none of them would be caught by a check that only knew
 * about asteroids.
 *
 * The radius is the aperture's half-*diagonal*, so the corridor contains the
 * whole opening rather than an inscribed circle of it.
 *
 * **It is a pad role's whole lane gate** (#165). A pad has no bay for anything
 * to be inside; what a ship traverses is the volume in front of the plane, and
 * that is this. It is also why a pad's berths stand as far out as they do —
 * they are the first parts of a station ever drawn on this side of the plane.
 */
export function corridorIntrusions(
	root: THREE.Object3D,
	type: StationType,
): Map<string, number> {
	root.updateMatrixWorld(true);
	const core = STATION_GEOMETRY[type].coreRadiusKm;
	const { widthKm, heightKm } = STATION_GEOMETRY[type].aperture;
	const radius = Math.hypot(widthKm, heightKm) / 2;
	// The aperture plane, read off the bars' own centre — they straddle it.
	const front = mouthPlane(root) * core;
	const found = new Map<string, number>();
	const v = new THREE.Vector3();
	const instance = new THREE.Matrix4();
	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position) return;
		// The aperture's own frame lives in the corridor by construction — it
		// *is* the opening.
		if (object.name.startsWith("aperture")) return;
		// A light pool is a lit decal lying on a surface, with no volume a ship
		// could strike (#300). The mouth ring's pools reach a few metres inside
		// the corridor from lamps that stand outside it, and a ship flying
		// through a pool of light is flying through light.
		if (object.userData.pool) return;
		const instanced = object as THREE.InstancedMesh;
		const count = instanced.isInstancedMesh ? instanced.count : 1;
		for (let n = 0; n < count; n++) {
			if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance);
			else instance.identity();
			for (let i = 0; i < position.count; i++) {
				v.fromBufferAttribute(position as THREE.BufferAttribute, i);
				v.applyMatrix4(instance);
				mesh.localToWorld(v);
				v.multiplyScalar(core);
				if (v.z <= front + WALL_EPSILON_KM) continue;
				if (Math.hypot(v.x, v.y) > radius) continue;
				const name = object.name || object.type;
				found.set(name, Math.max(found.get(name) ?? 0, v.z - front));
			}
		}
	});
	return found;
}

/**
 * The axial span the *drawn* interior occupies, nearest the station's centre
 * first — the box a form's `interior-shell`/`interior-deck` parts must fill.
 *
 * **Shared between the two suites that assert it** (#165). It was written out
 * twice, in `tests/station-mesh.test.ts` and
 * `tests/station-interior-mesh.test.ts`, and a change to the deck's face or its
 * thickness would have to land in both or one row goes quietly green against
 * the old figure.
 *
 * It reads the declaration, never the geometry: the row that uses it compares
 * the drawn box against this, so a tautology would need both sides to come from
 * the mesh.
 */
export function drawnInteriorSpanKm(
	interior: StationInterior,
): [number, number] {
	if (interior.presentation !== "pad")
		return [interior.endAxialKm, interior.mouthAxialKm];
	// A pad's deck runs **inward** from the berth surface — the plane itself —
	// by the span the interior declares outward of it, which is a berth's own
	// clear height. Both figures are the sim's.
	const face = interior.mouthAxialKm;
	return [face - (interior.stagingAxialKm - interior.mouthAxialKm), face];
}

/** One line per form, in the shape both the corridor failure message and the
 *  instrument print. Empty when the corridor is clear. */
export function corridorLine(found: Map<string, number>): string {
	return [...found]
		.map(([name, depth]) => `${name} +${(depth * 1000).toFixed(0)}m`)
		.join(", ");
}

/**
 * The aperture frame's own plane, in mesh units — the mean of the four bars'
 * centres.
 *
 * **The zero point of every figure this module produces.** `pastMouthKm`, the
 * bay depths and §13.1's whole table are measured from `bayBand().max.z`, and
 * the claim that the drawn bay's front face *is* this plane was prose until
 * `tests/station-mesh.test.ts` began asserting the two agree. A silent drift
 * between them would move every number here without failing anything.
 */
export function mouthPlane(root: THREE.Object3D): number {
	root.updateMatrixWorld(true);
	const centres: number[] = [];
	root.traverse((object) => {
		if (object.name !== "aperture-light") return;
		centres.push(
			new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()).z,
		);
	});
	if (centres.length !== 4)
		throw new Error(`${centres.length} aperture bars, expected 4`);
	return centres.reduce((a, b) => a + b, 0) / centres.length;
}

/** One surface a ship crosses inside the opening: its name, and how far past
 *  the mouth it sits in kilometres. */
export interface Crossing {
	name: string;
	pastMouthKm: number;
	/** What share of the opening it stands across, 0–1. A corner clipped and a
	 *  lane blocked are different defects with different fixes, and a name with
	 *  a depth beside it cannot tell them apart. */
	coverage: number;
	/**
	 * Whether this surface is one an aperture was cut into.
	 *
	 * Read off `userData.apertureCut`, which `hullLoft` and
	 * `buildCuboctahedron` write on the geometry they cut. It is what lets the
	 * gate assert the *cut* — #155's ruling — separately from the traffic
	 * standing in the lane behind it, which is #147's and has its own fixes. No
	 * depth band separates the two: the trade Coriolis's frame stands 25 m proud
	 * of the face it is cut into and an outpost's tower leg crosses the lane at
	 * 30 m.
	 */
	cut: boolean;
}

/**
 * Everything crossed inside the opening, nearest the mouth first.
 *
 * **A grid over the whole rectangle, out to its edges.** The cut is a ring, so a
 * defect that leaves a spur or misplaces one edge shows on some samples and not
 * others; the five-ray sketch that found #155's defect found it because that one
 * was the entire face, and it would miss a cut that was merely wrong.
 *
 * The grid reaches `EDGE_FRACTION` of each half-extent rather than the last
 * cell's centre. Cell centres top out at 0.944 of the half-width at nine
 * columns, so hull left standing across the outer 6% of each half-extent was
 * never sampled — and the claim this gate is asked to hold is that the cut edge
 * *is* the rectangle, with no tolerance to spend. It stops just short of the
 * boundary itself, because the cut edge and the rectangle are the same line and
 * a ray exactly on it asks a question about float32 rather than about geometry.
 *
 * Nothing here asserts. The assertion lives in the test.
 */
export function crossings(root: THREE.Object3D, type: StationType): Crossing[] {
	const core = STATION_GEOMETRY[type].coreRadiusKm;
	const { widthKm, heightKm } = STATION_GEOMETRY[type].aperture;
	const band = bayBand(root);
	const found = new Map<string, number>();
	const wasCut = new Map<string, boolean>();
	// **Rays, not hits.** Every surface is cast two-sided, so one ray through a
	// solid object returns its front face and its back face and a hit count
	// reports 200% of an opening it covers once.
	const rays = new Map<string, Set<number>>();
	const CELLS = 9;
	/** How far out the outermost sample sits, as a share of the half-extent. */
	const EDGE_FRACTION = 0.99;
	twoSided(root, () => {
		for (let ix = 0; ix < CELLS; ix++) {
			for (let iy = 0; iy < CELLS; iy++) {
				const cell = ix * CELLS + iy;
				const x = ((ix / (CELLS - 1)) * 2 - 1) * EDGE_FRACTION * (widthKm / 2);
				const y = ((iy / (CELLS - 1)) * 2 - 1) * EDGE_FRACTION * (heightKm / 2);
				for (const hit of castDown(root, x, y, core, band)) {
					const name = hit.object.name || hit.object.type;
					// The aperture's own frame lives in the opening by
					// construction — it *is* what frames it.
					if (name.startsWith("aperture") || BAY_PART.test(name)) continue;
					const past = (band.max.z - hit.point.z) * core;
					found.set(name, Math.min(found.get(name) ?? past, past));
					wasCut.set(
						name,
						(wasCut.get(name) ?? false) ||
							(hit.object as THREE.Mesh).geometry?.userData?.apertureCut !==
								undefined,
					);
					const seen = rays.get(name) ?? new Set<number>();
					seen.add(cell);
					rays.set(name, seen);
				}
			}
		}
	});
	return [...found]
		.map(([name, pastMouthKm]) => ({
			name,
			pastMouthKm,
			coverage: (rays.get(name)?.size ?? 0) / (CELLS * CELLS),
			cut: wasCut.get(name) ?? false,
		}))
		.sort((a, b) => a.pastMouthKm - b.pastMouthKm);
}

/**
 * The surface that **surrounds** the opening, per ray, and whether it was cut.
 *
 * `crossings` above can only see what still stands *in* the rectangle, and a
 * cut surface leaves nothing there — so on its own it cannot tell a form that
 * cut the right surface from one that cut a different surface and left the
 * right one solid. Point `buildRefineryWarren`'s cut at `i === 0` instead of
 * `i === 2` and the outermost terrace stands whole across the opening while
 * every ray through the rectangle passes clean between the pieces of a hole cut
 * two terraces down.
 *
 * So this samples the **collar** just outside the rectangle, where a cut
 * surface still has material, and asks which hull surface is frontmost there.
 * It must be one that was cut. The aperture's own frame is excluded — the four
 * bars and the trade Coriolis's coaming stand proud of the surface by
 * construction, which is what #128's 6% is.
 */
export function collarSurfaces(
	root: THREE.Object3D,
	type: StationType,
): { name: string; cut: boolean; pastMouthKm: number }[] {
	root.updateMatrixWorld(true);
	const core = STATION_GEOMETRY[type].coreRadiusKm;
	const { widthKm, heightKm } = STATION_GEOMETRY[type].aperture;
	const band = bayBand(root);
	/**
	 * How far out the collar sits, as a multiple of each half-extent.
	 *
	 * **Just outside, because the gate is otherwise one-sided.** The other row
	 * samples inside the rectangle, where a cut that is too *large* removes hull
	 * and produces fewer hits rather than more — so an oversize is invisible
	 * there, and an oversize is what opens a gap between the hole and the four
	 * bars that frame it. The collar is where an oversized cut is missing its
	 * material.
	 *
	 * Paired with the grid's own reach: the grid stops at 0.99 of each
	 * half-extent and this sits at 1.01, so the pair holds the cut edge to **1%
	 * of each half-extent** rather than exactly. 1% of a slot's half-height is
	 * 0.35 m, four orders above float32's resolution at this scale. The boundary
	 * itself is left unsampled on purpose: the cut edge and the rectangle are
	 * the same line there, and a ray on it asks a question about float32 rather
	 * than about geometry.
	 *
	 * Still inside two things it must not reach: the aperture bars, which start
	 * one bar-thickness out (1.4 half-widths on the widest aperture), and an
	 * outpost's heat ring at 1.55. Both are frame rather than hull, and both are
	 * excluded by name as well.
	 */
	const COLLAR = 1.01;
	const found = new Map<string, { cut: boolean; pastMouthKm: number }>();
	twoSided(root, () => {
		for (const [sx, sy] of [
			[COLLAR, 0],
			[-COLLAR, 0],
			[0, COLLAR],
			[0, -COLLAR],
			// **The diagonals are outside on both axes.** At 0.8 of the collar
			// they sat at 0.92 of each half-extent — inside the rectangle, so
			// they went through the hole and reported whatever stands in the lane
			// behind it. On the shipyard Gantry that is the keel, and the row
			// read `keel uncut` on a correct build.
			[COLLAR, COLLAR],
			[-COLLAR, COLLAR],
			[COLLAR, -COLLAR],
			[-COLLAR, -COLLAR],
		]) {
			let hull: { name: string; cut: boolean; pastMouthKm: number } | null =
				null;
			for (const hit of castDown(
				root,
				sx * (widthKm / 2),
				sy * (heightKm / 2),
				core,
				band,
			)) {
				const name = hit.object.name || hit.object.type;
				if (FRAME_PART.test(name)) continue;
				// **The bay is walked past, not stopped at.** On a form with a
				// stand-off the bay's own mouth bulkhead legitimately stands
				// between the frame and the hull face — on the trade Coriolis it
				// closes #128's 25 m — so stopping there reports every correct
				// form as having no hull. What catches an oversized cut is the
				// fallback below: the ray reaches the end having met no hull at
				// all, and *that* is named.
				if (BAY_PART.test(name)) continue;
				hull = {
					name,
					cut:
						(hit.object as THREE.Mesh).geometry?.userData?.apertureCut !==
						undefined,
					pastMouthKm: (band.max.z - hit.point.z) * core,
				};
				break;
			}
			const surface = hull ?? {
				// A ray that met no hull at all is named rather than dropped.
				name: `no hull at (${sx.toFixed(2)}, ${sy.toFixed(2)})`,
				cut: false,
				pastMouthKm: 0,
			};
			// **Keyed by ray, not by name.** Keying by name let the first ray's
			// verdict for a mesh name win, so a later ray meeting a different,
			// uncut mesh of the same name was discarded — and the row is titled
			// as per-ray coverage. The name goes in the key so a failure still
			// reads as a name, and the sample it came from is beside it.
			found.set(`${surface.name} at (${sx.toFixed(2)}, ${sy.toFixed(2)})`, {
				...surface,
			});
		}
	});
	return [...found].map(([name, surface]) => ({ ...surface, name }));
}

/**
 * Every surface an aperture was cut into, whether or not it still stands across
 * the opening — so "no form forgot to cut" is a check rather than a comment.
 */
export function cutSurfaces(root: THREE.Object3D): string[] {
	root.updateMatrixWorld(true);
	const names = new Set<string>();
	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		if (mesh.geometry?.userData?.apertureCut !== undefined)
			names.add(mesh.name || mesh.type);
	});
	return [...names].sort();
}

/** One line per form, in the shape both the failure message and the instrument
 *  print. Empty when the opening is clear. */
export function crossingsLine(found: Crossing[]): string {
	return found
		.map(
			(c) =>
				`${c.name} +${(c.pastMouthKm * 1000).toFixed(0)}m in, ${(c.coverage * 100).toFixed(0)}% of the opening`,
		)
		.join(", ");
}
