import { describe, expect, test } from "bun:test";
import { strength } from "../src/kill-credit";
import {
	type FittedModule,
	type Loadout,
	makeModule,
	stockLoadout,
} from "../src/loadout";
import { HULL_SPECS } from "../src/hull";
import {
	EARLIEST_MISSILE_FLIGHT_S,
	FIRST_MISSILE_LAUNCH_S,
	SURVIVAL_MIN_S,
	STARTER_SURVIVAL_MAX_S,
	hasRack,
	isStarterPilot,
	judgeFit,
	lighteningChain,
	selectRaiderFit,
	snapshotFit,
	stockCourierShip,
	strengthCeiling,
	survivalSeconds,
} from "../src/raider-strength-match";
import { npcLoadout } from "../src/npc-loadout";
import { RAIDER_HULL_ID } from "../src/raider-slots";
import { MISSILE } from "../src/missiles";

const SEEDS = Array.from({ length: 1000 }, (_, i) => i);
const courier = stockCourierShip();
const interceptor = {
	hull: "interceptor" as const,
	loadout: {
		...stockLoadout("interceptor"),
		h1: makeModule("beam-laser", 2, "E"),
		u1: makeModule("shield-booster", 1, "E"),
	},
};
const describeFit = (l: Loadout) =>
	Object.entries(l)
		.map(([k, m]) => `${k}:${m.module}/${m.size}${m.grade}`)
		.join(",");
const fail = (seed: number, pilot: typeof courier, l: Loadout, s: number) =>
	`seed ${seed} pilot [${describeFit(pilot.loadout)}] raider [${describeFit(l)}] destroyed in ${s}s`;

describe("stock courier", () => {
	const picks = SEEDS.map((seed) => ({
		seed,
		...selectRaiderFit(seed, courier),
	}));

	test("every fit is rack-free, armed, under the ceiling and 20-45 s", () => {
		for (const p of picks) {
			const s = p.verdict.survivalS;
			const why = fail(p.seed, courier, p.loadout, s);
			expect(hasRack(p.loadout), why).toBe(false);
			expect(
				strength({ hull: RAIDER_HULL_ID, loadout: p.loadout }),
				why,
			).toBeLessThanOrEqual(strengthCeiling(courier));
			expect(s, why).toBeGreaterThanOrEqual(SURVIVAL_MIN_S);
			expect(s, why).toBeLessThanOrEqual(STARTER_SURVIVAL_MAX_S);
			expect(
				strength({ hull: RAIDER_HULL_ID, loadout: p.loadout }),
				why,
			).toBeGreaterThan(0);
		}
	});

	test("seeds 0-999: median 32-36 s, 100+ under 30 s, 100+ over 38 s", () => {
		const t = picks.map((p) => p.verdict.survivalS).sort((a, b) => a - b);
		const median = (t[499] + t[500]) / 2;
		expect(median).toBeGreaterThanOrEqual(32);
		expect(median).toBeLessThanOrEqual(36);
		expect(t.filter((s) => s < 30).length).toBeGreaterThanOrEqual(100);
		expect(t.filter((s) => s > 38).length).toBeGreaterThanOrEqual(100);
	});

	test("the same seed and pilot fit select the same equipment", () => {
		for (const seed of [0, 7, 411, 999])
			expect(selectRaiderFit(seed, courier)).toEqual(
				selectRaiderFit(seed, snapshotFit(courier)),
			);
	});
});

describe("pilot snapshot", () => {
	test("spent ammunition and a copied fit select the same raider", () => {
		const racked = {
			hull: "courier" as const,
			loadout: {
				...stockLoadout("courier"),
				u1: { ...makeModule("missile-rack", 1), ammo: 1 },
			},
		};
		const full = {
			hull: "courier" as const,
			loadout: {
				...racked.loadout,
				u1: { ...racked.loadout.u1, ammo: 4 },
			},
		};
		for (const seed of SEEDS.slice(0, 50))
			expect(selectRaiderFit(seed, racked).loadout).toEqual(
				selectRaiderFit(seed, full).loadout,
			);
	});

	test("a snapshot does not alias the live fit", () => {
		const live = { ...courier, loadout: { ...courier.loadout } };
		const snap = snapshotFit(live);
		(live.loadout.h1 as FittedModule).grade = "A";
		expect(snap.loadout.h1.grade).toBe("E");
		(live.loadout.h1 as FittedModule).grade = "E";
	});
});

describe("unarmed and mining-only pilots", () => {
	const mining = {
		hull: "courier" as const,
		loadout: { ...stockLoadout("courier"), h1: makeModule("mining-laser", 1) },
	};
	const bare = {
		hull: "courier" as const,
		loadout: { plant: courier.loadout.plant },
	};
	test("still draw an armed opponent under the stock floor", () => {
		for (const pilot of [mining, bare]) {
			expect(strength(pilot)).toBe(0);
			expect(strengthCeiling(pilot)).toBe(strengthCeiling(courier));
			for (const seed of SEEDS.slice(0, 100)) {
				const pick = selectRaiderFit(seed, pilot);
				expect(
					strength({ hull: RAIDER_HULL_ID, loadout: pick.loadout }),
				).toBeGreaterThan(0);
				expect(pick.verdict.ok).toBe(true);
			}
		}
	});
});

describe("tougher pilot: fitted interceptor", () => {
	test("is above the starter window", () => {
		expect(isStarterPilot(interceptor)).toBe(false);
		expect(strengthCeiling(interceptor)).toBeGreaterThan(
			strengthCeiling(courier),
		);
	});

	test("every seed: under ceiling, 20 s minimum including the earliest missiles", () => {
		for (const seed of SEEDS) {
			const pick = selectRaiderFit(seed, interceptor);
			const why = fail(seed, interceptor, pick.loadout, pick.verdict.survivalS);
			expect(pick.verdict.ok, why).toBe(true);
			expect(pick.verdict.survivalS, why).toBeGreaterThanOrEqual(
				SURVIVAL_MIN_S,
			);
			expect(
				strength({ hull: RAIDER_HULL_ID, loadout: pick.loadout }),
				why,
			).toBeLessThanOrEqual(strengthCeiling(interceptor));
		}
	});

	test("a common seed gives the same weak raider against both ships, and the interceptor lasts longer", () => {
		const shared = SEEDS.filter(
			(seed) =>
				describeFit(selectRaiderFit(seed, courier).loadout) ===
				describeFit(selectRaiderFit(seed, interceptor).loadout),
		);
		expect(shared.length).toBeGreaterThan(100);
		for (const seed of shared)
			expect(
				selectRaiderFit(seed, interceptor).verdict.survivalS,
				`seed ${seed}`,
			).toBeGreaterThan(selectRaiderFit(seed, courier).verdict.survivalS);
	});

	test("the interceptor is matched up: some seeds field a stronger fit than the courier's", () => {
		const stronger = SEEDS.filter(
			(seed) =>
				selectRaiderFit(seed, interceptor).verdict.strength >
				selectRaiderFit(seed, courier).verdict.strength,
		);
		expect(stronger.length).toBeGreaterThan(100);
	});
});

describe("rack rejection", () => {
	const lasersOnly: Loadout = {
		plant: makeModule("power-plant", 1),
		h1: makeModule("pulse-laser", 2, "D"),
	};
	const racked: Loadout = {
		...lasersOnly,
		h2: makeModule("missile-rack", 1),
	};

	test("the lasers alone pass the starter window", () => {
		expect(judgeFit(lasersOnly, courier).ok).toBe(true);
	});

	test("the same lasers with a rack are rejected for the starter courier", () => {
		expect(judgeFit(racked, courier).reason).toBe("rack");
	});

	test("the earliest legal missile counts against a tougher pilot", () => {
		const without = survivalSeconds(lasersOnly, interceptor);
		const withRack = survivalSeconds(racked, interceptor);
		expect(withRack).toBeLessThan(without);
		expect(withRack).toBeGreaterThanOrEqual(
			FIRST_MISSILE_LAUNCH_S + EARLIEST_MISSILE_FLIGHT_S - 1 / 30,
		);
		expect(judgeFit(racked, interceptor).reason).toBe("short");
		expect(judgeFit(lasersOnly, interceptor).ok).toBe(true);
	});

	test("an empty rack launches nothing", () => {
		const empty: Loadout = {
			...lasersOnly,
			h2: { ...makeModule("missile-rack", 1), ammo: 0 },
		};
		expect(survivalSeconds(empty, courier)).toBe(
			survivalSeconds(lasersOnly, courier),
		);
	});

	test("missile cadence: one every 8 s while ammunition lasts", () => {
		const target = {
			hull: "freighter" as const,
			loadout: stockLoadout("freighter"),
		};
		const two = {
			plant: makeModule("power-plant", 1),
			h2: { ...makeModule("missile-rack", 1), ammo: 2 },
		};
		const none = {
			plant: makeModule("power-plant", 1),
			h2: { ...makeModule("missile-rack", 1), ammo: 0 },
		};
		expect(MISSILE.damage).toBeGreaterThan(0);
		expect(survivalSeconds(none, target)).toBe(Number.POSITIVE_INFINITY);
		expect(survivalSeconds(two, target)).toBeCloseTo(
			FIRST_MISSILE_LAUNCH_S + 8 + EARLIEST_MISSILE_FLIGHT_S,
			1,
		);
	});
});

describe("the floor fit", () => {
	test("every seed's floor is eligible against every stock hull, so the floor is never an unjudged fallback", () => {
		const floors = new Map<string, Loadout>();
		for (const seed of SEEDS) {
			const floor = lighteningChain(npcLoadout(RAIDER_HULL_ID, seed)).at(-1);
			if (floor) floors.set(describeFit(floor), floor);
		}
		expect(floors.size).toBeGreaterThan(0);
		for (const hull of Object.keys(HULL_SPECS) as (keyof typeof HULL_SPECS)[]) {
			const pilot = { hull, loadout: stockLoadout(hull) };
			for (const [fit, floor] of floors) {
				const verdict = judgeFit(floor, pilot);
				expect(verdict.ok, `${hull} floor [${fit}]: ${verdict.reason}`).toBe(
					true,
				);
			}
		}
	});
});
