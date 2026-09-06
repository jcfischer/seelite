/**
 * `src/occlusion-mesh.ts` — the walk that turns `participatesInShadow` into
 * `castShadow` and `receiveShadow` flags on a built subtree, and the bounding
 * sphere the shadow camera is fitted to (#201).
 *
 * ## Why this is a test and not a probe
 *
 * A probe can see that a shadow appeared. It cannot see that the *canopy glass*
 * was left out of it, because the canopy is 8% opaque and whatever it did or
 * did not cast is a few codes of an eight-bit frame. The flags are the thing
 * that is checkable exactly, and they are checkable here because the mesh
 * builders are pure — `station-mesh.ts` and `ship-mesh.ts` are headless-tested
 * already, so a real hull and every real station form can be built and walked
 * with no GPU in the room.
 *
 * What this file pins is the pair of properties the walk exists for: **every
 * lit opaque surface is marked, and nothing else is** — asserted over the real
 * subtrees rather than over a fixture, so a builder that adds a lamp in a new
 * material reaches this rather than the sheet.
 */
import { expect, test } from "bun:test";
import * as THREE from "three";
import { participatesInShadow } from "../src/occlusion";
import {
	hideNonOccluders,
	markOcclusion,
	restoreVisibility,
	subjectOf,
	surfaceFactsOf,
} from "../src/occlusion-mesh";
import { buildShipMesh } from "../src/ship-mesh";
import { buildStationMesh } from "../src/station-mesh";
import { STATION_TYPES } from "../src/station";

/** Every mesh in a subtree, in one place so a failure can name the offender. */
const meshesOf = (root: THREE.Object3D) => {
	const out: THREE.Mesh[] = [];
	root.traverse((o) => {
		if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
	});
	return out;
};

test("the walk marks a hull, and marks most of it", () => {
	const ship = buildShipMesh("courier").root;
	const marked = markOcclusion(ship);
	// A count rather than a boolean, because the failure this guards is a walk
	// that ran and matched nothing — which is what a renamed material class or
	// a builder switched to `ShaderMaterial` would produce, and which reads
	// exactly like a working walk from every other angle.
	expect(marked.participating).toBeGreaterThan(0);
	// A hull is mostly plating, so most of it takes part. A walk that marked
	// one mesh out of two hundred would clear the line above.
	expect(marked.participating).toBeGreaterThan(marked.excluded);
});

test("every flag on a hull agrees with the predicate", () => {
	const ship = buildShipMesh("courier").root;
	markOcclusion(ship);
	const disagreeing = meshesOf(ship)
		.filter(
			(m) =>
				m.castShadow !== participatesInShadow(surfaceFactsOf(m)) ||
				m.receiveShadow !== participatesInShadow(surfaceFactsOf(m)),
		)
		.map((m) => m.name || "(unnamed)");
	// Named rather than counted: a failure here should say which mesh, because
	// the answer is always "the builder started using a material the extraction
	// does not know about" and the mesh name is what points at it.
	expect(disagreeing).toEqual([]);
});

test("every station form marks its structure and refuses its lamps", () => {
	for (const type of STATION_TYPES) {
		const station = buildStationMesh(type, 0x8899aa, 0, 0).root;
		const marked = markOcclusion(station);
		expect({ type, marked: marked.participating > 0 }).toEqual({
			type,
			marked: true,
		});
		// Every station form carries lit strips, nameplates or an aperture bar in
		// `MeshBasicMaterial`, so every form has something the walk refuses. A
		// form where nothing was excluded would mean the predicate had stopped
		// discriminating — which is how a walk that marks everything passes a
		// "something was marked" check.
		expect({ type, excluded: marked.excluded > 0 }).toEqual({
			type,
			excluded: true,
		});
		const disagreeing = meshesOf(station)
			.filter((m) => m.castShadow !== participatesInShadow(surfaceFactsOf(m)))
			.map((m) => `${type}/${m.name || "(unnamed)"}`);
		expect(disagreeing).toEqual([]);
	}
});

test("an unlit material is read as unlit however it is dressed", () => {
	// The extraction, not the predicate — `surfaceFactsOf` is where a three
	// class becomes a boolean, and it is the half that a material swap in a
	// builder breaks silently.
	const box = new THREE.BoxGeometry(1, 1, 1);
	expect(
		surfaceFactsOf(new THREE.Mesh(box, new THREE.MeshBasicMaterial())).lit,
	).toBe(false);
	expect(
		surfaceFactsOf(new THREE.Mesh(box, new THREE.ShaderMaterial())).lit,
	).toBe(false);
	expect(
		surfaceFactsOf(new THREE.Mesh(box, new THREE.MeshStandardMaterial())).lit,
	).toBe(true);
	expect(
		surfaceFactsOf(new THREE.Mesh(box, new THREE.MeshPhysicalMaterial())).lit,
	).toBe(true);
	// The bay's walls and berths, which are the surfaces #201 wants corners on.
	expect(
		surfaceFactsOf(new THREE.Mesh(box, new THREE.MeshLambertMaterial())).lit,
	).toBe(true);
});

test("a mesh with several materials takes part only if all of them do", () => {
	// Geometry groups are how a plated form carries a lit sign on one face. If
	// any material on the mesh is out, the mesh is out: `castShadow` is per
	// object and there is no per-group flag to be more precise with.
	const box = new THREE.BoxGeometry(1, 1, 1);
	const mixed = new THREE.Mesh(box, [
		new THREE.MeshStandardMaterial(),
		new THREE.MeshBasicMaterial(),
	]);
	expect(surfaceFactsOf(mixed).lit).toBe(false);
	const allLit = new THREE.Mesh(box, [
		new THREE.MeshStandardMaterial(),
		new THREE.MeshLambertMaterial(),
	]);
	expect(surfaceFactsOf(allLit).lit).toBe(true);
});

test("the subject follows the scale the subtree is drawn at", () => {
	// `subjectOf` is what `main.ts` fits the shadow camera to, and the trap it
	// exists for is `CLAUDE.md`'s "a local frame has units": a station mesh is
	// built one core radius across and scaled by `radiusKm` at layer time, so a
	// subject read before the scale is out by whatever that radius is.
	const ship = buildShipMesh("courier").root;
	ship.updateMatrixWorld(true);
	const unit = subjectOf(ship);
	// A courier is tens of metres, so its bounding radius is well under a
	// kilometre and well over a metre. A subject in the wrong unit misses this
	// band by a factor of a thousand either way.
	expect(unit.radiusKm).toBeGreaterThan(0.005);
	expect(unit.radiusKm).toBeLessThan(0.5);
	ship.scale.setScalar(10);
	ship.position.set(3, 0, 0);
	ship.updateMatrixWorld(true);
	const scaled = subjectOf(ship);
	expect(scaled.radiusKm).toBeCloseTo(unit.radiusKm * 10, 9);
	// And it moves with the subtree, because the near scene is camera-relative
	// and a station's centre is wherever the station is this frame.
	expect(scaled.center[0]).toBeCloseTo(unit.center[0] * 10 + 3, 9);
});

test("the local bounds are measured once and then only transformed", () => {
	// Per frame, for a station of a few thousand meshes, a fresh
	// `Box3.setFromObject` is the whole budget this node is priced against. The
	// cache is the reason it is not — and a cache that silently re-measured
	// would be invisible except in the frame time, which is exactly the kind of
	// regression this repo has shipped before.
	const ship = buildShipMesh("courier").root;
	ship.updateMatrixWorld(true);
	subjectOf(ship);
	const cached = ship.userData.occlusionBounds as THREE.Sphere;
	expect(cached).toBeInstanceOf(THREE.Sphere);
	const before = cached.radius;
	// Move a mesh after the measurement. A re-measuring implementation would
	// report the new bounds; the cache reports the old ones, which is the
	// documented behaviour — these subtrees are rigid.
	const first = meshesOf(ship)[0];
	first.position.x += 100;
	ship.updateMatrixWorld(true);
	subjectOf(ship);
	expect((ship.userData.occlusionBounds as THREE.Sphere).radius).toBe(before);
});

test("a rotated subtree does not grow its own subject", () => {
	// The hazard behind `subjectOf`'s matrix juggling, and the reason it does
	// not simply take `Box3.setFromObject`'s world box. That box is
	// axis-aligned in *world* space, so a hull turned 45° measures wider than
	// the same hull pointed down an axis — and `main.ts` copies the ship's
	// orientation onto this root every frame. A subject that breathed with the
	// ship's heading would swing the shadow texel by up to √3 while nothing on
	// screen changed size.
	const straight = buildShipMesh("courier").root;
	straight.updateMatrixWorld(true);
	const a = subjectOf(straight).radiusKm;
	const turned = buildShipMesh("courier").root;
	turned.quaternion.setFromEuler(new THREE.Euler(0.6, 0.9, 0.3));
	turned.updateMatrixWorld(true);
	const b = subjectOf(turned).radiusKm;
	expect(b).toBeCloseTo(a, 9);
});

test("the ambient occlusion sees exactly what the shadow sees", () => {
	// **The defect this exists for, measured before it existed.** `GTAOPass`
	// renders its own normal-and-depth buffer with `MeshNormalMaterial` over
	// everything visible in the scene — and `MeshNormalMaterial` writes depth
	// even for a material that does not. The canopy glass is
	// `depthWrite: false`, so it writes nothing in the beauty pass and covers
	// the whole forward view in the AO buffer: with the cabin on screen, AO
	// landed on **2.8% of the sky** at up to 77/255, and in the chase views —
	// where the cabin is hidden — on none of it. One rule read twice fixes it:
	// a surface that casts no shadow occludes nothing either.
	const scene = new THREE.Scene();
	const hull = new THREE.Mesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshStandardMaterial(),
	);
	const glass = new THREE.Mesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshBasicMaterial({
			transparent: true,
			opacity: 0.08,
			depthWrite: false,
		}),
	);
	const streaks = new THREE.LineSegments(new THREE.BufferGeometry());
	scene.add(hull, glass, streaks);
	markOcclusion(scene);
	const cache = new Map<THREE.Object3D, boolean>();
	hideNonOccluders(scene, cache);
	expect(hull.visible).toBe(true);
	expect(glass.visible).toBe(false);
	expect(streaks.visible).toBe(false);
	restoreVisibility(cache);
	expect(glass.visible).toBe(true);
	// And it puts back exactly what it found, including a mesh that was already
	// hidden for its own reasons — the ship in cockpit view, the accessory a
	// station's detail level turned off.
	const alreadyHidden = new THREE.Mesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshStandardMaterial(),
	);
	alreadyHidden.visible = false;
	scene.add(alreadyHidden);
	markOcclusion(scene);
	const cache2 = new Map<THREE.Object3D, boolean>();
	hideNonOccluders(scene, cache2);
	restoreVisibility(cache2);
	expect(alreadyHidden.visible).toBe(false);
	expect(hull.visible).toBe(true);
	expect(glass.visible).toBe(true);
});
