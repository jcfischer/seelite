/**
 * Does the thing you have to fly through admit the thing you fly — **rolled**?
 *
 * `docking.md` §5 calls the aperture dimensions provisional pending #26's hull
 * roster, and #35 then built eleven roles' worth of hulls without anything
 * comparing the two. This file is that comparison.
 *
 * **At check 4's roll limit, not axis-aligned**, which is §10's actual wording
 * and which the first version of this file ignored. A ship may arrive up to
 * `ROLL_LIMIT` off the slot's long axis and still be admitted by the docking
 * checks, so the opening has to pass its hull at that angle. A rolled rectangle
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
import * as THREE from "three";
import {
	HULL_IDS,
	HULL_VARIANTS,
	type HullId,
	buildShipMesh,
} from "../src/ship-mesh";
import {
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
} from "../src/station";

/** The two capital classes. Named rather than detected by size, so a hull that
 *  grows into capital proportions fails the check instead of joining the
 *  exemption. */
const CAPITALS: HullId[] = ["carrier", "dreadnought"];

/** Check 4's tolerance, radians (`docking.md` §3.2). Read from the spec's own
 *  figure rather than re-derived: the roll limit is a chosen number, and a
 *  second copy of it here would be this file asserting against itself. */
const ROLL_LIMIT = (50 * Math.PI) / 180;

/**
 * The opening one hull needs, metres, at the roll limit — across all of its
 * variants.
 *
 * The worst case is *at* the limit rather than somewhere inside it: both
 * expressions grow monotonically in θ over 0–90° for any positive `w` and `h`,
 * so nothing between 0 and 50° binds harder than 50° does.
 */
function rolledEnvelope(id: HullId) {
	let across = 0;
	let up = 0;
	for (const variant of HULL_VARIANTS[id]) {
		const root = buildShipMesh(id, variant.id).root;
		root.updateMatrixWorld(true);
		const size = new THREE.Box3()
			.setFromObject(root)
			.getSize(new THREE.Vector3());
		const w = size.x * 1000;
		const h = size.y * 1000;
		across = Math.max(
			across,
			w * Math.cos(ROLL_LIMIT) + h * Math.sin(ROLL_LIMIT),
		);
		up = Math.max(up, w * Math.sin(ROLL_LIMIT) + h * Math.cos(ROLL_LIMIT));
	}
	return { across, up };
}

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
				const hull = rolledEnvelope(id);
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
		const needAcross = Math.max(
			...ordinary.map((id) => rolledEnvelope(id).across),
		);
		const needUp = Math.max(...ordinary.map((id) => rolledEnvelope(id).up));
		const widthMargin = gap.width - needAcross;
		const heightMargin = gap.height - needUp;
		console.log(
			`trade slot rolled: needs ${needAcross.toFixed(1)}×${needUp.toFixed(1)} m` +
				`, margins ${widthMargin.toFixed(1)} / ${heightMargin.toFixed(1)} m`,
		);
		expect(heightMargin).toBeLessThan(widthMargin);
		expect(heightMargin).toBeGreaterThan(0);
	});

	test("neither capital fits any aperture, and that is the intended answer", () => {
		// The separate-class decision, held as an assertion. Both capital classes
		// need more than every slot and pad in the game and are supposed to;
		// what #26 owes them is an outfitting route that is not a station. This
		// fails if an aperture is ever widened enough to admit one, which is the
		// shape that reversal would take — nobody would write "capitals may dock
		// now", they would widen a slot for some other reason.
		for (const id of CAPITALS) {
			const hull = rolledEnvelope(id);
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
});
