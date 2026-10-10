/**
 * The flown mass (#865): what a ship carries weighs something, and #181's law
 * turns the weight into handling.
 *
 * The principal's rulings on #865 (2026-10-10): cargo is the live mass, every
 * module weighs 0 t until the pricing instrument (#868) measures it, the
 * assist's demands scale with the authority the mass leaves, and `massT` stays
 * the empty hull, so a full hold costs the courier a quarter of its thrust.
 */

import { describe, expect, test } from "bun:test";
import { HULL_IDS, HULL_SPECS, PLAYER_BASELINE_HULL } from "../src/hull";
import { EQUIPMENT } from "../src/market";
import { flightPerformance, speedDemand, stepHull } from "../src/sim";
import {
	type CommanderState,
	flownMassT,
	newCommander,
} from "../src/station-commerce";
import { v3 } from "../src/vec3";

describe("flightPerformance at a flown mass", () => {
	test("at the hull's own mass it is today's struct, on every hull", () => {
		for (const id of HULL_IDS)
			expect(flightPerformance(id, {}, HULL_SPECS[id].massT)).toEqual(
				flightPerformance(id),
			);
	});

	test("a heavier ship has less authority on every axis, by the mass ratio", () => {
		for (const id of HULL_IDS) {
			const hullT = HULL_SPECS[id].massT;
			const empty = flightPerformance(id);
			const laden = flightPerformance(id, {}, hullT + HULL_SPECS[id].holdT);
			const k = hullT / (hullT + HULL_SPECS[id].holdT);
			expect(laden.massT).toBe(hullT + HULL_SPECS[id].holdT);
			expect(laden.thrustKms2).toBeCloseTo(empty.thrustKms2 * k, 12);
			expect(laden.retroKms2).toBeCloseTo(empty.retroKms2 * k, 12);
			expect(laden.strafeKms2).toBeCloseTo(empty.strafeKms2 * k, 12);
			for (const axis of ["pitch", "yaw", "roll"] as const) {
				expect(laden.angularAuthority[axis]).toBeCloseTo(
					empty.angularAuthority[axis] * k,
					12,
				);
				expect(laden.inertia[axis]).toBeCloseTo(empty.inertia[axis] / k, 6);
			}
			// The ruling: the assist's demands scale with the authority too.
			expect(laden.angularMax.yaw).toBeCloseTo(empty.angularMax.yaw * k, 12);
			expect(laden.assistLateralTauS).toBeCloseTo(
				empty.assistLateralTauS / k,
				12,
			);
			expect(laden.angularDampTauS).toBeCloseTo(empty.angularDampTauS / k, 12);
			// The drive is the hull's: thrust does not move.
			expect(laden.thrustMN).toBe(empty.thrustMN);
		}
	});

	test("a full hold costs the courier a quarter of its thrust", () => {
		const id = PLAYER_BASELINE_HULL;
		const full = flightPerformance(id, {}, 60 + 20);
		expect(full.thrustKms2 / flightPerformance(id).thrustKms2).toBeCloseTo(
			0.75,
			12,
		);
	});

	test("the stepper flies the laden mass: the same burn gains less speed", () => {
		const burn = (massT: number) => {
			const perf = flightPerformance(PLAYER_BASELINE_HULL, {}, massT);
			const ship = { pos: v3(), vel: v3() };
			const still = { pitch: 0, yaw: 0, roll: 0 };
			let attitude = { nose: v3(0, 0, -1), up: v3(0, 1, 0), rates: still };
			for (let i = 0; i < 10; i++)
				attitude = stepHull(
					ship,
					attitude,
					{
						stick: still,
						turnAssist: true,
						translation: { demand: speedDemand(1), assist: false },
					},
					0.05,
					perf,
				);
			return -ship.vel.z;
		};
		const hullT = HULL_SPECS[PLAYER_BASELINE_HULL].massT;
		expect(burn(hullT + 20)).toBeLessThan(burn(hullT));
		expect(burn(hullT + 20) / burn(hullT)).toBeCloseTo(0.75, 9);
	});

	test("a mass below the hull's, or not a number, is refused", () => {
		const hullT = HULL_SPECS[PLAYER_BASELINE_HULL].massT;
		expect(() =>
			flightPerformance(PLAYER_BASELINE_HULL, {}, hullT - 1),
		).toThrow(/below/);
		expect(() =>
			flightPerformance(PLAYER_BASELINE_HULL, {}, Number.NaN),
		).toThrow();
	});
});

describe("flownMassT", () => {
	const courier = (patch: Partial<CommanderState> = {}): CommanderState => ({
		...newCommander("courier"),
		...patch,
	});

	test("an empty ship weighs its hull", () => {
		for (const id of HULL_IDS)
			expect(flownMassT(id, newCommander(id), 0)).toBe(HULL_SPECS[id].massT);
	});

	test("tonne cargo, recovered fittings and entrusted lots each add their tonnes", () => {
		expect(flownMassT("courier", courier({ cargo: { Food: 12 } }), 0)).toBe(72);
		expect(
			flownMassT(
				"courier",
				courier({ recoveredFittings: [{ id: "E.C.M. System", tonnes: 1 }] }),
				0,
			),
		).toBe(61);
		expect(flownMassT("courier", courier(), 3)).toBe(63);
	});

	test("kilogram and gram goods weigh what they are, though they take no hold", () => {
		expect(
			flownMassT("courier", courier({ cargo: { Gold: 500 } }), 0),
		).toBeCloseTo(60.5, 12);
		expect(
			flownMassT("courier", courier({ cargo: { "Gem-Stones": 2000 } }), 0),
		).toBeCloseTo(60.002, 12);
	});

	test("the flown hull is the one named, not the commander's", () => {
		// A hull bought where no berth fits waits for launch (#556 D10): the
		// commander owns it and the ship in the berth is still the old one.
		expect(flownMassT("courier", newCommander("freighter"), 0)).toBe(60);
	});

	test("every module weighs 0 t until #868 measures it", () => {
		for (const item of EQUIPMENT) expect(item.massT).toBe(0);
		const kitted = courier({ ownedEquipment: EQUIPMENT.map((e) => e.name) });
		expect(flownMassT("courier", kitted, 0)).toBe(60);
	});

	test("a negative entrusted figure is refused", () => {
		expect(() => flownMassT("courier", courier(), -1)).toThrow();
	});
});
