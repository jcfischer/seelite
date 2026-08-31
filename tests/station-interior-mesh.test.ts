/**
 * The drawn bay against the catalogue that decides it (`docs/specs/docking.md`
 * §13.1 and §13.4).
 *
 * **This file exists because a docstring claimed it did.** `buildRoleFittings`
 * said its fittings "never enter the transit lane, which
 * `tests/station-interior-mesh.test.ts` asserts rather than trusts" while no
 * such file existed — a reader told an invariant was guarded when nothing
 * checked it. Sage's HonestOracle lens caught it on the first round.
 *
 * What belongs here is the seam between the two modules: the mesh authors no
 * dimension of its own, so every row below reads a figure off
 * `station-interior.ts` and asks whether the drawn object matches it. Whether
 * the bay *reads* as a room is the canonical view set's question and a
 * person's answer.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { STATION_GEOMETRY, STATION_TYPES } from "../src/station";
import { stationInterior } from "../src/station-interior";
import {
	INTERIOR_GROUP_NAME,
	NAMEPLATE_NAME,
	PLATE_FACTOR,
	buildStationInterior,
} from "../src/station-interior-mesh";

const interiorOf = (type: (typeof STATION_TYPES)[number]) =>
	stationInterior(type, STATION_GEOMETRY[type].aperturePlaneKm);

const built = (type: (typeof STATION_TYPES)[number]) => {
	const group = buildStationInterior(type, interiorOf(type));
	group.updateMatrixWorld(true);
	return group;
};

/** Every mesh under one name, with its world-space box. */
function boxesNamed(root: THREE.Object3D, match: (name: string) => boolean) {
	const found: { name: string; box: THREE.Box3 }[] = [];
	root.traverse((o) => {
		if (!(o as THREE.Mesh).isMesh || !match(o.name)) return;
		found.push({ name: o.name, box: new THREE.Box3().setFromObject(o) });
	});
	return found;
}

describe("the bay is the catalogue, drawn", () => {
	test("the shell spans exactly the volume the sim declares", () => {
		for (const type of STATION_TYPES) {
			const interior = interiorOf(type);
			const [shell] = boxesNamed(built(type), (n) => n === "interior-shell");
			expect([type, shell !== undefined]).toEqual([type, true]);
			// Six decimals is a millimetre on a kilometre; the positions are
			// `Float32Array` by the time they are read back, so nine would be
			// asserting the storage format rather than the dimension.
			expect(shell.box.max.z).toBeCloseTo(interior.mouthAxialKm, 6);
			expect(shell.box.min.z).toBeCloseTo(interior.endAxialKm, 6);
			expect(shell.box.max.x).toBeCloseTo(interior.halfAcrossKm, 6);
			expect(shell.box.max.y).toBeCloseTo(interior.halfUpKm, 6);
		}
	});

	test("every berth in the catalogue has its own drawn group", () => {
		for (const type of STATION_TYPES) {
			const group = built(type);
			for (const berth of interiorOf(type).berths)
				expect([
					type,
					berth.id,
					!!group.getObjectByName(`berth-${berth.id}`),
				]).toEqual([type, berth.id, true]);
		}
	});

	test("a berth's pad is drawn on the surface the sim parks a ship off", () => {
		// The seam that matters: the pad is where the sim says the wall is, which
		// is the berth's centre pushed back down its own normal by half the clear
		// height. A pad drawn anywhere else is a ship settling onto nothing.
		for (const type of STATION_TYPES) {
			const group = built(type);
			for (const berth of interiorOf(type).berths) {
				const holder = group.getObjectByName(`berth-${berth.id}`);
				if (!holder) throw new Error(`no drawn ${berth.id} at ${type}`);
				const [pad] = boxesNamed(holder, (n) => n === "berth-pad");
				const centre = pad.box.getCenter(new THREE.Vector3());
				const surface = {
					across:
						berth.centre.across -
						(berth.normal.across * berth.clearHeightKm) / 2,
					up: berth.centre.up - (berth.normal.up * berth.clearHeightKm) / 2,
				};
				const label = `${type} ${berth.id}`;
				expect([label, Math.abs(centre.z - berth.centre.axial) < 1e-6]).toEqual(
					[label, true],
				);
				// Within a plate's thickness of the surface, on both lateral axes:
				// the pad is a plate sitting *on* the wall, not a plane in it.
				const plate =
					Math.min(interiorOf(type).halfAcrossKm, interiorOf(type).halfUpKm) *
					0.06;
				expect([label, Math.abs(centre.x - surface.across) <= plate]).toEqual([
					label,
					true,
				]);
				expect([label, Math.abs(centre.y - surface.up) <= plate]).toEqual([
					label,
					true,
				]);
			}
		}
	});
});

describe("§13.1 — the transit lane is clear of everything drawn", () => {
	/**
	 * **The claim `buildRoleFittings`'s docstring makes.** Role fittings hang off
	 * the walls behind the berth line; a gantry or a pipe reaching into the lane
	 * is geometry the scripted traversal flies straight through, which is the one
	 * thing §13.1 says the lane is for.
	 *
	 * The mouth bulkhead and the lane-edge strips are not scanned at all, and
	 * that is by construction rather than by an exclusion list: they hang off
	 * the bay's own group, not off `interior-fittings` or a berth's, and they
	 * are the wall the lane is a *hole* in and the lit rim of that hole.
	 */
	/**
	 * Does this box occupy the lane?
	 *
	 * **The lane is a corridor, not a column.** §13.1 runs it "from the open
	 * mouth to a staging point", so it is bounded axially as well as laterally —
	 * the trade station's cargo marking sits on the deck line of the *back*
	 * bulkhead, a bay's depth behind the staging point, and a column rule called
	 * it an intrusion. Everything past the staging point is where the berths
	 * are, and a fitting there is beside them rather than in the way.
	 */
	const inLane = (interior: ReturnType<typeof interiorOf>, box: THREE.Box3) =>
		box.min.z < interior.mouthAxialKm - 1e-9 &&
		box.max.z > interior.stagingAxialKm + 1e-9 &&
		box.min.x < interior.laneHalfAcrossKm - 1e-9 &&
		box.max.x > -interior.laneHalfAcrossKm + 1e-9 &&
		box.min.y < interior.laneHalfUpKm - 1e-9 &&
		box.max.y > -interior.laneHalfUpKm + 1e-9;

	test("no role fitting reaches into the lane", () => {
		for (const type of STATION_TYPES) {
			const interior = interiorOf(type);
			const group = built(type);
			const fittings = group.getObjectByName("interior-fittings");
			if (!fittings) throw new Error(`no fittings group at ${type}`);
			for (const part of boxesNamed(fittings, () => true)) {
				expect([type, part.name, inLane(interior, part.box)]).toEqual([
					type,
					part.name,
					false,
				]);
			}
		}
	});

	test("nor does any berth's own furniture", () => {
		for (const type of STATION_TYPES) {
			const interior = interiorOf(type);
			const group = built(type);
			for (const berth of interior.berths) {
				const holder = group.getObjectByName(`berth-${berth.id}`);
				if (!holder) throw new Error(`no drawn ${berth.id} at ${type}`);
				for (const part of boxesNamed(holder, () => true)) {
					const label = `${type} ${berth.id} ${part.name}`;
					expect([label, inLane(interior, part.box)]).toEqual([label, false]);
				}
			}
		}
	});

	test("the check can fail — a part moved onto the axis is caught", () => {
		// **The control**, because a lane-clearance rule that nothing has ever
		// been seen to break is a rule nobody knows is running. `interiorOf`'s
		// own parts all sit outside the lane by construction, so the red case has
		// to be built rather than found.
		const interior = interiorOf("trade");
		const group = built("trade");
		const fittings = group.getObjectByName("interior-fittings");
		if (!fittings) throw new Error("no fittings group");
		const intruder = new THREE.Mesh(
			new THREE.BoxGeometry(0.01, 0.01, 0.01),
			new THREE.MeshBasicMaterial(),
		);
		intruder.name = "interior-intruder";
		fittings.add(intruder);
		// On the axis, half way between the mouth and the staging point.
		intruder.position.set(
			0,
			0,
			(interior.mouthAxialKm + interior.stagingAxialKm) / 2,
		);
		group.updateMatrixWorld(true);
		const [part] = boxesNamed(fittings, (n) => n === "interior-intruder");
		expect(inLane(interior, part.box)).toBe(true);
	});
});

describe("§13.1 — what the bay must and must not carry", () => {
	test("every bay carries the name shield, and it supplies no pixels", () => {
		// E10: this module is headless-tested and contains no `document`
		// reference, so the plate leaves it untextured and invisible and the
		// renderer lights it.
		for (const type of STATION_TYPES) {
			const plates = boxesNamed(built(type), (n) => n === NAMEPLATE_NAME);
			expect([type, plates.length]).toEqual([type, 1]);
		}
		const group = built("trade");
		let checked = 0;
		group.traverse((o) => {
			if (o.name !== NAMEPLATE_NAME) return;
			const material = (o as THREE.Mesh).material as THREE.MeshBasicMaterial;
			expect(material.map).toBe(null);
			expect(material.opacity).toBe(0);
			checked++;
		});
		expect(checked).toBe(1);
	});

	test("no bay carries a door", () => {
		// §13.1: the interior is unpressurized, and #138's docked gate is what
		// this replaces. Asserted here as well as over the whole station in
		// `tests/station-mesh.test.ts`, because this is the module that would
		// grow one.
		for (const type of STATION_TYPES) {
			const names: string[] = [];
			built(type).traverse((o) => {
				if (/gate|door|curtain/i.test(o.name)) names.push(o.name);
			});
			expect([type, names]).toEqual([type, []]);
		}
	});

	test("the group is the one the renderer and the probes look up", () => {
		for (const type of STATION_TYPES)
			expect([type, built(type).name]).toEqual([type, INTERIOR_GROUP_NAME]);
	});

	test("the furniture is tagged for the detail switch and the room is not", () => {
		// **Fifty-odd meshes, and none of them was tagged.** `setStationDetail`
		// culls on `userData.minDetail` alone, so an untagged bay is submitted in
		// full at every range behind a hull nothing can see it through. The shell,
		// the bulkhead, the lit rim and the shield stay unconditional: they are the
		// room rather than what is in it, and the mouth reads as an opening at
		// range only if what is behind it is drawn.
		for (const type of STATION_TYPES) {
			const group = built(type);
			for (const berth of interiorOf(type).berths) {
				const holder = group.getObjectByName(`berth-${berth.id}`);
				expect([type, berth.id, holder?.userData.minDetail]).toEqual([
					type,
					berth.id,
					"full",
				]);
			}
			expect([
				type,
				group.getObjectByName("interior-fittings")?.userData.minDetail,
			]).toEqual([type, "full"]);
			for (const name of [
				"interior-shell",
				"interior-bulkhead",
				"interior-lane-edge",
				NAMEPLATE_NAME,
			]) {
				const part = group.getObjectByName(name);
				expect([type, name, part?.userData.minDetail]).toEqual([
					type,
					name,
					undefined,
				]);
			}
		}
	});
});
