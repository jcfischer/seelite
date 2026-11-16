/**
 * Every hull row's slot layout, stock power plant and shield baseline (#866).
 *
 * The outfitting decision (#867) needs three things on each row: typed slots
 * sized 1–3 with one internal flex slot (D1, D2), the power plant as the one
 * core slot (D3), and a shield baseline per hull. The principal ruled the
 * laws and the table on #866; this file holds the rows to them.
 *
 * - **Capacity follows mass.** A heavier hull never has less total slot
 *   capacity than a lighter one (non-decreasing, capitals included).
 * - **The role keeps its slots.** Internals are role-tagged; the largest one
 *   accepts the role's own family, and one flex slot accepts any.
 * - **No pilot loses a fitting (#867 D14).** Today's whole kit fits every hull
 *   a shipyard sells, so moving the save onto slots (#876) has nowhere it must
 *   put a fitting that was fitted.
 * - **The courier is today's ship.** Its shield and its stock plant are the
 *   figures the globals carried before this node.
 */

import { describe, expect, test } from "bun:test";
import {
	HULL_IDS,
	HULL_SPECS,
	type HullId,
	type HullSlot,
	INTERNAL_FAMILIES,
	type InternalFamily,
	POWER_PLANT_OUTPUT,
	PURCHASABLE_HULL_IDS,
	ROLE_INTERNAL_FAMILY,
	SHIELD_COMBAT_FACTOR,
	SHIELD_COMBAT_ROLES,
	SHIELD_REFERENCE,
	shieldPoolUnderLaw,
	slotCapacity,
	stockPlant,
} from "../src/hull";
import {
	EQUIPMENT,
	ESCAPE_POD,
	LONG_RANGE_SCANNER,
	SCAN_MODULE,
} from "../src/market";

const slotsOf = (id: HullId, kind: HullSlot["kind"]) =>
	HULL_SPECS[id].slots.filter((s) => s.kind === kind);

/**
 * Today's catalogue sorted into #867 D5's slot kinds. Written here rather
 * than read from a module because the catalogue's own kinds are #868's to
 * ship; the last row below fails when an item joins `EQUIPMENT` unsorted.
 */
const TODAYS_KIT = {
	hardpoint: [
		"Extra Pulse Laser",
		"Extra Beam Laser",
		"Military Laser",
		"Mining Laser",
	],
	utility: ["E.C.M. System", "Docking Computer", SCAN_MODULE],
	internal: {
		"Large Cargo Bay": "cargo",
		"Fuel Scoops": "fuel",
		[LONG_RANGE_SCANNER]: "sensor",
		[ESCAPE_POD]: "survival",
		"Extra Energy Unit": "power",
	} as Record<string, InternalFamily>,
	/** Ammunition (a rack is a new module), removed (D5), parked (D5). */
	noSlot: ["Missile", "Energy Bomb", "Galactic Hyperdrive"],
};

/** Whether every family can be given its own internal slot (augmenting
 *  paths; the flex slot accepts anything). */
function fitsFamilies(
	internals: readonly HullSlot[],
	families: readonly InternalFamily[],
): boolean {
	const owner: (number | null)[] = internals.map(() => null);
	const accepts = (slot: HullSlot, f: InternalFamily) =>
		slot.kind === "internal" &&
		(slot.accepts === "any" || slot.accepts.includes(f));
	const place = (fi: number, seen: boolean[]): boolean => {
		for (let si = 0; si < internals.length; si++) {
			if (seen[si] || !accepts(internals[si], families[fi])) continue;
			seen[si] = true;
			const held = owner[si];
			if (held === null || place(held, seen)) {
				owner[si] = fi;
				return true;
			}
		}
		return false;
	};
	return families.every((_, fi) =>
		place(
			fi,
			internals.map(() => false),
		),
	);
}

describe("a hull's slots (#866, #867 D1 and D2)", () => {
	test("every slot is sized 1–3 and keyed by kind and position", () => {
		for (const id of HULL_IDS) {
			const keys = HULL_SPECS[id].slots.map((s) => s.key);
			const want = [
				...slotsOf(id, "hardpoint").map((_, i) => `h${i + 1}`),
				...slotsOf(id, "utility").map((_, i) => `u${i + 1}`),
				...slotsOf(id, "internal")
					.filter((s) => s.kind === "internal" && s.accepts !== "any")
					.map((_, i) => `i${i + 1}`),
				"flex",
			];
			expect([id, keys]).toEqual([id, want]);
			for (const s of HULL_SPECS[id].slots)
				expect([id, s.key, [1, 2, 3].includes(s.size)]).toEqual([
					id,
					s.key,
					true,
				]);
		}
	});

	test("the hardpoint slots are the hardpoints the mesh draws", () => {
		// `ship-mesh.ts` puts one muzzle per `hardpoints`, and the roster hash
		// pins that geometry, so the slots may not move the count.
		for (const id of HULL_IDS)
			expect([id, slotsOf(id, "hardpoint").length]).toEqual([
				id,
				HULL_SPECS[id].hardpoints,
			]);
	});

	test("each hull has exactly one internal flex slot (D1)", () => {
		for (const id of HULL_IDS) {
			const flex = HULL_SPECS[id].slots.filter(
				(s) => s.kind === "internal" && s.accepts === "any",
			);
			expect([id, flex.map((s) => s.key)]).toEqual([id, ["flex"]]);
		}
	});

	test("a tagged internal names families that exist, at least one", () => {
		for (const id of HULL_IDS)
			for (const s of slotsOf(id, "internal")) {
				if (s.kind !== "internal" || s.accepts === "any") continue;
				expect([id, s.key, s.accepts.length > 0]).toEqual([id, s.key, true]);
				for (const f of s.accepts)
					expect(INTERNAL_FAMILIES as readonly string[]).toContain(f);
				expect(new Set(s.accepts).size).toBe(s.accepts.length);
			}
	});

	test("the largest tagged internal accepts the role's own family", () => {
		for (const id of HULL_IDS) {
			const tagged = slotsOf(id, "internal").filter(
				(s) => s.kind === "internal" && s.accepts !== "any",
			);
			const first = tagged[0];
			const largest = Math.max(...tagged.map((s) => s.size));
			expect(`${id} ${first.size}`).toBe(`${id} ${largest}`);
			expect(
				first.kind === "internal" &&
					first.accepts !== "any" &&
					first.accepts.includes(ROLE_INTERNAL_FAMILY[HULL_SPECS[id].role]),
			).toBe(true);
		}
	});

	test("the lighter authored Porter retains its slots; other heavier hulls never have less capacity, the miner's two mounts (#1147 D-D10) aside", () => {
		// Node #813 re-derived Porter mass from its smaller authored box. Keep
		// the installed slot layout: shrinking it would invalidate saved fittings
		// (#867 D14). This is the sole departure from the original mass ordering.
		expect(HULL_SPECS.freighter.massT).toBe(92);
		expect(slotCapacity("freighter")).toBe(16);
		const mounted = (id: (typeof HULL_IDS)[number]) =>
			HULL_SPECS[id].slots
				.filter((s) => s.kind === "hardpoint" && s.mount)
				.reduce((sum, s) => sum + s.size, 0);
		expect(HULL_IDS.filter((id) => mounted(id) > 0)).toEqual(["miner"]);
		expect(mounted("miner")).toBe(6);
		const unmounted = (id: (typeof HULL_IDS)[number]) =>
			slotCapacity(id) - mounted(id);
		const byMass = HULL_IDS.filter((id) => id !== "freighter").sort(
			(a, b) => HULL_SPECS[a].massT - HULL_SPECS[b].massT,
		);
		for (let i = 1; i < byMass.length; i++) {
			const lighter = byMass[i - 1];
			const heavier = byMass[i];
			expect([
				`${lighter} ${unmounted(lighter)} <= ${heavier} ${unmounted(heavier)}`,
				unmounted(lighter) <= unmounted(heavier),
			]).toEqual([expect.any(String), true]);
		}
	});

	test("capacity is the sum of the slot sizes, the plant excluded", () => {
		expect(slotCapacity("courier")).toBe(11);
		for (const id of HULL_IDS)
			expect(slotCapacity(id)).toBe(
				HULL_SPECS[id].slots.reduce((sum, s) => sum + s.size, 0),
			);
	});
});

describe("no pilot loses a fitting (#867 D14)", () => {
	test("every item in today's catalogue is sorted into a slot kind", () => {
		const sorted = [
			...TODAYS_KIT.hardpoint,
			...TODAYS_KIT.utility,
			...Object.keys(TODAYS_KIT.internal),
			...TODAYS_KIT.noSlot,
		].sort();
		expect(sorted).toEqual(EQUIPMENT.map((e) => e.name).sort());
	});

	test("today's whole kit fits every hull a shipyard sells", () => {
		const families = Object.values(TODAYS_KIT.internal);
		for (const id of PURCHASABLE_HULL_IDS) {
			expect([
				id,
				slotsOf(id, "utility").length >= TODAYS_KIT.utility.length,
			]).toEqual([id, true]);
			expect([id, fitsFamilies(slotsOf(id, "internal"), families)]).toEqual([
				id,
				true,
			]);
		}
	});

	test("the matcher refuses a kit with more families than slots", () => {
		// The check above is only worth something if it can say no.
		const two: HullSlot[] = [
			{ key: "i1", kind: "internal", size: 1, accepts: ["cargo"] },
			{ key: "flex", kind: "internal", size: 1, accepts: "any" },
		];
		expect(fitsFamilies(two, ["cargo", "fuel"])).toBe(true);
		expect(fitsFamilies(two, ["fuel", "power"])).toBe(false);
		expect(fitsFamilies(two, ["cargo", "fuel", "power"])).toBe(false);
	});
});

describe("the stock power plant (#867 D3)", () => {
	test("every hull ships an E-grade plant of its own size", () => {
		for (const id of HULL_IDS) {
			const plant = stockPlant(id);
			expect([id, plant.grade, plant.size]).toEqual([
				id,
				"E",
				HULL_SPECS[id].plantSize,
			]);
			expect(plant.bankE).toBe(POWER_PLANT_OUTPUT.E[plant.size].bankE);
			expect(plant.regenPerS).toBe(POWER_PLANT_OUTPUT.E[plant.size].regenPerS);
		}
	});

	test("the courier's stock plant is the bank it flew before #866", () => {
		// `ENERGY_BANK = 100` and `ENERGY_REGEN_PER_S = 12` in
		// `ship-condition.ts` until this node.
		expect(stockPlant("courier")).toEqual({
			size: 1,
			grade: "E",
			bankE: 100,
			regenPerS: 12,
		});
	});

	test("a bigger plant has a bigger bank and faster regen", () => {
		expect(POWER_PLANT_OUTPUT.E[2].bankE).toBeGreaterThan(
			POWER_PLANT_OUTPUT.E[1].bankE,
		);
		expect(POWER_PLANT_OUTPUT.E[3].bankE).toBeGreaterThan(
			POWER_PLANT_OUTPUT.E[2].bankE,
		);
		expect(POWER_PLANT_OUTPUT.E[2].regenPerS).toBeGreaterThan(
			POWER_PLANT_OUTPUT.E[1].regenPerS,
		);
		expect(POWER_PLANT_OUTPUT.E[3].regenPerS).toBeGreaterThan(
			POWER_PLANT_OUTPUT.E[2].regenPerS,
		);
	});
});

describe("the shield baseline", () => {
	test("every shield figure is the law the table states it follows", () => {
		// The `integrity` discipline: a stored figure against the module's own
		// law, so a hand-edited row is a visible deviation rather than a typo, and
		// a retune of the law moves the check with it (sage #879 round 1).
		for (const id of HULL_IDS) {
			const { massT, role } = HULL_SPECS[id];
			expect([id, HULL_SPECS[id].shieldPool]).toEqual([
				id,
				shieldPoolUnderLaw(massT, role),
			]);
		}
	});

	test("the law is the mass law on #48's pool, a quarter up for combat roles", () => {
		// Pins the law's own constants, which the row above now reads through.
		expect(SHIELD_REFERENCE).toBe(106);
		expect(SHIELD_COMBAT_FACTOR).toBe(1.25);
		expect([...SHIELD_COMBAT_ROLES].sort() as string[]).toEqual(
			["battle-line", "fast", "outlaw", "security"].sort(),
		);
		expect(shieldPoolUnderLaw(60, "player-baseline")).toBe(106);
		expect(shieldPoolUnderLaw(60, "outlaw")).toBe(Math.round(106 * 1.25));
	});

	test("the courier keeps the pool it flew before #866", () => {
		// `SHIELD_POOL = 106`, #48's tuned figure.
		expect(HULL_SPECS.courier.shieldPool).toBe(106);
	});

	test("the raider's pool barely moves, so a duel is the duel it was", () => {
		expect(HULL_SPECS.raider.shieldPool).toBe(107);
	});
});
