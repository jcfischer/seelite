/**
 * The roster's own arithmetic: is the table true, and does it agree with the
 * modules that already name the same quantities?
 *
 * `tests/hull-docking.test.ts` owns the consequence — every hull still docks.
 * This file owns the table.
 *
 * The three shapes of row here are each a rule the map records:
 *
 * - **A declaration nobody measures drifts.** The envelope rows rebuild the
 *   selected variant's mesh and compare, because the table this replaced was
 *   68% out on height and the berth catalogue had been sized from it.
 * - **Two modules that name one quantity owe an assertion that they agree**
 *   (#46). The courier's hold, tank and drive charge are `HOLD_REFERENCE_T`,
 *   `JUMP_RANGE_LY` and `CHARGE_CAPACITY_AU`; each pair is pinned here, because
 *   a grep for prose cannot check a number (#11).
 * - **A derivation must reproduce what it replaced.** #5's tuned constants are
 *   the baseline hull's, so `flightPerformance("courier")` has to be them
 *   exactly rather than nearly.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { CHARGE_CAPACITY_AU } from "../src/cruise";
import { carrierKey } from "../src/carrier-key";
import { FUEL_TANK_LY, HOLD_REFERENCE_T, marketStationOf } from "../src/market";
import { JUMP_RANGE_LY } from "../src/galaxy";
import {
	CAPITAL_HULL_IDS,
	DOCKABLE_HULL_IDS,
	HULL_IDS,
	HULL_SPECS,
	HULL_VARIANT_IDS,
	isCapital,
	PLAYER_BASELINE_HULL,
	PURCHASABLE_HULL_IDS,
	type HullEnvelope,
	type HullId,
	type HullVariantId,
} from "../src/hull";
import { buildShipMesh } from "../src/ship-mesh";
import {
	REFERENCE_ANGULAR_ACCEL,
	REFERENCE_ANGULAR_DAMP_TAU_S,
	REFERENCE_ANGULAR_MAX,
	REFERENCE_ASSIST_LATERAL_TAU_S,
	REFERENCE_THRUST_KMS2,
	flightPerformance,
} from "../src/sim";
import { newCommander, transactAtStation } from "../src/station-commerce";
import { STATION_GEOMETRY, STATION_TYPES } from "../src/station";
import { berthFits, stationInterior } from "../src/station-interior";

/** 0.1 m, in kilometres — the quantum the table's envelopes are rounded **up**
 *  to, and the tolerance the row below allows. */
const ROUNDING_KM = 0.0001;
const ceilToRounding = (km: number) =>
	Math.ceil(km / ROUNDING_KM) * ROUNDING_KM;

/** The built box of one mesh, kilometres — the same measurement
 *  `tests/helpers/rolled-envelope.ts` takes, and for the same reason: the mesh
 *  is the ship, and anything else is a claim about it. */
function builtEnvelope(id: HullId, variant: HullVariantId): HullEnvelope {
	const root = buildShipMesh(id, variant).root;
	root.updateMatrixWorld(true);
	const size = new THREE.Box3()
		.setFromObject(root)
		.getSize(new THREE.Vector3());
	// `x` is the beam and `y` the height — the mesh's own local axes, which
	// `Ship.setAttitude` puts on `cross(nose, up)` and `up`; `z` is the length.
	return { lengthKm: size.z, beamKm: size.x, heightKm: size.y };
}

/** The box **as the roster would declare it** — rounded up, exactly as the
 *  shipped envelopes are. The variant rule scores on this rather than on the raw
 *  measurement, because the game fits on the rounded figure: a variant that
 *  clears a cell raw and not after rounding would otherwise win the rule and
 *  then fit fewer roles in play. */
const declarableEnvelope = (
	id: HullId,
	variant: HullVariantId,
): HullEnvelope => {
	const built = builtEnvelope(id, variant);
	return {
		lengthKm: ceilToRounding(built.lengthKm),
		beamKm: ceilToRounding(built.beamKm),
		heightKm: ceilToRounding(built.heightKm),
	};
};

const interiorOf = (type: (typeof STATION_TYPES)[number]) =>
	stationInterior(type, STATION_GEOMETRY[type].aperturePlaneKm, 1);
const INTERIORS = STATION_TYPES.map(
	(type) => [type, interiorOf(type)] as const,
);

/** How many station roles have a berth that admits this box. The variant rule's
 *  own arithmetic, so the rule and its check read one expression. */
const rolesAdmitting = (env: HullEnvelope): number =>
	INTERIORS.filter(([, interior]) =>
		interior.berths.some((berth) => berthFits(berth, env)),
	).length;

/** One buy of a tonne good at a trade station — the shipped calculator's own
 *  input, so the hold rows go through `transactAtStation` rather than around
 *  it. Mirrors `tests/station-commerce.test.ts`'s fixture. */
const COMMERCE_STATION = marketStationOf(
	{ type: "trade", localCarrierId: "station-trade", blackMarket: false },
	0x51a7_10,
);
const commerceInput = (commander: ReturnType<typeof newCommander>) => ({
	commander,
	deficits: {},
	station: COMMERCE_STATION,
	stationKey: carrierKey(0, "station-trade"),
	economy: 3,
	gameTimeMin: 0,
	displayTL: 8,
	action: { type: "buy-commodity" as const, commodity: "Food" },
});

describe("the envelope is the mesh, not a claim about it", () => {
	test.each([...HULL_IDS])(
		"%s's declared box is its selected variant's built box, rounded up",
		(id) => {
			const spec = HULL_SPECS[id];
			const built = builtEnvelope(id, spec.variant);
			// Two-sided on purpose. **Never under**, because a berth's fit
			// predicate reads this and a low figure admits a hull that does not
			// fit; **never more than 0.1 m over**, because a generous box would
			// make the table a safety margin rather than a measurement, and the
			// place margins belong is `Berth.clear*`, which already applies one.
			for (const axis of ["lengthKm", "beamKm", "heightKm"] as const) {
				const over = spec.env[axis] - built[axis];
				expect([id, axis, over >= 0, over <= ROUNDING_KM + 1e-12]).toEqual([
					id,
					axis,
					true,
					true,
				]);
			}
			console.log(
				`${id}/${spec.variant} ${(built.lengthKm * 1000).toFixed(1)} × ` +
					`${(built.beamKm * 1000).toFixed(1)} × ${(built.heightKm * 1000).toFixed(1)} m`,
			);
		},
	);

	test("the selection rule is what chose each variant, not taste", () => {
		// **The variant admitted by the most station roles, `a` on a tie.** Stated
		// as a rule so the row can be checked; the principal may overrule any of
		// them on how it looks, and the day one is overruled this goes red and
		// says so rather than the override being invisible.
		for (const id of HULL_IDS) {
			const spec = HULL_SPECS[id];
			const scored = HULL_VARIANT_IDS.map((v) => ({
				v,
				roles: rolesAdmitting(declarableEnvelope(id, v)),
			}));
			const best = Math.max(...scored.map((s) => s.roles));
			const chosen = scored.find((s) => s.v === spec.variant);
			expect([id, chosen?.roles]).toEqual([id, best]);
			// `a` on a tie: nothing earlier in the list may match the best score.
			const first = scored.find((s) => s.roles === best);
			expect([id, first?.v]).toEqual([id, spec.variant]);
			console.log(
				`${id}: ${scored.map((s) => `${s.v}=${s.roles}`).join(" ")} → ${spec.variant}`,
			);
		}
	});

	test("the rule had something to decide — the variants are not interchangeable", () => {
		// The control for the row above. If every variant of every hull fitted
		// every role, the selection rule would be satisfied by any choice at all
		// and the previous test would pass on a build that picked at random.
		const contested = HULL_IDS.filter((id) => {
			const scores = HULL_VARIANT_IDS.map((v) =>
				rolesAdmitting(declarableEnvelope(id, v)),
			);
			return Math.min(...scores) < Math.max(...scores);
		});
		expect(contested.length).toBeGreaterThan(0);
		console.log(
			`variants that disagree about where they fit: ${contested.join(", ")}`,
		);
	});
});

describe("the roster is the single owner, not a second copy", () => {
	test("the hold a commander actually has is the hull's", () => {
		// **The row that stops `holdT` being decoration.** Sage's first round found
		// it declared and unread — `STARTING_HOLD_T = 20` still decided the hold,
		// so a freighter's stated 60 t carried 20. That constant is gone and
		// `holdCapacityT` reads the roster, and this is asserted through the
		// shipped calculator rather than against the table, because a test that
		// builds its own struct is testing a different object from the one the
		// game uses (#25's tell).
		const at = (hull: HullId) => {
			const commander = { ...newCommander(hull), credits: 100_000 };
			const full = {
				...commander,
				cargo: { Food: HULL_SPECS[hull].holdT },
			};
			return {
				refusedWhenFull: transactAtStation(commerceInput(full)).reason,
				acceptedWhenEmpty: transactAtStation(commerceInput(commander)).accepted,
			};
		};
		for (const hull of PURCHASABLE_HULL_IDS) {
			expect([hull, at(hull)]).toEqual([
				hull,
				{ refusedWhenFull: "cargo-full", acceptedWhenEmpty: true },
			]);
		}
		// And the hold genuinely differs, or the loop above would pass on a build
		// that still read one constant.
		const holds = new Set(
			PURCHASABLE_HULL_IDS.map((id) => HULL_SPECS[id].holdT),
		);
		expect(holds.size).toBeGreaterThan(1);
	});

	test("the jump range and the baseline tank agree, and this one can fail", () => {
		// **`JUMP_RANGE_LY` is galaxy-owned on purpose**, and this is the only row
		// in this file that is a genuine drift guard rather than a statement of
		// direction. #181 first derived it from the roster; sage's second round
		// named the cost — it is the **edge predicate for the connectivity
		// graph**, and the roster's figures are provisional against #183 and #8,
		// so a combat retune of one hull's tank would silently regenerate every
		// system's edge set. Two quantities that happen to be equal, so #46's
		// answer is the assertion rather than the derivation.
		expect(JUMP_RANGE_LY).toBe(HULL_SPECS[PLAYER_BASELINE_HULL].tankLy);
	});

	test("the economy and the drive read the roster rather than a copy", () => {
		// These three *are* derived — a hold reference, a purchasable tank and a
		// drive charge are the hull's own figures, and none of them decides what a
		// system is. So the three lines below are true **by construction**, and
		// they are here as a statement of the ownership direction rather than as
		// a check that could fail. The check that can fail is the hold row above:
		// a figure that no longer reaches behaviour.
		expect(HOLD_REFERENCE_T).toBe(HULL_SPECS[PLAYER_BASELINE_HULL].holdT);
		expect(FUEL_TANK_LY).toBe(HULL_SPECS[PLAYER_BASELINE_HULL].tankLy);
		expect(CHARGE_CAPACITY_AU).toBe(HULL_SPECS[PLAYER_BASELINE_HULL].chargeAu);
	});

	test("the tank and the drive charge are still one hull's, and the table says so", () => {
		// **A property nothing reads is not shipped** — #25's rule about a rule
		// that lives only in an instrument, one level along. Unlike the hold, the
		// per-hull tank is *not* wired: every router and finder takes `maxJump` as
		// a parameter and every caller hands it `JUMP_RANGE_LY`, which is the
		// baseline's. This row states which hulls are affected so the gap is in
		// the tier that can hold it rather than only in prose.
		const varies = HULL_IDS.filter(
			(id) => HULL_SPECS[id].tankLy !== JUMP_RANGE_LY,
		);
		expect(varies.length).toBeGreaterThan(0);
		console.log(`tanks the router does not yet read: ${varies.join(", ")}`);
	});

	test("the seven purchasable hulls are the seven, and no capital is among them", () => {
		const seven: HullId[] = [
			"courier",
			"explorer",
			"freighter",
			"interceptor",
			"miner",
			"prospector",
			"tug",
		];
		expect([...PURCHASABLE_HULL_IDS].sort()).toEqual(
			seven.sort() as (typeof PURCHASABLE_HULL_IDS)[number][],
		);
		for (const id of CAPITAL_HULL_IDS)
			expect([
				id,
				(PURCHASABLE_HULL_IDS as readonly HullId[]).includes(id),
			]).toEqual([id, false]);
		expect([...DOCKABLE_HULL_IDS].sort()).toEqual(
			HULL_IDS.filter((id) => !isCapital(id)).sort(),
		);
	});
});

describe("handling derives from mass and thrust, and nothing else", () => {
	test("mass tracks the hull it is the mass of", () => {
		// **The `massT` docstring says mass is set from the box volume against a
		// role density, and sage's first round was right that nothing held it** —
		// a later editor told to re-derive mass after the envelopes moved had
		// nothing to re-derive it with. The density is not a table, because a
		// table would be a third declared number pretending to be a derivation;
		// it is a *band*, and this row is what states it.
		//
		// The band is the design claim: a freighter is dense for its size because
		// cargo structure is, an interceptor light because it is mostly engine,
		// and neither is off by a factor. A mass typed in without looking at the
		// hull lands outside it.
		const MIN_T_PER_1000M3 = 1.2;
		const MAX_T_PER_1000M3 = 2.4;
		for (const id of HULL_IDS) {
			const env = HULL_SPECS[id].env;
			const volumeM3 = env.lengthKm * env.beamKm * env.heightKm * 1e9;
			const density = (HULL_SPECS[id].massT * 1000) / volumeM3;
			expect([
				id,
				density >= MIN_T_PER_1000M3,
				density <= MAX_T_PER_1000M3,
			]).toEqual([id, true, true]);
			console.log(`${id.padEnd(12)} ${density.toFixed(2)} t per 1000 m³`);
		}
	});

	test("the baseline hull reproduces #5's tuning exactly", () => {
		// Exactly rather than nearly: #5's numbers were flown and tuned, and a
		// derivation that moved them by a rounding would have retuned the game's
		// one flown hull as a side effect of adding a table.
		const perf = flightPerformance(PLAYER_BASELINE_HULL);
		expect(perf.thrustKms2).toBe(REFERENCE_THRUST_KMS2);
		expect(perf.assistLateralTauS).toBe(REFERENCE_ASSIST_LATERAL_TAU_S);
		expect(perf.angularMax).toEqual(REFERENCE_ANGULAR_MAX);
		expect(perf.angularAccel).toBe(REFERENCE_ANGULAR_ACCEL);
		expect(perf.angularDampTauS).toBe(REFERENCE_ANGULAR_DAMP_TAU_S);
	});

	test("acceleration is thrust over mass, in the units the table declares", () => {
		for (const id of HULL_IDS) {
			const spec = HULL_SPECS[id];
			expect([id, flightPerformance(id).thrustKms2]).toEqual([
				id,
				spec.thrustMN / spec.massT,
			]);
		}
	});

	test("the roster is ordered sharp to sluggish, and the spread is real", () => {
		// D5 as a measurement rather than as an adjective. The ordering is the
		// claim — an interceptor sharper than a courier sharper than a freighter —
		// and the ratio is what a pilot would have to be able to feel.
		const byAgility = [...DOCKABLE_HULL_IDS].sort(
			(a, b) =>
				flightPerformance(b).angularMax.pitch -
				flightPerformance(a).angularMax.pitch,
		);
		const rank = (id: HullId) => byAgility.indexOf(id);
		expect(rank("interceptor")).toBeLessThan(rank("courier"));
		expect(rank("courier")).toBeLessThan(rank("prospector"));
		expect(rank("prospector")).toBeLessThan(rank("tug"));
		expect(rank("tug")).toBeLessThan(rank("explorer"));
		expect(rank("explorer")).toBeLessThan(rank("freighter"));
		expect(rank("freighter")).toBeLessThan(rank("miner"));

		// **The interceptor accelerates hardest and the patrol turns tightest**,
		// and the two are different questions rather than a defect. Agility is
		// `acceleration / length`, so a hull 6% shorter out-turns one with 2% more
		// thrust-to-mass; a `fast` role that also out-turned everything would make
		// the `security` hull's own length pay for nothing. #8's pursuit rests on
		// the straight line, so that is the row asserted by role.
		const byAccel = [...DOCKABLE_HULL_IDS].sort(
			(a, b) =>
				flightPerformance(b).thrustKms2 - flightPerformance(a).thrustKms2,
		);
		expect(byAccel[0]).toBe("interceptor");

		const sharp = flightPerformance(byAgility[0]);
		const sluggish = flightPerformance(byAgility[byAgility.length - 1]);
		expect(sharp.thrustKms2 / sluggish.thrustKms2).toBeGreaterThan(2);
		expect(sharp.angularMax.pitch / sluggish.angularMax.pitch).toBeGreaterThan(
			3,
		);
		console.log(
			`sharpest ${byAgility[0]} ${((sharp.angularMax.pitch * 180) / Math.PI).toFixed(1)}°/s, ` +
				`sluggish ${byAgility[byAgility.length - 1]} ` +
				`${((sluggish.angularMax.pitch * 180) / Math.PI).toFixed(1)}°/s`,
		);
	});
});

describe("who a station has a berth for", () => {
	test("every purchasable hull fits the three full-size roles", () => {
		for (const type of STATION_TYPES) {
			if (type === "outpost") continue;
			const interior = interiorOf(type);
			for (const id of PURCHASABLE_HULL_IDS)
				expect([
					type,
					id,
					interior.berths.some((b) => berthFits(b, HULL_SPECS[id].env)),
				]).toEqual([type, id, true]);
		}
	});

	test("the outpost turns away the miner and the explorer, which is its point", () => {
		// `BERTH_CELL`'s outpost row is two thirds of the volume *so that* it
		// rejects the two largest ordinary hulls, and the prose there named the
		// miner and the explorer from the old declared figures. Measured against
		// the meshes it is still those two, so the role's intent survived the
		// correction — which is a fact worth asserting rather than assuming.
		const interior = interiorOf("outpost");
		const refused = DOCKABLE_HULL_IDS.filter(
			(id) => !interior.berths.some((b) => berthFits(b, HULL_SPECS[id].env)),
		);
		expect([...refused].sort()).toEqual(["explorer", "miner"]);
	});

	test("no berth in the game admits a capital", () => {
		for (const [type, interior] of INTERIORS)
			for (const id of CAPITAL_HULL_IDS)
				expect([
					type,
					id,
					interior.berths.some((b) => berthFits(b, HULL_SPECS[id].env)),
				]).toEqual([type, id, false]);
	});
});
