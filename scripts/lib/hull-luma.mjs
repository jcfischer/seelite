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
 * Measured on `c6f8b57`, rig B (`LIGHT_RIG`, the principal's choice on #231), `hull-chase`, five samples per lane, same-build noise 0.00
 * at every one. Where the two rasterisers disagree the **lower** reading is
 * recorded, because these are floors and the conservative arm is the dark one.
 *
 * | | ANGLE Metal (M1 Pro) | SwiftShader |
 * | --- | --- | --- |
 * | peak | 204.92 | 204.92 |
 * | lower quartile | 22.80 | 22.80 |
 * | median | 79.53 | 79.73 |
 *
 * B moved light from the hemisphere into the sun with the median held (#723's
 * rule), so the hull reads with more contrast than #199's rig did: on
 * `9627632` that rig read 149.08 / 41.24 / 81.10.
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
	ref: "c6f8b57",
	peak: 204.92,
	lowerQuartile: 22.8,
	median: 79.53,
	laneSpread: Object.freeze({ peak: 0, lowerQuartile: 0, median: 0.2 }),
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
 * The floors that shipped before this module existed (#435), as a ratchet.
 *
 * Every reading here is from one M1 Pro on two rasterisers, so nothing measured
 * in this repo covers a third backend — and the comment #463 deleted had
 * explicitly reserved that headroom, "with room for both real backends rather
 * than calibrating it to software". Deriving a floor from one machine's readings
 * is how that headroom gets spent without anyone deciding to. So every derived
 * floor is required to sit **at or below** its entry here: this module may
 * loosen what shipped and may not tighten it, having no evidence that would
 * justify tightening.
 *
 * The rule has **no exemption**, which cost the quartile's margin its round
 * number. An earlier pass carved that row out — it is the one row with a
 * *sensitivity* bound above it, so it cannot simply be loosened — and then
 * tightened it from 35 to 37.116 anyway, which is the thing this constant
 * exists to prevent. There is no need for the carve-out: at 15.2% the derived
 * floor was 34.972 on #199's rig, inside the ratchet, and still inside
 * `SUBJECT_CHANGE_QUARTILE_DROP / 2` at 15.57%. On rig B (#231) the quartile
 * reads 22.80 and the same margin derives 19.334, far inside the ratchet: B
 * loosened the row, which the ratchet allows.
 */
export const SHIPPED_FLOORS = Object.freeze({
	peak: 140,
	lowerQuartile: 35,
	median: 70,
});

/**
 * Where "free to loosen" stops.
 *
 * The ratchet above only bounds a floor from one side. Without a second bound a
 * margin of 0.9 satisfies every other rule here and derives a median floor of
 * 8.11, which a hull rendered nearly black would pass — and the peak and the
 * median exist precisely to reject a hull gone dark or blown out everywhere,
 * since neither is the discriminating measurement. Half the calibrated reading
 * is the line, a long way outside anything this game has shipped: `worn` moved
 * the median by 4.3%.
 */
export const FLOOR_FRACTION_OF_READING = 0.5;

/**
 * How far under each reading its floor sits, as a fraction.
 *
 * Bounded on three sides, and `tests/light-rig.test.ts` asserts each one rather
 * than leaving it as prose.
 *
 * **Above**, by `SHIPPED_FLOORS` — no floor may tighten past what shipped. That
 * is why the peak's margin is 32%: rig B (#231) reads 204.92, and the 8% it
 * carried on #199's rig would derive 188.526 against a shipped 140. The smallest
 * margin the ratchet allows is 31.7%, and 32% derives 139.346. It is why the
 * quartile's is 15.2%, too.
 *
 * **Below**, by `FLOOR_FRACTION_OF_READING`, so loosening stops short of a floor
 * nothing can fail.
 *
 * **And for the quartile, by `SUBJECT_CHANGE_QUARTILE_DROP`**, which is the only
 * *sensitivity* bound here: that row has to keep catching a change of subject,
 * and it is the only one of the three `ab47a33` actually tripped. The peak fell
 * 154.32 → 149.08 and the median 85.29 → 81.60 — 3.4% and 4.3%, under any
 * workable margin — so neither could have caught it and neither is asked to.
 *
 * A fourth bound is **asserted and not binding**, and is worth reading as a rail
 * rather than a constraint: a margin in display codes must exceed `laneSpread`,
 * or the row would go red on which rasteriser ran it. At the margins here that
 * is 65.57, 3.47 and 11.13 codes against spreads of 0, 0 and 0.20 — between
 * 55x and unbounded away from binding. It rejects a margin small enough to be a
 * typo and nothing a person would choose on purpose.
 */
export const HULL_LUMA_MARGINS = Object.freeze({
	peak: 0.32,
	lowerQuartile: 0.152,
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
 * Every metric's floor, derived in one place by mapping the margins over the
 * readings, so a metric added to `HULL_LUMA_MARGINS` gets a floor rather than
 * being silently missed by a hand-written list.
 */
export const HULL_LUMA_FLOOR_OF = Object.freeze(
	Object.fromEntries(
		Object.entries(HULL_LUMA_MARGINS).map(([metric, margin]) => [
			metric,
			floorUnder(HULL_LUMA_CALIBRATION[metric], margin),
		]),
	),
);

/**
 * Display-space luma after ACES and composition, on the 0–255 canvas readback.
 *
 * A band rather than a floor: a white hull and an under-lit hull are both
 * exposure failures. Only the floor is derived — the ceiling is an authored
 * limit on how bright painted metal may read, and no calibration produces it.
 * #199 set it at 200. The principal raised it to 215 on #231 (D2) with rig B,
 * whose peak reads 204.92: about ten codes of room.
 */
export const HULL_LUMA_BAND = Object.freeze({
	min: HULL_LUMA_FLOOR_OF.peak,
	max: 215,
});

/**
 * The floors for the distribution beneath the peak — every derived floor except
 * the peak's, which is the band's. They reject the failure the principal caught:
 * one compliant highlight on an otherwise dark hull, without turning the probe
 * into an exact-image comparison.
 */
export const HULL_LUMA_FLOORS = Object.freeze(
	Object.fromEntries(
		Object.entries(HULL_LUMA_FLOOR_OF).filter(([metric]) => metric !== "peak"),
	),
);
