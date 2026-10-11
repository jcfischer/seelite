import { describe, expect, test } from "bun:test";
import {
	COCKPIT_MODEL_LAMP_GAIN,
	COCKPIT_MODEL_LAMPS,
	carriedLamp,
} from "../src/cockpit-model";
import { INTERIOR_FLOOD_INTENSITY } from "../src/interior-kit";
import { CABIN_HEMISPHERE_GAIN, LIGHT_RIG } from "../src/light-rig";

/**
 * The three figures the principal set on the live brightness panel in the docked cabin
 * (node #887), held here so a shipped look cannot quietly drift back to whatever a
 * sweep happened to produce.
 *
 * The panel drove these same lights and measured the frame back; the numbers below are
 * what it and the follow-up probe read. What is *not* asserted is any absolute level:
 * the complaint these answer ("the cockpit is too dark", "the lights are too bright in
 * the docked station") is a judgement about a picture, and the picture is signed off by
 * looking at it, not by a row in a test.
 */
describe("the docked cabin's lighting ruling", () => {
	test("the cabin takes 0.7 of the rig's hemisphere and every other layer keeps 1", () => {
		// The cabin shares the far/approach/near rig by #651's decision, so the whole
		// point of this row is that the exception is the cabin and nothing else: the
		// hull's look, and `HULL_LUMA_CALIBRATION` recorded against it, were judged at
		// the full figure and must stay there.
		expect(CABIN_HEMISPHERE_GAIN).toBe(0.7);
		expect(CABIN_HEMISPHERE_GAIN).toBeLessThan(1);
		expect(LIGHT_RIG.hemisphere.intensity).toBe(3.425);
	});

	test("the authored interior's floods are a fifth of what the kit shipped with", () => {
		// 50,000 cd was the kit's authored figure; the principal dialed the same lights
		// to 0.2× in the docked cabin and left them there.
		expect(INTERIOR_FLOOD_INTENSITY).toBe(10_000);
		expect(INTERIOR_FLOOD_INTENSITY).toBe(50_000 * 0.2);
	});

	test("the console lamps read 2.8× the spike struck them", () => {
		expect(COCKPIT_MODEL_LAMP_GAIN).toBe(2.8);
		// The gain belongs to the game's reading of the lamps, not to the study's
		// authored figures — those stay in `COCKPIT_MODEL_LAMPS` as the model has them.
		expect(COCKPIT_MODEL_LAMP_GAIN).toBeGreaterThan(1);
	});

	test("the gain commutes with the carry into the cabin", () => {
		// `main.ts` multiplies each authored figure by the gain on its way *into*
		// `carriedLamp`. That is equivalent to raising the cabin's figure afterwards,
		// because the carry scales intensity by k^decay and is linear in it — and it is
		// equivalence worth asserting, because the two readings are easy to confuse and
		// a gain moved to the wrong side of a non-linear step would change the picture.
		const lamp = COCKPIT_MODEL_LAMPS.find(
			(entry) => entry.name === "cockpit-light",
		)!;
		const carriedAuthored = carriedLamp(lamp).intensity;
		const gainedThenCarried = carriedLamp({
			...lamp,
			intensity: lamp.intensity * COCKPIT_MODEL_LAMP_GAIN,
		} as (typeof COCKPIT_MODEL_LAMPS)[number]).intensity;
		expect(gainedThenCarried).toBeCloseTo(
			carriedAuthored * COCKPIT_MODEL_LAMP_GAIN,
			12,
		);
	});
});
