/**
 * #332 — trade E, the Wheel: two rims on one axis, after Space Station V.
 *
 * Every row every form owes (reach, corridor, aperture cut, islands, lamps) is
 * already asserted over `STATION_FORMS` by the station suites, and the Wheel
 * reaches them by being in that table. What this file holds is the form's own
 * thesis, each half of which a plausible build could get wrong while every one
 * of those rows stayed green:
 *
 * - **two** rims, not the Ring's one, sharing the spin axis and apart along it;
 * - four spokes to each;
 * - a finished rim whose section is a **box**, not the Ring's round tube;
 * - an unfinished rim that is a lattice **all the way round**, because a partial
 *   arc on a spinning part is a silhouette that depends on the clock
 *   (`station-types.md` §7.2);
 * - the dock on the hub's front cap, ahead of both wheels.
 *
 * Positions are read back in kilometres: `buildStationForm` normalises by the
 * core radius on an inner group, so a world vertex off the root is in core
 * radii and is scaled back here.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { STATION_GEOMETRY } from "../src/station";
import { STATION_FORMS, buildStationForm } from "../src/station-mesh";

const GREY = 0x9aa6b2;
const CORE_KM = STATION_GEOMETRY.trade.coreRadiusKm;

const wheel = () => {
	const { root } = buildStationForm("trade", "e", GREY, 0, 0);
	root.updateMatrixWorld(true);
	return root;
};

/** Every vertex under `object`, in kilometres, instances included. */
function verticesKm(object: THREE.Object3D): THREE.Vector3[] {
	const out: THREE.Vector3[] = [];
	const instance = new THREE.Matrix4();
	object.traverse((node) => {
		const mesh = node as THREE.Mesh;
		const position = mesh.geometry?.getAttribute("position");
		if (!position) return;
		const instanced = node as THREE.InstancedMesh;
		const count = instanced.isInstancedMesh ? instanced.count : 1;
		for (let n = 0; n < count; n++) {
			if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance);
			else instance.identity();
			for (let i = 0; i < position.count; i++) {
				const v = new THREE.Vector3()
					.fromBufferAttribute(position as THREE.BufferAttribute, i)
					.applyMatrix4(instance);
				mesh.localToWorld(v);
				out.push(v.multiplyScalar(CORE_KM));
			}
		}
	});
	return out;
}

const radial = (v: THREE.Vector3) => Math.hypot(v.x, v.y);

function named(root: THREE.Object3D, name: string) {
	const object = root.getObjectByName(name);
	if (!object) throw new Error(`the Wheel has no part named ${name}`);
	return object;
}

function boxKm(object: THREE.Object3D) {
	return new THREE.Box3().setFromPoints(verticesKm(object));
}

describe("trade E — the Wheel", () => {
	test("trade carries the Wheel as form e, and no other role does", () => {
		expect(STATION_FORMS.trade.find((form) => form.id === "e")?.name).toBe(
			"Wheel",
		);
		for (const type of ["shipyard", "refinery", "outpost"] as const)
			expect(STATION_FORMS[type].some((form) => form.id === "e")).toBe(false);
	});

	test("two rims share the spin axis and stand apart along it", () => {
		const root = wheel();
		const finished = boxKm(named(root, "core"));
		const frame = boxKm(named(root, "rim-frame"));
		for (const box of [finished, frame]) {
			const centre = box.getCenter(new THREE.Vector3());
			// Centred on the axis to the metre: a rim off the axis is a wobble.
			expect(Math.abs(centre.x)).toBeLessThan(0.001);
			expect(Math.abs(centre.y)).toBeLessThan(0.001);
		}
		const finishedDepth = finished.max.z - finished.min.z;
		const gap = Math.max(
			frame.min.z - finished.max.z,
			finished.min.z - frame.max.z,
		);
		// Clear air between them, at least a rim's own depth: two rims touching
		// read as one thick one.
		expect(gap).toBeGreaterThan(finishedDepth);
		// The same wheel twice, which is the reference's whole symmetry.
		const outer = (box: THREE.Box3) => (box.max.x - box.min.x) / 2;
		expect(outer(frame) / outer(finished)).toBeGreaterThan(0.95);
		expect(outer(frame) / outer(finished)).toBeLessThan(1.05);
	});

	test("each wheel is carried on four spokes that reach from the hub to its rim", () => {
		const root = wheel();
		const rimOuter = boxKm(named(root, "core")).max.x;
		const hubHalf = boxKm(named(root, "hub")).max.x;
		for (const wheelName of ["fore", "aft"]) {
			for (let i = 0; i < 4; i++) {
				const spoke = verticesKm(named(root, `spoke-${wheelName}-${i}`));
				const r = spoke.map(radial);
				expect(Math.min(...r)).toBeLessThan(hubHalf * 1.05);
				expect(Math.max(...r)).toBeGreaterThan(rimOuter * 0.8);
			}
			expect(root.getObjectByName(`spoke-${wheelName}-4`)).toBeUndefined();
		}
	});

	test("the finished rim is a box section, not a round tube", () => {
		// A box section has a flat outer face, so the vertices at the rim's
		// outermost radius span the rim's whole depth. On a torus they span
		// nothing: the outermost radius is one circle at the tube's equator.
		const core = verticesKm(named(wheel(), "core"));
		const outer = Math.max(...core.map(radial));
		const zs = core.map((v) => v.z);
		const depth = Math.max(...zs) - Math.min(...zs);
		const onOuterFace = core
			.filter((v) => radial(v) > outer * 0.995)
			.map((v) => v.z);
		expect(Math.max(...onOuterFace) - Math.min(...onOuterFace)).toBeGreaterThan(
			depth * 0.8,
		);
	});

	test("the unfinished rim is the same circle at every angle, lattice with plated sections", () => {
		const root = wheel();
		const frame = verticesKm(named(root, "rim-frame"));
		const SECTORS = 36;
		const reach = new Array<number>(SECTORS).fill(0);
		for (const v of frame) {
			const sector =
				Math.floor(
					((Math.atan2(v.y, v.x) + Math.PI * 2) % (Math.PI * 2)) /
						((Math.PI * 2) / SECTORS),
				) % SECTORS;
			reach[sector] = Math.max(reach[sector], radial(v));
		}
		// Every sector reaches the rim: no gap in the ring, so no phase at which the
		// spinning outline is shorter on one side.
		expect(Math.min(...reach) / Math.max(...reach)).toBeGreaterThan(0.97);
		let plates = 0;
		named(root, "rim-frame").traverse((node) => {
			if (node.name.startsWith("rim-frame-plate-")) plates++;
		});
		// Plated in places and open in the rest: at least three sections, and not
		// so many that the lattice is gone.
		expect(plates).toBeGreaterThanOrEqual(3);
		expect(plates).toBeLessThanOrEqual(12);
		expect(root.getObjectByName("rim-frame-members")).toBeDefined();
	});

	test("the dock is on the hub's front cap, ahead of both wheels", () => {
		const root = wheel();
		const hub = boxKm(named(root, "hub"));
		let bars = -Infinity;
		root.traverse((node) => {
			if (node.name === "aperture-light")
				bars = Math.max(bars, boxKm(node).max.z);
		});
		expect(bars).toBeGreaterThan(boxKm(named(root, "core")).max.z);
		expect(bars).toBeGreaterThan(boxKm(named(root, "rim-frame")).max.z);
		// On the cap, not in front of it: the bars straddle the hub's last station.
		expect(Math.abs(bars - hub.max.z)).toBeLessThan(0.03);
	});
});
