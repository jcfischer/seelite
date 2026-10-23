/**
 * Every vent's line of action goes through its hull's metal (#636,
 * `flight-model.md` §3.2.1).
 *
 * The table used to put every vent on its envelope's box, and no attitude
 * vent's line of action met metal on any hull. A placement now moves each
 * pair only in the directions that keep it pure, and shortens an attitude
 * arm only as far as metal asks; the shares are re-solved against the arm the
 * table actually has, so no hull's handling moved (`tests/vents.test.ts`).
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	HULL_IDS,
	HULL_SPECS,
	type CoupleArms,
	type HullId,
	type VentSlot,
	coupleArms,
} from "../src/hull";
import { buildShipMesh } from "../src/ship-mesh";
import { ventLoads } from "../src/sim";
import { length } from "../src/vec3";
import { ventThroats } from "../src/vent-plumes";
import { measureVentPlacement } from "../scripts/measure-vent-placement";

const built = new Map<HullId, THREE.Group>();
const rootOf = (id: HullId) => {
	let root = built.get(id);
	if (!root) {
		root = buildShipMesh(id, HULL_SPECS[id].variant).root;
		built.set(id, root);
	}
	return root;
};

const loadsOf = (id: HullId, slots: readonly VentSlot[]) =>
	ventLoads(
		Object.fromEntries(slots.map((slot) => [slot, 1])),
		HULL_SPECS[id].vents,
		HULL_SPECS[id].thrustMN,
		{},
	);

describe("§3.2.1 every line of action meets metal", () => {
	test("no throat is drawn at a closest approach, on any hull", () => {
		for (const id of HULL_IDS) {
			const missed = ventThroats(rootOf(id), id)
				.filter((t) => t.placed === "line" && t.gapKm > 0)
				.map((t) => `${t.slot} ${(t.gapKm * 1000).toFixed(1)} m`);
			expect({ id, missed }).toEqual({ id, missed: [] });
		}
	}, 60_000);

	test("the stored placement is the one the mesh gives", () => {
		for (const id of HULL_IDS)
			expect({ id, placement: HULL_SPECS[id].ventPlacement }).toEqual({
				id,
				placement: measureVentPlacement(id, rootOf(id)),
			});
	}, 60_000);
});

describe("§3.2 every pair stays pure on every hull, wherever it was moved", () => {
	// Every pair the table has, both senses of every couple: the purity of the
	// ones not listed would otherwise rest on a symmetry nothing pins.
	const FORCES: [string, VentSlot[]][] = [
		["the port strafe pair", ["strafe-fore-port", "strafe-aft-port"]],
		[
			"the starboard strafe pair",
			["strafe-fore-starboard", "strafe-aft-starboard"],
		],
		["the dorsal strafe pair", ["strafe-fore-dorsal", "strafe-aft-dorsal"]],
		["the ventral strafe pair", ["strafe-fore-ventral", "strafe-aft-ventral"]],
		["the retro pair", ["retro-port", "retro-starboard"]],
	];
	const COUPLES: [keyof CoupleArms, VentSlot[]][] = [
		["yaw", ["fore-starboard-lateral", "aft-port-lateral"]],
		["yaw", ["fore-port-lateral", "aft-starboard-lateral"]],
		["pitch", ["fore-ventral-vertical", "aft-dorsal-vertical"]],
		["pitch", ["fore-dorsal-vertical", "aft-ventral-vertical"]],
		["roll", ["port-dorsal-roll", "starboard-ventral-roll"]],
		["roll", ["port-ventral-roll", "starboard-dorsal-roll"]],
	];
	const AXIS = { pitch: "x", yaw: "y", roll: "z" } as const;

	test("a pair fired the same way is force and no torque", () => {
		for (const id of HULL_IDS)
			for (const [name, slots] of FORCES) {
				const { force, torque } = loadsOf(id, slots);
				const reach = HULL_SPECS[id].env.lengthKm;
				expect({
					id,
					name,
					torque: length(torque) / (length(force) * reach),
				}).toEqual({ id, name, torque: expect.closeTo(0, 12) });
			}
	});

	test("a couple is torque on its own axis, no force, and its arm is the solver's", () => {
		for (const id of HULL_IDS) {
			const spec = HULL_SPECS[id];
			const arms = coupleArms(spec.env, spec.ventPlacement);
			for (const [axis, slots] of COUPLES) {
				const { force, torque } = loadsOf(id, slots);
				const own = Math.abs(torque[AXIS[axis]]);
				const unit = spec.ventShares[axis] * spec.thrustMN;
				expect({ id, axis, force: length(force) / unit }).toEqual({
					id,
					axis,
					force: expect.closeTo(0, 12),
				});
				expect({ id, axis, cross: length(torque) / own - 1 }).toEqual({
					id,
					axis,
					cross: expect.closeTo(0, 12),
				});
				expect({ id, axis, arm: own / unit }).toEqual({
					id,
					axis,
					arm: expect.closeTo(arms[axis], 12),
				});
			}
		}
	});
});
