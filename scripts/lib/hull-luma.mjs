/**
 * The painted hull's display-code calibration, and the floors derived from it.
 *
 * `probe-light-rig.mjs` reads the painted player hull's **absolute** luma off a
 * 0–255 canvas readback, so its three hull rows are a property of the hull
 * *finish* on screen, not of the lighting they are named for. That is the whole
 * reason this module exists rather than three constants sitting in the probe:
 * the readings, the finish they were taken on, and the margins applied to them
 * belong in one place a test can execute.
 *
 * **What went wrong when they did not (#294).** `ab47a33` set
 * `DEFAULT_HULL_FINISH` to `worn`; across that one commit the peak went
 * 154.32 → 149.08 and the lower quartile 60.93 → 41.96. Two rows red, a
 * fortnight of standing red, and a picture that reads exactly like an under-lit
 * hull. The thresholds were then lowered with a stated reason — a
 * Metal/SwiftShader readback difference — that a measurement of both lanes
 * refutes: on one build through one dev server the peak reads 149.08 on ANGLE
 * Metal and 149.08 on SwiftShader.
 *
 * So a finish change must fail **here**, by name, in the headless tier, rather
 * than as three browser rows a later reader has to bisect.
 */

/**
 * Measured on `9627632`, `hull-chase`, five samples per lane, same-build noise
 * 0.00 at every one. Where the two rasterisers disagree the **lower** reading is
 * recorded, because these are floors and the conservative arm is the dark one.
 *
 * | | ANGLE Metal (M1 Pro) | SwiftShader |
 * | --- | --- | --- |
 * | peak | 149.08 | 149.08 |
 * | lower quartile | 41.24 | 41.45 |
 * | median | 81.10 | 81.17 |
 *
 * `laneSpread` is what they disagreed by, and it is recorded rather than
 * described because the margins below are asserted against it.
 */
export const HULL_LUMA_CALIBRATION = Object.freeze({
	finish: "worn",
	ref: "9627632",
	peak: 149.08,
	lowerQuartile: 41.24,
	median: 81.1,
	laneSpread: Object.freeze({ peak: 0, lowerQuartile: 0.21, median: 0.07 }),
});

/**
 * How far under each reading its floor sits, as a fraction.
 *
 * Bounded from both sides, and `tests/light-rig.test.ts` asserts both bounds
 * rather than leaving them as prose. **Below**, a margin must exceed
 * `laneSpread` or the row goes red on which rasteriser ran it. **Above**, the
 * quartile's margin must stay well inside the 31.1% drop #202 produced, or the
 * probe passes straight through the next change of subject.
 *
 * The quartile carries that upper bound alone because it is the only row of the
 * three that #202 actually tripped: the peak fell 3.4% and the median 4.3%
 * across that commit, which no workable margin catches. The two of them are a
 * second condition — they reject a hull gone dark or blown out everywhere —
 * rather than the discriminating measurement.
 */
export const HULL_LUMA_MARGINS = Object.freeze({
	peak: 0.05,
	lowerQuartile: 0.1,
	median: 0.05,
});

/**
 * The relative drop in the lower quartile that `ab47a33` produced —
 * 60.93 → 41.96 — kept as the sensitivity this row is required to retain.
 */
export const SUBJECT_CHANGE_QUARTILE_DROP = (60.93 - 41.96) / 60.93;

/** A floor at its stated margin under a recorded reading. */
const floorUnder = (reading, margin) => reading * (1 - margin);

/**
 * Display-space luma after ACES and composition, on the 0–255 canvas readback.
 *
 * A band rather than a floor: a white hull and an under-lit hull are both
 * exposure failures. Only the floor is derived — the ceiling is an authored
 * limit on how bright painted metal may read, and no calibration produces it.
 */
export const HULL_LUMA_BAND = Object.freeze({
	min: floorUnder(HULL_LUMA_CALIBRATION.peak, HULL_LUMA_MARGINS.peak),
	max: 200,
});

/**
 * Floors for the distribution beneath the peak. They reject the failure the
 * principal caught — one compliant highlight on an otherwise dark hull —
 * without turning the probe into an exact-image comparison.
 */
export const HULL_LUMA_FLOORS = Object.freeze({
	lowerQuartile: floorUnder(
		HULL_LUMA_CALIBRATION.lowerQuartile,
		HULL_LUMA_MARGINS.lowerQuartile,
	),
	median: floorUnder(
		HULL_LUMA_CALIBRATION.median,
		HULL_LUMA_MARGINS.median,
	),
});
