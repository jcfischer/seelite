/**
 * #129 — the station half of #102: mechanical clutter on the three silhouettes,
 * and enough lit windows that a station reads as inhabited at approach range.
 *
 * What lives here is what a browser cannot answer cheaply, and one thing it
 * cannot answer at all.
 *
 * The one it cannot answer is #102 §2's rule from the greeble side: **no
 * greeble may be a station's farthest vertex.** On screen a station whose
 * outline gained a box at `full` and lost it at `reduced` looks like a station
 * that resolved, which is also what a correct band switch looks like.
 * `tests/station-visuals.test.ts` already asserts the reach is *identical* at
 * all three levels, so a violation lands there as an inequality; what this file
 * adds is the reason, measured per form, so the failure names the form rather
 * than the role.
 *
 * The rest is arithmetic a probe would have to render to see: that the density
 * figures reach the mesh, that the fill is deterministic, and that #102 §5's
 * quality gate drops the geometry and keeps every light.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
} from "../src/station";
import { GREEBLE_PRIMITIVES } from "../src/station-greebles";
import {
	STATION_FORMS,
	buildStationForm,
	setStationDetail,
	updateStationVisuals,
} from "../src/station-mesh";
import { STATION_QUALITY, STATION_VISUALS } from "../src/station-visuals";

const TYPES: StationType[] = STATION_TYPES;
const GREY = 0x9aa6b2;

/** Every instanced greeble mesh on a built station. */
function greebleMeshes(root: THREE.Object3D): THREE.InstancedMesh[] {
	const found: THREE.InstancedMesh[] = [];
	root.traverse((object) => {
		const mesh = object as THREE.InstancedMesh;
		if (mesh.isInstancedMesh && object.name.startsWith("greebles")) {
			found.push(mesh);
		}
	});
	return found;
}

const greebleCount = (root: THREE.Object3D) =>
	greebleMeshes(root).reduce((n, mesh) => n + mesh.count, 0);

/** The farthest vertex of a named subset, kilometres — authored units, so the
 *  core-radius normalisation at the root is undone the way the sibling reach
 *  measurements in `station-visuals.test.ts` undo it. */
function reachOf(
	root: THREE.Object3D,
	type: StationType,
	keep: (object: THREE.Object3D) => boolean,
): number {
	root.updateMatrixWorld(true);
	let maxSq = 0;
	const v = new THREE.Vector3();
	const instance = new THREE.Matrix4();
	root.traverse((object) => {
		if (!keep(object)) return;
		const mesh = object as THREE.Mesh;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position) return;
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

const isGreeble = (object: THREE.Object3D) => {
	for (let node: THREE.Object3D | null = object; node; node = node.parent)
		if (node.name.startsWith("greebles")) return true;
	return false;
};

describe("every form carries clutter, and the density figure is what puts it there", () => {
	test("every form of every role builds greebles", () => {
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY);
				expect([type, form.id, greebleCount(root) > 0]).toEqual([
					type,
					form.id,
					true,
				]);
			}
		}
	});

	test("the clutter is instanced, so a station's draw calls do not scale with it", () => {
		// #102's budget note: an `InstancedMesh` is one draw call, a hundred
		// separate meshes is not. One mesh per primitive per station is the
		// ceiling this asserts — not one per zone, which is what a naive
		// per-zone builder produces.
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY);
				expect([type, form.id, greebleMeshes(root).length]).toEqual([
					type,
					form.id,
					GREEBLE_PRIMITIVES.length,
				]);
			}
		}
	});

	test("every role's density figure is the one thing that moves its count", () => {
		// The figure #129 asks to be settled by looking rather than chosen up
		// front. This does not judge it — it proves the dial is wired, so what a
		// person sees on the contact sheet is what the profile says.
		for (const type of TYPES) {
			expect([type, STATION_VISUALS[type].greebleDensity > 0]).toEqual([
				type,
				true,
			]);
		}
		// Two roles with different figures must not land on the same count for
		// the same zone declaration; that would mean the figure is being
		// rounded away rather than read.
		const counts = TYPES.map((type) =>
			greebleCount(buildStationForm(type, "a", GREY).root),
		);
		expect(new Set(counts).size).toBeGreaterThan(1);
	});

	test("the fill is deterministic — the same station twice is the same clutter", () => {
		// `displayRand` is keyed by a constant string, so this holds across loads
		// and across systems. A generator seeded from anything else — a counter,
		// `Math.random` — passes every other test in this file and fails here.
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const a = greebleMeshes(buildStationForm(type, form.id, GREY).root);
				const b = greebleMeshes(buildStationForm(type, form.id, GREY).root);
				for (let m = 0; m < a.length; m++) {
					expect([type, form.id, [...a[m].instanceMatrix.array]]).toEqual([
						type,
						form.id,
						[...b[m].instanceMatrix.array],
					]);
				}
			}
		}
	});
});

describe("#102 §2 — no greeble may be a station's farthest vertex", () => {
	test("on every form, the structure reaches further than the clutter", () => {
		// The rule stated where it is caused. `station-visuals.test.ts` asserts
		// the consequence — reach identical at all three levels — and would go
		// red for a greeble that carried the outline; it would not say which
		// form or by how much, and a strict inequality here does.
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY);
				const clutter = reachOf(root, type, isGreeble);
				const structure = reachOf(root, type, (o) => !isGreeble(o));
				expect([type, form.id, clutter < structure]).toEqual([
					type,
					form.id,
					true,
				]);
			}
		}
	});
});

describe("#102 §5 — low drops the geometry and keeps every light", () => {
	test("the quality key says so, in the one place both sides read", () => {
		expect(STATION_QUALITY.high.greebles).toBe(true);
		expect(STATION_QUALITY.low.greebles).toBe(false);
	});

	test("low hides every greeble instance", () => {
		for (const type of TYPES) {
			const built = buildStationForm(type, "a", GREY);
			// Driven through the per-frame call rather than by setting the flag
			// and reading the mesh: the gate has to be live, and the renderer's
			// own path is the only one that proves it.
			updateStationVisuals(built, 0, 1, "low");
			expect([
				type,
				greebleMeshes(built.root).every((m) => !m.visible),
			]).toEqual([type, true]);
			updateStationVisuals(built, 0, 1, "high");
			expect([type, greebleMeshes(built.root).every((m) => m.visible)]).toEqual(
				[type, true],
			);
		}
	});

	test("low keeps the windows and every clock-driven fixture", () => {
		// The half that must *not* move. Dropping the lights on low would drop
		// the reason #102 exists — an unlit flank is legible because it emits.
		for (const type of TYPES) {
			const built = buildStationForm(type, "a", GREY);
			updateStationVisuals(built, 3, 1, "low");
			const panes = built.root.getObjectByName("windows");
			expect([type, panes?.visible]).toEqual([type, true]);
			const lit = built.fixtures.map((f) => f.material.emissiveIntensity);
			updateStationVisuals(built, 3, 1, "high");
			expect([
				type,
				built.fixtures.map((f) => f.material.emissiveIntensity),
			]).toEqual([type, lit]);
		}
	});

	test("the quality gate is not the detail band wearing another name", () => {
		// Both write `visible`, and a single owner would make one of them a
		// no-op. At `full` with low quality the clutter is gone and the rest of
		// the `full` set is still drawn.
		const built = buildStationForm("trade", "a", GREY);
		setStationDetail(built, "full");
		updateStationVisuals(built, 0, 1, "low");
		expect(greebleMeshes(built.root).every((m) => !m.visible)).toBe(true);
		expect(built.root.getObjectByName("windows")?.visible).toBe(true);
	});
});

describe("#129 — the windows are dense enough to read as inhabited", () => {
	/** Panes on one built form. */
	const paneCount = (root: THREE.Object3D) =>
		(root.getObjectByName("windows") as THREE.InstancedMesh).count;

	test("every role's window scale reaches its forms", () => {
		for (const type of TYPES) {
			expect([type, STATION_VISUALS[type].windowScale >= 1]).toEqual([
				type,
				true,
			]);
		}
	});

	test("a station carries more panes than #36 shipped", () => {
		// The counts #36 shipped, per form, so a scale silently reset to 1 is a
		// red run rather than a station that merely looks the same. Not a
		// tolerance: the figures are integers and this is the whole claim.
		const before: Record<StationType, number[]> = {
			trade: [28, 28, 28],
			shipyard: [16, 16, 12],
			refinery: [12, 12, 10],
			outpost: [6, 6, 6],
		};
		for (const type of TYPES) {
			STATION_FORMS[type].forEach((form, i) => {
				const now = paneCount(buildStationForm(type, form.id, GREY).root);
				expect([type, form.id, now > before[type][i]]).toEqual([
					type,
					form.id,
					true,
				]);
			});
		}
	});
});
