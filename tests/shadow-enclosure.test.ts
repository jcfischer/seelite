/**
 * Node #723: the arms of `scripts/measure-shadow-enclosure.mjs`, and the
 * readback rule that refuses a row whose two frames were drawn under different
 * lights.
 *
 * The instrument is headed and cannot run here. What can is the part that
 * decides what each arm *is*, and the check its page readback goes through —
 * which is where #363's scaled-sun arm went wrong: its baseline was drawn at
 * the shipped sun and its shadow frame at ten times it, and nothing compared
 * the two.
 */
import { describe, expect, test } from "bun:test";
import {
	BASELINE_OCCLUSION,
	bisectHemisphere,
	enclosureArms,
	EXPOSURE_RULE,
	LAYER_SCENES,
	LIT_SIDE_MIN_GAIN,
	lightsHeldProblems,
	litSide,
	medianOf,
	medianWhere,
	REBALANCE_SUNS,
	resolveOcclusion,
	SUN_SCALE,
} from "../scripts/lib/shadow-enclosure.mjs";

const SHIPPED = { sun: 0.2, hemisphere: 6.85 };
const REBALANCES = [
	{ sun: 0.5, hemisphere: 6.1 },
	{ sun: 1, hemisphere: 4.9 },
	{ sun: 2, hemisphere: 2.6 },
];
const arms = enclosureArms({ shipped: SHIPPED, rebalances: REBALANCES });
const arm = (name: string) => {
	const found = arms.find((a) => a.name === name);
	if (!found) throw new Error(`no arm named ${name}`);
	return found;
};

/** Every layer scene at one pair of intensities, as the page reads it back. */
const everyScene = (lights: { sun: number; hemisphere: number }) =>
	LAYER_SCENES.map((scene) => ({ scene, ...lights }));

describe("the arms", () => {
	test("every arm is differenced against the same baseline: no shadow, no AO", () => {
		expect(BASELINE_OCCLUSION).toEqual({ shadows: false, ao: false });
	});

	test("names are unique and the named comparisons exist", () => {
		const names = arms.map((a) => a.name);
		expect(new Set(names).size).toBe(names.length);
		for (const name of [
			"shipped",
			"gate-blind",
			"shadow only",
			"AO only",
			"scaled sun",
			"control",
		])
			expect(names).toContain(name);
	});

	test("gate-blind draws the AO the shipped frame drew, so the two differ by the gate alone", () => {
		// Defect 2: `setOcclusion(true, false)` against `setOcclusion()` differed
		// by AO as well as by the gate wherever the gate was open.
		for (const aoShipped of [true, false])
			expect(resolveOcclusion(arm("gate-blind").occlusion, aoShipped)).toEqual({
				shadows: true,
				ao: aoShipped,
			});
		expect(arm("gate-blind").lights).toEqual(arm("shipped").lights);
	});

	test("shipped and control leave the gate live; every other arm pins it", () => {
		expect(resolveOcclusion(arm("shipped").occlusion, true)).toBe("gate");
		expect(resolveOcclusion(arm("control").occlusion, true)).toBe("gate");
		for (const a of arms)
			if (a.name !== "shipped" && a.name !== "control")
				expect(resolveOcclusion(a.occlusion, true)).not.toBe("gate");
	});

	test("shadow only and AO only each differ from the baseline by one term", () => {
		expect(resolveOcclusion(arm("shadow only").occlusion, true)).toEqual({
			shadows: true,
			ao: false,
		});
		expect(resolveOcclusion(arm("AO only").occlusion, true)).toEqual({
			shadows: false,
			ao: true,
		});
	});

	test("the light arms differ from shadow only by their lights alone", () => {
		const shadowOnly = resolveOcclusion(arm("shadow only").occlusion, true);
		const lightArms = arms.filter(
			(a) => a.name === "scaled sun" || a.name.startsWith("rebalance"),
		);
		expect(lightArms).toHaveLength(1 + REBALANCES.length);
		for (const a of lightArms)
			expect(resolveOcclusion(a.occlusion, true)).toEqual(shadowOnly);
		expect(arm("scaled sun").lights).toEqual({
			sun: SHIPPED.sun * SUN_SCALE,
			hemisphere: SHIPPED.hemisphere,
		});
		expect(
			arms.filter((a) => a.name.startsWith("rebalance")).map((a) => a.lights),
		).toEqual(REBALANCES);
	});

	test("the rebalance ladder is the principal's: sun 0.5, 1.0 and 2.0", () => {
		expect(REBALANCE_SUNS).toEqual([0.5, 1, 2]);
	});

	test("the exposure rule is the shipped run's own hull-chase median, within one code", () => {
		expect(EXPOSURE_RULE.statistic).toBe("median");
		expect(EXPOSURE_RULE.toleranceCodes).toBe(1);
	});
});

describe("the lights are held across an arm's two frames", () => {
	const scaled = { sun: 2, hemisphere: 6.85 };

	test("a row drawn under one set of lights, then restored, passes", () => {
		expect(
			lightsHeldProblems({
				wanted: scaled,
				atBaseline: everyScene(scaled),
				atArm: everyScene(scaled),
				restored: everyScene(SHIPPED),
				shipped: SHIPPED,
			}),
		).toEqual([]);
	});

	test("#363's order — baseline at the shipped sun, arm at the scaled one — is refused", () => {
		const problems = lightsHeldProblems({
			wanted: scaled,
			atBaseline: everyScene(SHIPPED),
			atArm: everyScene(scaled),
			restored: everyScene(SHIPPED),
			shipped: SHIPPED,
		});
		expect(problems.length).toBeGreaterThan(0);
		expect(problems.join("\n")).toContain("baseline");
	});

	test("one layer left on the old rig is refused, by name", () => {
		const atArm = everyScene(scaled).map((row) =>
			row.scene === "approachScene" ? { ...row, ...SHIPPED } : row,
		);
		const problems = lightsHeldProblems({
			wanted: scaled,
			atBaseline: everyScene(scaled),
			atArm,
			restored: everyScene(SHIPPED),
			shipped: SHIPPED,
		});
		expect(problems.join("\n")).toContain("approachScene");
	});

	test("a missing layer is refused rather than read as agreement", () => {
		const problems = lightsHeldProblems({
			wanted: scaled,
			atBaseline: everyScene(scaled).slice(1),
			atArm: everyScene(scaled),
			restored: everyScene(SHIPPED),
			shipped: SHIPPED,
		});
		expect(problems.length).toBeGreaterThan(0);
	});

	test("lights not restored to the shipped rig are refused", () => {
		const problems = lightsHeldProblems({
			wanted: scaled,
			atBaseline: everyScene(scaled),
			atArm: everyScene(scaled),
			restored: everyScene(scaled),
			shipped: SHIPPED,
		});
		expect(problems.join("\n")).toContain("restored");
	});
});

describe("the hemisphere search", () => {
	/** A median that rises with the hemisphere, as a lift does. */
	const linear = (sun: number) => async (hemisphere: number) =>
		20 * sun + 10 * hemisphere;

	test("lands within the tolerance of the target", async () => {
		const target = 80;
		const found = await bisectHemisphere(linear(1), {
			target,
			lo: 0,
			hi: 6.85,
			tolerance: 1,
		});
		expect(found.held).toBe(true);
		expect(Math.abs(found.median - target)).toBeLessThanOrEqual(1);
		expect(found.hemisphere).toBeCloseTo(6, 0);
	});

	test("says when no hemisphere is dark enough — the sun alone overshoots", async () => {
		const found = await bisectHemisphere(linear(10), {
			target: 80,
			lo: 0,
			hi: 6.85,
			tolerance: 1,
		});
		expect(found.held).toBe(false);
		expect(found.reason).toBe("over");
		expect(found.hemisphere).toBe(0);
	});

	test("says when even the shipped hemisphere is too dark", async () => {
		const found = await bisectHemisphere(async () => 10, {
			target: 80,
			lo: 0,
			hi: 6.85,
			tolerance: 1,
		});
		expect(found.held).toBe(false);
		expect(found.reason).toBe("under");
	});
});

describe("the lit side of the hull", () => {
	test("a pixel is lit when the sun adds more than the gain floor to it", () => {
		const lit = litSide({
			shippedLuma: [10, 50, 80, 33],
			noSunLuma: [10, 40, 79, 30.5],
			minGain: LIT_SIDE_MIN_GAIN,
		});
		expect(lit).toEqual([false, true, false, true]);
	});

	test("the two readings must cover the same pixels", () => {
		expect(() =>
			litSide({ shippedLuma: [1, 2], noSunLuma: [1], minGain: 2 }),
		).toThrow();
	});

	test("the median is the hull reader's: the sorted value at half the count", () => {
		expect(medianOf([5, 1, 3, 2])).toBe(3);
		expect(medianOf([4, 9, 1])).toBe(4);
		expect(medianOf([])).toBe(0);
	});

	test("a lit-side median reads only the lit pixels", () => {
		const lit = [false, true, true, false];
		expect(medianWhere([100, 20, 40, 100], lit)).toBe(40);
	});
});
