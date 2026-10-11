import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	COCKPIT_MODEL_LAMP_GAIN,
	COCKPIT_MODEL_LAMPS,
	carriedConsoleLamp,
	carriedLamp,
} from "../src/cockpit-model";
import { INTERIOR_FLOOD_INTENSITY } from "../src/interior-kit";
import {
	CABIN_HEMISPHERE_GAIN,
	hemisphereIntensityFor,
	LIGHT_RIG,
} from "../src/light-rig";

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

	test("the composed carry commutes, and the game reaches for it", () => {
		// Two halves, because Sage caught this claim once already: an assertion about
		// the composition alone stays green when `main.ts` never calls it, and a claim
		// that the game calls it stays green when the composition is wrong.
		const lamp = COCKPIT_MODEL_LAMPS.find(
			(entry) => entry.name === "cockpit-light",
		)!;
		expect(carriedConsoleLamp(lamp).intensity).toBeCloseTo(
			carriedLamp(lamp).intensity * COCKPIT_MODEL_LAMP_GAIN,
			12,
		);
		const game = readFileSync("src/main.ts", "utf8");
		expect(game).toContain("carriedConsoleLamp(lamp)");
		expect(game).toContain("hemisphereIntensityFor(cabinScene)");
	});
});
