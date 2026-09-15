/**
 * What a destroyed raider leaves behind (node #324 part d): the lifecycle on
 * the game clock, and the cargo canisters the player can scoop.
 */
import { describe, expect, test } from "bun:test";
import { raiderSlots } from "../src/raider-slots";
import { ASSIST_CAP_KMS } from "../src/sim";
import {
	CANISTER_COUNT,
	CANISTER_KEEP_FRACTION,
	CANISTER_LIFETIME_S,
	CANISTER_SCOOP_RADIUS_KM,
	CANISTER_SCOOP_SPEED_KMS,
	CANISTER_SPREAD_KMS,
	type Canister,
	PLAYER_KILL,
	RAIDER_REPAIR_S,
	RAIDER_WRECK_S,
	cargoWeights,
	dropCanisters,
	raiderDestruction,
	scoops,
	stepCanisters,
} from "../src/raider-wreck";
import { newCommander, scoopCargo } from "../src/station-commerce";
import { length, sub, v3 } from "../src/vec3";
import {
	applyTransition,
	effectiveCarrier,
	newWorld,
} from "../src/world-state";
import { commodity } from "../src/market";

const SLOT = raiderSlots(9, 0)[1];

describe("the lifecycle", () => {
	test("is combat-model §4's thirty minutes, split ten and twenty", () => {
		expect(RAIDER_WRECK_S + RAIDER_REPAIR_S).toBe(30 * 60);
		expect(RAIDER_WRECK_S).toBe(10 * 60);
	});

	test("a kill is the player's destroy, scheduling the replacement", () => {
		const event = raiderDestruction(9, 500);
		expect(event.kind).toBe("destroy");
		expect(event.cause).toEqual(PLAYER_KILL);
		if (event.kind !== "destroy" || !event.schedule)
			throw new Error("no schedule");
		expect(event.schedule.startsAt).toBe(500 + RAIDER_WRECK_S);
		expect(event.schedule.completesAt).toBe(
			500 + RAIDER_WRECK_S + RAIDER_REPAIR_S,
		);
		expect(event.schedule.cause.playerRole).toBe("none");
	});

	test("applied to the slot, it reads destroyed, repairing, then replaced", () => {
		const w = applyTransition(
			newWorld(0x5ee11e),
			0,
			SLOT.key,
			raiderDestruction(9, 500),
		);
		const at = (t: number) => effectiveCarrier(w.galaxies[0], SLOT.key, t);
		expect(at(500).condition).toBe("destroyed");
		expect(at(500 + RAIDER_WRECK_S - 0.001).condition).toBe("destroyed");
		expect(at(500 + RAIDER_WRECK_S).condition).toBe("repairing");
		const done = at(500 + RAIDER_WRECK_S + RAIDER_REPAIR_S);
		expect(done.condition).toBe("operational");
		expect(done.instanceOrdinal).toBe(1);
	});
});

const kill = (overrides: Partial<Parameters<typeof dropCanisters>[0]> = {}) =>
	dropCanisters({
		systemSeed: 0x1234,
		government: 3,
		key: SLOT.key,
		killedAt: 812.4,
		pos: v3(100, 0, 0),
		vel: v3(0, 0, -1),
		frameVel: v3(0, 0, 0),
		...overrides,
	});

describe("the cargo drop", () => {
	test("the same kill drops the same canisters", () => {
		expect(kill()).toEqual(kill());
	});

	test("one to three one-tonne canisters, expiring five minutes after the kill", () => {
		const counts = new Set<number>();
		for (let s = 0; s < 400; s++) {
			const drop = kill({ killedAt: s });
			counts.add(drop.length);
			for (const c of drop) {
				expect(c.tonnes).toBe(1);
				expect(c.expiresAt).toBe(s + CANISTER_LIFETIME_S);
				const good = commodity(c.commodity);
				expect(good.unit).toBe("t");
				expect(good.sellOnly).toBe(false);
			}
		}
		expect([...counts].sort()).toEqual(
			Array.from(
				{ length: CANISTER_COUNT.max - CANISTER_COUNT.min + 1 },
				(_, i) => CANISTER_COUNT.min + i,
			),
		);
	});

	test("a Corporate State's raiders carry no contraband, and an Anarchy's do", () => {
		const illegalIn = (government: number) => {
			let n = 0;
			for (let s = 0; s < 600; s++)
				for (const c of kill({ government, killedAt: s }))
					if (commodity(c.commodity).illegal) n++;
			return n;
		};
		expect(illegalIn(7)).toBe(0);
		expect(illegalIn(0)).toBeGreaterThan(0);
		expect(
			cargoWeights(7).every((w) => !w.good.illegal || w.weight === 0),
		).toBe(true);
	});

	test("canisters keep a fifth of the wreck's frame velocity, spread a little", () => {
		// The wreck flies 1 km/s along -z in a frame moving 30 km/s along +x.
		const frameVel = v3(30, 0, 0);
		for (const c of kill({ frameVel, vel: v3(30, 0, -1) })) {
			expect(CANISTER_KEEP_FRACTION).toBe(0.2);
			expect(Math.abs(c.vel.x - 30)).toBeLessThanOrEqual(CANISTER_SPREAD_KMS);
			expect(Math.abs(c.vel.z - -0.2)).toBeLessThanOrEqual(CANISTER_SPREAD_KMS);
			expect(c.pos).toEqual(v3(100, 0, 0));
		}
	});

	test("a canister from a wreck at the assist cap is closable at the cap", () => {
		// The playtest's case: a fleeing raider dies at the cap, and a canister
		// that kept its velocity held its range against a ship at the cap.
		const frameVel = v3(0, 0, 0);
		for (let s = 0; s < 200; s++)
			for (const c of kill({
				killedAt: s,
				frameVel,
				vel: v3(ASSIST_CAP_KMS, 0, 0),
			}))
				expect(length(sub(c.vel, frameVel))).toBeLessThanOrEqual(
					ASSIST_CAP_KMS / 2,
				);
	});
});

describe("drift, expiry and the scoop", () => {
	const canister: Canister = {
		id: "c",
		commodity: "Food",
		tonnes: 1,
		pos: v3(0, 0, 0),
		vel: v3(0.01, 0, 0),
		expiresAt: 100,
	};

	test("a canister drifts on its velocity and is gone at `expiresAt`", () => {
		const [moved] = stepCanisters([canister], 2, 50);
		expect(moved.pos.x).toBeCloseTo(0.02, 12);
		expect(stepCanisters([canister], 0.1, 99.999)).toHaveLength(1);
		expect(stepCanisters([canister], 0.1, 100)).toHaveLength(0);
	});

	test("a close, slow pass scoops it; a far or a fast one does not", () => {
		const slow = { pos: v3(CANISTER_SCOOP_RADIUS_KM * 0.5, 0, 0), vel: v3() };
		expect(scoops(canister, slow)).toBe(true);
		expect(
			scoops(canister, {
				...slow,
				pos: v3(CANISTER_SCOOP_RADIUS_KM * 2, 0, 0),
			}),
		).toBe(false);
		expect(
			scoops(canister, {
				...slow,
				vel: v3(CANISTER_SCOOP_SPEED_KMS * 2, 0, 0),
			}),
		).toBe(false);
	});

	test("a scooped tonne goes into the hold, and a full hold refuses it", () => {
		const commander = newCommander("courier");
		const took = scoopCargo(commander, "Food", 1);
		expect(took.accepted).toBe(true);
		expect(took.commander.cargo.Food).toBe(1);
		const full = { ...commander, cargo: { Food: 10_000 } };
		const refused = scoopCargo(full, "Food", 1);
		expect(refused.accepted).toBe(false);
		expect(refused.commander).toBe(full);
	});
});
