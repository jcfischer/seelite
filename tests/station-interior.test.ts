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
import * as THREE from "three";
import { HULL_IDS, HULL_VISUALS, type HullId } from "../src/ship-mesh";
import { SELECTED_FORM, buildStationForm } from "../src/station-mesh";
import {
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
	stationInterior(type, STATION_GEOMETRY[type].aperturePlaneKm, seed);

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

	test("the bay fits inside the hull of the form that holds it", () => {
		// **The boundary §13.7 states**: the interior may not change the exterior
		// silhouette, and a bay wider than the hull it is cut into pokes through
		// it. The shipyard's Gantry carries its slot on a hub about 250 m across
		// and a bay sized from the berth cell alone came out 280 m wide — flown,
		// the chase camera from a wall berth was outside the station altogether.
		//
		// **Measured against the hull's own bounding box, and the box is why
		// this is a floor rather than a proof.** A hull mesh is `FrontSide`, so a
		// ray cast from inside passes straight through and reports nothing; and a
		// box is larger than the shape inside it, so a bay that fails this is
		// certainly through the hull, while a bay that passes may still meet a
		// sloped face. The rest is the canonical view set's, which is #98's
		// finding one level down rather than a gap to close later.
		//
		// The interior is excluded from the measurement for the obvious reason:
		// it is the subject.
		// **Slot forms only, and the pads are excluded for a reason rather than
		// for convenience** — the same restriction #128's hull-reaches-the-plane
		// row makes and for the same reason. A Coriolis's `core` *is* the body its
		// slot is cut into; a refinery's is a 48 m slab of deck sitting in the
		// notch of a rock that is a separate mesh, and an outpost's is the tank
		// cluster *below* its pad, at negative z. Measured against those, the row
		// would be comparing the bay with the wrong object.
		//
		// So the two pad roles' bays are held by the canonical view set alone.
		// That is the residue, stated rather than papered over.
		for (const type of STATION_TYPES) {
			if (STATION_GEOMETRY[type].aperture.kind !== "slot") continue;
			const interior = interiorOf(type);
			const { root } = buildStationForm(type, SELECTED_FORM[type], 0x888888, 0);
			root.updateMatrixWorld(true);
			const core = STATION_GEOMETRY[type].coreRadiusKm;
			// **The `core`, not the whole assembly.** A shipyard's drydock frame
			// reaches 1.5 km and a box over everything drawn is satisfied by any
			// bay at all — measured that way, a cap of 400 m passed. `core` is the
			// body the aperture is cut into, which is the thing the bay has to fit
			// inside, and it is the same object `#128`'s hull-reaches-the-plane row
			// measures.
			const body = root.getObjectByName("core");
			const hull = new THREE.Box3();
			if (body) hull.setFromObject(body);
			const label = `${type} ${SELECTED_FORM[type]}`;
			expect([label, hull.isEmpty()]).toEqual([label, false]);
			expect([label, interior.halfAcrossKm <= hull.max.x * core]).toEqual([
				label,
				true,
			]);
			expect([label, interior.halfUpKm <= hull.max.y * core]).toEqual([
				label,
				true,
			]);
			expect([label, interior.endAxialKm >= hull.min.z * core]).toEqual([
				label,
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
