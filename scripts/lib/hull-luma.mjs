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
 * hull. The thresholds were then lowered, and the reason given for lowering them
 * was a Metal/SwiftShader readback difference — stated with no measurement on
 * any build. #294 measured it: at `9627632` the peak reads 149.08 on ANGLE Metal
 * and 149.08 on SwiftShader, and the distribution differs by 0.21 and 0.07. That
 * is a later build than the one the claim was made about, so read it as bounding
 * the lane difference on this machine rather than as disproving a claim about
 * another; what it does settle is that a lane difference cannot account for a
 * quartile that moved by 19 codes.
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
 * described because the margins below are asserted against it. **The peak's is
 * exactly 0**, so that leg of the assertion is satisfied by any margin above
 * zero and is not a bound on the peak at all — it is recorded as measured rather
 * than padded to a figure nobody read. **It is two
 * rasterisers on one machine**, so it bounds what a lane costs here and says
 * nothing about a third backend; `SHIPPED_BAND_FLOOR` is what stands in for the
 * backends nobody here can measure.
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
 * The lower quartile immediately **before** `ab47a33`, and where the figure
 * comes from — because the obvious reading of it is wrong.
 *
 * This is a reading taken by #294 at `ab47a33^` (`cbf3f0f`), not a column
 * copied out of the docstring #463 deleted. It happens to equal that table's
 * *occlusion-off* column, 60.93, rather than its shipped column of 55.38, and
 * the coincidence has a cause rather than being an error: #201's table was
 * measured on `bf38973`, and `e137ea7` (#241) lands between the two and gates
 * the occlusion passes **off** in open space. `hull-chase` is open space. So by
 * `ab47a33^` the shipped build *is* the occlusion-off column, and #294 measured
 * 60.93 there directly.
 *
 * `bf38973` re-measured by the same instrument reads 55.16 — the shipped column
 * of that table to within a quarter of a code — which is how the two are known to be
 * the same measurement at two points rather than two different things.
 */
const PRE_SUBJECT_CHANGE_QUARTILE = 60.93;

/**
 * The same reading at `ab47a33` itself, and the other endpoint of the drop.
 *
 * Named for the reason the one above is: a bare literal inside the expression is
 * the shape this module exists to remove, and half a pair with provenance is
 * still half a pair without it.
 */
const POST_SUBJECT_CHANGE_QUARTILE = 41.96;

/**
 * The other two rows across the same commit, recorded so the sentence that
 * explains why they carry no upper bound is checkable rather than asserted.
 * Both were read by #294 at `ab47a33^` and `ab47a33` with the probe each of
 * those builds shipped.
 */
export const SUBJECT_CHANGE_OTHER_ROWS = Object.freeze({
	peak: Object.freeze({ before: 154.32, after: 149.08 }),
	median: Object.freeze({ before: 85.29, after: 81.6 }),
});

/**
 * The relative drop in the lower quartile that `ab47a33` produced —
 * 60.93 → 41.96 — kept as the sensitivity this row is required to retain.
 */
export const SUBJECT_CHANGE_QUARTILE_DROP =
	(PRE_SUBJECT_CHANGE_QUARTILE - POST_SUBJECT_CHANGE_QUARTILE) /
	PRE_SUBJECT_CHANGE_QUARTILE;

/**
 * The band floor that shipped before this module existed (#435).
 *
 * Every reading here is from one M1 Pro on two rasterisers, so nothing measured
 * in this repo covers a third backend — and the comment #463 deleted had
 * explicitly reserved that headroom, "with room for both real backends rather
 * than calibrating it to software". Deriving a floor from one machine's peak is
 * how that headroom gets spent without anyone deciding to. So the derived floor
 * is required to sit **at or below** this figure: #463 may loosen the shipped
 * band and may not tighten it, because it has no evidence that would justify
 * tightening.
 */
export const SHIPPED_BAND_FLOOR = 140;

/**
 * How far under each reading its floor sits, as a fraction.
 *
 * Bounded from three sides, and `tests/light-rig.test.ts` asserts each one
 * rather than leaving it as prose.
 *
 * **Below**, a margin must exceed `laneSpread` or the row goes red on which
 * rasteriser ran it. **Above**, the quartile's margin must stay well inside the
 * drop `ab47a33` produced, or the probe passes straight through the next change
 * of subject. And **the peak's floor may not tighten past `SHIPPED_BAND_FLOOR`**,
 * which is why the peak's margin is 8% rather than the 5% it was first written
 * at: 5% derives a floor of 141.63, which is a gate quietly tightened on the
 * evidence of one machine.
 *
 * The quartile carries the upper bound alone because it is the only row of the
 * three that `ab47a33` actually tripped. Both other readings are recorded above
 * rather than asserted as percentages: the peak fell 154.32 → 149.08 and the
 * median 85.29 → 81.60, which is 3.4% and 4.3% — under any workable margin, and
 * under the 5% this module gives the median. The two of them are a
 * second condition — they reject a hull gone dark or blown out everywhere —
 * rather than the discriminating measurement.
 */
export const HULL_LUMA_MARGINS = Object.freeze({
	peak: 0.08,
	lowerQuartile: 0.1,
	median: 0.05,
});

/**
 * A floor at its stated margin under a recorded reading, rounded to three
 * decimals — the readings carry two, and a floor printed as `77.04499999999999`
 * in a probe row is a number nobody can check against the calibration above.
 *
 * Exported because the rounding is part of the rule: a test that re-derives a
 * floor without it compares against a number this module never produced.
 */
export const floorUnder = (reading, margin) =>
	Math.round(reading * (1 - margin) * 1000) / 1000;

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
	median: floorUnder(HULL_LUMA_CALIBRATION.median, HULL_LUMA_MARGINS.median),
});
