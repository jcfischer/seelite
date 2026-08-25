import { expect, test } from "bun:test";
import {
	COMBAT_PROTOTYPE_DEFAULTS,
	createCombatPrototype,
	stepCombatPrototype,
	duelTargetInCone,
} from "../src/combat-prototype";

test("starter pulse fire destroys an unshielded hull within the pacing target", () => {
	let state = createCombatPrototype({
		targetForeShield: 0,
		targetAftShield: 0,
	});
	for (let elapsed = 0; elapsed < 30; elapsed += 0.1)
		state = stepCombatPrototype(state, { dt: 0.1, firing: "pulse" });
	expect(state.targetHull).toBe(0);
	expect(state.elapsed).toBeGreaterThanOrEqual(20);
});

test("beam trades faster damage for a heat lockout", () => {
	let state = createCombatPrototype();
	for (let elapsed = 0; elapsed < 4; elapsed += 0.1)
		state = stepCombatPrototype(state, { dt: 0.1, firing: "beam" });
	expect(state.heatLocked).toBe(true);
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

test("an enemy barrage depletes the player fore shield before damaging hull", () => {
	let state = createCombatPrototype({ foreShield: 1 });
	state = stepCombatPrototype(state, { dt: 1, enemyFiring: true });
	expect(state.foreShield).toBe(0);
	expect(state.playerHull).toBeLessThan(COMBAT_PROTOTYPE_DEFAULTS.hull);
});
