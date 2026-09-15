/**
 * The raider encounter carriers and the law that brings one onto a cruise leg
 * (node #324 part b). The principal's rulings, 2026-09-14:
 *
 * - raiders are **enumerated** world-state slots, and a system can hold more
 *   than one, because several may attack together later;
 * - a leg's chance of an encounter falls with the system's law, and a
 *   Corporate State keeps a smaller chance rather than none (`combat-model.md`
 *   §3 owns the figures);
 * - a raider appears behind, alongside or ahead of the player.
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { generateGalaxy } from "../src/galaxy";
import { INTERDICTION_RANGE_KM } from "../src/interdiction";
import {
	ENCOUNTER_DELAY_S,
	ENCOUNTER_RANGE_KM,
	RAIDER_HULL_ID,
	legEncounter,
	raiderLegChance,
	raiderSlotCount,
	raiderSlots,
} from "../src/raider-slots";

const WORLD = 0x5ee11e;
const GOVERNMENTS = [0, 1, 2, 3, 4, 5, 6, 7];

describe("slots", () => {
	test("every system has at least one, and lawless systems have more", () => {
		for (const g of GOVERNMENTS) expect(raiderSlotCount(g)).toBeGreaterThan(0);
		for (let g = 1; g < 8; g++)
			expect(raiderSlotCount(g)).toBeLessThanOrEqual(raiderSlotCount(g - 1));
		expect(raiderSlotCount(0)).toBeGreaterThan(raiderSlotCount(7));
	});

	test("slot ids are stable, unique in a system, and key into the carrier namespace", () => {
		const slots = raiderSlots(12, 0);
		expect(slots).toHaveLength(raiderSlotCount(0));
		expect(new Set(slots.map((s) => s.localCarrierId)).size).toBe(slots.length);
		expect(slots[0].localCarrierId).toBe("raider-00");
		for (const s of slots) expect(s.key).toBe(carrierKey(12, s.localCarrierId));
		// A pure function of its inputs: the id table is a save migration, not a
		// refactor.
		expect(raiderSlots(12, 0)).toEqual(slots);
	});

	test("the raider hull is the raider", () => {
		expect(RAIDER_HULL_ID).toBe("raider");
	});
});

describe("the leg law", () => {
	test("the chance falls with law and a Corporate State keeps some", () => {
		for (let g = 1; g < 8; g++)
			expect(raiderLegChance(g)).toBeLessThan(raiderLegChance(g - 1));
		expect(raiderLegChance(7)).toBeGreaterThan(0);
		expect(raiderLegChance(0)).toBeLessThan(1);
	});

	test("the principal's rate: 60% of legs in an Anarchy, 20% in a Corporate State", () => {
		// The ruling of 2026-09-15; `combat-model.md` §3 has the reason.
		expect(raiderLegChance(0)).toBeCloseTo(0.6, 12);
		expect(raiderLegChance(7)).toBeCloseTo(0.2, 12);
	});

	test("an encounter is a pure function of system, law and leg", () => {
		const record = generateGalaxy(WORLD, 0).systems[5];
		for (let leg = 0; leg < 50; leg++)
			expect(legEncounter(record.seed, record.government, leg)).toEqual(
				legEncounter(record.seed, record.government, leg),
			);
	});

	test("over many legs the rate matches the law, per government", () => {
		const record = generateGalaxy(WORLD, 0).systems[5];
		const LEGS = 20_000;
		for (const g of [0, 3, 7]) {
			let hits = 0;
			for (let leg = 0; leg < LEGS; leg++)
				if (legEncounter(record.seed, g, leg)) hits++;
			// Binomial: three standard deviations at the largest variance, p = 0.5,
			// is 0.0106 at 20,000 legs.
			expect(Math.abs(hits / LEGS - raiderLegChance(g))).toBeLessThan(0.0106);
		}
	});

	test("an encounter names a slot the system has, a bearing, a delay and a range", () => {
		const record = generateGalaxy(WORLD, 0).systems[5];
		const bearings = new Set<string>();
		const slotsSeen = new Set<number>();
		for (let leg = 0; leg < 2_000; leg++) {
			const e = legEncounter(record.seed, 0, leg);
			if (!e) continue;
			expect(e.slotIndex).toBeGreaterThanOrEqual(0);
			expect(e.slotIndex).toBeLessThan(raiderSlotCount(0));
			expect(e.delayS).toBeGreaterThanOrEqual(ENCOUNTER_DELAY_S[0]);
			expect(e.delayS).toBeLessThanOrEqual(ENCOUNTER_DELAY_S[1]);
			expect(e.rangeKm).toBeGreaterThanOrEqual(ENCOUNTER_RANGE_KM[0]);
			expect(e.rangeKm).toBeLessThanOrEqual(ENCOUNTER_RANGE_KM[1]);
			bearings.add(e.bearing);
			slotsSeen.add(e.slotIndex);
		}
		expect([...bearings].sort()).toEqual(["ahead", "alongside", "behind"]);
		expect(slotsSeen.size).toBe(raiderSlotCount(0));
	});

	test("a contest can begin from wherever a raider appears", () => {
		expect(ENCOUNTER_RANGE_KM[1]).toBeLessThanOrEqual(INTERDICTION_RANGE_KM);
	});

	test("two systems do not share an encounter sequence", () => {
		const galaxy = generateGalaxy(WORLD, 0);
		const sequence = (i: number) =>
			Array.from({ length: 200 }, (_, leg) =>
				legEncounter(galaxy.systems[i].seed, 0, leg) !== null ? 1 : 0,
			).join("");
		expect(sequence(5)).not.toBe(sequence(6));
	});
});
