/**
 * The prepare step every authored hull shares (node #887).
 *
 * Both authored flight assets — the O4 courier and the Longwall B miner — are
 * prepared by the same sequence, and #887 wrote it twice: measure each paint's base
 * colour map, hold the measurement to the recorded figure, apply the lift, assert no
 * lifted paint went missing, assert none went past the roster's painted hull, then
 * print what every paint became. Only the assert messages differed.
 *
 * That is the shape of problem this module exists for: a third authored hull, or a
 * change to the drift tolerance, would have meant finding every copy. Sage caught
 * the duplication on #898 — and the risk it names is real, because the two copies
 * could have drifted apart in *strictness* without either failing.
 *
 * It lives beside `texture-luma.mjs` rather than inside `authored-hull-paint.mjs`
 * because it needs the image decoder, and that module is deliberately pure
 * arithmetic so the bun tests that read the lift's rules load no native binding.
 */
import assert from "node:assert/strict";
import {
	ceilingFailures,
	liftAuthoredHullPaint,
} from "./authored-hull-paint.mjs";
import { baseColorLumaByMaterial } from "./texture-luma.mjs";

/** How far a measured map mean may sit from the recorded one before it is a
 *  re-authored texture rather than a rounding difference. */
const MAP_MEAN_TOLERANCE = 1e-3;

/**
 * Measure, verify and lift one authored hull's paints, in place, on a loaded
 * glTF-transform document. Returns the lift's rows for the caller to log.
 *
 * **The measurement is the point.** A base colour factor is only half a paint: the
 * courier multiplies every exterior factor by a `steel-wear` map whose pixels mean
 * 0.4466 linear, while the miner's structure and alloy paints carry no map at all.
 * The same rule over those two assets is a different brightness by a factor of two,
 * so the map is measured — and a texture that has moved since the figure was
 * recorded stops the build here, because that is a look someone has to decide
 * rather than a number a build quietly carries.
 */
export async function liftAndVerifyAuthoredHull(document, asset) {
	const measured = await baseColorLumaByMaterial(document);
	for (const [name, recorded] of Object.entries(asset.baseColorLuma)) {
		const got = measured.get(name) ?? 1;
		assert(
			Math.abs(got - recorded) < MAP_MEAN_TOLERANCE,
			`${name}: its base colour map means ${got.toFixed(4)}, not the recorded ${recorded}. Re-record the figure on the node that re-authored the texture.`,
		);
	}
	const lifted = liftAuthoredHullPaint(document, measured);
	const missing = asset.liftedPaints.filter(
		(name) => !lifted.some((row) => row.name === name),
	);
	assert.deepEqual(
		missing,
		[],
		`${asset.id}: the study lost a paint the lift names`,
	);
	const over = ceilingFailures(lifted);
	assert.deepEqual(
		over.map(
			(row) =>
				`${row.name}: ${row.diffuse.toFixed(4)} > ${row.ceiling.toFixed(4)}`,
		),
		[],
		`${asset.id}: a paint the lift brightened past the roster's painted hull`,
	);
	return lifted;
}

/** One lifted paint, in the line both prepare scripts print. */
export const formatLiftRow = (row) => {
	const triple = (tint) =>
		tint
			.slice(0, 3)
			.map((value) => value.toFixed(3))
			.join(",");
	return (
		`lifted ${row.name}: tint ${triple(row.from.tint)} -> ${triple(row.to.tint)} (x${row.scale.toFixed(2)}), ` +
		`metalness ${row.from.metalness.toFixed(2)} -> ${row.to.metalness.toFixed(2)}` +
		(row.ceilingBound ? " [diffuse ceiling]" : "")
	);
};
