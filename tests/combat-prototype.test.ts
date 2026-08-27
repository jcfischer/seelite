import { expect, test } from "bun:test";
import {
	COMBAT_PROTOTYPE_DEFAULTS,
	createCombatPrototype,
	stepCombatPrototype,
	duelTargetInCone,
} from "../src/combat-prototype";

// The cap is far above either pacing window, so both the low and high bounds
// are real assertions: a duel that kills too fast (under 60 s) fails the floor,
// and one that cannot kill within the window fails the ceiling. The step
// mirrors the flyable rig: it alternates the target shield bank and lets the
// enemy fire back on the same schedule the game drives.
function fireFixedStepDuel(state = createCombatPrototype(), cap = 200) {
	while (state.elapsed < cap && state.targetHull > 0)
		state = stepCombatPrototype(state, {
			dt: 0.1,
			firing: "pulse",
			targetInCone: duelTargetInCone(state.elapsed),
			hitAft: Math.floor(state.elapsed / 2) % 2 === 1,
			enemyFiring: state.targetHull > 0 && state.elapsed % 4 < 2,
			enemyHitAft: Math.floor(state.elapsed / 3) % 2 === 1,
		});
	return state;
}

// These pacing windows assert the tuned arithmetic (duel length from
// shield/dps/cone duty cycle), not an independent gameplay verdict: the
// 60-90 s starter-duel and 20-30 s exposed-hull figures still require
// principal validation in flight before they can be recorded as results.
test("starter pulse duel destroys the shielded target within the pacing target", () => {
	const state = fireFixedStepDuel();
	expect(state.targetHull).toBe(0);
	expect(state.playerHull).toBeGreaterThan(0);
	expect(state.elapsed).toBeGreaterThanOrEqual(60);
	expect(state.elapsed).toBeLessThanOrEqual(90);
});

test("starter pulse duel destroys an unshielded hull within the pacing target", () => {
	const state = fireFixedStepDuel(
		createCombatPrototype({ targetForeShield: 0, targetAftShield: 0 }),
	);
	expect(state.targetHull).toBe(0);
	expect(state.elapsed).toBeGreaterThanOrEqual(20);
	expect(state.elapsed).toBeLessThanOrEqual(30);
});

test("beam trades faster damage for a heat lockout", () => {
	let state = createCombatPrototype();
	for (let elapsed = 0; elapsed < 4; elapsed += 0.1)
		state = stepCombatPrototype(state, { dt: 0.1, firing: "beam" });
	expect(state.heatLocked).toBe(true);
});

test("weapon heat never exceeds the instrument scale", () => {
	const state = stepCombatPrototype(createCombatPrototype(), {
		dt: 3.4,
		firing: "beam",
	});
	expect(state.heat).toBeLessThanOrEqual(COMBAT_PROTOTYPE_DEFAULTS.heatLock);
});

test("an off-cone shot spends resources without damaging the target", () => {
	const state = stepCombatPrototype(createCombatPrototype(), {
		dt: 1,
		firing: "pulse",
		targetInCone: false,
	});
	expect(state.energy).toBeLessThan(COMBAT_PROTOTYPE_DEFAULTS.energy);
	expect(state.heat).toBeGreaterThan(0);
	expect(state.targetForeShield).toBe(COMBAT_PROTOTYPE_DEFAULTS.shield);
	expect(state.targetAftShield).toBe(COMBAT_PROTOTYPE_DEFAULTS.shield);
	expect(state.targetHull).toBe(COMBAT_PROTOTYPE_DEFAULTS.hull);
});

test("a shield-breaking hit bleeds exactly the unabsorbed remainder to hull", () => {
	const state = stepCombatPrototype(
		createCombatPrototype({ targetForeShield: 0.5 }),
		{ dt: 1, firing: "pulse", targetInCone: true },
	);
	expect(state.targetForeShield).toBe(0);
	expect(state.targetHull).toBe(COMBAT_PROTOTYPE_DEFAULTS.hull - 5.5);
});

test("a roll break resets a charged interdiction", () => {
	let state = createCombatPrototype();
	state = stepCombatPrototype(state, {
		dt: COMBAT_PROTOTYPE_DEFAULTS.interdictionSeconds,
		interdicting: true,
	});
	expect(state.interdiction).toBe(true);
	state = stepCombatPrototype(state, {
		dt: 0.1,
		interdicting: true,
		breakAngle: true,
	});
	expect(state.interdiction).toBe(false);
	expect(state.interdictionProgress).toBe(0);
});

test("a broken acquisition cone clears missile lock and ECM clears a warning", () => {
	let state = createCombatPrototype();
	for (
		let elapsed = 0;
		elapsed < COMBAT_PROTOTYPE_DEFAULTS.lockSeconds;
		elapsed += 0.1
	)
		state = stepCombatPrototype(state, { dt: 0.1, targetInCone: true });
	expect(state.missileLock).toBe(true);
	state = stepCombatPrototype(state, {
		dt: 0.1,
		targetInCone: false,
		incomingMissile: true,
	});
	expect(state.missileLock).toBe(false);
	expect(state.incomingMissile).toBe(true);
	state = stepCombatPrototype(state, { dt: 0.1, ecm: true });
	expect(state.incomingMissile).toBe(false);
});

test("a strafing duel target can leave the line of fire", () => {
	expect(duelTargetInCone(0)).toBe(false);
	expect(duelTargetInCone(Math.PI / (2 * 0.7))).toBe(false);
});

test("enemy fire can deplete the player aft shield", () => {
	const state = stepCombatPrototype(createCombatPrototype(), {
		dt: 1,
		enemyFiring: true,
		enemyHitAft: true,
	});
	expect(state.aftShield).toBeLessThan(COMBAT_PROTOTYPE_DEFAULTS.shield);
	expect(state.foreShield).toBe(COMBAT_PROTOTYPE_DEFAULTS.shield);
});

test("an enemy barrage depletes the player fore shield before damaging hull", () => {
	let state = createCombatPrototype({ foreShield: 1 });
	state = stepCombatPrototype(state, { dt: 1, enemyFiring: true });
	expect(state.foreShield).toBe(0);
	expect(state.playerHull).toBeLessThan(COMBAT_PROTOTYPE_DEFAULTS.hull);
});
