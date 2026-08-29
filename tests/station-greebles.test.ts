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
import { GREEBLE_PRIMITIVES, buildGreebles } from "../src/station-greebles";
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

	test("every role's density figure is the factor on a zone's own count", () => {
		// The figure #129 asks to be settled by looking rather than chosen up
		// front. This does not judge it — it proves the dial is wired, so what a
		// person sees on the contact sheet is what the profile says.
		//
		// **Through `buildGreebles` with one fixed zone**, and that is the whole
		// point of the test. The first version compared the totals of four
		// *different forms*, whose zones already declare 32, 30, 22 and 12
		// pieces: the four counts differ with `greebleDensity` deleted from the
		// generator entirely, so the check could not fail for the thing it
		// claims. One declaration through every role is the only way the density
		// is the only variable.
		const zone = {
			count: 100,
			sizeKm: 0.01,
			reliefKm: 0.01,
			place: (_i: number, _n: number, p: THREE.Vector3, n: THREE.Vector3) => {
				p.set(0, 0, 0);
				n.set(0, 0, 1);
			},
		};
		for (const type of TYPES) {
			const built = buildGreebles(type, `density-${type}`, [zone]).children;
			const total = built.reduce(
				(sum, mesh) => sum + (mesh as THREE.InstancedMesh).count,
				0,
			);
			expect([type, total]).toEqual([
				type,
				Math.round(100 * STATION_VISUALS[type].greebleDensity),
			]);
		}
		// And the four figures are not all the same, so the equality above is
		// four different numbers rather than one written twice.
		expect(
			new Set(TYPES.map((t) => STATION_VISUALS[t].greebleDensity)).size,
		).toBe(TYPES.length);
	});

	test("the fill is deterministic — the same station twice is the same clutter", () => {
		// **What this proves and what it does not.** Two builds in one process,
		// so it catches a generator that advances across calls — a module-level
		// counter, a shared stream, `Math.random`. It says nothing about a
		// second load or a second machine; the argument for those is that
		// `displayRand` is keyed by a constant string and does integer
		// arithmetic, and an argument is not a check.
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

describe("a greeble is mounted on the station, not floating beside it", () => {
	test("every instance sits inside the station's own structure", () => {
		// **The check `station-mesh.test.ts`'s island grouping cannot make.**
		// That one takes one `Box3` per object, and `Box3.setFromObject` on an
		// `InstancedMesh` unions every instance — so a single box already spans
		// the hull, and the grouping would pass with every individual piece
		// floating free. It catches a whole zone that is a detached island; it
		// cannot see one piece of thirty.
		//
		// A proxy, named as one, in two halves: a piece's centre is inside the
		// box of the *non-greeble* geometry, and it is out at the structure
		// rather than at the middle of it.
		//
		// **The box is widened rather than shrunk, and two earlier versions of
		// this got that backwards.** A face-mounted piece sits on the box's own
		// surface by construction and then stands its own standoff proud of it:
		// the Coriolis' square faces are at 0.672 against an AABB of 0.720 on x
		// and 0.678 on y, so a 2% inset failed half the pieces and a bare
		// `containsPoint` still failed the one sitting 0.0002 past the y face. A
		// tolerance that fails correct work is worse than a loose one, because
		// it is loosened by whoever meets it next rather than understood. 1% of
		// the structure's own size is more than any greeble's standoff and two
		// orders less than a zone placed off the hull, which is the distinction
		// that has to hold.
		//
		// It cannot see a piece buried inside a hollow, and nothing headless can
		// without a per-form surface equation — the same limit
		// `station-mesh.test.ts` records for the window panes. What it catches is
		// the failure that actually happens: a zone placed at a radius chosen by
		// eye, off the surface it was meant to be set into. Four fixtures were in
		// that state when the island check was first run.
		for (const type of TYPES) {
			for (const form of STATION_FORMS[type]) {
				const { root } = buildStationForm(type, form.id, GREY);
				root.updateMatrixWorld(true);
				const structure = new THREE.Box3();
				root.traverse((object) => {
					if (isGreeble(object)) return;
					if (!(object as THREE.Mesh).geometry) return;
					structure.union(new THREE.Box3().setFromObject(object));
				});
				structure.expandByVector(
					structure.getSize(new THREE.Vector3()).multiplyScalar(0.01),
				);
				// **A quarter of the core radius, not of the form's own box**, and
				// that is the pane test's correction applied here: a shipyard's
				// reach is a 1.4 km frame nothing is mounted on, so a floor
				// derived from its bounding box rejected the keel clutter that is
				// exactly where a yard's plant belongs. The mesh is normalised to
				// one core radius, so the core radius is 1.
				const FLOOR = 0.25;
				const matrix = new THREE.Matrix4();
				const centre = new THREE.Vector3();
				const outside: string[] = [];
				for (const mesh of greebleMeshes(root)) {
					for (let i = 0; i < mesh.count; i++) {
						mesh.getMatrixAt(i, matrix);
						centre.setFromMatrixPosition(matrix);
						mesh.localToWorld(centre);
						if (!structure.containsPoint(centre) || centre.length() < FLOOR)
							outside.push(`${mesh.name}#${i}`);
					}
				}
				expect([type, form.id, outside.join(",")]).toEqual([type, form.id, ""]);
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

	test("no role's window scale is below 1", () => {
		// Renamed: this asserts the figure, not that it reached anything. It
		// builds no form, so it could never have failed for a scale that stopped
		// reaching one — the test below is the one that can.
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
		//
		// **Keyed by form id, not by position.** A positional list is
		// re-baselined by reordering `STATION_FORMS` or inserting a form: each
		// assertion silently starts comparing against another form's count, and
		// nothing goes red.
		const before: Record<StationType, Record<string, number>> = {
			trade: { a: 28, b: 28, c: 28 },
			shipyard: { a: 16, b: 16, c: 12 },
			refinery: { a: 12, b: 12, c: 10 },
			outpost: { a: 6, b: 6, c: 6 },
		};
		for (const type of TYPES) {
			// Every form has a baseline, so a form added without one is a red run
			// rather than a comparison against `undefined`, which is never true
			// and would read as the new form having too few panes.
			expect([type, Object.keys(before[type]).sort()]).toEqual([
				type,
				STATION_FORMS[type].map((form) => form.id).sort(),
			]);
			for (const form of STATION_FORMS[type]) {
				const now = paneCount(buildStationForm(type, form.id, GREY).root);
				expect([type, form.id, now > before[type][form.id]]).toEqual([
					type,
					form.id,
					true,
				]);
			}
		}
	});
});
