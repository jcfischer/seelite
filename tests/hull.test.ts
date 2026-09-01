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
import { FUEL_TANK_LY, HOLD_REFERENCE_T } from "../src/market";
import { JUMP_RANGE_LY } from "../src/galaxy";
import {
	CAPITAL_HULL_IDS,
	DOCKABLE_HULL_IDS,
	HULL_IDS,
	HULL_SPECS,
	HULL_VARIANT_IDS,
	PLAYER_BASELINE_HULL,
	PURCHASABLE_HULL_IDS,
	type HullEnvelope,
	type HullId,
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
import { STARTING_HOLD_T } from "../src/station-commerce";
import { STATION_GEOMETRY, STATION_TYPES } from "../src/station";
import { berthFits, stationInterior } from "../src/station-interior";

/** The built box of one mesh, kilometres — the same measurement
 *  `tests/helpers/rolled-envelope.ts` takes, and for the same reason: the mesh
 *  is the ship, and anything else is a claim about it. */
function builtEnvelope(id: HullId, variant: string): HullEnvelope {
	const root = buildShipMesh(id, variant as never).root;
	root.updateMatrixWorld(true);
	const size = new THREE.Box3()
		.setFromObject(root)
		.getSize(new THREE.Vector3());
	// `x` is the beam and `y` the height — the mesh's own local axes, which
	// `Ship.setAttitude` puts on `cross(nose, up)` and `up`; `z` is the length.
	return { lengthKm: size.z, beamKm: size.x, heightKm: size.y };
}

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
			const ROUNDING_KM = 0.0001;
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
				roles: rolesAdmitting(builtEnvelope(id, v)),
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
				rolesAdmitting(builtEnvelope(id, v)),
			);
			return Math.min(...scores) < Math.max(...scores);
		});
		expect(contested.length).toBeGreaterThan(0);
		console.log(
			`variants that disagree about where they fit: ${contested.join(", ")}`,
		);
	});
});

describe("the roster agrees with the modules that already name its quantities", () => {
	test("the baseline hull's hold is the economy's reference and the starting hold", () => {
		// One quantity, three names, and #11's finding is that a grep cannot check
		// a number: `FUEL_COST_PER_LY` sat wrong in `galaxy.ts` for six weeks
		// after the specs were corrected, because the stated check was a text
		// search. An assertion is what holds.
		expect(HULL_SPECS[PLAYER_BASELINE_HULL].holdT).toBe(HOLD_REFERENCE_T);
		expect(HULL_SPECS[PLAYER_BASELINE_HULL].holdT).toBe(STARTING_HOLD_T);
	});

	test("the baseline hull's tank and drive charge are the game's", () => {
		expect(HULL_SPECS[PLAYER_BASELINE_HULL].tankLy).toBe(JUMP_RANGE_LY);
		expect(HULL_SPECS[PLAYER_BASELINE_HULL].tankLy).toBe(FUEL_TANK_LY);
		expect(HULL_SPECS[PLAYER_BASELINE_HULL].chargeAu).toBe(CHARGE_CAPACITY_AU);
	});

	test("nothing reads the other hulls' fuel yet, and the table says so", () => {
		// **A property nothing reads is not shipped** — #25's rule about a rule
		// that lives only in an instrument, one level along. The explorer's 9 LY
		// is a declaration this node makes and a later node has to wire: the
		// router and the finder take `maxJump` as a parameter but every caller
		// hands them `JUMP_RANGE_LY`. This row is here so the claim is stated in
		// the tier that can hold it rather than only in prose.
		const varies = HULL_IDS.filter(
			(id) => HULL_SPECS[id].tankLy !== JUMP_RANGE_LY,
		);
		expect(varies.length).toBeGreaterThan(0);
		console.log(
			`hulls whose tank is not the game's ${JUMP_RANGE_LY} LY and is not yet ` +
				`read by the router: ${varies.join(", ")}`,
		);
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
			expect([id, PURCHASABLE_HULL_IDS.includes(id as never)]).toEqual([
				id,
				false,
			]);
		expect([...DOCKABLE_HULL_IDS].sort()).toEqual(
			HULL_IDS.filter((id) => !CAPITAL_HULL_IDS.includes(id as never)).sort(),
		);
	});
});

describe("handling derives from mass and thrust, and nothing else", () => {
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
