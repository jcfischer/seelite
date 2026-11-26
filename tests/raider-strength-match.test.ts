import { describe, expect, test } from "bun:test";
import { HULL_SPECS } from "../src/hull";
import {
	type FittedModule,
	type Loadout,
	makeModule,
	stockLoadout,
} from "../src/loadout";
import { MISSILE } from "../src/missiles";
import { npcLoadout } from "../src/npc-loadout";
import {
	EARLIEST_MISSILE_FLIGHT_S,
	FIRST_MISSILE_LAUNCH_S,
	MISSILE_RELAUNCH_S,
	SURVIVAL_MIN_S,
	isStarterPilot,
	judgeFit,
	lighteningChain,
	selectRaiderFit,
	snapshotFit,
	stockCourierShip,
	strengthCeiling,
	survivalSeconds,
} from "../src/raider-strength-match";
import { RAIDER_HULL_ID } from "../src/raider-slots";

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
const plant = makeModule("power-plant", 1);
const describeFit = (l: Loadout) =>
	Object.entries(l)
		.map(([k, m]) => `${k}:${m.module}/${m.size}${m.grade}`)
		.join(",");
const floorOf = (grade: FittedModule["grade"]): Loadout => ({
	plant,
	h1: makeModule("pulse-laser", 1, grade),
});

describe("selection", () => {
	test("the same seed and pilot fit select the same equipment", () => {
		for (const seed of [0, 7, 411, 999])
			expect(selectRaiderFit(seed, courier)).toEqual(
				selectRaiderFit(seed, snapshotFit(courier)),
			);
	});

	test("a raider keeps its seeded fit exactly when it was eligible as drawn", () => {
		const picks = [courier, interceptor].flatMap((pilot) =>
			[...SEEDS.slice(0, 10), 107, 184].map((seed) => ({
				pick: selectRaiderFit(seed, pilot),
				drawn: npcLoadout(RAIDER_HULL_ID, seed),
			})),
		);
		for (const { pick, drawn } of picks)
			expect(pick.kept).toBe(describeFit(pick.loadout) === describeFit(drawn));
		expect(picks.some(({ pick }) => pick.kept)).toBe(true);
		expect(picks.some(({ pick }) => !pick.kept)).toBe(true);
	});
});

describe("pilot snapshot", () => {
	test("a snapshot does not alias the live fit", () => {
		const live = { ...courier, loadout: { ...courier.loadout } };
		const snap = snapshotFit(live);
		(live.loadout.h1 as FittedModule).grade = "A";
		expect(snap.loadout.h1.grade).toBe("E");
		(live.loadout.h1 as FittedModule).grade = "E";
	});
});

describe("the starter window", () => {
	test("is above the starter window", () => {
		expect(isStarterPilot(interceptor)).toBe(false);
		expect(strengthCeiling(interceptor)).toBeGreaterThan(
			strengthCeiling(courier),
		);
	});

	test("a stronger gun on a stock hull leaves the window", () => {
		const armed = {
			hull: "courier" as const,
			loadout: { ...courier.loadout, h1: makeModule("beam-laser", 1) },
		};
		expect(isStarterPilot(courier)).toBe(true);
		expect(isStarterPilot(armed)).toBe(false);
	});

	test("armour alone leaves the window, though it adds no strength", () => {
		const armoured = {
			hull: "courier" as const,
			loadout: { plant, i1: makeModule("armour-plating", 1) },
		};
		expect(isStarterPilot({ hull: "courier", loadout: { plant } })).toBe(true);
		expect(isStarterPilot(armoured)).toBe(false);
	});
});

describe("verdicts", () => {
	const heavy: Loadout = {
		plant: makeModule("power-plant", 1, "E"),
		h1: makeModule("beam-laser", 2, "D"),
		h2: makeModule("military-laser", 1, "E"),
	};

	test("a fit over the pilot's ceiling is rejected for strength", () => {
		expect(judgeFit(heavy, courier).reason).toBe("strength");
	});

	test("a fit exactly at the ceiling is within it", () => {
		const pilot = {
			hull: RAIDER_HULL_ID,
			loadout: npcLoadout(RAIDER_HULL_ID, 1),
		};
		const verdict = judgeFit(npcLoadout(RAIDER_HULL_ID, 62), pilot);
		expect(verdict.strength).toBe(strengthCeiling(pilot));
		expect(verdict.reason).not.toBe("strength");
	});

	test("a kill at exactly the minimum survival is eligible", () => {
		const tug = {
			hull: "tug" as const,
			loadout: { ...stockLoadout("tug"), h1: makeModule("beam-laser", 2, "E") },
		};
		const verdict = judgeFit(heavy, tug);
		expect(verdict.survivalS).toBe(SURVIVAL_MIN_S);
		expect(verdict.reason).toBe("ok");
	});

	test("an unarmed raider outlasts the starter window", () => {
		expect(judgeFit({ plant }, courier).reason).toBe("long");
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

describe("missiles", () => {
	const racked = (ammo: number): Loadout => ({
		plant,
		h2: { ...makeModule("missile-rack", 1), ammo },
	});
	const freighter = {
		hull: "freighter" as const,
		loadout: stockLoadout("freighter"),
	};

	test("a missile lands before the next one launches", () => {
		expect(EARLIEST_MISSILE_FLIGHT_S).toBeLessThan(MISSILE_RELAUNCH_S);
	});

	test("the first missile lands on the step its flight ends", () => {
		expect(survivalSeconds(racked(1), courier)).toBeCloseTo(
			FIRST_MISSILE_LAUNCH_S + EARLIEST_MISSILE_FLIGHT_S,
			3,
		);
	});

	test("a spent rack stops launching", () => {
		expect(MISSILE.damage).toBeGreaterThan(0);
		expect(survivalSeconds(racked(1), freighter)).toBe(
			Number.POSITIVE_INFINITY,
		);
	});
});

describe("the lightening chain", () => {
	test.each(["pulse-laser", "beam-laser", "military-laser"] as const)(
		"two %ss lighten to the last hardpoint's, then the floor",
		(kind) => {
			const h1 = makeModule(kind, 1, "D");
			const h2 = makeModule(kind, 1, "A");
			expect(lighteningChain({ plant, h1, h2 })).toEqual([
				{ plant, h1, h2 },
				{ plant, h2 },
				floorOf("A"),
			]);
		},
	);

	test("racks go first, and a laser off the hardpoints stays", () => {
		const fit: Loadout = {
			plant,
			h1: makeModule("beam-laser", 1, "D"),
			h2: makeModule("missile-rack", 1),
			u1: makeModule("shield-booster", 1),
			u2: makeModule("pulse-laser", 1, "A"),
		};
		expect(lighteningChain(fit)).toEqual([
			fit,
			{ plant, h1: fit.h1, u1: fit.u1, u2: fit.u2 },
			floorOf("D"),
		]);
	});

	test("one laser goes straight to the floor, of the last hardpoint laser's grade", () => {
		const fit: Loadout = {
			plant,
			h1: makeModule("pulse-laser", 1, "D"),
			u2: makeModule("pulse-laser", 1, "A"),
		};
		expect(lighteningChain(fit)).toEqual([fit, floorOf("D")]);
	});

	test("a fit with no laser floors at grade E", () => {
		const fit: Loadout = { plant, h2: makeModule("missile-rack", 1, "A") };
		expect(lighteningChain(fit)).toEqual([fit, { plant }, floorOf("E")]);
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
