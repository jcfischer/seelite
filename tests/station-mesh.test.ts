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
import { STATION_SILHOUETTE_KM, buildStationMesh } from "../src/station-mesh";

const TYPES: StationType[] = ["trade", "shipyard", "refinery"];

/** Any colour: these tests are about geometry. The two that are about the
 *  colour cue pass their own and say so. */
const GREY = 0x9aa6b2;

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
	const { root } = buildStationMesh(type, GREY);
	root.updateMatrixWorld(true);
	let maxSq = 0;
	const v = new THREE.Vector3();
	const instance = new THREE.Matrix4();
	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position) return;
		// An `InstancedMesh` carries its copies in `instanceMatrix`, not in the
		// scene graph, so walking children alone would measure the window grid at
		// the origin and report a station smaller than it is drawn.
		const instanced = object as THREE.InstancedMesh;
		const count = instanced.isInstancedMesh ? instanced.count : 1;
		for (let n = 0; n < count; n++) {
			if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance);
			else instance.identity();
			for (let i = 0; i < position.count; i++) {
				v.fromBufferAttribute(position as THREE.BufferAttribute, i);
				v.applyMatrix4(instance);
				mesh.localToWorld(v);
				maxSq = Math.max(maxSq, v.lengthSq());
			}
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
					`${STATION_SILHOUETTE_KM[type]} km`,
			);
			// A hair of slack for float32: `BufferAttribute` positions are single
			// precision, so a vertex authored at exactly the budget reads back a few
			// parts in 10⁸ outside it. The budget is a kilometre-scale claim and this
			// is a 24-nanometre one.
			expect(reach).toBeLessThanOrEqual(
				STATION_SILHOUETTE_KM[type] * (1 + 1e-6),
			);
		}
	});

	test("the budget is not slack enough to hide a doubling", () => {
		// A ceiling nothing approaches is a ceiling that catches nothing: the
		// shipyard's frame could grow by half again inside a 3 km budget and no
		// test would see it. Half the budget is the floor, which every type clears
		// comfortably today.
		for (const type of TYPES) {
			expect(reachKm(type)).toBeGreaterThan(STATION_SILHOUETTE_KM[type] * 0.5);
		}
	});

	test("every silhouette contains its own dockable core", () => {
		for (const type of TYPES) {
			expect(STATION_SILHOUETTE_KM[type]).toBeGreaterThanOrEqual(
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
			const { root } = buildStationMesh(type, GREY);
			// `probe-station.mjs` finds these by name; a rename that only broke the
			// probe would show up as a browser-tier failure with no headless signal.
			expect(root.getObjectByName("aperture")).toBeDefined();
			expect(!!root.getObjectByName("drydock")).toBe(type === "shipyard");
		}
	});

	test("the drydock is a sibling of the spinner, never inside it", () => {
		// §7's frame does not rotate. Inside the spinner it would, and the only
		// symptom is a shipyard whose frame swings — which no arithmetic sees.
		const { root, spinner } = buildStationMesh("shipyard", GREY);
		expect(spinner.getObjectByName("drydock")).toBeUndefined();
		expect(root.getObjectByName("drydock")).toBeDefined();
	});

	test("the refinery's spinner is empty, so a phase written into it draws nothing", () => {
		const { spinner } = buildStationMesh("refinery", GREY);
		expect(spinner.children.length).toBe(0);
	});
});

describe("the meshes are built in the table's units", () => {
	test("the aperture is drawn at the size the docking checks use", () => {
		// The one dimension a headless test can hold the renderer to: a slot drawn
		// wider than `STATION_GEOMETRY` says is a gap between what the player aims
		// at and what #9's checks measure, and it is invisible on screen.
		for (const type of TYPES) {
			const { root } = buildStationMesh(type, GREY);
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
			const { root } = buildStationMesh(type, GREY);
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

describe("§7's secondary cue, and the detail that is not the identity", () => {
	test("the hull is painted the colour the caller passes", () => {
		// The blocker sage's HonestOracle lens caught: the first version built both
		// Coriolis cores from one literal, so a trade station and a shipyard were
		// the same colour — a per-type cue silently removed while two docstrings
		// still claimed it was live.
		for (const type of TYPES) {
			const { root } = buildStationMesh(type, 0x123456);
			const core = root.getObjectByName("core") as THREE.Mesh;
			expect(core).toBeDefined();
			expect((core.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
				0x123456,
			);
		}
	});

	test("two colours give two different stations", () => {
		const a = buildStationMesh("trade", 0x111111);
		const b = buildStationMesh("trade", 0x222222);
		const hex = (m: THREE.Object3D) =>
			(
				(m.getObjectByName("core") as THREE.Mesh)
					.material as THREE.MeshStandardMaterial
			).color.getHex();
		// A shared material would make the second build recolour the first, which
		// is the failure the shared-parts comment warns about from the other side.
		expect(hex(a.root)).toBe(0x111111);
		expect(hex(b.root)).toBe(0x222222);
	});

	test("window panes lie on the hull, not buried inside it", () => {
		// An octahedron's surface is |x| + |y| + |z| = r, so a pane placed on a
		// circle sits tens of metres behind an opaque face at every angle — which
		// is invisible, and which no rendered check would report as anything but
		// "the windows do not show".
		for (const type of ["trade", "shipyard"] as StationType[]) {
			const { root } = buildStationMesh(type, GREY);
			root.updateMatrixWorld(true);
			const panes = root.getObjectByName("windows") as THREE.InstancedMesh;
			expect(panes.isInstancedMesh).toBe(true);
			const r = STATION_GEOMETRY[type].coreRadiusKm;
			const m = new THREE.Matrix4();
			const p = new THREE.Vector3();
			for (let i = 0; i < panes.count; i++) {
				panes.getMatrixAt(i, m);
				p.setFromMatrixPosition(m);
				// The core is built in kilometres — the normalisation happens at the
				// root, above this group — so the face plane is at `r` directly.
				const face = Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z);
				expect(face).toBeGreaterThanOrEqual(r);
				expect(face).toBeLessThan(r * 1.02);
			}
		}
	});

	test("the aperture mouth is not coplanar with the face it is cut into", () => {
		// Coplanar faces z-fight, and the symptom is a slot that flickers as the
		// station turns — which reads as the aperture not being there.
		for (const type of TYPES) {
			const { root } = buildStationMesh(type, GREY);
			root.updateMatrixWorld(true);
			const mouth = root.getObjectByName("aperture-mouth") as THREE.Mesh;
			const box = new THREE.Box3().setFromObject(mouth);
			const bars = root.getObjectByName("aperture") as THREE.Object3D;
			const barZ = Math.max(
				...bars.children
					.filter((c) => c.name !== "aperture-mouth")
					.map((c) => c.position.z),
			);
			expect(box.max.z).toBeGreaterThan(barZ - 0.5);
			expect(box.max.z).not.toBeCloseTo(barZ, 9);
		}
	});
});
