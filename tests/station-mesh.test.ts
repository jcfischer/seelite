/**
 * What the built silhouettes actually measure.
 *
 * Geometry is arithmetic even when it ends up on a GPU, so it belongs in the
 * headless tier: `station-mesh.ts` builds `BufferGeometry` and nothing here
 * needs a canvas, a context or a frame. What the browser probe owns is the half
 * this cannot see — whether the three read *apart* on screen, and whether the
 * slot turns.
 *
 * The claim being guarded is `STATION_SILHOUETTE_KM` (`station-mesh.ts`), which
 * was a number nothing checked until sage's review of #28 measured it: the
 * drydock frame reached 2.0 km against §5's declared 1.5, and the refinery's
 * stacks 0.85 against a then-declared 0.75. A budget with no test is a comment.
 *
 * The two rows are different kinds of claim and the assertions below cannot tell
 * them apart, so it is said here instead: the shipyard's 1.5 km comes from
 * `docking.md` §5, and its overrun was fixed by **resizing the frame**. The
 * refinery has no spec figure, so its 0.9 was set from the mesh's own 0.837 —
 * the overrun there was fixed by **raising the number**, and on the day it was
 * written that row could not have failed. It is a ratchet against future growth,
 * not a design constraint.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
} from "../src/station";
import {
	STATION_FORMS,
	STATION_SILHOUETTE_KM,
	buildStationForm,
	buildStationMesh,
} from "../src/station-mesh";

// From `station.ts`, not a literal: a fourth station type must reach every
// loop in this file, and a hand-written list is exactly the place it would not.
const TYPES: StationType[] = STATION_TYPES;

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
	return reachOf(buildStationMesh(type, GREY).root, type);
}

/** The farthest drawn vertex of an already-built station, kilometres. */
function reachOf(root: THREE.Object3D, type: StationType): number {
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

	test("every form is inside its own declared reach", () => {
		// Per *form*, not per role. The selected forms are what the two
		// assertions around this one measure, and a form nobody has ranked yet is
		// exactly where an overrun hides: the previewer draws it, nothing else
		// does, and its number would drift until the day it was chosen.
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY);
				const reach = reachOf(root, type);
				console.log(
					`${type} ${form.id} ${form.name}: reaches ${reach.toFixed(3)} km, ` +
						`declared ${form.reachKm} km`,
				);
				expect(reach).toBeLessThanOrEqual(form.reachKm * (1 + 1e-6));
				// And not slack: a declaration nothing approaches catches nothing.
				expect(reach).toBeGreaterThan(form.reachKm * 0.6);
			}
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
	test("every form of every role has a core and an aperture", () => {
		// `probe-station.mjs` and `probe-station-visuals.mjs` find these by name;
		// a rename that only broke a probe would show up as a browser-tier
		// failure with no headless signal. Asserted over every *form*, not only
		// the selected one, because the previewer builds them all and a form that
		// cannot be probed is a form that cannot be ranked honestly.
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY);
				expect(root.getObjectByName("core")).toBeDefined();
				expect(root.getObjectByName("aperture")).toBeDefined();
				expect(root.getObjectByName("aperture-mouth")).toBeDefined();
			}
		}
	});

	test("a shipyard's outboard frame is never inside its spinner", () => {
		// §7's frame does not rotate. Inside the spinner it would, and the only
		// symptoms are a fairground ride and — measurably — `probe-station.mjs`'s
		// far-range width check becoming a function of the clock, because the
		// outboard structure swings through the view.
		for (const form of STATION_FORMS.shipyard) {
			const { root, spinner } = buildStationForm("shipyard", form.id, GREY);
			expect(root.getObjectByName("frame")).toBeDefined();
			expect(spinner.getObjectByName("frame")).toBeUndefined();
			// And the slot *is* inside it, or the phase drives nothing.
			expect(spinner.getObjectByName("aperture-mouth")).toBeDefined();
		}
	});

	test("only a role that spins hands back a spinner with anything in it", () => {
		// `docking.md` §4: the refinery's pad does not turn, and a station that
		// rotated whole would sweep its own pad away from the ship lined up on it.
		for (const type of TYPES) {
			const { spinner } = buildStationMesh(type, GREY);
			expect(spinner.children.length > 0).toBe(STATION_GEOMETRY[type].spins);
		}
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
		// The failure this guards is invisible on screen: a pane inside an opaque
		// hull renders as nothing, and reads only as "the windows do not show".
		// #28 could test it exactly — an octahedron's surface is the plane
		// |x| + |y| + |z| = r — and the forms have no single such expression
		// between them, so what is asserted is the property that survives:
		// a pane is out near the shell it belongs to, and not inside the middle
		// of the station or outside its declared reach.
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY);
				root.updateMatrixWorld(true);
				const panes = root.getObjectByName("windows") as THREE.InstancedMesh;
				expect(panes?.isInstancedMesh).toBe(true);
				const core = STATION_GEOMETRY[type].coreRadiusKm;
				const m = new THREE.Matrix4();
				const p = new THREE.Vector3();
				for (let i = 0; i < panes.count; i++) {
					panes.getMatrixAt(i, m);
					p.setFromMatrixPosition(m);
					// The group is authored in kilometres — the normalisation happens
					// at the root, above this — so these are kilometres already.
					expect(p.length()).toBeGreaterThan(core * 0.25);
					expect(p.length()).toBeLessThanOrEqual(form.reachKm);
				}
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

describe("a station is one object, not a scatter of parts", () => {
	/**
	 * The parts of a built station, grouped into islands by bounding-box
	 * contact.
	 *
	 * Boxes rather than geometry, and it is worth being plain that this is a
	 * **proxy**: two boxes can overlap while the meshes inside them miss each
	 * other, so a pass here is not proof that everything touches. What it does
	 * catch is the failure that actually happens — a fixture placed at a radius
	 * chosen by eye, hanging in space beside the hull it is meant to be mounted
	 * on. Four of those were in the pool when this was first run: two of the
	 * Gantry's floods, one of the Hangar's strobes, the Derrick's whole flare,
	 * and the Rig's window run.
	 */
	function islands(root: THREE.Object3D): string[][] {
		root.updateMatrixWorld(true);
		const parts: { name: string; box: THREE.Box3 }[] = [];
		root.traverse((object) => {
			if (!(object as THREE.Mesh).geometry) return;
			parts.push({
				name: object.name || object.type,
				box: new THREE.Box3().setFromObject(object),
			});
		});
		const parent = parts.map((_, i) => i);
		const find = (i: number): number =>
			parent[i] === i ? i : (parent[i] = find(parent[i]));
		for (let i = 0; i < parts.length; i++)
			for (let j = i + 1; j < parts.length; j++)
				if (parts[i].box.intersectsBox(parts[j].box)) parent[find(i)] = find(j);
		const grouped = new Map<number, string[]>();
		for (let i = 0; i < parts.length; i++) {
			const root = find(i);
			if (!grouped.has(root)) grouped.set(root, []);
			(grouped.get(root) as string[]).push(parts[i].name);
		}
		return [...grouped.values()];
	}

	test("every form of every role is a single connected assembly", () => {
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY);
				const found = islands(root);
				// The message carries the names, because "2 islands" tells you
				// nothing about which part came loose and the parts are named.
				const detached = found
					.slice(1)
					.map((names) => names.join("+"))
					.join(" | ");
				expect([`${type} ${form.id}`, detached]).toEqual([
					`${type} ${form.id}`,
					"",
				]);
			}
		}
	});
});
