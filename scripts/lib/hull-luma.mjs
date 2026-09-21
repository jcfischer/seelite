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
 * `DEFAULT_HULL_FINISH` to `worn`, and every painted-hull reading fell —
 * the endpoints are `PRE_/POST_SUBJECT_CHANGE_QUARTILE` and
 * `SUBJECT_CHANGE_OTHER_ROWS` below, rather than a second copy here. Two rows
 * red, a fortnight of standing red, and a picture that reads exactly like an
 * under-lit hull. The thresholds were then lowered, and the reason given for lowering them
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
 * described because the margins below are asserted against it. These are two
 * rasterisers on one machine; what follows from that is `SHIPPED_FLOORS`'s
 * to say. **The peak's is
 * exactly 0**, so that leg of the assertion is satisfied by any margin above
 * zero and is not a bound on the peak at all — it is recorded as measured rather
 * than padded to a figure nobody read.
 *
 * **Why the key is the hull finish alone.** The station finish is published on
 * the same handle and printed beside these rows, and it is deliberately not part
 * of the guard. `hull-chase` isolates the player hull by subtraction — the frame
 * is rendered without the ship's meshes and differenced against one with them —
 * so nothing a station is wearing reaches the masked pixels. Measured rather
 * than reasoned: with `DEFAULT_STATION_FINISH` moved `worn` → `nostromo` and
 * everything else held, the peak, the quartile, the median and the pixel count
 * are bit-identical at 149.08 / 41.24 / 81.10 over 25,578 px. Gating on it would
 * be a red with nothing behind it.
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
export const SHIPPED_FLOORS = Object.freeze({ peak: 140, median: 70 });

/**
 * The same rule for the distribution rows, and the one row it cannot cover.
 *
 * `SHIPPED_FLOORS` states the rule and the reason for it; both are about
 * every absolute-code floor derived from one machine's readings, not about the
 * peak. So the median obeys it too — 14% rather than the 5% first written here,
 * which derived 77.045 against a shipped 70.
 *
 * **The lower quartile is exempt, and the exemption is the point rather than a
 * gap.** It is the only row of the three with a *sensitivity* requirement:
 * `SUBJECT_CHANGE_QUARTILE_DROP` bounds its margin from above, because it is the
 * row that has to keep catching a change of subject. Loosening is free for the
 * peak and the median, which caught nothing at `ab47a33` and are not asked to.
 * It is not free here — a floor at 35 is 15.1% under the reading against an
 * upper bound of 15.6%, so the two bounds would meet and leave a margin with no
 * room in it. The row is kept tight deliberately, and the rule is written down
 * as not applying to it rather than quietly not applied.
 */

/**
 * Where "free to loosen" stops.
 *
 * The peak and the median are a **second condition** — they reject a hull gone
 * dark or blown out everywhere — so loosening them costs nothing the quartile
 * was not already doing. It costs nothing only while they still reject that
 * case: a median margin of 0.9 satisfies every other bound here and derives a
 * floor of 8.11, which a hull rendered nearly black would pass. Half the
 * calibrated reading is the line, and it is a long way outside any finish this
 * game has shipped — `worn` moved the median by 4.3%.
 */
export const FLOOR_FRACTION_OF_READING = 0.5;

/**
 * How far under each reading its floor sits, as a fraction.
 *
 * Bounded from three sides, and `tests/light-rig.test.ts` asserts each one
 * rather than leaving it as prose.
 *
 * **Below**, a margin — converted to display codes under its reading, which is
 * what the test compares — must exceed `laneSpread`, or the row goes red on
 * which rasteriser ran it. The fractions here are not comparable to that table
 * directly: the median's 14% is 11.35 codes against a spread of 0.07. **Above**, the quartile's margin must stay well inside the
 * drop `ab47a33` produced, or the probe passes straight through the next change
 * of subject. And **the peak's floor may not tighten past `SHIPPED_FLOORS`**,
 * which is why the peak's margin is 8% rather than the 5% it was first written
 * at: 5% derives a floor of 141.626, which is a gate quietly tightened on the
 * evidence of one machine.
 *
 * The quartile carries the upper bound alone because it is the only row of the
 * three that `ab47a33` actually tripped. Both other readings are recorded above
 * rather than asserted as percentages: the peak fell 154.32 → 149.08 and the
 * median 85.29 → 81.60, which is 3.4% and 4.3% — under any workable margin, and
 * under the 14% this module gives the median. The two of them are a
 * second condition — they reject a hull gone dark or blown out everywhere —
 * rather than the discriminating measurement.
 */
export const HULL_LUMA_MARGINS = Object.freeze({
	peak: 0.08,
	lowerQuartile: 0.1,
	median: 0.14,
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
export const HULL_LUMA_FLOOR_OF = Object.freeze(
	Object.fromEntries(
		Object.entries(HULL_LUMA_MARGINS).map(([metric, margin]) => [
			metric,
			floorUnder(HULL_LUMA_CALIBRATION[metric], margin),
		]),
	),
);

export const HULL_LUMA_BAND = Object.freeze({
	min: HULL_LUMA_FLOOR_OF.peak,
	max: 200,
});

/**
 * Floors for the distribution beneath the peak. They reject the failure the
 * principal caught — one compliant highlight on an otherwise dark hull —
 * without turning the probe into an exact-image comparison.
 */
export const HULL_LUMA_FLOORS = Object.freeze({
	lowerQuartile: HULL_LUMA_FLOOR_OF.lowerQuartile,
	median: HULL_LUMA_FLOOR_OF.median,
});

/**
 * Every metric's floor, by name, so a consumer iterates the module's own set
 * rather than re-typing it. A metric added to `HULL_LUMA_MARGINS` and missed
 * here is a key with no floor, which `tests/light-rig.test.ts` reads as a shape
 * failure rather than skipping in silence.
 */
