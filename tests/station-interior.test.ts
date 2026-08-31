/**
 * The interior contract (`docs/specs/docking.md` §13), as arithmetic.
 *
 * Every row here is a claim the ratified receipt makes and that nothing in the
 * browser tier can see: a bay reads as hollow or it does not, but whether the
 * transit lane is *clear*, whether two berths overlap, and whether the berth a
 * clearance hands out is the tightest free one that fits are all questions with
 * a number for an answer.
 *
 * The hull figures come from the roster rather than from a copy: a table of
 * expected fits typed in here would go stale the first time a hull was retuned,
 * and the fit predicate's whole subject is the roster.
 */

import { describe, expect, test } from "bun:test";
import { HULL_IDS, HULL_VISUALS, type HullId } from "../src/ship-mesh";
import { STATION_SILHOUETTE_KM } from "../src/station-mesh";
import {
	BAY_HALF_LIMIT_KM,
	BERTH_CELL,
	type Berth,
	ROLE_BERTHS,
	ROLE_CAPACITY,
	type StationInterior,
	berthFits,
	berthSpare,
	chooseBerth,
	stationInterior,
} from "../src/station-interior";
import { STATION_GEOMETRY, STATION_TYPES } from "../src/station";

const CAPITALS: HullId[] = ["carrier", "dreadnought"];
const interiorOf = (type: (typeof STATION_TYPES)[number], seed = 0) =>
	stationInterior(type, STATION_GEOMETRY[type], seed);

/** A berth's occupied box in the aperture frame, as three intervals. The berth
 *  axes are not the frame's: a wall berth's *height* runs across the bay and
 *  its beam runs up it, because the parked ship is on its side. */
function box(berth: Berth) {
	const half =
		berth.face === "deck" || berth.face === "overhead"
			? { across: berth.clearBeamKm / 2, up: berth.clearHeightKm / 2 }
			: { across: berth.clearHeightKm / 2, up: berth.clearBeamKm / 2 };
	return {
		axial: [
			berth.centre.axial - berth.clearLengthKm / 2,
			berth.centre.axial + berth.clearLengthKm / 2,
		] as const,
		across: [
			berth.centre.across - half.across,
			berth.centre.across + half.across,
		] as const,
		up: [berth.centre.up - half.up, berth.centre.up + half.up] as const,
	};
}

const overlaps = (a: readonly [number, number], b: readonly [number, number]) =>
	Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 1e-9;

describe("the catalogue answers the receipt", () => {
	test("every role offers exactly the capacity the receipt fixed", () => {
		for (const type of STATION_TYPES)
			expect([type, ROLE_BERTHS[type].length]).toEqual([
				type,
				ROLE_CAPACITY[type],
			]);
	});

	test("a role's addresses are distinct", () => {
		for (const type of STATION_TYPES) {
			const ids = interiorOf(type).berths.map((berth) => berth.id);
			expect([type, new Set(ids).size]).toEqual([type, ids.length]);
		}
	});

	test("each role uses only the families its palette allows", () => {
		const palette: Record<string, string[]> = {
			trade: ["deck", "wall"],
			shipyard: ["wall", "cradle"],
			refinery: ["deck", "cradle"],
			outpost: ["deck", "wall"],
		};
		for (const type of STATION_TYPES)
			for (const berth of interiorOf(type).berths)
				expect([type, berth.id, palette[type].includes(berth.family)]).toEqual([
					type,
					berth.id,
					true,
				]);
	});

	test("the outpost's second berth is the station's own draw, and it is a side", () => {
		expect(interiorOf("outpost", 0).berths[1].face).toBe("port");
		expect(interiorOf("outpost", 1).berths[1].face).toBe("starboard");
	});
});

describe("the volume holds what it says it holds", () => {
	test("the central transit lane is clear of every berth", () => {
		for (const type of STATION_TYPES) {
			const interior = interiorOf(type);
			const lane = {
				across: [
					-interior.laneHalfAcrossKm,
					interior.laneHalfAcrossKm,
				] as const,
				up: [-interior.laneHalfUpKm, interior.laneHalfUpKm] as const,
			};
			for (const berth of interior.berths) {
				const b = box(berth);
				expect([
					type,
					berth.id,
					overlaps(b.across, lane.across) && overlaps(b.up, lane.up),
				]).toEqual([type, berth.id, false]);
			}
		}
	});

	test("no two berths overlap", () => {
		for (const type of STATION_TYPES) {
			const berths = interiorOf(type).berths;
			for (let i = 0; i < berths.length; i++)
				for (let j = i + 1; j < berths.length; j++) {
					const a = box(berths[i]);
					const b = box(berths[j]);
					expect([
						type,
						`${berths[i].id} ${berths[j].id}`,
						overlaps(a.axial, b.axial) &&
							overlaps(a.across, b.across) &&
							overlaps(a.up, b.up),
					]).toEqual([type, `${berths[i].id} ${berths[j].id}`, false]);
				}
		}
	});

	test("every berth lies inside the enclosed volume", () => {
		for (const type of STATION_TYPES) {
			const interior = interiorOf(type);
			for (const berth of interior.berths) {
				const b = box(berth);
				expect([
					type,
					berth.id,
					b.axial[0] >= interior.endAxialKm - 1e-9,
				]).toEqual([type, berth.id, true]);
				expect([
					type,
					berth.id,
					b.axial[1] <= interior.mouthAxialKm + 1e-9,
				]).toEqual([type, berth.id, true]);
				expect([
					type,
					berth.id,
					Math.abs(b.across[0]) <= interior.halfAcrossKm + 1e-9 &&
						Math.abs(b.across[1]) <= interior.halfAcrossKm + 1e-9 &&
						Math.abs(b.up[0]) <= interior.halfUpKm + 1e-9 &&
						Math.abs(b.up[1]) <= interior.halfUpKm + 1e-9,
				]).toEqual([type, berth.id, true]);
			}
		}
	});

	test("no bay is capped so tight that a berth reaches the lane", () => {
		// `BAY_HALF_LIMIT_KM` is a cap on the bay's width, authored per form —
		// and a cap set below `lane + cell height` would put a wall berth in the
		// transit lane. The lane-clearance row above would catch it, but it would
		// read as a layout bug rather than as a table entry that is too small.
		for (const type of STATION_TYPES) {
			const cell = BERTH_CELL[type];
			const aperture = STATION_GEOMETRY[type].aperture;
			expect([
				type,
				BAY_HALF_LIMIT_KM[type] >= aperture.widthKm / 2 + cell.heightKm,
			]).toEqual([type, true]);
			expect([
				type,
				BAY_HALF_LIMIT_KM[type] >= aperture.heightKm / 2 + cell.heightKm,
			]).toEqual([type, true]);
		}
	});

	test("the interior stays inside the drawn station", () => {
		// The receipt's boundary: the interior may not change the exterior
		// silhouette, and a volume reaching past the form's own reach would show
		// through it. Measured against `STATION_SILHOUETTE_KM`, the selected
		// form's reach, rather than against a figure typed in here.
		for (const type of STATION_TYPES) {
			const interior = interiorOf(type);
			const corner = Math.hypot(
				interior.halfAcrossKm,
				interior.halfUpKm,
				Math.max(
					Math.abs(interior.mouthAxialKm),
					Math.abs(interior.endAxialKm),
				),
			);
			expect([type, corner <= STATION_SILHOUETTE_KM[type]]).toEqual([
				type,
				true,
			]);
		}
	});
});

describe("fit is geometric", () => {
	const cellBerth = (type: (typeof STATION_TYPES)[number]) =>
		interiorOf(type).berths[0];

	test("a full-size berth admits every ordinary hull and neither capital", () => {
		const berth = cellBerth("trade");
		for (const id of HULL_IDS)
			expect([id, berthFits(berth, HULL_VISUALS[id])]).toEqual([
				id,
				!CAPITALS.includes(id),
			]);
	});

	test("the player's baseline hull fits at every role", () => {
		for (const type of STATION_TYPES)
			expect([
				type,
				interiorOf(type).berths.some((berth) =>
					berthFits(berth, HULL_VISUALS.courier),
				),
			]).toEqual([type, true]);
	});

	test("an outpost berth turns away the hulls its cell is smaller than", () => {
		const berth = cellBerth("outpost");
		const refused = HULL_IDS.filter(
			(id) => !berthFits(berth, HULL_VISUALS[id]),
		);
		// Not a typed list of names: the claim is that the reduced cell refuses
		// *something* and that both capitals are in it, so a cell quietly grown
		// back to full size fails here.
		expect(refused.length).toBeGreaterThan(CAPITALS.length);
		for (const id of CAPITALS) expect(refused).toContain(id);
		expect(BERTH_CELL.outpost.heightKm).toBeLessThan(BERTH_CELL.trade.heightKm);
	});
});

describe("clearance reserves one berth", () => {
	const trade = () => interiorOf("trade");
	const hull = HULL_VISUALS.courier;

	test("it never hands out an occupied berth", () => {
		const interior = trade();
		const occupied = new Set(interior.berths.slice(0, 7).map((b) => b.id));
		const chosen = chooseBerth(interior, hull, occupied, 0);
		expect(chosen?.id).toBe(interior.berths[7].id);
	});

	test("a full station gets nothing, which is what makes clearance queue", () => {
		const interior = trade();
		const occupied = new Set(interior.berths.map((b) => b.id));
		expect(chooseBerth(interior, hull, occupied, 0)).toBeNull();
	});

	test("it picks the least spare envelope", () => {
		// Two roles' cells differ, so a mixed catalogue is built by hand here
		// rather than found in the game: what is under test is the ranking.
		const interior: StationInterior = {
			...trade(),
			berths: [
				{ ...trade().berths[0], id: "roomy", clearHeightKm: 0.09 },
				{ ...trade().berths[1], id: "snug" },
			],
		};
		const chosen = chooseBerth(interior, hull, new Set(), 0);
		expect(chosen?.id).toBe("snug");
		expect(berthSpare(interior.berths[0], hull)).toBeGreaterThan(
			berthSpare(interior.berths[1], hull),
		);
	});

	test("equal fits rotate with the request time", () => {
		const interior = trade();
		const seen = new Set<string>();
		for (let t = 0; t < interior.berths.length; t++)
			seen.add(chooseBerth(interior, hull, new Set(), t)?.id ?? "none");
		// Every berth in a uniform catalogue is an equal fit, so a station that
		// handed out one berth forever would put a single entry in here.
		expect(seen.size).toBe(interior.berths.length);
	});
});
