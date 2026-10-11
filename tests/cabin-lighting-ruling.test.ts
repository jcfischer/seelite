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
	CABIN_LOW_QUALITY_HEMISPHERE_GAIN,
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
		// **The branch, not the figures.** Sage's third round on #898 caught that a row
		// holding 0.7 and 3.425 stays green even if the function ignores its argument or
		// every layer starts counting as the cabin — which is the failure the exception
		// exists to avoid, since moving the hull layers' ambient moves the
		// `HULL_LUMA_CALIBRATION` subject this ruling is careful not to touch.
		expect(hemisphereIntensityFor(true, "high")).toBeCloseTo(3.425 * 0.7, 12);
		expect(hemisphereIntensityFor(false, "high")).toBe(3.425);
	});

	test("on low the cabin takes its own figure, and no other layer moves (node #912)", () => {
		// Low turns off the six perimeter lamps the 0.7 was tuned against, so on low the
		// cut only removes light. The low figure is at least the full rig — the cabin
		// before #898, which the principal already read as too dark — and above high's.
		expect(CABIN_LOW_QUALITY_HEMISPHERE_GAIN).toBeGreaterThanOrEqual(1);
		expect(CABIN_LOW_QUALITY_HEMISPHERE_GAIN).toBeGreaterThan(
			CABIN_HEMISPHERE_GAIN,
		);
		expect(hemisphereIntensityFor(true, "low")).toBeCloseTo(
			3.425 * CABIN_LOW_QUALITY_HEMISPHERE_GAIN,
			12,
		);
		// The hull layers keep the rig's figure on both settings, for the same
		// `HULL_LUMA_CALIBRATION` reason as the row above.
		expect(hemisphereIntensityFor(false, "low")).toBe(3.425);
	});

	test("a quality change reaches every layer's hemisphere, live", () => {
		// Built with the figure and re-applied by `applyQuality`: a figure set only at
		// build time would leave a pilot who switches to low mid-flight in the dark
		// cabin until a reload.
		const game = readFileSync("src/main.ts", "utf8");
		const applyQuality = game.slice(
			game.indexOf("private applyQuality() {"),
			game.indexOf("\n\t}\n", game.indexOf("private applyQuality() {")),
		);
		expect(applyQuality).toContain(
			"rig.hemisphere.intensity = hemisphereIntensityFor(",
		);
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
		expect(game).toContain(
			"hemisphereIntensityFor(cabinScene, this.settings.value.quality)",
		);
	});
});
