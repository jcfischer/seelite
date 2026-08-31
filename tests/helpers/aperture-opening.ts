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
 * **The question is what is *in* the opening, not what is in front of it.**
 * `tests/station-mesh.test.ts`'s corridor row measures the volume outside the
 * aperture plane and skips every vertex at or behind it by construction — its
 * own comment says *"the wall the aperture is cut into is not an intrusion into
 * the corridor in front of it"*. #155's defect lived exactly in the space that
 * skip creates: all twelve forms drew a lit frame on an uncut surface.
 */

import * as THREE from "three";
import { STATION_GEOMETRY, type StationType } from "../../src/station";

/**
 * The bay's own parts — what lies beyond the opening on purpose.
 *
 * Its five shell slabs (§13.1), its fittings, the bulkhead shield a parked ship
 * reads, and the berth furniture the traversal parks against.
 */
const BAY_PART = /^(interior-|bay-|berth-|station-nameplate)/;

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
	const saved: [THREE.Material, THREE.Side][] = [];
	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		if (!mesh.isMesh) return;
		const materials = Array.isArray(mesh.material)
			? mesh.material
			: [mesh.material];
		for (const material of materials) {
			if (!material) continue;
			saved.push([material, material.side]);
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
 * **A grid over the whole rectangle, not the axis and four corners.** The cut is
 * a ring, so a defect that leaves a spur or misplaces one edge shows on some
 * samples and not others; the five-ray sketch that found #155's defect found it
 * because that one was the entire face, and it would miss a cut that was merely
 * wrong. Cell centres of a 9 x 9 grid, which never samples the boundary itself —
 * the cut edge and the aperture rectangle are the same line, so a ray exactly on
 * it is asking a question about float32 rather than about geometry.
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
	twoSided(root, () => {
		for (let ix = 0; ix < CELLS; ix++) {
			for (let iy = 0; iy < CELLS; iy++) {
				const cell = ix * CELLS + iy;
				const x = ((ix + 0.5) / CELLS - 0.5) * widthKm;
				const y = ((iy + 0.5) / CELLS - 0.5) * heightKm;
				const ray = new THREE.Raycaster(
					new THREE.Vector3(x / core, y / core, band.max.z + 20),
					new THREE.Vector3(0, 0, -1),
				);
				ray.far = 100;
				for (const hit of ray.intersectObject(root, true)) {
					const name = hit.object.name || hit.object.type;
					// The aperture's own frame lives in the opening by
					// construction — it *is* what frames it.
					if (name.startsWith("aperture") || BAY_PART.test(name)) continue;
					// **From the back wall outward, with no ceiling.** An upper
					// bound at the mouth reads a surface lying exactly *in* the
					// mouth plane — which is where ten of the twelve forms put
					// theirs — as either inside or outside on float32 noise, and
					// it silently reported two forms clear that were not.
					// Anything drawn across the rectangle in front of the mouth
					// is an obstruction too, so there is nothing to bound.
					if (hit.point.z < band.min.z) continue;
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
