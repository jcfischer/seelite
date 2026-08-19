/**
 * What the built silhouettes actually measure.
 *
 * Geometry is arithmetic even when it ends up on a GPU, so it belongs in the
 * headless tier: `station-mesh.ts` builds `BufferGeometry` and nothing here
 * needs a canvas, a context or a frame. What the browser probe owns is the half
 * this cannot see — whether the three read *apart* on screen, and whether the
 * slot turns.
 *
 * The claim being guarded is `STATION_GEOMETRY.silhouetteRadiusKm`, which was a
 * number nothing checked until sage's review of #28 measured it: the drydock
 * frame reached 2.0 km against a declared 1.5, and the refinery's flare stacks
 * 0.85 against 0.75. A budget with no test is a comment.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { STATION_GEOMETRY, type StationType } from "../src/station";
import { buildStationMesh } from "../src/station-mesh";

const TYPES: StationType[] = ["trade", "shipyard", "refinery"];

/**
 * The farthest vertex from the station's centre, in kilometres.
 *
 * Vertices rather than `Box3.setFromObject`, and the difference is not
 * pedantry: a box around the trade station's octahedron has corners at
 * √3 × 0.6 = 1.04 km where the object's farthest actual point is 0.6, so a box
 * would fail a correct mesh and be "fixed" by inflating the budget.
 *
 * The root is normalised to core radii (`station-mesh.ts`), so the result is
 * multiplied back by the core radius to land in kilometres — the units the
 * table is written in.
 */
function reachKm(type: StationType): number {
	const { root } = buildStationMesh(type);
	root.updateMatrixWorld(true);
	let maxSq = 0;
	const v = new THREE.Vector3();
	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position) return;
		for (let i = 0; i < position.count; i++) {
			v.fromBufferAttribute(position as THREE.BufferAttribute, i);
			mesh.localToWorld(v);
			maxSq = Math.max(maxSq, v.lengthSq());
		}
	});
	return Math.sqrt(maxSq) * STATION_GEOMETRY[type].coreRadiusKm;
}

describe("the silhouette budget is a budget", () => {
	test("no vertex of any station lies outside silhouetteRadiusKm", () => {
		for (const type of TYPES) {
			const reach = reachKm(type);
			console.log(
				`${type}: reaches ${reach.toFixed(3)} km, budget ` +
					`${STATION_GEOMETRY[type].silhouetteRadiusKm} km`,
			);
			// A hair of slack for float32: `BufferAttribute` positions are single
			// precision, so a vertex authored at exactly the budget reads back a few
			// parts in 10⁸ outside it. The budget is a kilometre-scale claim and this
			// is a 24-nanometre one.
			expect(reach).toBeLessThanOrEqual(
				STATION_GEOMETRY[type].silhouetteRadiusKm * (1 + 1e-6),
			);
		}
	});

	test("the budget is not slack enough to hide a doubling", () => {
		// A ceiling nothing approaches is a ceiling that catches nothing: the
		// shipyard's frame could grow by half again inside a 3 km budget and no
		// test would see it. Half the budget is the floor, which every type clears
		// comfortably today.
		for (const type of TYPES) {
			expect(reachKm(type)).toBeGreaterThan(
				STATION_GEOMETRY[type].silhouetteRadiusKm * 0.5,
			);
		}
	});

	test("every silhouette contains its own dockable core", () => {
		for (const type of TYPES) {
			expect(STATION_GEOMETRY[type].silhouetteRadiusKm).toBeGreaterThanOrEqual(
				STATION_GEOMETRY[type].coreRadiusKm,
			);
			// And the mesh really is at least core-sized — a station drawn smaller
			// than what the docking checks aim at is a slot you cannot see.
			expect(reachKm(type)).toBeGreaterThanOrEqual(
				STATION_GEOMETRY[type].coreRadiusKm * 0.95,
			);
		}
	});
});

describe("the parts the probe and the renderer look up by name", () => {
	test("every type has an aperture, and only the shipyard a drydock", () => {
		for (const type of TYPES) {
			const { root } = buildStationMesh(type);
			// `probe-station.mjs` finds these by name; a rename that only broke the
			// probe would show up as a browser-tier failure with no headless signal.
			expect(root.getObjectByName("aperture")).toBeDefined();
			expect(!!root.getObjectByName("drydock")).toBe(type === "shipyard");
		}
	});

	test("the drydock is a sibling of the spinner, never inside it", () => {
		// §7's frame does not rotate. Inside the spinner it would, and the only
		// symptom is a shipyard whose frame swings — which no arithmetic sees.
		const { root, spinner } = buildStationMesh("shipyard");
		expect(spinner.getObjectByName("drydock")).toBeUndefined();
		expect(root.getObjectByName("drydock")).toBeDefined();
	});

	test("the refinery's spinner is empty, so a phase written into it draws nothing", () => {
		const { spinner } = buildStationMesh("refinery");
		expect(spinner.children.length).toBe(0);
	});
});

describe("the meshes are built in the table's units", () => {
	test("the aperture is drawn at the size the docking checks use", () => {
		// The one dimension a headless test can hold the renderer to: a slot drawn
		// wider than `STATION_GEOMETRY` says is a gap between what the player aims
		// at and what #9's checks measure, and it is invisible on screen.
		for (const type of TYPES) {
			const { root } = buildStationMesh(type);
			root.updateMatrixWorld(true);
			const mouth = root.getObjectByName("aperture-mouth") as THREE.Mesh;
			expect(mouth).toBeDefined();
			const box = new THREE.Box3().setFromObject(mouth);
			const size = box.getSize(new THREE.Vector3());
			const core = STATION_GEOMETRY[type].coreRadiusKm;
			// Six digits, not nine: the vertices are float32 by the time they are
			// read back, so nine would be asserting the storage format rather than
			// the dimension. A slot 1% wrong fails this by four orders of magnitude.
			expect(size.x * core).toBeCloseTo(
				STATION_GEOMETRY[type].aperture.widthKm,
				6,
			);
			expect(size.y * core).toBeCloseTo(
				STATION_GEOMETRY[type].aperture.heightKm,
				6,
			);
		}
	});

	test("the aperture sits on the +Z face, which is the axis the caller aims", () => {
		for (const type of TYPES) {
			const { root } = buildStationMesh(type);
			root.updateMatrixWorld(true);
			const mouth = root.getObjectByName("aperture-mouth") as THREE.Mesh;
			const centre = mouth.getWorldPosition(new THREE.Vector3());
			expect(centre.z).toBeGreaterThan(0);
			// On the axis, not off it: an off-axis slot turns the roll match into a
			// lateral intercept at above-gate speed (`docking.md` §4.2).
			expect(Math.hypot(centre.x, centre.y)).toBeLessThan(1e-6);
		}
	});
});
