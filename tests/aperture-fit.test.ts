/**
 * Does the thing you have to fly through admit the thing you fly?
 *
 * `docking.md` §5 calls the aperture dimensions **provisional pending #26's
 * hull roster**, and #35 then built eleven roles' worth of hulls without
 * anything comparing the two. This file is that comparison, and it exists as a
 * test rather than as a measurement because a hull is widened by editing a
 * control station: nothing about that edit says "and now it does not fit".
 *
 * The margin is on **beam and height**, never on length. A ship flies through a
 * slot nose-first, so its length is what it needs *clearance to stop in* — a
 * different question, and one `docking.md` §3's approach gate owns.
 *
 * **Capitals do not dock, and that is now a decision rather than a gap.** The
 * carrier is 212 × 181 m and the dreadnought 186 × 165 m, against a 200 × 70 m
 * slot and the refinery's 150 m pad: neither fits any aperture in the game, and
 * neither is meant to. Ratified 2026-08-26 and recorded in the map's
 * Constraints, so #26's roster owes them an outfitting route that is not a
 * station.
 *
 * That makes the third test below a **contract, not a note**: it asserts that
 * they still do not fit, and it goes red the day an aperture is widened far
 * enough to admit one — which would be a decision reversed by accident.
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

/** Every hull's beam and height, metres, across all of its variants. */
function envelope(id: HullId) {
	let beam = 0;
	let height = 0;
	for (const variant of HULL_VARIANTS[id]) {
		const root = buildShipMesh(id, variant.id).root;
		root.updateMatrixWorld(true);
		const size = new THREE.Box3()
			.setFromObject(root)
			.getSize(new THREE.Vector3());
		beam = Math.max(beam, size.x * 1000);
		height = Math.max(height, size.y * 1000);
	}
	return { beam, height };
}

const APERTURE = (type: StationType) => ({
	width: STATION_GEOMETRY[type].aperture.widthKm * 1000,
	height: STATION_GEOMETRY[type].aperture.heightKm * 1000,
});

describe("the aperture admits the hulls that have to fly through it", () => {
	test("every non-capital hull fits every aperture, with the margins printed", () => {
		const ordinary = HULL_IDS.filter((id) => !CAPITALS.includes(id));
		for (const type of STATION_TYPES) {
			const gap = APERTURE(type);
			let tightest = Number.POSITIVE_INFINITY;
			let tightestBy = "";
			for (const id of ordinary) {
				const hull = envelope(id);
				const clearance = Math.min(
					gap.width - hull.beam,
					gap.height - hull.height,
				);
				if (clearance < tightest) {
					tightest = clearance;
					tightestBy = id;
				}
				expect([type, id, clearance > 0]).toEqual([type, id, true]);
			}
			console.log(
				`${type.padEnd(9)} ${gap.width}×${gap.height} m — tightest ` +
					`${tightest.toFixed(0)} m on ${tightestBy}`,
			);
		}
	});

	test("the slot's height is the binding dimension, not its width", () => {
		// Worth pinning, because it is not obvious from the numbers and it is
		// what any retune has to respect: the slot is 200 m wide and 70 m tall,
		// and the pool's widest hull is 54 m against its tallest at 47 m. Width
		// has 3.7× the clearance height has. A slot that grew wider would be
		// answering a question nothing asked.
		const gap = APERTURE("trade");
		const ordinary = HULL_IDS.filter((id) => !CAPITALS.includes(id));
		const beams = ordinary.map((id) => envelope(id).beam);
		const heights = ordinary.map((id) => envelope(id).height);
		const widthMargin = gap.width - Math.max(...beams);
		const heightMargin = gap.height - Math.max(...heights);
		console.log(
			`trade slot: width margin ${widthMargin.toFixed(0)} m, ` +
				`height margin ${heightMargin.toFixed(0)} m`,
		);
		expect(heightMargin).toBeLessThan(widthMargin);
		expect(heightMargin).toBeGreaterThan(0);
	});

	test("neither capital fits any aperture, and that is the intended answer", () => {
		// The separate-class decision, held as an assertion. Both capital classes
		// are wider than every slot and pad in the game and are supposed to be;
		// what #26 owes them is an outfitting route that is not a station. This
		// fails if an aperture is ever widened enough to admit one, which is the
		// shape that reversal would take — nobody would write "capitals may dock
		// now", they would widen a slot for some other reason.
		for (const id of CAPITALS) {
			const hull = envelope(id);
			for (const type of STATION_TYPES) {
				const gap = APERTURE(type);
				expect([
					id,
					type,
					hull.beam > gap.width || hull.height > gap.height,
				]).toEqual([id, type, true]);
			}
			console.log(`${id}: ${hull.beam.toFixed(0)}×${hull.height.toFixed(0)} m`);
		}
	});
});
