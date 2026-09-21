/**
 * §8's jump: the range gate, the fuel, and the wind-up.
 *
 * Everything here is the pure half (`src/hyperspace.ts`). What the jump does to
 * a *world* is `tests/world-jump.test.ts`; what the renderer has to tear down
 * is `tests/gpu-teardown.test.ts`.
 *
 * The fixtures are a **generated galaxy**, not hand-built records, because the
 * one thing this module must not do is disagree with the chart: `neighbours`
 * decides what is lit inside the 7 LY shell and `planRoute` decides what a
 * course is made of, and a gate that rooted the distance before comparing could
 * refuse a system both of those offered.
 */
import { describe, expect, test } from "bun:test";
import {
	JUMP_RANGE_LY,
	type SystemRecord,
	distanceLy,
	generateGalaxy,
	neighbours,
	startSystem,
} from "../src/galaxy";
import {
	JUMP_CHARGE_S,
	JUMP_TANK_LY,
	beginCharge,
	cancelCharge,
	charging,
	idleCharge,
	planJump,
	stepCharge,
} from "../src/hyperspace";

const SEED = 20260902;
const GALAXY = generateGalaxy(SEED, 0);
const HOME = startSystem(GALAXY);

/** A system inside the shell, and one outside it — both from the shipped
 *  generator rather than invented, so the figures below are the game's. */
const NEAR = neighbours(GALAXY.systems, HOME)[0];
const FAR = GALAXY.systems
	.filter((s) => s.index !== HOME.index)
	.map((s) => ({ s, d: distanceLy(HOME.pos, s.pos) }))
	.sort((a, b) => b.d - a.d)[0].s;

describe("the fixtures are what they claim", () => {
	test("one neighbour inside the shell and one system well outside it", () => {
		expect(distanceLy(HOME.pos, NEAR.pos)).toBeLessThanOrEqual(JUMP_RANGE_LY);
		expect(distanceLy(HOME.pos, FAR.pos)).toBeGreaterThan(JUMP_RANGE_LY);
	});
});

describe("planJump", () => {
	test("a full tank reaches the nearest neighbour, and the tank pays the distance", () => {
		const decision = planJump(HOME, NEAR, JUMP_TANK_LY);
		if (!decision.ok) throw new Error(`refused: ${decision.refusal}`);
		const ly = distanceLy(HOME.pos, NEAR.pos);
		expect(decision.plan.distanceLy).toBeCloseTo(ly, 12);
		expect(decision.plan.fuelLeftLy).toBeCloseTo(JUMP_TANK_LY - ly, 12);
		expect(decision.plan.to).toBe(NEAR);
	});

	test("the destination the ship is already in is refused before anything else", () => {
		// A zero-length jump is in range and free, so every later gate accepts it.
		const decision = planJump(HOME, HOME, JUMP_TANK_LY);
		expect(decision).toEqual({ ok: false, refusal: "same-system" });
	});

	test("out of range outranks an empty tank", () => {
		// The distinction the HUD needs: refuelling does not make FAR reachable,
		// so a message about fuel would send the player to buy what they have.
		expect(planJump(HOME, FAR, JUMP_TANK_LY)).toEqual({
			ok: false,
			refusal: "out-of-range",
		});
		expect(planJump(HOME, FAR, 0)).toEqual({
			ok: false,
			refusal: "out-of-range",
		});
	});

	test("in range and short of fuel is its own refusal", () => {
		const ly = distanceLy(HOME.pos, NEAR.pos);
		expect(planJump(HOME, NEAR, ly - 1e-9)).toEqual({
			ok: false,
			refusal: "insufficient-fuel",
		});
		// Exactly enough is enough: the tank is spent to zero, not to a residue.
		const exact = planJump(HOME, NEAR, ly);
		if (!exact.ok) throw new Error(`refused: ${exact.refusal}`);
		expect(exact.plan.fuelLeftLy).toBeCloseTo(0, 12);
	});

	test("another galaxy is refused, because that is the Galactic Hyperdrive", () => {
		const other = startSystem(generateGalaxy(SEED, 1));
		expect(other.galaxy).toBe(1);
		expect(planJump(HOME, other, JUMP_TANK_LY)).toEqual({
			ok: false,
			refusal: "other-galaxy",
		});
	});

	test("the gate accepts exactly what the chart lights", () => {
		// The failure this exists for: `neighbours` compares squared distances and
		// a gate that rooted first can disagree for a pair within an ulp of the
		// range. Swept over the whole galaxy rather than one pair, because the
		// disagreement is a property of a boundary nobody can pick by hand.
		const lit = new Set(
			neighbours(GALAXY.systems, HOME).map((s: SystemRecord) => s.index),
		);
		for (const system of GALAXY.systems) {
			if (system.index === HOME.index) continue;
			const decision = planJump(HOME, system, JUMP_TANK_LY);
			const accepted = decision.ok || decision.refusal === "insufficient-fuel";
			expect([system.index, accepted]).toEqual([
				system.index,
				lit.has(system.index),
			]);
		}
	});
});

describe("the wind-up", () => {
	test("an idle charge is idle, and cancelling one is not a special case", () => {
		expect(charging(idleCharge())).toBe(false);
		expect(cancelCharge()).toEqual(idleCharge());
		expect(stepCharge(idleCharge(), 1)).toEqual({
			charge: idleCharge(),
			fired: null,
		});
	});

	test("it fires once, at the end, at whatever frame rate", () => {
		// Three rates over the same window. The count of firings is what matters:
		// a charge left holding its destination on the firing step would fire
		// again on the next frame, which at 240 Hz is 240 jumps a second.
		for (const dt of [1 / 30, 1 / 60, 1 / 240]) {
			let charge = beginCharge(7);
			let fires = 0;
			let elapsed = 0;
			for (let i = 0; i < Math.ceil((JUMP_CHARGE_S + 1) / dt); i++) {
				const step = stepCharge(charge, dt);
				charge = step.charge;
				if (step.fired !== null) {
					fires++;
					expect(step.fired).toBe(7);
					expect(elapsed + dt).toBeGreaterThanOrEqual(JUMP_CHARGE_S);
					// Never more than one frame late, which is what "a few seconds"
					// has to mean for a window the player is vulnerable inside.
					expect(elapsed).toBeLessThan(JUMP_CHARGE_S);
				}
				elapsed += dt;
			}
			expect(fires).toBe(1);
		}
	});

	test("the destination is fixed when the window opens, not when it closes", () => {
		// §8's window is a commitment. Re-aiming inside it would give the player
		// back the free action the wind-up exists to take away.
		let charge = beginCharge(42);
		expect(charge.toIndex).toBe(42);
		charge = stepCharge(charge, JUMP_CHARGE_S / 2).charge;
		expect(charge.toIndex).toBe(42);
		expect(stepCharge(charge, JUMP_CHARGE_S).fired).toBe(42);
	});

	test("damage cancels it, and nothing fires afterwards", () => {
		let charge = beginCharge(3);
		charge = stepCharge(charge, JUMP_CHARGE_S - 0.01).charge;
		expect(charging(charge)).toBe(true);
		charge = cancelCharge();
		expect(charging(charge)).toBe(false);
		expect(stepCharge(charge, 10).fired).toBeNull();
	});

	test("the tank is the range, one quantity with one name", () => {
		expect(JUMP_TANK_LY).toBe(JUMP_RANGE_LY);
	});
});
