/**
 * `#396` §§3–4: who heard a civilian being shot at.
 *
 * **This module exists because H5 asked the wrong question.** H5 filed the
 * witness the flight assist had already chosen — the frame body — and so a
 * system with four berths produced one witness per offence, chosen by where the
 * *pilot* happened to be standing. These rows are the amendment: the reach is
 * the victim's transmission, its centre is the victim, and every station in the
 * system is asked.
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import {
	DISTRESS_RANGE_KM,
	type EarshotStation,
	hailText,
	stationsInEarshot,
} from "../src/distress";
import { NEAR_FAR_KM } from "../src/units";
import { type Vec3, v3 } from "../src/vec3";

/** A station at `km` along +x, which is all a straight-line measure can see. */
const station = (
	name: string,
	km: number,
	axis: Vec3 = v3(1, 0, 0),
): EarshotStation => ({
	key: carrierKey(3, name),
	pos: v3(axis.x * km, axis.y * km, axis.z * km),
});

describe("H5's reach, amended (#396)", () => {
	test("is three times the frame body's reach, and is its own dial", () => {
		// Not `NEAR_FAR_KM`, because at that figure the amendment picks the same
		// witness the old rule did and reads as a change while being one nobody
		// can observe; and not a system-wide radius, because that turns H5's
		// per-station judgement into a per-system one.
		expect(DISTRESS_RANGE_KM).toBe(3 * NEAR_FAR_KM);
		expect(DISTRESS_RANGE_KM).toBeGreaterThan(NEAR_FAR_KM);
	});

	test("a station just inside the reach hears and one beyond it does not", () => {
		const inside = station("station-inside", DISTRESS_RANGE_KM - 1);
		const outside = station("station-outside", DISTRESS_RANGE_KM + 1);
		expect(stationsInEarshot([inside, outside], v3())).toEqual([
			carrierKey(3, "station-inside"),
		]);
	});

	test("a berth past the frame body's reach but inside earshot is filed", () => {
		// **The row the amendment is for.** Under H5 as written this station heard
		// nothing at all, because it was too far away to be the body the ship was
		// standing next to — and a pilot could shoot a carrier down in a berth's
		// visual range and be unknown to it.
		const far = station("station-far", NEAR_FAR_KM * 2.5);
		expect(stationsInEarshot([far], v3())).toEqual([
			carrierKey(3, "station-far"),
		]);
	});

	test("the measure is the victim's, not the shooter's", () => {
		// Two berths at either end of the line: the pilot is beside one and the
		// carrier is beside the other, and only the carrier's position decides who
		// is filed. A reach measured from the player is H5 again with a longer
		// constant pasted in front of it.
		const victim = v3(0, 0, -2 * DISTRESS_RANGE_KM);
		const besideTheVictim: EarshotStation = {
			key: carrierKey(3, "station-beside"),
			pos: v3(0, 0, -2 * DISTRESS_RANGE_KM + 50),
		};
		const besideTheShooter = station("station-shooter", 0);
		expect(
			stationsInEarshot([besideTheVictim, besideTheShooter], victim),
		).toEqual([carrierKey(3, "station-beside")]);
		// And the same two berths with the fight moved to the shooter's end of
		// the system: the answer follows the victim and swaps.
		expect(
			stationsInEarshot([besideTheVictim, besideTheShooter], v3()),
		).toEqual([carrierKey(3, "station-shooter")]);
	});

	test("every station in earshot is filed, not the nearest one", () => {
		// H5's whole point is that a berth's hostility is its own judgement, and
		// a rule that files one witness per offence cannot express a crowd.
		const ring = [
			station("station-a", 100),
			station("station-b", 100, v3(0, 1, 0)),
			station("station-c", 100, v3(0, 0, 1)),
			station("station-d", DISTRESS_RANGE_KM * 4),
		];
		expect(stationsInEarshot(ring, v3())).toEqual([
			carrierKey(3, "station-a"),
			carrierKey(3, "station-b"),
			carrierKey(3, "station-c"),
		]);
	});

	test("an empty list is what nothing-heard returns, and it is not undefined", () => {
		// The distinction the caller depends on: `[]` is a computed answer, and
		// `withOffence` takes the list as a required argument so that a caller
		// which never computed one cannot arrive at the same place.
		const none = stationsInEarshot([], v3());
		expect(none).toEqual([]);
		expect(stationsInEarshot([station("station-far", 1e6)], v3())).toEqual([]);
	});

	test("the keys come back in the order the stations were asked", () => {
		// The caller hands this a set built from the system's bodies, which is
		// already distinct, and `world-state.ts` refuses a duplicate at the write
		// — so the only thing owed here is to not rearrange what it was given.
		// Canonical order is the *writer's* job, and a module that sorted here
		// would be a second, different copy of that rule.
		const a = station("station-a", 100);
		const b = station("station-b", 100, v3(0, 1, 0));
		expect(stationsInEarshot([b, a], v3())).toEqual([b.key, a.key]);
		expect(stationsInEarshot([a, b], v3())).toEqual([a.key, b.key]);
	});
});

describe("the hail's own words", () => {
	test("names the speaker, because the rail has to say who is transmitting", () => {
		expect(hailText("LETHARGY ONE")).toContain("LETHARGY ONE");
	});

	test("says cease fire and does not say what the pilot has been charged with", () => {
		// The hail is drawn on the first landed hit; the clock that convicts is
		// still running. A victim that announces a charge which has not been made
		// tells the pilot the wrong thing on the one surface that is honest about
		// the moment.
		const said = hailText("LETHARGY ONE").toLowerCase();
		expect(said).toContain("cease fire");
		for (const word of ["offence", "wanted", "assault", "charged"])
			expect(said).not.toContain(word);
	});
});
