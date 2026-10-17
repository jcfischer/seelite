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
 *   (#46). The courier's hold is `HOLD_REFERENCE_T` and its tank is
 *   `JUMP_RANGE_LY`, the galaxy's connectivity predicate; each pair is pinned,
 *   because a grep for prose cannot check a number (#11). The tank and the
 *   drive charge are read off the flown hull everywhere else since #554, which
 *   `tests/hull-reach.test.ts` holds.
 * - **A derivation must reproduce what it replaced.** #5's tuned constants are
 *   the baseline hull's, so `flightPerformance("courier")` has to be them
 *   exactly rather than nearly.
 */

import { TOP_RUNGS } from "../src/ladder";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { carrierKey } from "../src/carrier-key";
import { HOLD_REFERENCE_T, marketStationOf } from "../src/market";
import { JUMP_RANGE_LY } from "../src/galaxy";
import {
	CAPITAL_HULL_IDS,
	DOCKABLE_HULL_IDS,
	HULL_CEILING_HOLD_T,
	HULL_IDS,
	HULL_PRICE_BASELINE_CR,
	HULL_PRICE_EXPONENT,
	HULL_PRICE_KNEE_HOLD_T,
	HULL_PRICE_STEP_CR,
	HULL_PRICE_UPPER_EXPONENT,
	HULL_SPECS,
	HULL_VARIANT_IDS,
	hullPriceCr,
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
import {
	BERTH_CELL,
	berthFits,
	stationInterior,
} from "../src/station-interior";
import {
	CEILING_REFERENCE,
	derivedCeiling,
	hullBoxM3,
	rosterCeiling,
	stretchedToHold,
} from "./helpers/hull-math";

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
	entrustedT: 0,
	rungs: TOP_RUNGS,
	hullReach: () => ({ ok: true, systems: 1 }) as const,
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

	test("the connectivity predicate and the baseline tank agree, and this one can fail", () => {
		// **`JUMP_RANGE_LY` is galaxy-owned on purpose** (#185 D2): it is the
		// reach at which every galaxy is connected, and the roster's figures are
		// provisional against #183 and #8, so deriving it would let a retune of
		// one hull regenerate every system's edge set. It is the courier's tank
		// and nobody's jump gate; #46's answer is the assertion.
		expect(JUMP_RANGE_LY).toBe(HULL_SPECS[PLAYER_BASELINE_HULL].tankLy);
	});

	test("the hold reference is the roster's", () => {
		// Derived, so true **by construction** — a statement of the ownership
		// direction rather than a check that could fail.
		expect(HOLD_REFERENCE_T).toBe(HULL_SPECS[PLAYER_BASELINE_HULL].holdT);
	});

	test("the tanks and the drive charges genuinely differ, so reading one hull's is visible", () => {
		// #554 wired both per hull; `tests/hull-reach.test.ts` fails if a call
		// site hands the router the galaxy's constant. That check is worth
		// something only while the roster actually varies, which this pins.
		const tanks = new Set(
			PURCHASABLE_HULL_IDS.map((id) => HULL_SPECS[id].tankLy),
		);
		const charges = new Set(
			PURCHASABLE_HULL_IDS.map((id) => HULL_SPECS[id].chargeAu),
		);
		expect(tanks.size).toBeGreaterThan(1);
		expect(charges.size).toBeGreaterThan(1);
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
			if (id === "miner") {
				// **The one named exemption, and it is pinned rather than banded**
				// (node #815). Longwall B's box replaced the loft's, and the mass
				// it would re-derive to is a stat change the principal has not
				// made, so the old 215 t stands in a box it was not derived from.
				// Pinned to both figures, so re-deriving the mass or moving the
				// box makes this row red and somebody deletes the exemption.
				expect([HULL_SPECS.miner.massT, env]).toEqual([
					215,
					{ lengthKm: 0.0845, beamKm: 0.0341, heightKm: 0.0188 },
				]);
				expect(density).toBeGreaterThan(MAX_T_PER_1000M3);
				console.log(
					`${id.padEnd(12)} ${density.toFixed(2)} t per 1000 m³ (exempt, node #815)`,
				);
				continue;
			}
			expect([
				id,
				density >= MIN_T_PER_1000M3,
				density <= MAX_T_PER_1000M3,
			]).toEqual([id, true, true]);
			console.log(`${id.padEnd(12)} ${density.toFixed(2)} t per 1000 m³`);
		}
	});

	test("the density band had something to exclude", () => {
		// The control the row above owes, in the shape the variant rule's has: a
		// band wide enough to admit anything is satisfied by a mass typed in
		// without looking at the hull, and would pass on the build it exists to
		// catch. So the band is checked against the case it is for — the courier's
		// mass on the miner's box, which is the shape of "a figure copied from
		// the row above it".
		const MIN_T_PER_1000M3 = 1.2;
		const MAX_T_PER_1000M3 = 2.4;
		const densityOf = (massT: number, env: HullEnvelope) =>
			(massT * 1000) / (env.lengthKm * env.beamKm * env.heightKm * 1e9);
		const swapped = densityOf(HULL_SPECS.courier.massT, HULL_SPECS.miner.env);
		expect(swapped).toBeLessThan(MIN_T_PER_1000M3);
		// And the other direction: the miner's mass on the courier's box.
		expect(
			densityOf(HULL_SPECS.miner.massT, HULL_SPECS.courier.env),
		).toBeGreaterThan(MAX_T_PER_1000M3);
	});

	test("the baseline hull reproduces #5's tuning exactly", () => {
		// Exactly rather than nearly: #5's numbers were flown and tuned, and a
		// derivation that moved them by a rounding would have retuned the game's
		// one flown hull as a side effect of adding a table.
		const perf = flightPerformance(PLAYER_BASELINE_HULL);
		expect(perf.thrustKms2).toBe(REFERENCE_THRUST_KMS2);
		expect(perf.assistLateralTauS).toBe(REFERENCE_ASSIST_LATERAL_TAU_S);
		expect(perf.angularMax).toEqual(REFERENCE_ANGULAR_MAX);
		// The one figure that is the vents' rather than a ratio against the
		// baseline (#619): what the courier's attitude couples deliver, solved to
		// #5's 3 rad/s² at the six figures `hull.ts` stores its shares to.
		expect(perf.angularAccel).toBeCloseTo(REFERENCE_ANGULAR_ACCEL, 5);
		expect(perf.angularDampTauS).toBe(REFERENCE_ANGULAR_DAMP_TAU_S);
	});

	test("every integrity figure is the law the table states it follows", () => {
		// Two independent artifacts — a written law and a typed number per hull — so
		// this is a comparison rather than a tautology: it goes red on a
		// hand-edited row, which is what makes a deliberate deviation from #8's
		// balance visible instead of reading as a typo.
		for (const id of HULL_IDS)
			expect([id, HULL_SPECS[id].integrity]).toEqual([
				id,
				Math.round(100 * (HULL_SPECS[id].massT / 60) ** 0.6),
			]);
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

describe("what a hull costs (#182, #26's D4 and D7)", () => {
	test("every row is `hullPriceCr` of its own hold, and nothing else", () => {
		// The same discipline `integrity` gets: the figure is stored because a
		// screen reads a row rather than calling a function, and it is asserted
		// against the law so a hand-edited price is a deliberate deviation.
		for (const id of HULL_IDS)
			expect([id, HULL_SPECS[id].priceCr]).toEqual([
				id,
				hullPriceCr(HULL_SPECS[id].holdT),
			]);
	});

	test("the capitals have no price, and it is the ceiling that says so", () => {
		// Not a hand-maintained exemption list: the law returns `null` above the
		// ceiling, and the capitals are above it. A capital that shrank into a
		// dockable hold would get a price from the same rule.
		for (const id of CAPITAL_HULL_IDS) {
			expect(HULL_SPECS[id].holdT).toBeGreaterThan(HULL_CEILING_HOLD_T);
			expect(HULL_SPECS[id].priceCr).toBeNull();
		}
		// …and every hull that is *not* a capital is priced, so `null` never
		// silently spreads to a hull a shipyard is meant to sell.
		for (const id of DOCKABLE_HULL_IDS)
			expect([id, HULL_SPECS[id].priceCr]).not.toEqual([id, null]);
	});

	test("the price law is monotone in the hold, and bends at the knee", () => {
		// **#383's finding, in the shape it has.** With §5.6's spread live the
		// roster's holds earn in proportion to the hold, so the lower segment is
		// never *dearer* per tonne as it grows; above the knee the shelves run
		// short and every further tonne earns less. The loop cannot tell one
		// law from two; the knee is the elasticity read off the *prices* either
		// side of it, which a single power law of any exponent holds equal.
		// #182's law fails that, and so would the ^0.88 candidate.
		let last = 0;
		let lastPerTonne = Number.POSITIVE_INFINITY;
		for (let holdT = 1; holdT <= HULL_CEILING_HOLD_T; holdT++) {
			const price = hullPriceCr(holdT) as number;
			expect(price).toBeGreaterThanOrEqual(last);
			last = price;
			// A rounded price is off the law by up to half a step, so a tonne's
			// share of it can wobble by that much over the hold.
			const perTonne = price / holdT;
			expect(perTonne).toBeLessThanOrEqual(
				lastPerTonne + HULL_PRICE_STEP_CR / holdT,
			);
			lastPerTonne = perTonne;
		}
		expect(HULL_PRICE_EXPONENT).toBeGreaterThan(0);
		expect(HULL_PRICE_EXPONENT).toBeLessThanOrEqual(1);
		expect(HULL_PRICE_UPPER_EXPONENT).toBeLessThan(HULL_PRICE_EXPONENT);
		// The knee is a hold the roster sells, so no hull is priced by a segment
		// that was fitted without it.
		expect(PURCHASABLE_HULL_IDS.map((id) => HULL_SPECS[id].holdT)).toContain(
			HULL_PRICE_KNEE_HOLD_T,
		);
		// Read off the rounded prices over a wide span each side, so the
		// rounding step is far below the difference being asserted.
		const elasticity = (lo: number, hi: number) =>
			Math.log((hullPriceCr(hi) as number) / (hullPriceCr(lo) as number)) /
			Math.log(hi / lo);
		const below = elasticity(
			HULL_PRICE_KNEE_HOLD_T / 3,
			HULL_PRICE_KNEE_HOLD_T,
		);
		const above = elasticity(HULL_PRICE_KNEE_HOLD_T, HULL_CEILING_HOLD_T);
		expect(below - above).toBeGreaterThan(0.2);
	});

	test("the shipped prices are the ones §7.1 publishes, to the credit", () => {
		// **A pin, and it is not derived from its subject.** The check it replaces
		// was `hullPriceCr(baselineHold) === HULL_PRICE_BASELINE_CR`, which is
		// `baseline × 1^exponent` and holds for any pair of constants — so it
		// could not have caught the pair moving, which is exactly what happened
		// once in this node's own review. These seven figures are the table
		// `economy-trade.md` §7.1 prints and a shipyard screen will read; moving
		// either constant fails here first.
		expect(
			Object.fromEntries(
				PURCHASABLE_HULL_IDS.map((id) => [id, HULL_SPECS[id].priceCr]),
			),
		).toEqual({
			interceptor: 9_200,
			prospector: 13_800,
			courier: 23_000,
			tug: 27_600,
			explorer: 34_500,
			miner: 46_000,
			freighter: 69_000,
		});
		expect(hullPriceCr(HULL_CEILING_HOLD_T)).toBe(128_000);
		expect(HULL_PRICE_BASELINE_CR % HULL_PRICE_STEP_CR).toBe(0);
		// Every quoted price is on the step, so a spec table and a shipyard screen
		// cannot round differently.
		for (const id of HULL_IDS) {
			const price = HULL_SPECS[id].priceCr;
			if (price !== null) expect(price % HULL_PRICE_STEP_CR).toBe(0);
		}
	});

	test("the prose that quotes the constants agrees with the leaf", () => {
		// **The drift this catches happened.** #182's review moved the pair once,
		// and `CLAUDE.md` and §1's constant table went on printing the superseded
		// figures with every gate green — a spec is a claim like any other, and
		// §1's own rule is that a quoted figure has a re-derivation path.
		// `hud-scanner-spec.test.ts` is the precedent for reading one here.
		const read = (path: string) =>
			readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(
				/\s+/g,
				" ",
			);
		const withCommas = (n: number) => n.toLocaleString("en-GB");
		// **The published tables, row by row, rather than every price-shaped number
		// in the sections.** Two drafts of this guard got the scope wrong: one
		// searched for `30,000 Cr x (hold`, a shape neither file writes, so it
		// passed at any constants; the next matched every "NN,N00 Cr" in the whole
		// spec and tripped on commodity figures and on the derivation's own
		// intermediate. What binds is the claim actually being made — §7.1 and
		// §7.2 publish a table of hulls and holds against prices, and every row of
		// it has to be `hullPriceCr` of the hold in the same row.
		const specAll = read("docs/specs/economy-trade.md");
		const priceSections = specAll.slice(
			specAll.indexOf("### 7.1 Hull prices"),
			specAll.indexOf("## 8. The progression pump"),
		);
		expect(priceSections.length).toBeGreaterThan(1000);
		const rows = [
			...priceSections.matchAll(
				/\|[^|]*\|\s*(\d+) t\s*\|\s*\*{0,2}(\d{1,3}(?:,\d{3})+) Cr\*{0,2}\s*(?:—[^|]*)?\|/g,
			),
		].map((m) => ({
			holdT: Number(m[1]),
			priceCr: Number(m[2].replace(/,/g, "")),
		}));
		// Seven civilian hulls and two rungs — if the tables stop being read the
		// loop below would pass on nothing at all.
		expect(rows.length).toBe(PURCHASABLE_HULL_IDS.length + 2);
		for (const row of rows)
			expect([row.holdT, row.priceCr as number | null]).toEqual([
				row.holdT,
				hullPriceCr(row.holdT),
			]);

		// **The pitfalls name the constants rather than restating them**, so there
		// is nothing there to go stale — which is the fix for the round where
		// CLAUDE.md carried a superseded pair with every gate green. The trap moved
		// to docs/pitfalls.md with the rest of them.
		const claudeMd = read("docs/pitfalls.md");
		expect(claudeMd).toContain("HULL_PRICE_BASELINE_CR");
		expect(claudeMd).toContain("HULL_PRICE_EXPONENT");
		const hullTrap = claudeMd.slice(
			claudeMd.indexOf("A hull's price is a law"),
			claudeMd.indexOf("`src/hull.ts` is the third leaf"),
		);
		expect(hullTrap.length).toBeGreaterThan(200);
		expect(hullTrap).not.toMatch(/\d{1,3}(?:,\d{3})+ Cr/);

		// The spec is the owner, so it must carry the live pair and the table.
		const spec = specAll;
		expect(spec).toContain(
			`HULL_PRICE_BASELINE_CR = ${withCommas(HULL_PRICE_BASELINE_CR)} Cr`,
		);
		expect(spec).toContain(`HULL_PRICE_EXPONENT = ${HULL_PRICE_EXPONENT}`);
		expect(spec).toContain(
			`HULL_PRICE_KNEE_HOLD_T = ${HULL_PRICE_KNEE_HOLD_T} t`,
		);
		expect(spec).toContain(
			`HULL_PRICE_UPPER_EXPONENT = ${HULL_PRICE_UPPER_EXPONENT}`,
		);
		expect(spec).toContain(`HULL_CEILING_HOLD_T = ${HULL_CEILING_HOLD_T} t`);
		for (const id of PURCHASABLE_HULL_IDS)
			expect([
				id,
				spec.includes(`${withCommas(HULL_SPECS[id].priceCr as number)} Cr`),
			]).toEqual([id, true]);
	});

	test("the ceiling is the berth catalogue's, re-derived from it", () => {
		// **The leaf cannot import the berth cell, so this is where the two sides
		// meet.** `hull.ts` imports nothing and `headless.test.ts` asserts it, so
		// `HULL_CEILING_HOLD_T` is declared there and re-derived here — the same
		// split `env` and `integrity` already use.
		//
		// The derivation: the largest clear berth envelope in the game, against
		// the densest hold the roster has measured. It is an upper bound in the
		// safe direction, so it assumes a hull could be a solid box at that
		// density.
		const derived = derivedCeiling();
		expect(HULL_CEILING_HOLD_T).toBe(derived.holdT);
		// …and the derivation reached the rows it is supposed to: the largest
		// berth in the game, named rather than assumed, so a retune that moved it
		// shows up here as a changed name rather than only as a changed number.
		// The density is `CEILING_REFERENCE`'s, the hold #182 ratified the
		// ceiling against; the row below says what the live roster would make
		// of it.
		expect(derived.largestType).toBe("trade");
		expect(CEILING_REFERENCE.hull).toBe("freighter");
		// …and it really is a ceiling: every hull a berth admits is under it, and
		// the two that no berth admits are over it.
		for (const id of DOCKABLE_HULL_IDS)
			expect(HULL_SPECS[id].holdT).toBeLessThanOrEqual(HULL_CEILING_HOLD_T);
	});

	test("the live roster's densest hold would derive another ceiling, and that is the principal's call", () => {
		// **A tripwire, not a gate (node #813).** The authored O2 Porter carries
		// the reference's 60 t in a box a third smaller, so the same derivation on
		// the shipped roster gives a higher ceiling — one under which two
		// capitals would take a price. Held exactly, so the divergence is on
		// record: a change to the Porter's box or hold, or a decision to adopt the
		// live figure, moves this row and has to say so.
		const live = rosterCeiling();
		expect(live.densestHull).toBe("freighter");
		expect(Math.round(live.m3PerT)).toBe(698);
		expect(live.holdT).toBe(299);
		expect(live.holdT).toBeGreaterThan(HULL_CEILING_HOLD_T);
		const priced = HULL_IDS.filter(
			(id) =>
				HULL_SPECS[id].priceCr === null && HULL_SPECS[id].holdT <= live.holdT,
		);
		expect(priced).toEqual(["dreadnought", "voyager"]);
		console.log(
			`ceiling: ${HULL_CEILING_HOLD_T} t on the reference, ${live.holdT} t on the live ` +
				`roster (${live.densestHull} ${live.m3PerT.toFixed(0)} m³/t); adopting it prices ${priced.join(", ")}`,
		);
	});

	test("the ceiling is the last hold a berth can admit, and one tonne more is not", () => {
		// **The control on the re-derivation above, and it reads the ceiling.** A
		// draft of this test built its boxes out of `BERTH_CELL` alone and claimed
		// to pin `HULL_CEILING_HOLD_T`; it passed at any ceiling, because nothing
		// in it mentioned one. What binds is the pair either side of the boundary.
		//
		// The hull is the cargo role stretched along the axis #26 leaves free —
		// beam and height are nearly spent — so its hold grows with its length at
		// the reference's density, which is the density the ceiling is derived
		// from (`CEILING_REFERENCE`).
		const referenceM3PerT =
			hullBoxM3(CEILING_REFERENCE.env) / CEILING_REFERENCE.holdT;
		const berths = stationInterior(
			"trade",
			STATION_GEOMETRY.trade.aperturePlaneKm,
			1,
		).berths;
		const fits = (holdT: number) =>
			berths.some((berth) =>
				berthFits(
					berth,
					stretchedToHold(holdT, referenceM3PerT, BERTH_CELL.trade),
				),
			);
		expect(fits(HULL_CEILING_HOLD_T)).toBe(true);
		expect(fits(HULL_CEILING_HOLD_T + 1)).toBe(false);
		// …and it is the *first* failure, not merely a failure a long way up: the
		// whole roster below it fits, which is what makes the boundary the ceiling
		// rather than an arbitrary large number.
		for (const id of DOCKABLE_HULL_IDS)
			expect([id, fits(HULL_SPECS[id].holdT)]).toEqual([id, true]);
	});
});
