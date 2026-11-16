import { useShippedInterceptorHull } from "./setup/interceptor-hull";
import { useShippedSevenShips } from "./setup/seven-ships-hull";
import { withProceduralHulls } from "./helpers/procedural-hulls";
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
	RETAINED_ENVELOPE_HULLS,
	type HullEnvelope,
	type HullId,
	type HullVariantId,
} from "../src/hull";
import { SEVEN_SHIP_FILES } from "../scripts/lib/shipped-seven-ships";
import { measureVentPlacement } from "../scripts/measure-vent-placement";
import { HULL_REACH_KM, buildShipMesh } from "../src/ship-mesh";
import { isLevelStandIn } from "../src/ship-detail";
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

await useShippedInterceptorHull();
await useShippedSevenShips();

const ROUNDING_KM = 0.0001;
const ceilToRounding = (km: number) =>
	Math.ceil(km / ROUNDING_KM) * ROUNDING_KM;

function builtEnvelope(id: HullId, variant: HullVariantId): HullEnvelope {
	const root = buildShipMesh(id, variant).root;
	root.updateMatrixWorld(true);
	const size = new THREE.Box3()
		.setFromObject(root)
		.getSize(new THREE.Vector3());
	const { x: beamKm, y: heightKm, z: lengthKm } = size;
	return { lengthKm, beamKm, heightKm };
}

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

// https://github.com/jcfischer/seelite/issues/1035
const AUTHORED_ROWS = Object.keys(SEVEN_SHIP_FILES) as HullId[];

const farthestVertexKm = (root: THREE.Object3D) => {
	root.updateMatrixWorld(true);
	const v = new THREE.Vector3();
	let out = 0;
	root.traverse((object) => {
		if (
			!(object instanceof THREE.Mesh) ||
			(object as THREE.InstancedMesh).isInstancedMesh ||
			isLevelStandIn(object) ||
			object.name.startsWith("ship-")
		)
			return;
		const position = object.geometry.getAttribute("position");
		for (let i = 0; i < position.count; i++)
			out = Math.max(
				out,
				v
					.fromBufferAttribute(position, i)
					.applyMatrix4(object.matrixWorld)
					.length(),
			);
	});
	return out;
};

const interiorOf = (type: (typeof STATION_TYPES)[number]) =>
	stationInterior(type, STATION_GEOMETRY[type].aperturePlaneKm, 1);
const INTERIORS = STATION_TYPES.map(
	(type) => [type, interiorOf(type)] as const,
);

const rolesAdmitting = (env: HullEnvelope): number =>
	INTERIORS.filter(([, interior]) =>
		interior.berths.some((berth) => berthFits(berth, env)),
	).length;

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

describe("envelopes measure the mesh or retain an approved simulation box", () => {
	test.each(HULL_IDS.filter((id) => !RETAINED_ENVELOPE_HULLS.has(id)))(
		"%s's declared box is its selected variant's built box, rounded up",
		(id) => {
			const spec = HULL_SPECS[id];
			const built = builtEnvelope(id, spec.variant);
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

	test.each(AUTHORED_ROWS)(
		"%s's display reach is its model's and its loft's farthest vertex, rounded up",
		(id) => {
			const model = farthestVertexKm(
				buildShipMesh(id, HULL_SPECS[id].variant).root,
			);
			const loft = withProceduralHulls(() =>
				farthestVertexKm(buildShipMesh(id, HULL_SPECS[id].variant).root),
			);
			const reach = Math.ceil(Math.max(model, loft) * 10_000 - 1e-9) / 10_000;
			expect({ id, reach: HULL_REACH_KM[id] }).toEqual({ id, reach });
		},
	);

	const retainedEnvelopes: Partial<Record<HullId, HullEnvelope>> = {
		interceptor: { lengthKm: 0.0624, beamKm: 0.0253, heightKm: 0.0252 },
	};
	test("only approved hulls retain their established fit envelopes", () => {
		expect(Object.keys(retainedEnvelopes)).toEqual([
			...RETAINED_ENVELOPE_HULLS,
		]);
	});
	test.each([...RETAINED_ENVELOPE_HULLS])(
		"%s retains its established fit envelope around its authored hull",
		(id) => {
			const spec = HULL_SPECS[id];
			expect(retainedEnvelopes[id]).toEqual(spec.env);
			const built = builtEnvelope(id, spec.variant);
			for (const axis of ["lengthKm", "beamKm", "heightKm"] as const)
				expect(built[axis]).toBeLessThanOrEqual(spec.env[axis]);
		},
	);

	test("the selection rule is what chose each variant, not taste", () => {
		withProceduralHulls(() => {
			for (const id of HULL_IDS) {
				const spec = HULL_SPECS[id];
				const scored = HULL_VARIANT_IDS.map((v) => ({
					v,
					roles: rolesAdmitting(declarableEnvelope(id, v)),
				}));
				const best = Math.max(...scored.map((s) => s.roles));
				const chosen = scored.find((s) => s.v === spec.variant);
				expect([id, chosen?.roles]).toEqual([id, best]);
				const earliestAtBest = scored.find((s) => s.roles === best);
				expect([id, earliestAtBest?.v]).toEqual([id, spec.variant]);
				console.log(
					`${id}: ${scored.map((s) => `${s.v}=${s.roles}`).join(" ")} → ${spec.variant}`,
				);
			}
		});
	});

	test("the rule had something to decide — the variants are not interchangeable", () => {
		const contested = withProceduralHulls(() =>
			HULL_IDS.filter((id) => {
				const scores = HULL_VARIANT_IDS.map((v) =>
					rolesAdmitting(declarableEnvelope(id, v)),
				);
				return Math.min(...scores) < Math.max(...scores);
			}),
		);
		expect(contested.length).toBeGreaterThan(0);
		console.log(
			`variants that disagree about where they fit: ${contested.join(", ")}`,
		);
	});
});

// https://github.com/jcfischer/seelite/issues/1035
describe("the vent rows are the model's measurements", () => {
	test.each(AUTHORED_ROWS)(
		"%s's stored placement is the one its metal gives",
		(id) => {
			const root = buildShipMesh(id, HULL_SPECS[id].variant).root;
			root.updateMatrixWorld(true);
			expect({ id, placement: HULL_SPECS[id].ventPlacement }).toEqual({
				id,
				placement: measureVentPlacement(id, root),
			});
		},
		60_000,
	);
});

describe("the roster is the single owner, not a second copy", () => {
	test("the hold a commander actually has is the hull's", () => {
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
		const holds = new Set(
			PURCHASABLE_HULL_IDS.map((id) => HULL_SPECS[id].holdT),
		);
		expect(holds.size).toBeGreaterThan(1);
	});

	test("the connectivity predicate and the baseline tank agree, and this one can fail", () => {
		expect(JUMP_RANGE_LY).toBe(HULL_SPECS[PLAYER_BASELINE_HULL].tankLy);
	});

	test("the hold reference is the roster's", () => {
		expect(HOLD_REFERENCE_T).toBe(HULL_SPECS[PLAYER_BASELINE_HULL].holdT);
	});

	test("the tanks and the drive charges genuinely differ, so reading one hull's is visible", () => {
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
		const PINNED: Partial<
			Record<HullId, { massT: number; env: HullEnvelope }>
		> = {
			miner: {
				massT: 215,
				env: { lengthKm: 0.0845, beamKm: 0.0341, heightKm: 0.0188 },
			},
			carrier: {
				massT: 14000,
				env: { lengthKm: 0.4068, beamKm: 0.1895, heightKm: 0.1895 },
			},
			prospector: {
				massT: 58,
				env: { lengthKm: 0.0664, beamKm: 0.0201, heightKm: 0.015 },
			},
			dreadnought: {
				massT: 12000,
				env: { lengthKm: 0.432, beamKm: 0.1895, heightKm: 0.1895 },
			},
		};
		const MIN_T_PER_1000M3 = 1.2;
		const MAX_T_PER_1000M3 = 2.4;
		for (const id of HULL_IDS) {
			const env = HULL_SPECS[id].env;
			const volumeM3 = env.lengthKm * env.beamKm * env.heightKm * 1e9;
			const density = (HULL_SPECS[id].massT * 1000) / volumeM3;
			const pinned = PINNED[id];
			if (pinned) {
				// https://github.com/jcfischer/seelite/issues/815
				// Four authored boxes keep their approved masses: https://github.com/jcfischer/seelite/issues/1035
				expect({ massT: HULL_SPECS[id].massT, env }).toEqual(pinned);
				console.log(
					`${id.padEnd(12)} ${density.toFixed(2)} t per 1000 m³ (pinned, an authored box)`,
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
		const MIN_T_PER_1000M3 = 1.2;
		const MAX_T_PER_1000M3 = 2.4;
		const densityOf = (massT: number, env: HullEnvelope) =>
			(massT * 1000) / (env.lengthKm * env.beamKm * env.heightKm * 1e9);
		const courierMassOnMinerBox = densityOf(
			HULL_SPECS.courier.massT,
			HULL_SPECS.miner.env,
		);
		const minerMassOnCourierBox = densityOf(
			HULL_SPECS.miner.massT,
			HULL_SPECS.courier.env,
		);
		expect(courierMassOnMinerBox).toBeLessThan(MIN_T_PER_1000M3);
		expect(minerMassOnCourierBox).toBeGreaterThan(MAX_T_PER_1000M3);
	});

	test("the baseline hull reproduces #5's tuning exactly", () => {
		const perf = flightPerformance(PLAYER_BASELINE_HULL);
		expect(perf.thrustKms2).toBe(REFERENCE_THRUST_KMS2);
		expect(perf.assistLateralTauS).toBe(REFERENCE_ASSIST_LATERAL_TAU_S);
		expect(perf.angularMax).toEqual(REFERENCE_ANGULAR_MAX);
		const ventShareSolvedDigits = 5;
		expect(perf.angularAccel).toBeCloseTo(
			REFERENCE_ANGULAR_ACCEL,
			ventShareSolvedDigits,
		);
		expect(perf.angularDampTauS).toBe(REFERENCE_ANGULAR_DAMP_TAU_S);
	});

	test("every integrity figure is the law the table states it follows", () => {
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
		const handled = HULL_IDS.filter((id) => !isCapital(id));
		const byAgility = [...handled].sort(
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
		for (const id of HULL_IDS)
			expect([id, HULL_SPECS[id].priceCr]).toEqual([
				id,
				hullPriceCr(HULL_SPECS[id].holdT),
			]);
	});

	test("the capitals have no price, and it is the ceiling that says so", () => {
		for (const id of CAPITAL_HULL_IDS) {
			expect(HULL_SPECS[id].holdT).toBeGreaterThan(HULL_CEILING_HOLD_T);
			expect(HULL_SPECS[id].priceCr).toBeNull();
		}
		for (const id of DOCKABLE_HULL_IDS)
			expect([id, HULL_SPECS[id].priceCr]).not.toEqual([id, null]);
	});

	test("the price law is monotone in the hold, and bends at the knee", () => {
		let last = 0;
		let lastPerTonne = Number.POSITIVE_INFINITY;
		for (let holdT = 1; holdT <= HULL_CEILING_HOLD_T; holdT++) {
			const price = hullPriceCr(holdT) as number;
			expect(price).toBeGreaterThanOrEqual(last);
			last = price;
			const perTonne = price / holdT;
			const perTonneRoundingSlack = HULL_PRICE_STEP_CR / holdT;
			expect(perTonne).toBeLessThanOrEqual(
				lastPerTonne + perTonneRoundingSlack,
			);
			lastPerTonne = perTonne;
		}
		expect(HULL_PRICE_EXPONENT).toBeGreaterThan(0);
		expect(HULL_PRICE_EXPONENT).toBeLessThanOrEqual(1);
		expect(HULL_PRICE_UPPER_EXPONENT).toBeLessThan(HULL_PRICE_EXPONENT);
		expect(PURCHASABLE_HULL_IDS.map((id) => HULL_SPECS[id].holdT)).toContain(
			HULL_PRICE_KNEE_HOLD_T,
		);
		const spanWideEnoughToDwarfRounding = 3;
		const elasticity = (lo: number, hi: number) =>
			Math.log((hullPriceCr(hi) as number) / (hullPriceCr(lo) as number)) /
			Math.log(hi / lo);
		const below = elasticity(
			HULL_PRICE_KNEE_HOLD_T / spanWideEnoughToDwarfRounding,
			HULL_PRICE_KNEE_HOLD_T,
		);
		const above = elasticity(HULL_PRICE_KNEE_HOLD_T, HULL_CEILING_HOLD_T);
		expect(below - above).toBeGreaterThan(0.2);
	});

	test("the shipped prices are the ones §7.1 publishes, to the credit", () => {
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
		for (const id of HULL_IDS) {
			const price = HULL_SPECS[id].priceCr;
			if (price !== null) expect(price % HULL_PRICE_STEP_CR).toBe(0);
		}
	});

	test("the prose that quotes the constants agrees with the leaf", () => {
		const read = (path: string) =>
			readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(
				/\s+/g,
				" ",
			);
		const withCommas = (n: number) => n.toLocaleString("en-GB");
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
		expect(rows.length).toBe(PURCHASABLE_HULL_IDS.length + 2);
		for (const row of rows)
			expect([row.holdT, row.priceCr as number | null]).toEqual([
				row.holdT,
				hullPriceCr(row.holdT),
			]);

		const pitfalls = read("docs/pitfalls.md");
		expect(pitfalls).toContain("HULL_PRICE_BASELINE_CR");
		expect(pitfalls).toContain("HULL_PRICE_EXPONENT");
		const hullTrap = pitfalls.slice(
			pitfalls.indexOf("A hull's price is a law"),
			pitfalls.indexOf("`src/hull.ts` is the third leaf"),
		);
		expect(hullTrap.length).toBeGreaterThan(200);
		expect(hullTrap).not.toMatch(/\d{1,3}(?:,\d{3})+ Cr/);

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
		const derived = derivedCeiling();
		expect(HULL_CEILING_HOLD_T).toBe(derived.holdT);
		expect(derived.largestType).toBe("trade");
		expect(CEILING_REFERENCE.hull).toBe("freighter");
		for (const id of DOCKABLE_HULL_IDS)
			expect(HULL_SPECS[id].holdT).toBeLessThanOrEqual(HULL_CEILING_HOLD_T);
	});

	test("the live roster's densest hold would derive another ceiling, and that is the principal's call", () => {
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
		for (const id of DOCKABLE_HULL_IDS)
			expect([id, fits(HULL_SPECS[id].holdT)]).toEqual([id, true]);
	});
});
