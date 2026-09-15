/**
 * Does the thing you have to fly through admit the thing you fly — **rolled**?
 *
 * `docking.md` §5 calls the aperture dimensions provisional pending #26's hull
 * roster, and #35 then built eleven roles' worth of hulls without anything
 * comparing the two. This file is that comparison.
 *
 * **At check 4's roll limit, not axis-aligned**, which is §10's actual wording
 * and which the first version of this file ignored. A ship may arrive up to
 * `ROLL_LIMIT` off the slot's long axis — its beam along that axis is check 4's
 * own zero, ratified in #157 against this file's measurement — and still be
 * admitted by the docking checks, so the opening has to pass its hull at that
 * angle. A rolled rectangle
 * needs `w·cos θ + h·sin θ` across and `w·sin θ + h·cos θ` up, and for a hull
 * that is nearly as tall as it is wide those are both larger than either.
 *
 * That distinction is not academic: measured axis-aligned, a 120 × 60 m slot
 * looked to have 13 m of height margin, and rolled it is 3.4 m **short**. The
 * number that mattered was never in the axis-aligned reading.
 *
 * The margin is on beam and height, never on length. A ship flies through a
 * slot nose-first, so its length is what it needs clearance to *stop* in — a
 * different question, and `docking.md` §3's approach gate owns it.
 *
 * **The figures are printed, not written into the prose here.** Every stale
 * number this file has carried got that way by being typed into a comment
 * beside an assertion that reads the table.
 *
 * **Capitals do not dock, and that is a decision rather than a gap.** The
 * carrier and the dreadnought are wider than every slot and pad in the game,
 * and neither is meant to fit. Ratified 2026-08-26 and recorded in the map's
 * Constraints, so #26's roster owes them an outfitting route that is not a
 * station.
 *
 * That makes the last test a **contract, not a note**: it asserts that they
 * still do not fit, and it goes red the day an aperture is widened far enough
 * to admit one — which would be a decision reversed by accident.
 */

import { describe, expect, test } from "bun:test";
import { ROLL_TOLERANCE_DEG } from "../src/docking";
import { CAPITAL_HULL_IDS, HULL_IDS, type HullId } from "../src/hull";
import { rolledEnvelope } from "./helpers/rolled-envelope";
import {
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
} from "../src/station";

/** The capital classes — `hull.ts`'s named list, imported rather than copied,
 *  so a capital added there reaches this file (#335's review). Named rather
 *  than detected by size, so a hull that grows into capital proportions fails
 *  the check instead of joining the exemption. */
const CAPITALS: readonly HullId[] = CAPITAL_HULL_IDS;

/** The capitals a *section* refuses: wider or taller than every aperture.
 *  `voyager` (#331) is not one of them — at the film's proportions its section
 *  passes a slot, and what refuses it is its length against every berth, which
 *  `tests/hull.test.ts`' `no berth in the game admits a capital` holds. */
const WIDER_THAN_EVERY_APERTURE: HullId[] = ["carrier", "dreadnought"];

/** Check 4's tolerance, radians (`docking.md` §3.2). Read from the spec's own
 *  figure rather than re-derived: the roll limit is a chosen number, and a
 *  second copy of it here would be this file asserting against itself. */
const ROLL_LIMIT = (50 * Math.PI) / 180;

/** **And it must stay the shipped one.** `tests/roll-reference.test.ts` rolls to
 *  `ROLL_TOLERANCE_DEG` while this file rolls to the spec's figure, and the two
 *  are named as one angle by `docking.md` §3 — so if the tolerance ever moved,
 *  both files would stay green and the tie between them would quietly stop
 *  holding. Asserted at load rather than inside a row, because every row here
 *  depends on it. */
if (Math.abs(ROLL_LIMIT - (ROLL_TOLERANCE_DEG * Math.PI) / 180) > 1e-12)
	throw new Error(
		`the spec's roll limit and ROLL_TOLERANCE_DEG have diverged: ` +
			`${(ROLL_LIMIT * 180) / Math.PI}° against ${ROLL_TOLERANCE_DEG}°`,
	);

/** The opening one hull needs at check 4's limit, metres — the shared helper,
 *  so the `across` term's `w` is the beam in exactly one place (#158). */
const rolled = (id: HullId) => rolledEnvelope(id, ROLL_LIMIT);

/** The opening one type offers, metres. Read from the table, never restated. */
const APERTURE = (type: StationType) => ({
	width: STATION_GEOMETRY[type].aperture.widthKm * 1000,
	height: STATION_GEOMETRY[type].aperture.heightKm * 1000,
});

describe("the aperture admits the hulls that have to fly through it", () => {
	test("every non-capital hull fits every aperture at the roll limit", () => {
		const ordinary = HULL_IDS.filter((id) => !CAPITALS.includes(id));
		for (const type of STATION_TYPES) {
			const gap = APERTURE(type);
			let tightest = Number.POSITIVE_INFINITY;
			let tightestBy = "";
			for (const id of ordinary) {
				const hull = rolled(id);
				const clearance = Math.min(
					gap.width - hull.across,
					gap.height - hull.up,
				);
				if (clearance < tightest) {
					tightest = clearance;
					tightestBy = id;
				}
				expect([type, id, clearance > 0]).toEqual([type, id, true]);
			}
			console.log(
				`${type.padEnd(9)} ${gap.width}×${gap.height} m — tightest ` +
					`${tightest.toFixed(1)} m on ${tightestBy}, rolled ` +
					`${Math.round((ROLL_LIMIT * 180) / Math.PI)}°`,
			);
		}
	});

	test("the slot's height is the binding dimension once the hull can roll", () => {
		// Worth pinning, because it is what any retune has to respect and it is
		// the opposite of what the axis-aligned reading suggests. Rolled, a hull
		// needs almost as much height as width however flat it is lying, so the
		// height is where a slot runs out first — and it is the dimension a
		// narrowing must not touch.
		const gap = APERTURE("trade");
		const ordinary = HULL_IDS.filter((id) => !CAPITALS.includes(id));
		const needAcross = Math.max(...ordinary.map((id) => rolled(id).across));
		const needUp = Math.max(...ordinary.map((id) => rolled(id).up));
		const widthMargin = gap.width - needAcross;
		const heightMargin = gap.height - needUp;
		console.log(
			`trade slot rolled: needs ${needAcross.toFixed(1)}×${needUp.toFixed(1)} m` +
				`, margins ${widthMargin.toFixed(1)} / ${heightMargin.toFixed(1)} m`,
		);
		expect(heightMargin).toBeLessThan(widthMargin);
		expect(heightMargin).toBeGreaterThan(0);
	});

	test("the carrier and the dreadnought fit no aperture, and that is the intended answer", () => {
		// The separate-class decision, held as an assertion. Both capital classes
		// need more than every slot and pad in the game and are supposed to;
		// what #26 owes them is an outfitting route that is not a station. This
		// fails if an aperture is ever widened enough to admit one, which is the
		// shape that reversal would take — nobody would write "capitals may dock
		// now", they would widen a slot for some other reason.
		for (const id of WIDER_THAN_EVERY_APERTURE) {
			const hull = rolled(id);
			for (const type of STATION_TYPES) {
				const gap = APERTURE(type);
				expect([
					id,
					type,
					hull.across > gap.width || hull.up > gap.height,
				]).toEqual([id, type, true]);
			}
			console.log(
				`${id}: needs ${hull.across.toFixed(0)}×${hull.up.toFixed(0)} m rolled`,
			);
		}
	});

	test("voyager's section passes a slot, so its refusal is its length and not its section", () => {
		// Stated rather than left implicit (#331): the claim above used to read
		// "neither capital fits any aperture", and a third capital at the film's
		// proportions makes that false. Its refusal is that no berth admits a
		// 200 m hull, which is a length and not a section. If voyager ever grows
		// a section no aperture admits, this goes red and the exemption above
		// should gain it instead.
		const hull = rolled("voyager");
		const gap = APERTURE("trade");
		expect(hull.across < gap.width && hull.up < gap.height).toBe(true);
	});
});
