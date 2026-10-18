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

import {
	HULL_SPECS,
	type HullEnvelope,
	type HullId,
	type HullSpec,
	PURCHASABLE_HULL_IDS,
} from "../../src/hull";
import type { StationType } from "../../src/station";
import { STATION_TYPES } from "../../src/station";
import { BERTH_CELL } from "../../src/station-interior";

/** Cubic metres of bounding box. The envelope is kilometres (`hull.ts`), which
 *  is why this conversion exists at all rather than being inlined. */
export const hullBoxM3 = (env: HullEnvelope): number =>
	env.lengthKm * env.beamKm * env.heightKm * 1e9;

/** Cubic metres of bounding box per tonne of hold — the density §7.2's ceiling
 *  is derived from, and the one figure on which a role differs by 7.1x. */
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

/**
 * The hold density §7.2's ceiling was ratified against (#182), recorded here
 * rather than read off the live roster — node #813.
 *
 * Until then the densest hold was the procedural Porter's: its 69.7 x 46.3 x
 * 19.7 m box carrying 60 t, 1,060 m³ a tonne, which with the trade berth gives
 * 197 t. The authored O2 Porter that replaced it carries the same 60 t in a box
 * a third smaller, 698 m³ a tonne, and the same derivation on it gives 299 t —
 * a ceiling under which the dreadnought (200 t) and the voyager (240 t) would
 * take a price, which reverses #56's "the capitals have no price, and it is the
 * ceiling that says so". Whether to adopt it is an economy decision, not a
 * hull integration's, so the derivation keeps its input and `rosterCeiling`
 * below prints what the live roster would make of it. `tests/hull.test.ts`
 * holds both figures exactly.
 */
export const CEILING_REFERENCE = {
	hull: "freighter",
	source: "procedural Porter (freighter/b) before node #813",
	env: { lengthKm: 0.0697, beamKm: 0.0463, heightKm: 0.0197 },
	holdT: 60,
} as const satisfies {
	hull: HullId;
	source: string;
	env: HullEnvelope;
	holdT: number;
};

/** The largest berth cell in the game, and every type is checked. */
const largestBerth = (): { largestType: StationType; boxM3: number } => {
	const largestType = STATION_TYPES.reduce((best, type) =>
		hullBoxM3(BERTH_CELL[type]) > hullBoxM3(BERTH_CELL[best]) ? type : best,
	);
	return { largestType, boxM3: hullBoxM3(BERTH_CELL[largestType]) };
};

/**
 * §7.2's ceiling, derived from the berth catalogue and `CEILING_REFERENCE`
 * rather than declared.
 *
 * One body for the same reason the two above exist: the max-over-types step
 * was written out in `tests/hull.test.ts` *and* in
 * `scripts/measure-hull-pricing.ts` section G, so a retune that changed which
 * station type has the largest berth had two places to agree in. The gate
 * asserts `HULL_CEILING_HOLD_T === holdT` and the instrument prints this same
 * record, so the two cannot report different ceilings.
 *
 * **Floored, not rounded.** A hold that does not fit is not a ceiling, and a
 * quotient of 197.6 admits 197 t.
 */
export const derivedCeiling = (): {
	largestType: StationType;
	boxM3: number;
	m3PerT: number;
	holdT: number;
} => {
	const { largestType, boxM3 } = largestBerth();
	const m3PerT = hullBoxM3(CEILING_REFERENCE.env) / CEILING_REFERENCE.holdT;
	return { largestType, boxM3, m3PerT, holdT: Math.floor(boxM3 / m3PerT) };
};

/**
 * The same derivation on the live roster's densest hold: the ceiling
 * `HULL_CEILING_HOLD_T` would be if `CEILING_REFERENCE` followed the shipped
 * hulls. A tripwire, not a gate — see `CEILING_REFERENCE`.
 */
export const rosterCeiling = (): {
	densestHull: HullId;
	m3PerT: number;
	holdT: number;
} => {
	const { boxM3 } = largestBerth();
	const densestHull = PURCHASABLE_HULL_IDS.reduce((best, id) =>
		m3PerTonneOfHold(HULL_SPECS[id]) < m3PerTonneOfHold(HULL_SPECS[best])
			? id
			: best,
	);
	const m3PerT = m3PerTonneOfHold(HULL_SPECS[densestHull]);
	return { densestHull, m3PerT, holdT: Math.floor(boxM3 / m3PerT) };
};
