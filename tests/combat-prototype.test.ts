import { expect, test } from "bun:test";
import {
	COMBAT_PROTOTYPE_DEFAULTS,
	createCombatPrototype,
	duelInputs,
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
		state = stepCombatPrototype(state, duelInputs(state, 0.1, "pulse"));
	return state;
}

// These pacing windows assert the tuned arithmetic (duel length from
// shield/dps/cone duty cycle), not an independent gameplay verdict: the
// 60-90 s starter-duel and 20-30 s exposed-hull figures still require
// principal validation in flight before they can be recorded as results.
test("starter pulse duel destroys the shielded target within the pacing target", () => {
	const state = fireFixedStepDuel();
	expect(state.targetHull).toBe(0);
	// The enemy fired back through the duel: shields were engaged (their sum
	// is below the untouched total) while hull stayed untouched — so this is a
	// two-sided exchange that does not threaten the player at these numbers.
	expect(state.foreShield + state.aftShield).toBeLessThan(
		COMBAT_PROTOTYPE_DEFAULTS.shield * 2,
	);
	expect(state.playerHull).toBe(COMBAT_PROTOTYPE_DEFAULTS.hull);
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

test("beam out-damages pulse and still heat-locks", () => {
	const beamDuel = (state = createCombatPrototype()) => {
		while (state.elapsed < 60 && state.targetHull > 0)
			// Same schedule as the pulse arm, from the same function the rig flies,
			// so "the two duels differ only in the weapon" is now a property of the
			// code rather than a claim in a comment.
			state = stepCombatPrototype(state, duelInputs(state, 0.1, "beam"));
		return state;
	};
	const beamState = beamDuel();
	// A fresh target proves the weapon still reaches heat lockout on its own.
	const lockState = stepCombatPrototype(createCombatPrototype(), {
		dt: 3.4,
		firing: "beam",
	});
	expect(lockState.heatLocked).toBe(true);
	// The beam kills the target in fewer seconds than the pulse duel (both
	// alternate the target shield bank), so it is the faster weapon despite
	// the heat lock.
	expect(beamState.targetHull).toBe(0);
	expect(beamState.elapsed).toBeLessThan(fireFixedStepDuel().elapsed);
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

// ---------------------------------------------------------------------------
// #61 — the duel schedule is one function
// ---------------------------------------------------------------------------
//
// It used to be three: `Game.step` drove the live rig, and this file wrote the
// same arithmetic out twice more — once per weapon arm — with a comment
// asserting the arms matched. They drifted, and the repair was a run of
// commits that hand-mirrored one copy onto another ("match beam and pulse duel
// arms", "mirror enemy aft alternation in duel", "mirror live rig in pacing
// test and retune pulse"). A comment claiming two things are the same is not a
// check that they are.

test("the weapon changes `firing` and no other input", () => {
	// **What this proves, stated exactly.** `duelInputs` is a function of the
	// state, and the weapon reaches only the `firing` field — so two arms given
	// the *same* state are handed the same schedule.
	//
	// It does **not** prove two *flown* duels see the same schedule: they
	// diverge in hull as they run, and `enemyFiring` reads both hulls. An
	// earlier version of this test claimed that, and could not have shown it —
	// it walked `createCombatPrototype({ elapsed })`, whose hulls are always
	// full, so the one state-dependent term never varied and agreed vacuously.
	//
	// The states below vary the hulls deliberately, so `enemyFiring` takes both
	// values across the walk; the counters at the end refuse a run where it did
	// not.
	let enemyFiringTrue = 0;
	let enemyFiringFalse = 0;
	for (let elapsed = 0; elapsed < 40; elapsed += 0.1) {
		for (const hulls of [
			{},
			{ targetHull: 0 },
			{ playerHull: 0 },
			{ targetHull: 12, playerHull: 30, heat: 40, energy: 55 },
		]) {
			const state = createCombatPrototype({ elapsed, ...hulls });
			const pulse = duelInputs(state, 0.1, "pulse");
			const beam = duelInputs(state, 0.1, "beam");
			expect({ ...pulse, firing: null }).toEqual({ ...beam, firing: null });
			expect(pulse.firing).toBe("pulse");
			expect(beam.firing).toBe("beam");
			if (pulse.enemyFiring) enemyFiringTrue++;
			else enemyFiringFalse++;
		}
	}
	// The control: without these the equality above would pass on a walk where
	// `enemyFiring` was constant, which is how the earlier version read green.
	expect(enemyFiringTrue).toBeGreaterThan(0);
	expect(enemyFiringFalse).toBeGreaterThan(0);
});

test("the schedule drives the cone off `duelTargetInCone`, not a second copy", () => {
	// Not a restatement of the arithmetic: this pins the schedule to the
	// *exported* predicate, so a fourth spelling of the cone cannot appear
	// inside `duelInputs` and agree with this file by coincidence.
	let disagreements = 0;
	let offCone = 0;
	for (let elapsed = 0; elapsed < 40; elapsed += 0.1) {
		const state = createCombatPrototype({ elapsed });
		const expected = duelTargetInCone(elapsed);
		if (duelInputs(state, 0.1, "pulse").targetInCone !== expected)
			disagreements++;
		if (!expected) offCone++;
	}
	expect(disagreements).toBe(0);
	// The control. Without it a `duelInputs` that returned a constant `true`
	// and a `duelTargetInCone` that did the same would agree perfectly, and the
	// assertion above would read green over both.
	expect(offCone).toBeGreaterThan(0);
});

test("the enemy stops firing once either side is dead", () => {
	const live = createCombatPrototype({ elapsed: 0 });
	// `elapsed % 4 < 2` is true at 0, so a live duel fires here — which is what
	// makes the two dead cases below a difference rather than a coincidence.
	expect(duelInputs(live, 0.1, "pulse").enemyFiring).toBe(true);
	const targetDead = createCombatPrototype({ elapsed: 0, targetHull: 0 });
	expect(duelInputs(targetDead, 0.1, "pulse").enemyFiring).toBe(false);
	const playerDead = createCombatPrototype({ elapsed: 0, playerHull: 0 });
	expect(duelInputs(playerDead, 0.1, "pulse").enemyFiring).toBe(false);
});

test("live inputs pass through, and are absent when the rig supplies none", () => {
	const state = createCombatPrototype();
	const bare = duelInputs(state, 0.1, null);
	// Absent, not `false`. `toBeFalsy` passed either way, so the half of this
	// test's name that says "absent" was checking nothing — and the two cases
	// differ to a caller that spreads the result over defaults.
	expect("incomingMissile" in bare).toBe(false);
	expect("ecm" in bare).toBe(false);
	expect("interdicting" in bare).toBe(false);
	expect("breakAngle" in bare).toBe(false);
	const flown = duelInputs(state, 0.1, null, {
		incomingMissile: true,
		ecm: true,
		interdicting: true,
		breakAngle: true,
	});
	expect(flown.incomingMissile).toBe(true);
	expect(flown.ecm).toBe(true);
	expect(flown.interdicting).toBe(true);
	expect(flown.breakAngle).toBe(true);
});
