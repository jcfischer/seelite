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
import { drawnInteriorSpanKm } from "./helpers/aperture-opening";

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
	test("the shell or deck spans exactly the volume the sim declares", () => {
		for (const type of STATION_TYPES) {
			const interior = interiorOf(type);
			const pad = interior.presentation === "pad";
			// **The union of the five walls.** The shell was one closed box until
			// its sixth face turned out to be a lid across the mouth; it is four
			// walls and a back now, so what spans the volume is their union.
			//
			// **A pad draws four deck panels instead** (#165), and there is no
			// fifth: the hole they leave is the approach corridor, which is what
			// keeps a landing deck out of the volume a ship descends through.
			const parts = boxesNamed(
				built(type),
				(n) =>
					n === "interior-shell" ||
					n === "interior-shell-back" ||
					n === "interior-deck",
			);
			expect([type, parts.length]).toEqual([type, pad ? 4 : 5]);
			const shell = { box: new THREE.Box3() };
			for (const part of parts) shell.box.union(part.box);
			// Six decimals is a millimetre on a kilometre; the positions are
			// `Float32Array` by the time they are read back, so nine would be
			// asserting the storage format rather than the dimension.
			const [farKm, nearKm] = drawnInteriorSpanKm(interior);
			expect(shell.box.max.z).toBeCloseTo(nearKm, 6);
			expect(shell.box.min.z).toBeCloseTo(farKm, 6);
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

	test("a berth's drawn run lies along the nose the sim parks a ship on", () => {
		// **The row the reversed cross product got past** (#165, sage round 2).
		// `berthBasis` hands `buildBerth` a beam and it recovers the run as
		// `beam × outward`; built as `along × outward` that comes back
		// **`−along`**, because `(a × b) × b = −a`. Nothing measured it, and the
		// comment beside it claimed the opposite.
		//
		// The group's local +Z *is* the run (`makeBasis(beam, outward, along)`),
		// so this reads the drawn object's own third column.
		//
		// **Two strengths, and the weaker one is not a hedge.** Every berth's
		// run must lie *along* the parked nose — a run off that axis would put
		// the apron across the ship. The **sign** is asserted on pads only,
		// because a bay's four faces come from a hand-written table whose wall
		// entries mirror the run on purpose (`buildBerth`: *"a berth is
		// symmetric along the lane, so the mirror shows only in which end the
		// boom stands at"*), while a pad's basis is *derived* from
		// `parkedNose` — so there the sign is a fact about the derivation rather
		// than a convention, and it is the half that goes red if the cross
		// product is written the other way round.
		for (const type of STATION_TYPES) {
			const interior = interiorOf(type);
			const group = built(type);
			group.updateMatrixWorld(true);
			for (const berth of interior.berths) {
				const holder = group.getObjectByName(`berth-${berth.id}`);
				if (!holder) throw new Error(`no drawn ${berth.id} at ${type}`);
				const e = holder.matrixWorld.elements;
				const run = new THREE.Vector3(e[8], e[9], e[10]).normalize();
				const want = new THREE.Vector3(
					berth.parkedNose.across,
					berth.parkedNose.up,
					berth.parkedNose.axial,
				);
				const label = `${type} ${berth.id}`;
				const along = run.dot(want);
				expect([label, Math.abs(along)]).toEqual([label, expect.closeTo(1, 6)]);
				if (interior.presentation === "pad")
					expect([label, along]).toEqual([label, expect.closeTo(1, 6)]);
			}
		}
	});

	test("a berth's pad is drawn on the surface the sim parks a ship off", () => {
		// The seam that matters: the pad is where the sim says the surface is,
		// which is the berth's centre pushed back down its own normal by half the
		// clear height. A pad drawn anywhere else is a ship settling onto
		// nothing.
		//
		// **Written in the berth's own frame rather than per axis** (#165). It
		// used to name `z` as the along-the-lane axis and `x`/`y` as the lateral
		// pair, which is true of every wall in a bay and of no berth on a pad,
		// where the normal *is* the axial direction. Along the normal the plate
		// sits within a plate's thickness of the surface; off the normal it sits
		// on the berth's centre. One rule, four faces, two presentations.
		for (const type of STATION_TYPES) {
			const interior = interiorOf(type);
			const group = built(type);
			const plate =
				Math.min(interior.halfAcrossKm, interior.halfUpKm) * PLATE_FACTOR;
			for (const berth of interior.berths) {
				const holder = group.getObjectByName(`berth-${berth.id}`);
				if (!holder) throw new Error(`no drawn ${berth.id} at ${type}`);
				const [pad] = boxesNamed(holder, (n) => n === "berth-pad");
				const centre = pad.box.getCenter(new THREE.Vector3());
				const normal = new THREE.Vector3(
					berth.normal.across,
					berth.normal.up,
					berth.normal.axial,
				);
				const surface = new THREE.Vector3(
					berth.centre.across,
					berth.centre.up,
					berth.centre.axial,
				).addScaledVector(normal, -berth.clearHeightKm / 2);
				const offset = centre.clone().sub(surface);
				const alongNormal = offset.dot(normal);
				const offNormal = offset.addScaledVector(normal, -alongNormal).length();
				const label = `${type} ${berth.id}`;
				// Within a plate's thickness of the surface: the pad is a plate
				// sitting *on* the surface, not a plane in it.
				expect([label, Math.abs(alongNormal) <= plate]).toEqual([label, true]);
				expect([label, offNormal < 1e-6]).toEqual([label, true]);
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
	/** **The band's ends are ordered rather than named** (#165): a bay stages
	 *  inward of its mouth and a pad outward of its deck, so which of the two is
	 *  the larger `z` is the presentation's answer and not this rule's. */
	const inLane = (interior: ReturnType<typeof interiorOf>, box: THREE.Box3) =>
		box.min.z <
			Math.max(interior.mouthAxialKm, interior.stagingAxialKm) - 1e-9 &&
		box.max.z >
			Math.min(interior.mouthAxialKm, interior.stagingAxialKm) + 1e-9 &&
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
				"interior-shell-back",
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
