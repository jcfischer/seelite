/**
 * Node #735 — a derelict that looks broken, inside the envelope it had.
 *
 * Three claims, and each is measured the way a cut cannot fool:
 *
 * 1. **The envelope is the intact hull's.** Measured from the triangles each
 *    visible mesh actually draws (`drawnHullBox`), because `Box3.setFromObject`
 *    reads `geometry.boundingBox`, which covers the whole position array — a
 *    tear that deleted every triangle of an extremal ring would still pass it.
 *    D13's collision proxy and the tether margin are read off `HULL_SPECS`, so
 *    a drawn box equal to the intact one is what keeps them honest.
 * 2. **Every torn part stays attached.** No removed triangle sits under any
 *    other part, the skin left is one piece, and every frame member is carried
 *    by intact skin at its anchored ends.
 * 3. **The live ship is untouched.** The roster's geometry is shared, so a
 *    tear made in place would cut every live ship of that hull.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildDerelictMesh, disposeDerelict } from "../src/derelict-mesh";
import { drawnBoxes, drawnHullBox, tearHull } from "../src/derelict-tear";
import { HULL_SPECS, type HullId, PURCHASABLE_HULL_IDS } from "../src/hull";
import { buildShipMesh } from "../src/ship-mesh";

/** The hulls a derelict is drawn from (`derelict.ts`), at their flown variant. */
const live = (id: HullId) => buildShipMesh(id, HULL_SPECS[id].variant).root;

/**
 * The purchasable hulls the tear can cut: the lofted, procedural ones. The
 * courier (node #812) and the miner (Longwall B, node #815) draw authored
 * models, which have no lofted part for `tearHull` to open, so their wrecks
 * are the whole hull gone dark — held as that below rather than left out
 * unsaid.
 */
const TEARABLE = PURCHASABLE_HULL_IDS.filter(
	(id) => !live(id).userData.authored,
);

/** FNV-1a over every mesh's positions and index, in traversal order. */
function geometryHash(root: THREE.Object3D) {
	let h = 0x811c9dc5;
	const fnv = (array: ArrayLike<number> & { buffer: ArrayBufferLike }) => {
		const view = array as unknown as Float32Array;
		for (const v of new Uint8Array(
			view.buffer,
			view.byteOffset,
			view.byteLength,
		)) {
			h ^= v;
			h = Math.imul(h, 0x01000193);
		}
	};
	root.traverse((object) => {
		if (!(object instanceof THREE.Mesh)) return;
		const geometry = object.geometry as THREE.BufferGeometry;
		fnv(geometry.getAttribute("position").array as Float32Array);
		if (geometry.index) fnv(geometry.index.array as Uint16Array);
	});
	return (h >>> 0).toString(16);
}

const closestDistance = (point: THREE.Vector3, triangles: THREE.Triangle[]) => {
	const at = new THREE.Vector3();
	let best = Number.POSITIVE_INFINITY;
	for (const t of triangles)
		best = Math.min(best, t.closestPointToPoint(point, at).distanceTo(point));
	return best;
};

/** The triangles a mesh draws, in its own frame (every torn part is untransformed). */
const drawnTriangles = (mesh: THREE.Mesh) => {
	const geometry = mesh.geometry as THREE.BufferGeometry;
	const position = geometry.getAttribute("position") as THREE.BufferAttribute;
	const index = geometry.index as THREE.BufferAttribute;
	const out: THREE.Triangle[] = [];
	for (let k = 0; k < index.count; k += 3)
		out.push(
			new THREE.Triangle(
				new THREE.Vector3().fromBufferAttribute(position, index.getX(k)),
				new THREE.Vector3().fromBufferAttribute(position, index.getX(k + 1)),
				new THREE.Vector3().fromBufferAttribute(position, index.getX(k + 2)),
			),
		);
	return out;
};

describe("a derelict's envelope is the intact hull's", () => {
	test("the authored courier's wreck is whole: dark, inside its envelope, untorn", () => {
		// Node #812's gap, stated: a courier wreck shows no torn section or
		// exposed frame until the authored model carries parts a tear can cut.
		expect(TEARABLE).not.toContain("courier");
		const intact = drawnHullBox(live("courier"));
		const wreck = buildDerelictMesh("courier");
		expect(wreck.userData.torn).toBeNull();
		const drawn = drawnHullBox(wreck);
		for (const axis of ["x", "y", "z"] as const) {
			expect(drawn.min[axis]).toBeCloseTo(intact.min[axis], 4);
			expect(drawn.max[axis]).toBeCloseTo(intact.max[axis], 4);
		}
		disposeDerelict(wreck);
	});

	for (const id of PURCHASABLE_HULL_IDS)
		test(`${id}: the drawn box is equal, and it tears only if lofted`, () => {
			const intact = drawnHullBox(live(id));
			const wreck = buildDerelictMesh(id);
			const torn = drawnHullBox(wreck);
			// Within 5 cm, as `ship-finish.test.ts` holds a finish to: under the
			// 0.1 m `hull.test.ts` rounds a declaration up by.
			for (const axis of ["x", "y", "z"] as const) {
				expect([id, axis, torn.min[axis]]).toEqual([
					id,
					axis,
					expect.closeTo(intact.min[axis], 4),
				]);
				expect([id, axis, torn.max[axis]]).toEqual([
					id,
					axis,
					expect.closeTo(intact.max[axis], 4),
				]);
			}
			// The rows above pass for a hull nothing was done to; this one does
			// not. Every lofted hull tears, and shows its frame.
			//
			// **The authored Longwall B does not (node #815)**: a tear cuts a
			// loft's ring-and-segment grid, and an authored model has none, so its
			// wreck is the dark hull S26 shipped first. Stated here rather than
			// skipped, so the day it tears this row says so.
			const sites = wreck.userData.torn?.sites ?? [];
			const tears = TEARABLE.includes(id);
			expect([id, sites.length > 0]).toEqual([id, tears]);
			expect([id, (wreck.userData.torn?.frame ?? 0) > 0]).toEqual([id, tears]);
			disposeDerelict(wreck);
		});

	test("the measure sees a cut that the bounding box cannot", () => {
		// The instrument's own control: delete every fuselage triangle touching
		// the nose's plane — which is the hull's foremost — and `drawnHullBox`
		// moves while `Box3.setFromObject` does not.
		const root = live("patrol");
		const fuselage = root.getObjectByName("patrol-fuselage") as THREE.Mesh;
		const before = drawnHullBox(root);
		const cut = fuselage.geometry.clone();
		const position = cut.getAttribute("position");
		const index = Array.from(cut.index?.array ?? []);
		const nose = (i: number) => position.getZ(i) < before.min.z + 1e-6;
		const kept: number[] = [];
		for (let k = 0; k < index.length; k += 3)
			if (![0, 1, 2].some((n) => nose(index[k + n])))
				kept.push(index[k], index[k + 1], index[k + 2]);
		cut.setIndex(kept);
		const stale = new THREE.Box3().setFromObject(root);
		fuselage.geometry = cut;
		expect(new THREE.Box3().setFromObject(root).equals(stale)).toBe(true);
		expect(drawnHullBox(root).min.z).toBeGreaterThan(before.min.z);
	});

	test("the measure is the hull's own frame, however the wreck is placed and turned", () => {
		// A wreck in the scene is moved, scaled by its layer and tumbling. Boxing
		// a rotated box again would read it metres large; the probe caught that.
		const wreck = buildDerelictMesh("miner");
		const still = drawnHullBox(wreck);
		const scene = new THREE.Scene();
		scene.add(wreck);
		wreck.position.set(3, -2, 7);
		wreck.scale.setScalar(0.25);
		wreck.quaternion.setFromEuler(new THREE.Euler(0.7, -1.3, 2.1));
		const turned = drawnHullBox(wreck);
		for (const axis of ["x", "y", "z"] as const) {
			expect(turned.min[axis]).toBeCloseTo(still.min[axis], 7);
			expect(turned.max[axis]).toBeCloseTo(still.max[axis], 7);
		}
		disposeDerelict(wreck);
	});

	test("the hull proxy the sim collides with is the intact hull's", () => {
		// D13: the wreck collides through `hullBox(spec.env, spec.envCentre)`,
		// and the drawn torn hull fills the same box the live hull does.
		for (const id of PURCHASABLE_HULL_IDS) {
			const wreck = buildDerelictMesh(id);
			const size = drawnHullBox(wreck).getSize(new THREE.Vector3());
			const env = HULL_SPECS[id].env;
			expect([id, size.z <= env.lengthKm + 1e-4]).toEqual([id, true]);
			expect([id, size.x <= env.beamKm + 1e-4]).toEqual([id, true]);
			expect([id, size.y <= env.heightKm + 1e-4]).toEqual([id, true]);
			disposeDerelict(wreck);
		}
	});
});

describe("every torn part is attached to the structure", () => {
	for (const id of TEARABLE)
		test(`${id}: no tear under another part, one skin, every member carried`, () => {
			const intact = live(id);
			const root = live(id);
			const torn = tearHull(root, id);
			expect(torn).not.toBeNull();
			if (!torn) return;
			for (const patch of torn.patches) {
				const before = intact.getObjectByName(patch.part) as THREE.Mesh;
				const after = root.getObjectByName(patch.part) as THREE.Mesh;
				// What the tear removed is what the intact part draws and the torn
				// one does not.
				const kept = new Set<string>();
				const key = (t: THREE.Triangle) =>
					[t.a, t.b, t.c].map((v) => v.toArray().join(",")).join("|");
				const index = after.geometry.index as THREE.BufferAttribute;
				const original = before.geometry.getAttribute(
					"position",
				) as THREE.BufferAttribute;
				for (let k = 0; k < index.count; k += 3)
					kept.add(
						[0, 1, 2]
							.map((n) =>
								new THREE.Vector3()
									.fromBufferAttribute(original, index.getX(k + n))
									.toArray()
									.join(","),
							)
							.join("|"),
					);
				const removed = drawnTriangles(before).filter((t) => !kept.has(key(t)));
				expect([patch.part, removed.length > 0]).toEqual([patch.part, true]);
				// No removed triangle sits under another part's box: a fitting over
				// a hole would be a fitting on nothing.
				const others: { name: string; box: THREE.Box3 }[] = [];
				for (const child of intact.children)
					if (child.name !== patch.part)
						for (const box of drawnBoxes(child))
							others.push({ name: child.name, box });
				const triBox = new THREE.Box3();
				for (const t of removed) {
					triBox.setFromPoints([t.a, t.b, t.c]);
					const under = others.find((o) => o.box.intersectsBox(triBox));
					expect([patch.part, under?.name ?? null]).toEqual([patch.part, null]);
				}
				// The skin left is one piece, edge to edge: no flake of plating is
				// stranded inside the hole.
				const skin = drawnTriangles(after);
				const vertexKey = (v: THREE.Vector3) =>
					v
						.toArray()
						.map((c) => c.toFixed(7))
						.join(",");
				const byEdge = new Map<string, number[]>();
				skin.forEach((t, n) => {
					const vs = [t.a, t.b, t.c].map(vertexKey);
					for (let e = 0; e < 3; e += 1) {
						const pair = [vs[e], vs[(e + 1) % 3]].sort().join("|");
						byEdge.set(pair, [...(byEdge.get(pair) ?? []), n]);
					}
				});
				const seen = new Set([0]);
				const stack = [0];
				while (stack.length) {
					const n = stack.pop() as number;
					const t = skin[n];
					const vs = [t.a, t.b, t.c].map(vertexKey);
					for (let e = 0; e < 3; e += 1)
						for (const m of byEdge.get(
							[vs[e], vs[(e + 1) % 3]].sort().join("|"),
						) ?? [])
							if (!seen.has(m)) {
								seen.add(m);
								stack.push(m);
							}
				}
				expect([patch.part, seen.size]).toEqual([patch.part, skin.length]);
			}
			// Every member is carried at each end it is anchored by: that end's
			// skin point lies on a triangle the torn part still draws, and the
			// member's own geometry reaches it — its outer face stands 0.1 m
			// under the skin and its corners half a width to either side.
			const skins = torn.patches.map((p) =>
				drawnTriangles(root.getObjectByName(p.part) as THREE.Mesh),
			);
			const snapped = torn.frame.filter(
				(m) => m.userData.derelictFrame.anchors !== "both",
			);
			expect(snapped.length).toBeGreaterThan(0);
			for (const member of torn.frame) {
				const { anchors, ends } = member.userData.derelictFrame as {
					anchors: "both" | "fore" | "aft";
					ends: [number, number, number][];
				};
				const position = member.geometry.getAttribute(
					"position",
				) as THREE.BufferAttribute;
				const anchored =
					anchors === "both"
						? ends
						: anchors === "fore"
							? [ends[0]]
							: [ends[1]];
				for (const xyz of anchored) {
					const end = new THREE.Vector3(...xyz);
					const onSkin = Math.min(...skins.map((s) => closestDistance(end, s)));
					let reach = Number.POSITIVE_INFINITY;
					for (let k = 0; k < position.count; k += 1)
						reach = Math.min(
							reach,
							new THREE.Vector3()
								.fromBufferAttribute(position, k)
								.distanceTo(end),
						);
					expect([member.name, onSkin < 1e-6, reach < 0.0003]).toEqual([
						member.name,
						true,
						true,
					]);
				}
			}
		});
});

describe("the folded rim is lit as the shape it was folded into", () => {
	// The loft's normals are `computeVertexNormals` over its own index, seam
	// twins unmatched, so the torn skin is held to that same rule recomputed
	// over what it now draws — and a rim still carrying the intact hull's
	// normals is a fold the light cannot see.
	for (const id of TEARABLE)
		test(`${id}: every torn part's normals are its own surface's`, () => {
			const intact = live(id);
			const root = live(id);
			const torn = tearHull(root, id);
			expect(torn).not.toBeNull();
			if (!torn) return;
			for (const patch of torn.patches) {
				const after = root.getObjectByName(patch.part) as THREE.Mesh;
				const before = intact.getObjectByName(patch.part) as THREE.Mesh;
				const normal = after.geometry.getAttribute(
					"normal",
				) as THREE.BufferAttribute;
				const fresh = after.geometry.clone();
				fresh.computeVertexNormals();
				const expected = fresh.getAttribute("normal") as THREE.BufferAttribute;
				const was = before.geometry.getAttribute(
					"normal",
				) as THREE.BufferAttribute;
				const index = after.geometry.index as THREE.BufferAttribute;
				const a = new THREE.Vector3();
				const b = new THREE.Vector3();
				// The control arm: a vertex none of whose intact faces the tear
				// removed or moved keeps the intact normal. Without it a recompute
				// that relit the whole part would pass both rows above.
				const position = after.geometry.getAttribute(
					"position",
				) as THREE.BufferAttribute;
				const intactPosition = before.geometry.getAttribute(
					"position",
				) as THREE.BufferAttribute;
				const intactIndex = before.geometry.index as THREE.BufferAttribute;
				const faceKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
				const keptFaces = new Set<string>();
				for (let k = 0; k < index.count; k += 3)
					keptFaces.add(
						faceKey(index.getX(k), index.getX(k + 1), index.getX(k + 2)),
					);
				const touched = new Set<number>();
				for (let k = 0; k < intactIndex.count; k += 3) {
					const face = [0, 1, 2].map((n) => intactIndex.getX(k + n));
					const changed =
						!keptFaces.has(faceKey(face[0], face[1], face[2])) ||
						face.some(
							(i) =>
								a
									.fromBufferAttribute(position, i)
									.distanceTo(b.fromBufferAttribute(intactPosition, i)) > 0,
						);
					if (changed) for (const i of face) touched.add(i);
				}
				let worst = 0;
				let moved = 0;
				let kept = 0;
				let drift = 0;
				for (let k = 0; k < index.count; k += 1) {
					const i = index.getX(k);
					a.fromBufferAttribute(normal, i);
					worst = Math.max(
						worst,
						a.distanceTo(b.fromBufferAttribute(expected, i)),
					);
					const d = a.distanceTo(b.fromBufferAttribute(was, i));
					if (d > 1e-3) moved += 1;
					if (!touched.has(i)) {
						kept += 1;
						drift = Math.max(drift, d);
					}
				}
				expect([
					patch.part,
					worst < 1e-6,
					moved > 0,
					kept > 0,
					drift < 1e-6,
				]).toEqual([patch.part, true, true, true, true]);
			}
		});
});

describe("the roster's own mounting rule holds on a wreck", () => {
	test("every nacelle still intersects a named structural mount", () => {
		// `ship-mesh.test.ts`'s rule, run over the torn hull and measured from
		// what each part draws: a torn nacelle is the case that could fail it.
		for (const id of TEARABLE) {
			const wreck = buildDerelictMesh(id);
			const named = (test: (name: string) => boolean) =>
				wreck.children.filter(
					(child) => child instanceof THREE.Mesh && test(child.name),
				);
			const mounts = named((name) => name.includes("-mount-")).flatMap(
				(mount) => drawnBoxes(mount),
			);
			const nacelles = named(
				(name) => name.endsWith("-nacelle") && !name.includes("-mount-"),
			);
			expect(nacelles.length).toBeGreaterThanOrEqual(2);
			for (const nacelle of nacelles)
				for (const box of drawnBoxes(nacelle))
					expect(
						`${nacelle.name}: ${mounts.some((mount) => mount.intersectsBox(box))}`,
					).toBe(`${nacelle.name}: true`);
			disposeDerelict(wreck);
		}
	});
});

describe("the live ship is untouched", () => {
	test("building a derelict leaves every live hull's geometry as it was", () => {
		for (const id of PURCHASABLE_HULL_IDS) {
			const ship = live(id);
			const before = geometryHash(ship);
			const wreck = buildDerelictMesh(id);
			expect([id, geometryHash(live(id))]).toEqual([id, before]);
			expect([id, geometryHash(ship)]).toEqual([id, before]);
			disposeDerelict(wreck);
			// Disposing the wreck frees only what the wreck owns.
			expect([id, geometryHash(live(id))]).toEqual([id, before]);
		}
	});

	test("a wreck disposes the tear's geometry and not the roster's", () => {
		const wreck = buildDerelictMesh(TEARABLE[0]);
		const owned = new Set<THREE.BufferGeometry>();
		const shared = new Set<THREE.BufferGeometry>();
		wreck.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			(o.geometry.userData.derelictOwned ? owned : shared).add(o.geometry);
		});
		expect(owned.size).toBeGreaterThan(0);
		const disposed = new Set<THREE.BufferGeometry>();
		for (const g of [...owned, ...shared])
			g.addEventListener("dispose", () => disposed.add(g));
		disposeDerelict(wreck);
		for (const g of owned) expect(disposed.has(g)).toBe(true);
		for (const g of shared) expect(disposed.has(g)).toBe(false);
	});

	test("two wrecks of one hull draw the same torn geometry", () => {
		for (const id of PURCHASABLE_HULL_IDS) {
			const a = buildDerelictMesh(id);
			const b = buildDerelictMesh(id);
			expect([id, geometryHash(a)]).toEqual([id, geometryHash(b)]);
			expect(a.userData.torn).toEqual(b.userData.torn);
			disposeDerelict(a);
			disposeDerelict(b);
		}
	});
});

describe("the broken look goes dark with the rest", () => {
	test("the frame, the liner and the scorched skin carry no light of their own", () => {
		const wreck = buildDerelictMesh("patrol");
		let frame = 0;
		let liners = 0;
		wreck.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			const m = o.material as THREE.MeshStandardMaterial;
			if (o.userData.derelictFrame) frame += 1;
			if (o.name.endsWith("-liner")) {
				liners += 1;
				expect(m.side).toBe(THREE.BackSide);
			}
			if (m instanceof THREE.MeshStandardMaterial)
				expect(m.emissiveIntensity).toBe(0);
		});
		expect(frame).toBeGreaterThan(0);
		expect(liners).toBe(wreck.userData.torn.sites.length);
		disposeDerelict(wreck);
	});
});
