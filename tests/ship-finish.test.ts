/**
 * #203 — the hull finishes.
 *
 * A finish is a preset over the surface and the two geometry primitives a hull
 * shares with every other hull (the hoop and the drive bell). Three things
 * have to hold for the workbench's sheet to mean anything:
 *
 * 1. **`stock` is the hull that shipped.** Not "looks the same" — the same
 *    bytes. The pin below was taken from `main` at `cbf3f0f` by hashing every
 *    hull's positions and UVs, and the worktree's stock build read the same
 *    hash before this test existed. Like `tests/surface.test.ts`'s station
 *    pins, it cannot prove its own provenance; it can prove nothing has moved
 *    since.
 * 2. **Every finish builds every hull inside its declared reach**, with the
 *    same named parts the rest of the suite reads. A collar that stands
 *    proud of a hoop, or a bowl that outgrows its bell, lands here by name.
 * 3. **The finish reaches the material**, not only the geometry: the rim dial
 *    and the tile size are read off what was built.
 *
 * Every case restores the **default** on its way out. The finish is module
 * state, and a test file that left another finish set would hand the next
 * file a hull the game does not ship.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	HULL_IDS,
	HULL_VARIANT_IDS,
	type HullId,
	type HullVariantId,
} from "../src/hull";
import { HULL_REACH_KM, buildShipMesh, isAuthoredHull } from "../src/ship-mesh";
import {
	DEFAULT_HULL_FINISH,
	HULL_FINISHES,
	HULL_FINISH_IDS,
	type HullFinishId,
	SHIP_MAP_SIZE,
	SHIP_PANEL_KM,
	SHIP_PLATING,
	hullFinishId,
	plateUVs,
	setHullFinish,
} from "../src/ship-surface";
import { hullLoft, uvUnitsOf } from "../src/loft";

// Restore the **default**, not stock: bun runs every test file in one
// process, and a file that left `stock` behind would hand the next file a
// hull the game no longer ships.
afterEach(() => setHullFinish(DEFAULT_HULL_FINISH));

/** FNV-1a over the given hulls' positions and UVs, in roster order.
 *  Procedural hulls only: an authored model (node #813's O2 Porter) is not
 *  built by the finishes this pin protects, and is held by its own file. */
function rosterHash(ids: readonly HullId[] = HULL_IDS) {
	let h = 0x811c9dc5;
	let vertices = 0;
	const fnv = (bytes: Uint8Array) => {
		for (const v of bytes) {
			h ^= v;
			h = Math.imul(h, 0x01000193);
		}
	};
	for (const id of ids)
		for (const variant of HULL_VARIANT_IDS) {
			if (isAuthoredHull(id, variant)) continue;
			buildShipMesh(id, variant).root.traverse((object) => {
				// #130's generated detail is a finish layered onto the hull, not a
				// change to the stock hull this pin protects. It has its own deterministic
				// matrix contract in `ship-details.test.ts`; keep this hash on the
				// pre-existing structure so moving a fuselage cannot hide in an expected
				// detail addition.
				if (
					object.name.startsWith("ship-greebles-") ||
					object.name === "ship-strip" ||
					object.name === "ship-windows"
				)
					return;
				const geometry = (object as THREE.Mesh).geometry;
				const position = geometry?.getAttribute?.("position") as
					| THREE.BufferAttribute
					| undefined;
				if (!position) return;
				vertices += position.count;
				for (const name of ["position", "uv"]) {
					// The nav lights are `Points` with positions and no UVs.
					const attribute = geometry.getAttribute(name) as
						| THREE.BufferAttribute
						| undefined;
					if (!attribute) continue;
					const array = attribute.array as Float32Array;
					fnv(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
				}
			});
		}
	return { hash: (h >>> 0).toString(16), vertices };
}

/** The suite's own reach: the largest absolute coordinate of the hull's box,
 *  which is what `HULL_REACH_KM` is declared against in `ship-mesh.test.ts`. */
const reachOf = (root: THREE.Object3D) => {
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	return Math.max(
		...box.min.toArray().map(Math.abs),
		...box.max.toArray().map(Math.abs),
	);
};

describe("stock is the hull that shipped", () => {
	test("the finish's figures are the shipped constants, not copies of them", () => {
		expect(HULL_FINISHES.stock.plating).toBe(SHIP_PLATING);
		expect(HULL_FINISHES.stock.mapSize).toBe(SHIP_MAP_SIZE);
		expect(HULL_FINISHES.stock.panelKm).toBe(SHIP_PANEL_KM);
		expect(HULL_FINISHES.stock.rim).toBe(0);
		expect(HULL_FINISHES.stock.paint).toEqual({ saturation: 1, value: 1 });
	});

	test("the default is worn — the principal's choice on the second sheet", () => {
		expect(DEFAULT_HULL_FINISH).toBe("worn");
		expect(HULL_FINISHES[DEFAULT_HULL_FINISH].collar).toBe("flange");
	});

	test("no finish moves a hull's envelope: every built box is stock's", () => {
		// A hull's envelope is the berth catalogue's fit predicate
		// (`hull.ts`), so a finish that grew a box would change which berths
		// a hull fits and, through the selection rule, which variant flies.
		// The first flanged collar did exactly that, on eleven hulls. Within
		// 5 cm (`closeTo` at four places, in kilometres), which is under the
		// 0.1 m `hull.test.ts` rounds a declaration up by and over the
		// millimetres two polygons on the same rays differ by.
		//
		// 216 builds across five finishes ran 5.3 s alone at `4b145f3`, over
		// bun's 5 s default, so the row states its own budget (node #813).
		const boxOf = (id: HullId, variant: HullVariantId) => {
			const root = buildShipMesh(id, variant).root;
			root.updateMatrixWorld(true);
			return new THREE.Box3().setFromObject(root);
		};
		for (const id of HULL_IDS)
			for (const variant of HULL_VARIANT_IDS) {
				setHullFinish("stock");
				const stock = boxOf(id, variant);
				for (const finish of HULL_FINISH_IDS) {
					setHullFinish(finish);
					const box = boxOf(id, variant);
					for (const axis of ["x", "y", "z"] as const) {
						expect([finish, id, variant, axis, box.min[axis]]).toEqual([
							finish,
							id,
							variant,
							axis,
							expect.closeTo(stock.min[axis], 4),
						]);
						expect([finish, id, variant, axis, box.max[axis]]).toEqual([
							finish,
							id,
							variant,
							axis,
							expect.closeTo(stock.max[axis], 4),
						]);
					}
				}
			}
	}, 30_000);

	test("every hull's geometry and UVs hash to the pin taken on main", () => {
		// Taken at `cbf3f0f`: 33 hulls, 192,257 vertices. Under `stock` by
		// name, now that the default is not stock.
		//
		// **Re-pinned for #331's voyager**, which a hash over every hull moves
		// by construction: 36 hulls, 211,160 vertices. The row below keeps the
		// old pin, so the claim that the new hulls are the whole of the change
		// is something a run checks rather than a comment.
		//
		// **Re-pinned for node #813**, which replaced the procedural Porter
		// (`freighter/b`) with an authored model the hash leaves out: 35
		// procedural hulls, 205,905 vertices. The same hash over `4b145f3`'s
		// roster with `freighter/b` left out reads the same pair, so the
		// Porter is the whole of the change.
		setHullFinish("stock");
		expect(rosterHash()).toEqual({ hash: "e00963f3", vertices: 205905 });
	});

	test("the original eleven archetypes still hash to the pin taken on main", () => {
		// `cbf3f0f`'s pin over the ids that existed then. Adding a hull may move
		// the whole-roster hash; it may not move any of these (#335's review).
		// Re-pinned for node #813 as the row above is, and checked the same way
		// against `4b145f3` without `freighter/b`.
		setHullFinish("stock");
		expect(rosterHash(HULL_IDS.filter((id) => id !== "voyager"))).toEqual({
			hash: "f18aff79",
			vertices: 187002,
		});
	});
});

describe("every finish builds the whole roster", () => {
	for (const finish of HULL_FINISH_IDS) {
		test(`${finish}: every hull is inside its declared reach and keeps its drive pair`, () => {
			setHullFinish(finish);
			for (const id of HULL_IDS)
				for (const variant of HULL_VARIANT_IDS) {
					const root = buildShipMesh(id, variant).root;
					const reach = reachOf(root);
					expect([
						finish,
						id,
						variant,
						reach <= HULL_REACH_KM[id] * 1.00001,
					]).toEqual([finish, id, variant, true]);
					const span = (object: THREE.Object3D) =>
						Math.max(
							...new THREE.Box3()
								.setFromObject(object)
								.getSize(new THREE.Vector3())
								.toArray(),
						);
					// An authored model has no named nacelle and bell; its glow
					// is held in `tests/porter-model.test.ts`.
					if (isAuthoredHull(id, variant)) continue;
					let pairs = 0;
					for (const drive of root.children) {
						if (!drive.name.endsWith("-nacelle")) continue;
						const stem = drive.name.slice(0, -"-nacelle".length);
						const exhaust = root.children.find(
							(child) => child.name === `${stem}-exhaust`,
						);
						const bell = root.children.find(
							(child) => child.name === `${stem}-bell`,
						);
						if (!exhaust) continue;
						pairs += 1;
						expect(bell).toBeDefined();
						// The exhaust is inside its bell's mouth, whatever its shape.
						const bellBox = new THREE.Box3().setFromObject(
							bell as THREE.Object3D,
						);
						const exhaustBox = new THREE.Box3().setFromObject(exhaust);
						const bellRadius = (bellBox.max.x - bellBox.min.x) / 2;
						const exhaustRadius = (exhaustBox.max.x - exhaustBox.min.x) / 2;
						expect([finish, id, variant, exhaustRadius < bellRadius]).toEqual([
							finish,
							id,
							variant,
							true,
						]);
						expect(span(exhaust) < span(drive) * 0.5).toBe(true);
					}
					expect(pairs).toBeGreaterThanOrEqual(2);
				}
		});
	}

	test("the finish keys the palette, so a switch does not hand back the previous paint", () => {
		const paintOf = (id: HullFinishId) => {
			setHullFinish(id);
			const hull = buildShipMesh("courier", "a").root.getObjectByName(
				"courier-fuselage",
			) as THREE.Mesh;
			return (hull.material as THREE.MeshStandardMaterial).color.getHex();
		};
		const stock = paintOf("stock");
		const plated = paintOf("plated");
		expect(plated).not.toBe(stock);
		// And back again: the stock palette is cached under its own key.
		expect(paintOf("stock")).toBe(stock);
	});
});

describe("the finish reaches the material and the tile", () => {
	test("the rim is on the material under an industrial finish and off under stock", () => {
		const rimOf = (id: HullFinishId) => {
			setHullFinish(id);
			const hull = buildShipMesh("courier", "a").root.getObjectByName(
				"courier-fuselage",
			) as THREE.Mesh;
			const material = hull.material as THREE.MeshStandardMaterial;
			return {
				rim: material.userData.rim as number,
				key: material.customProgramCacheKey(),
			};
		};
		const stock = rimOf("stock");
		const plated = rimOf("plated");
		expect(stock.rim).toBe(0);
		expect(plated.rim).toBeGreaterThan(0);
		// Two finishes must not share a program: the rim is a uniform, and a
		// uniform's value is not part of three's own key.
		expect(plated.key).not.toBe(stock.key);
	});

	test("plate UVs are divided by the finish's tile, so the plate stays a metre", () => {
		const ring = () =>
			hullLoft([
				{ z: -0.01, w: 0.004, h: 0.003 },
				{ z: 0.01, w: 0.004, h: 0.003 },
			]);
		const at = (finish: HullFinishId) => {
			setHullFinish(finish);
			const geometry = ring();
			const before = (
				geometry.getAttribute("uv") as THREE.BufferAttribute
			).getX(3);
			plateUVs(geometry);
			const after = (geometry.getAttribute("uv") as THREE.BufferAttribute).getX(
				3,
			);
			return after / before;
		};
		// Three places: the UVs are float32, and 125 reads back as 124.999997.
		expect(at("stock")).toBeCloseTo(1 / SHIP_PANEL_KM, 3);
		expect(at("industrial")).toBeCloseTo(
			1 / HULL_FINISHES.industrial.panelKm,
			3,
		);
		// The map doubled with the tile, so the plate itself did not move.
		expect(
			HULL_FINISHES.industrial.panelKm / HULL_FINISHES.industrial.mapSize,
		).toBeCloseTo(SHIP_PANEL_KM / SHIP_MAP_SIZE, 9);
	});

	test("a bowl exhaust is drawn from inside and graded from throat to lip", () => {
		setHullFinish("industrial");
		const root = buildShipMesh("courier", "a").root;
		const exhaust = root.getObjectByName(
			"courier-starboard-exhaust",
		) as THREE.Mesh;
		const bell = root.getObjectByName("courier-starboard-bell") as THREE.Mesh;
		const material = exhaust.material as THREE.MeshStandardMaterial;
		expect(material.side).toBe(THREE.BackSide);
		expect(material.emissiveMap).toBeTruthy();
		// The gradient's axis: `v` runs the whole ramp, and `add()` did not
		// divide it by a tile size.
		expect(uvUnitsOf(exhaust.geometry)).toBe("plate");
		const uv = exhaust.geometry.getAttribute("uv") as THREE.BufferAttribute;
		let min = 1;
		let max = 0;
		for (let i = 0; i < uv.count; i++) {
			min = Math.min(min, uv.getY(i));
			max = Math.max(max, uv.getY(i));
		}
		expect(min).toBeCloseTo(0, 6);
		expect(max).toBeCloseTo(1, 6);
		// The bowl's throat is deeper than its lip, and both are inside the bell.
		const bowlBox = new THREE.Box3().setFromObject(exhaust);
		const bellBox = new THREE.Box3().setFromObject(bell);
		expect(bowlBox.min.z).toBeGreaterThan(bellBox.min.z);
		expect(bowlBox.max.z).toBeLessThanOrEqual(bellBox.max.z + 1e-9);
	});

	test("a hoop and a collar are both marked as rings", () => {
		for (const finish of ["stock", "industrial"] as const) {
			setHullFinish(finish);
			const hoop = buildShipMesh("courier", "a").root.getObjectByName(
				"courier-hoop-starboard",
			) as THREE.Mesh;
			expect([finish, hoop.geometry.userData.ring]).toEqual([finish, true]);
			expect([finish, uvUnitsOf(hoop.geometry)]).toEqual([finish, "plate"]);
		}
	});
});

describe("a ring is hollow", () => {
	/**
	 * The first collar was a capped loft — a drum — on the argument that a
	 * hoop's inside is buried in the nacelle it grips. Two of `hoop`'s callers
	 * are not nacelles: carrier B's bay lip stands round the bay's mouth and
	 * explorer A's habitat ring round open space, and sage's forward ray at
	 * the carrier's mouth met the lip under `industrial` and the mouth under
	 * `stock`. The forward-view test exempts a `ring` on the promise that its
	 * middle is empty, so this is where the promise is checked: in the
	 * geometry's own frame a ray along its axis passes through, and a ray from
	 * its centre outward meets a wall that faces the axis; in the hull's frame
	 * a ray along the ring's own axis never meets the ring, whatever else it
	 * meets.
	 */
	test("a ray along every ring's axis passes through it, under every finish", () => {
		for (const finish of HULL_FINISH_IDS) {
			setHullFinish(finish);
			let rings = 0;
			for (const id of HULL_IDS)
				for (const variant of HULL_VARIANT_IDS) {
					const root = buildShipMesh(id, variant).root;
					root.updateMatrixWorld(true);
					const meshes: THREE.Mesh[] = [];
					root.traverse((object) => {
						if (object instanceof THREE.Mesh) meshes.push(object);
					});
					for (const mesh of meshes) {
						if (mesh.geometry.userData.ring !== true) continue;
						rings += 1;
						const tag = [finish, id, variant, mesh.name];
						const alone = new THREE.Mesh(
							mesh.geometry,
							new THREE.MeshBasicMaterial(),
						);
						const through = new THREE.Raycaster(
							new THREE.Vector3(0, 0, -1),
							new THREE.Vector3(0, 0, 1),
							0,
							2,
						);
						expect([...tag, through.intersectObject(alone).length]).toEqual([
							...tag,
							0,
						]);
						const outward = new THREE.Raycaster(
							new THREE.Vector3(),
							new THREE.Vector3(1, 0, 0),
							0,
							1,
						);
						expect([...tag, outward.intersectObject(alone).length > 0]).toEqual(
							[...tag, true],
						);
						const axis = new THREE.Vector3(0, 0, 1).transformDirection(
							mesh.matrixWorld,
						);
						const centre = new THREE.Vector3().setFromMatrixPosition(
							mesh.matrixWorld,
						);
						const along = new THREE.Raycaster(
							centre.clone().addScaledVector(axis, -5),
							axis,
							0,
							10,
						);
						const hits = along.intersectObjects(meshes, false);
						expect([...tag, hits.some((hit) => hit.object === mesh)]).toEqual([
							...tag,
							false,
						]);
					}
				}
			expect([finish, rings > 0]).toEqual([finish, true]);
		}
	});
});

describe("the maps are the plating's, not the finish's", () => {
	test("plated and industrial share one set of maps; stock and worn have their own", () => {
		const mapOf = (id: HullFinishId) => {
			setHullFinish(id);
			let map: THREE.Texture | null = null;
			buildShipMesh("courier", "a").root.traverse((object) => {
				if (map || !(object instanceof THREE.Mesh)) return;
				if (!object.name.includes("fuselage")) return;
				map = (object.material as THREE.MeshStandardMaterial).map;
			});
			return map as THREE.Texture | null;
		};
		const plated = mapOf("plated");
		expect(plated).not.toBeNull();
		// The same object, not an equal one: a second generation of the same
		// profile is the duplicate this exists to refuse.
		expect(mapOf("industrial")).toBe(plated);
		expect(mapOf("stock")).not.toBe(plated);
		expect(mapOf("worn")).not.toBe(plated);
	});
});
