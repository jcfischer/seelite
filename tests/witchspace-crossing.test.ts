/**
 * Node #1006: a jump crossing as a watcher sees it.
 *
 * The complaint was made from a frame: "the witchspace is open in first frame,
 * the ship magically appears and then magically disappears. No idea where it
 * went. … No sense of drama when witchspace opens." What was missing is not
 * brightness but *order* — an opening that comes before the ship, a moment when
 * it comes through, and a place that closes behind it.
 *
 * So every row here asks about order, and each one goes red on the timeline the
 * node replaced: `npcRiftStrength` opened the ring over 0.5 s **after** the
 * jump instant and faded it, with the ship already sitting at the lane point.
 */
import { describe, expect, test } from "bun:test";
import { ARRIVAL_RIFT } from "../src/arrival-rift";
import type { HullId } from "../src/hull";
import { HULL_SPECS } from "../src/hull";
import { JUMP_CHARGE_S } from "../src/hyperspace";
import { HULL_REACH_KM } from "../src/ship-mesh";
import { WITCHSPACE, witchspaceLook } from "../src/witchspace";
import {
	CROSSING,
	crossingDistanceKm,
	crossingFlare,
	emergenceOffset,
	npcRiftLook,
	npcRiftVisible,
	sealFlare,
} from "../src/witchspace-crossing";
import { length, v3 } from "../src/vec3";

const NOSE = v3(0, 0, 1);
/** A hull's own radial extent, and the lead-in the crossing gives it. */
const RADIUS = 0.04;
const DISTANCE = CROSSING.emergeRadii * RADIUS;
const strengthAt = (ageS: number) => npcRiftLook(ageS).strength;
const flareAt = (ageS: number) => npcRiftLook(ageS).flare;

describe("the ring's own timeline (node #1006 C1, C3)", () => {
	test("is closed until the opening begins, and the opening starts from nothing", () => {
		expect(npcRiftVisible(-CROSSING.openS - 0.01)).toBe(false);
		expect(strengthAt(-CROSSING.openS - 0.01)).toBe(0);
		// The first frame a watcher can see must be faint, or the ring reads as
		// "already open" exactly as the capture's first frame did.
		expect(strengthAt(-CROSSING.openS + 0.1)).toBeLessThan(0.05);
	});

	test("opens across the whole lead-in, so the opening is a beat and not a pop", () => {
		// The defect this replaces opened in 0.5 s; the build-up has to be long
		// enough to watch, and monotone while it runs.
		expect(CROSSING.openS).toBeGreaterThanOrEqual(1);
		let previous = -1;
		const samples = 20;
		for (let i = 0; i <= samples; i++) {
			const s = strengthAt(-CROSSING.openS + (CROSSING.openS * i) / samples);
			expect(s).toBeGreaterThanOrEqual(previous);
			previous = s;
		}
		expect(previous).toBeCloseTo(1, 6);
		// Half open at about half the lead-in: no step in the middle of it.
		expect(strengthAt(-CROSSING.openS / 2)).toBeGreaterThan(0.3);
		expect(strengthAt(-CROSSING.openS / 2)).toBeLessThan(0.7);
	});

	test("is full at the crossing, and stays full while the ship settles", () => {
		expect(strengthAt(0)).toBe(1);
		expect(strengthAt(CROSSING.crossS)).toBe(1);
		expect(strengthAt(CROSSING.holdS)).toBe(1);
	});

	test("the seal's strength falls to zero at the window's end", () => {
		expect(strengthAt(CROSSING.windowEndS)).toBe(0);
		expect(npcRiftVisible(CROSSING.windowEndS)).toBe(false);
		// This checks the timeline; arrival-rift.test.ts measures the mesh's
		// collapse, including the flare that remains bright just before removal.
		expect(strengthAt(CROSSING.windowEndS - CROSSING.sealS * 0.5)).toBeLessThan(
			strengthAt(CROSSING.holdS),
		);
	});

	test("the window is long enough to read as one event, front to back", () => {
		// The ring a watcher saw sat open for 7.5 s with no opening and no close.
		// The same total span is spent opening and sealing instead, so the whole
		// crossing has to stay watchable in one look.
		expect(CROSSING.windowS).toBeGreaterThanOrEqual(5);
		expect(CROSSING.windowS).toBeLessThanOrEqual(9);
	});

	test("the flare marks the crossing and nothing else", () => {
		expect(flareAt(-CROSSING.flareRiseS - 0.01)).toBe(0);
		expect(crossingFlare(-CROSSING.flareRiseS)).toBe(0);
		expect(crossingFlare(0)).toBeCloseTo(1, 9);
		expect(flareAt(0)).toBeGreaterThan(0.9 * CROSSING.flarePeak);
		expect(crossingFlare(CROSSING.flareFallS)).toBe(0);
		expect(flareAt(CROSSING.flareFallS + 0.01)).toBe(0);
		expect(flareAt(CROSSING.holdS / 2)).toBe(0);
	});

	test("and a second flare rides the seal, so the last thing seen is a closing", () => {
		expect(
			sealFlare(
				CROSSING.windowEndS - CROSSING.sealFlareS - 0.01,
				CROSSING.windowEndS,
			),
		).toBe(0);
		expect(
			flareAt(CROSSING.windowEndS - CROSSING.sealFlareS * 0.5),
		).toBeGreaterThan(0.2);
		// At the end the ring is gone: the flare must not outlive it.
		expect(flareAt(CROSSING.windowEndS)).toBe(0);
	});

	test("the flare never carries the ring past what #199's budget can hold", () => {
		let worst = 0;
		for (
			let ageS = -CROSSING.openS;
			ageS <= CROSSING.windowEndS;
			ageS += 0.01
		) {
			const { strength, flare } = npcRiftLook(ageS);
			worst = Math.max(worst, strength + flare);
			expect(strength).toBeGreaterThanOrEqual(0);
			expect(flare).toBeGreaterThanOrEqual(0);
		}
		expect(worst).toBeLessThanOrEqual(1 + CROSSING.flarePeak + 1e-9);
		expect(worst).toBeLessThan(1.8);
	});

	test("the opening and the swallow both fit inside the wind-up the route gives them", () => {
		// A departure ring opening before the ship is standing at its lane point
		// would draw an event with no subject: the wind-up is the only window in
		// which the ship is there to be swallowed.
		expect(CROSSING.openS).toBeLessThanOrEqual(JUMP_CHARGE_S);
		expect(CROSSING.crossS).toBeLessThanOrEqual(JUMP_CHARGE_S);
	});

	test("the lead-in is long enough for a whole hull to clear the ring's plane", () => {
		// It has to cover the ring's own standoff *and* the hull's aft extent, so
		// that a whole hull passes the plane rather than its nose alone. Both are
		// at most one hull radius, hence twice one.
		expect<number>(CROSSING.emergeRadii).toBeGreaterThanOrEqual(
			ARRIVAL_RIFT.standoffReaches + 1,
		);
		expect(length(emergenceOffset("arrival", -1, DISTANCE, NOSE))).toBeCloseTo(
			DISTANCE,
			9,
		);
		expect(
			length(emergenceOffset("arrival", CROSSING.crossS, DISTANCE, NOSE)),
		).toBe(0);
	});

	test("the extent the route reads and the reach the rift is sized from agree", () => {
		// `crossingDistanceKm` is built from `HULL_SPECS.env`, the route's own
		// measured box; `HULL_REACH_KM` is the mesh's farthest vertex and what
		// `ArrivalRift` stands itself off by. The route may not read the display
		// table, so the agreement is asserted instead of assumed — and a box whose
		// corner fell under the vertex would put a hull's nose through a ring it
		// has not come through yet.
		//
		// Measured at this commit over all twelve hulls: 1.001 (`voyager`) to 1.152
		// (`carrier`). The band is that spread with room for a hull's box to be
		// rounded up further, not a guess.
		for (const id of Object.keys(HULL_SPECS) as HullId[]) {
			const radius =
				crossingDistanceKm(HULL_SPECS[id].env, HULL_SPECS[id].envCentre) /
				CROSSING.emergeRadii;
			expect(radius).toBeGreaterThanOrEqual(HULL_REACH_KM[id]);
			expect(radius).toBeLessThanOrEqual(1.25 * HULL_REACH_KM[id]);
			expect(Number.isFinite(radius)).toBe(true);
		}
	});
});

describe("the ship's own motion through the plane (node #1006 C2, C3)", () => {
	test("an arrival starts behind the plane and ends on the lane point", () => {
		const before = emergenceOffset("arrival", -1, DISTANCE, NOSE);
		expect(before.z).toBeLessThan(0);
		const mid = emergenceOffset("arrival", CROSSING.crossS / 2, DISTANCE, NOSE);
		expect(mid.z).toBeLessThan(0);
		expect(Math.abs(mid.z)).toBeLessThan(Math.abs(before.z));
		for (const ageS of [-1, 0, CROSSING.crossS / 2, CROSSING.crossS, 5]) {
			const a = emergenceOffset("arrival", ageS, DISTANCE, NOSE);
			const b = emergenceOffset("arrival", ageS + 0.01, DISTANCE, NOSE);
			expect(b.z).toBeGreaterThanOrEqual(a.z - 1e-12);
		}
	});

	test("a departure ends with its whole hull through the plane, at the crossing", () => {
		expect(
			emergenceOffset("departure", -CROSSING.crossS - 0.1, DISTANCE, NOSE).z,
		).toBe(0);
		const at = emergenceOffset("departure", 0, DISTANCE, NOSE);
		expect(at.z).toBeCloseTo(DISTANCE, 9);
		// Monotone into the ring, and nothing once it has gone through.
		let previous = -1;
		for (let ageS = -CROSSING.crossS; ageS <= 0; ageS += 0.05) {
			const z = emergenceOffset("departure", ageS, DISTANCE, NOSE).z;
			expect(z).toBeGreaterThanOrEqual(previous);
			previous = z;
		}
	});

	test("the crossing is flown, not teleported: its fastest step is a fraction of its span", () => {
		const step = 1 / 60;
		let fastest = 0;
		for (let ageS = -CROSSING.crossS; ageS <= CROSSING.crossS; ageS += step) {
			const a = emergenceOffset("arrival", ageS, DISTANCE, NOSE);
			const b = emergenceOffset("arrival", ageS + step, DISTANCE, NOSE);
			fastest = Math.max(fastest, Math.abs(b.z - a.z) / step);
		}
		// Far under the 2 km/s combat cap, so nothing a watcher has in front of
		// them is crossable at this speed, and no swept test is stretched by it.
		expect(fastest).toBeLessThan(0.2);
	});

	test("a hull's own size sets the distance, so a carrier's crossing is a carrier's", () => {
		expect(
			Math.abs(emergenceOffset("arrival", 0, 0.2, NOSE).z),
		).toBeGreaterThan(
			Math.abs(emergenceOffset("arrival", 0, DISTANCE, NOSE).z),
		);
	});
});

describe("the player's own ring (node #1006 C4)", () => {
	const exit = (sinceS: number) =>
		witchspaceLook({ kind: "exit", sinceS, from: "jump" });

	test("flares at the moment it becomes visible, which is the crossing a chase camera sees", () => {
		const seen = WITCHSPACE.riftFullS;
		expect(exit(seen).rift).toBe(1);
		expect(exit(seen).riftFlare).toBeGreaterThan(0.9 * CROSSING.flarePeak);
		expect(exit(seen + CROSSING.flareFallS + 0.1).riftFlare).toBe(0);
	});

	test("and flares again as it seals", () => {
		const seals = WITCHSPACE.riftEndS - CROSSING.sealFlareS * 0.5;
		expect(exit(seals).riftFlare).toBeGreaterThan(0);
		expect(exit(WITCHSPACE.riftEndS).riftFlare).toBe(0);
	});

	test("nothing flares when no jump is running", () => {
		expect(witchspaceLook({ kind: "idle" }).riftFlare).toBe(0);
		expect(
			witchspaceLook({ kind: "entry", leftS: WITCHSPACE.entryS }).riftFlare,
		).toBe(0);
	});

	test("the ring's screen-space timeline is unchanged by the flare", () => {
		// #532's exit clock was judged on the strip and in flight; only the flare
		// is new, so every other term must read exactly as it did. `rift` is the
		// term the pass and the object both read.
		for (const sinceS of [0, 1, WITCHSPACE.unfoldAtS, 4, 5, 6, 7]) {
			expect(exit(sinceS).rift).toBe(
				witchspaceLook({ kind: "exit", sinceS, from: "arrival" }).rift,
			);
			expect(exit(sinceS).rift).toBeLessThanOrEqual(1);
		}
	});
});
