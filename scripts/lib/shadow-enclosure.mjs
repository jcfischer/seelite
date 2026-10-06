/**
 * What each arm of `measure-shadow-enclosure.mjs` is, and the readback rule
 * that refuses a row drawn under two sets of lights (node #723).
 *
 * Headless, so `tests/shadow-enclosure.test.ts` can hold it. The instrument is
 * headed and cannot run there; this is the part of it that decides what a
 * figure means.
 *
 * **Why the readback rule exists.** #363's scaled-sun arm drew its baseline at
 * the shipped sun and its shadow frame at ten times it. A shadowed pixel then
 * lost the same 0.2 sun as in gate-blind and a lit pixel got brighter, which a
 * darker-pixel count does not see, so the arm read the bay at 2.751% · 3.1 in
 * both columns. Nothing compared the two frames' lights. Now the page reads
 * every layer's sun and hemisphere back at both draws and after the restore,
 * and `lightsHeldProblems` refuses the row on any difference.
 */

/**
 * The scenes that each carry their own `"sun"` and `"hemisphere"`
 * (`main.ts`, where the lights are built). A rebalance that sets only the near
 * scene's pair lights whatever the handoff put in the approach layer — and the
 * cabin — by the old rig, so every arm sets all four and the readback checks
 * all four.
 */
export const LAYER_SCENES = Object.freeze([
	"farScene",
	"approachScene",
	"nearScene",
	"cabinScene",
]);

/** The "scaled sun" arm: the shipped sun times this, with the hemisphere left
 *  as shipped. It only adds light, so it says whether the shadow's geometry is
 *  there, not what a rebalanced rig looks like. */
export const SUN_SCALE = 10;

/** The rebalance ladder's sun intensities — the principal's choice on #723
 *  (2026-10-06). 2.0 is the scaled arm's sun, so the two compare. */
export const REBALANCE_SUNS = Object.freeze([0.5, 1, 2]);

/**
 * What "the same exposure" means for a rebalance — the principal's choice on
 * #723 (2026-10-06). For each sun in `REBALANCE_SUNS`, the hemisphere is
 * lowered until the painted hull's median display luma in `hull-chase`
 * (`lib/hull-chase.mjs`, the reader #199's band is calibrated with) equals the
 * same run's shipped median within `toleranceCodes`. The target is the run's
 * own reading, not `HULL_LUMA_CALIBRATION`'s, so the rule compares two rigs on
 * one build and one renderer.
 */
export const EXPOSURE_RULE = Object.freeze({
	subject: "hull-chase painted hull",
	statistic: "median",
	toleranceCodes: 1,
	describe:
		"hemisphere lowered until the hull-chase painted-hull median equals this run's shipped median within 1 code",
});

/** Every arm is differenced against this frame, drawn at the arm's own lights. */
export const BASELINE_OCCLUSION = Object.freeze({ shadows: false, ao: false });

/** `occlusion` value meaning "call `setOcclusion()` and let #241's gate decide". */
const GATE = "gate";
/** `ao` value meaning "the AO the shipped arm drew at this rung". */
const AS_SHIPPED = "as shipped";

/**
 * The arms, in the order the page draws them. `shipped` comes first because
 * `gate-blind` takes its AO from what `shipped` drew.
 *
 * | arm | occlusion | lights | difference from |
 * |---|---|---|---|
 * | shipped | gate live | shipped | — what the player sees |
 * | gate-blind | shadow pinned on, AO as shipped drew it | shipped | shipped: the gate alone |
 * | shadow only | shadow on, AO off | shipped | baseline: the shadow alone |
 * | AO only | shadow off, AO on | shipped | baseline: the AO alone |
 * | scaled sun | as shadow only | sun × `SUN_SCALE` | shadow only: the sun alone |
 * | rebalance s | as shadow only | sun s, hemisphere lowered | shadow only: the rig alone |
 * | control | gate live | shipped | shipped: same-build drift |
 */
export function enclosureArms({ shipped, rebalances }) {
	const shadowOnly = { shadows: true, ao: false };
	return [
		{ name: "shipped", occlusion: GATE, lights: { ...shipped } },
		{
			name: "gate-blind",
			occlusion: { shadows: true, ao: AS_SHIPPED },
			lights: { ...shipped },
		},
		{ name: "shadow only", occlusion: shadowOnly, lights: { ...shipped } },
		{
			name: "AO only",
			occlusion: { shadows: false, ao: true },
			lights: { ...shipped },
		},
		{
			name: "scaled sun",
			occlusion: shadowOnly,
			lights: {
				sun: shipped.sun * SUN_SCALE,
				hemisphere: shipped.hemisphere,
			},
		},
		...rebalances.map((lights) => ({
			name: `rebalance ${lights.sun}`,
			occlusion: shadowOnly,
			lights: { sun: lights.sun, hemisphere: lights.hemisphere },
		})),
		{ name: "control", occlusion: GATE, lights: { ...shipped } },
	];
}

/**
 * The `setOcclusion` arguments an arm stands for at one rung: `"gate"` for a
 * bare call, or the two pinned halves. `aoShipped` is whether the shipped
 * arm's frame drew AO there — read off the page, because the gate may have
 * shut it.
 */
export function resolveOcclusion(occlusion, aoShipped) {
	if (occlusion === GATE) return GATE;
	return {
		shadows: occlusion.shadows,
		ao: occlusion.ao === AS_SHIPPED ? aoShipped : occlusion.ao,
	};
}

/**
 * Every way one arm's readback breaks the rule that both of its frames were
 * drawn under the lights it names, in every layer, and that the shipped rig
 * was back afterwards. Empty means the row may be printed.
 *
 * Each of `atBaseline`, `atArm` and `restored` is the page's list of
 * `{ scene, sun, hemisphere }`, read immediately before that draw (or after
 * the restore). Equality is exact: the page writes these numbers and reads the
 * same numbers back, so any difference is a write that did not happen.
 */
export function lightsHeldProblems({
	wanted,
	atBaseline,
	atArm,
	restored,
	shipped,
}) {
	const problems = [];
	const check = (label, rows, expected) => {
		const seen = new Map(rows.map((row) => [row.scene, row]));
		for (const scene of LAYER_SCENES) {
			const row = seen.get(scene);
			if (!row) {
				problems.push(`${label}: ${scene} has no sun and hemisphere to read`);
				continue;
			}
			for (const light of ["sun", "hemisphere"])
				if (row[light] !== expected[light])
					problems.push(
						`${label}: ${scene} ${light} ${row[light]}, expected ${expected[light]}`,
					);
		}
	};
	check("baseline", atBaseline, wanted);
	check("arm", atArm, wanted);
	check("restored", restored, shipped);
	return problems;
}

/**
 * The hemisphere intensity that holds `measure`'s median at `target`, by
 * bisection between `lo` and `hi`. `measure` takes a hemisphere intensity and
 * resolves to the median; it must rise with the hemisphere, which a lift does.
 *
 * Returns `held: false` with a reason when no value in the range can hold it:
 * `"over"` when the hull is too bright with no hemisphere at all, `"under"`
 * when it is too dark even at `hi`. The instrument still measures the shadow
 * at the returned value and prints the reason beside it.
 */
export async function bisectHemisphere(
	measure,
	{ target, lo, hi, tolerance, maxSteps = 20 },
) {
	const within = (median) => Math.abs(median - target) <= tolerance;
	const atLo = await measure(lo);
	if (atLo > target + tolerance)
		return {
			hemisphere: lo,
			median: atLo,
			held: false,
			reason: "over",
			steps: 1,
		};
	if (within(atLo))
		return { hemisphere: lo, median: atLo, held: true, steps: 1 };
	const atHi = await measure(hi);
	if (atHi < target - tolerance)
		return {
			hemisphere: hi,
			median: atHi,
			held: false,
			reason: "under",
			steps: 2,
		};
	if (within(atHi))
		return { hemisphere: hi, median: atHi, held: true, steps: 2 };
	let a = lo;
	let b = hi;
	let best = { hemisphere: hi, median: atHi };
	for (let step = 3; step <= maxSteps + 2; step++) {
		const mid = (a + b) / 2;
		const median = await measure(mid);
		if (Math.abs(median - target) < Math.abs(best.median - target))
			best = { hemisphere: mid, median };
		if (within(median))
			return { hemisphere: mid, median, held: true, steps: step };
		if (median < target) a = mid;
		else b = mid;
	}
	return {
		...best,
		held: false,
		reason: "no convergence",
		steps: maxSteps + 2,
	};
}
