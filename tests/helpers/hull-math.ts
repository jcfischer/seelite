/**
 * The arithmetic that turns a hull's declared envelope into the two figures
 * #182's ceiling is derived from.
 *
 * **One body, three former copies.** The box volume per tonne of hold was
 * written out in `tests/hull.test.ts`'s re-derivation, again in the same file's
 * boundary control, and a third time in `scripts/measure-hull-pricing.ts`
 * section G. A unit change — the envelope is kilometres and the density is
 * quoted in cubic metres — had to land in three places or the instrument and
 * the gate would disagree about the ceiling with nothing going red.
 *
 * It lives under `tests/helpers/` for the reason `market-math.ts` gives: the
 * guarded tier must not depend on operator tooling, and the suite and the
 * instrument share it so the number in the spec and the number under test
 * cannot drift.
 */

import type { HullEnvelope, HullSpec } from "../../src/hull";

/** Cubic metres of bounding box. The envelope is kilometres (`hull.ts`), which
 *  is why this conversion exists at all rather than being inlined. */
export const hullBoxM3 = (env: HullEnvelope): number =>
	env.lengthKm * env.beamKm * env.heightKm * 1e9;

/** Cubic metres of bounding box per tonne of hold — the density §7.2's ceiling
 *  is derived from, and the one figure on which a role differs by 4.7x. */
export const m3PerTonneOfHold = (spec: HullSpec): number =>
	hullBoxM3(spec.env) / spec.holdT;

/**
 * A hull grown along its length alone to carry `holdT` at `m3PerT`, in a box no
 * wider or taller than `cell`.
 *
 * #26's constraint: beam and height are nearly spent, so a bigger hull is a
 * longer one. This is what the ceiling assumes a hull *could* be, which is why
 * it is an upper bound in the safe direction.
 */
export const stretchedToHold = (
	holdT: number,
	m3PerT: number,
	cell: { beamKm: number; heightKm: number },
): HullEnvelope => ({
	beamKm: cell.beamKm,
	heightKm: cell.heightKm,
	// `m3PerT` is cubic metres and the cell is kilometres, so the 1e9 that
	// `hullBoxM3` applies has to come back out here.
	lengthKm: (holdT * m3PerT) / 1e9 / (cell.beamKm * cell.heightKm),
});
