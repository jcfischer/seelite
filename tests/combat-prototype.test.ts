import { expect, test } from "bun:test";
import {
	COMBAT_PROTOTYPE_DEFAULTS,
	createCombatPrototype,
	duelInputs,
	stepCombatPrototype,
	duelTargetInCone,
} from "../src/combat-prototype";
import {
	ENEMY_COLLISION_RADIUS_KM,
	FIRE_COS,
	GUN_RANGE_KM,
	MAX_TURN_RATE_RAD_S,
	MERGE_BREAK_KM,
	PLAYER_LASER_RANGE_KM,
	createCombatEnemy,
	playerLaserHit,
	stepCombatEnemy,
} from "../src/combat-enemy";
import { dot, length, scale, sub, v3 } from "../src/vec3";

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
	// The enemy fired back through the duel, and it now costs the player hull.
	//
	// **This assertion used to be `playerHull === hull` — untouched — and that
	// was a property of the recharge, not of the exchange.** Recharge was 6/s
	// against a 6/s pulse, so nothing short of continuous fire could take a
	// point off a shield, and the scripted enemy fires on a 50 % schedule. With
	// `shieldRechargeDelaySeconds` the schedule lands: the player finishes this
	// duel around half hull. A duel the player cannot lose is not a duel, and
	// #48's "does not threaten the player at these numbers" was a claim about
	// the arithmetic rather than about the fight.
	//
	// The bound is wide on purpose: the exact figure is a balance number the
	// principal has to fly, and pinning it here would make a retune look like a
	// regression. What the test holds is the shape — hull is taken, and the
	// player is alive at the end.
	expect(state.foreShield + state.aftShield).toBeLessThan(
		COMBAT_PROTOTYPE_DEFAULTS.shield * 2,
	);
	expect(state.playerHull).toBeGreaterThan(0);
	expect(state.playerHull).toBeLessThan(COMBAT_PROTOTYPE_DEFAULTS.hull);
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

/**
 * What the recharge delay is for, stated as the exchange it makes possible.
 *
 * A fifth of the time on target is below the recharge rate, so without the
 * delay this volley cannot take a single point off — which is the state the
 * flown duel was in: the striker held its nose on the player for 13 % of a
 * fight, fired on 99 frames of 787, and the player's shields did not move.
 */
test("intermittent fire lands, which is what the recharge delay is for", () => {
	const duty = 5;
	let state = createCombatPrototype();
	const opening = state.foreShield;
	for (let frame = 0; frame < 600; frame++)
		state = stepCombatPrototype(state, {
			dt: 0.05,
			enemyFiring: frame % duty === 0,
		});
	expect(state.foreShield).toBeLessThan(opening);
});

test("a shield that has just been hit waits out the delay before recharging", () => {
	const delay = COMBAT_PROTOTYPE_DEFAULTS.shieldRechargeDelaySeconds;
	// **The guard is the test.** The wait below is `delay - 0.25` long, so a
	// delay of zero makes that loop empty and the assertion after it compares a
	// value to itself — which is exactly how this read green against a build
	// with the delay removed. A constant that makes the check vacuous has to
	// fail it rather than satisfy it.
	expect(delay).toBeGreaterThan(0.5);
	let state = createCombatPrototype({ foreShield: 40 });
	state = stepCombatPrototype(state, { dt: 0.1, enemyFiring: true });
	const struck = state.foreShield;
	expect(struck).toBeLessThan(40);
	for (let elapsed = 0; elapsed < delay - 0.25; elapsed += 0.1)
		state = stepCombatPrototype(state, { dt: 0.1 });
	expect(state.foreShield).toBeCloseTo(struck, 6);
	// And it does come back, or the delay would be a shield that never returns.
	for (let elapsed = 0; elapsed < 1; elapsed += 0.1)
		state = stepCombatPrototype(state, { dt: 0.1 });
	expect(state.foreShield).toBeGreaterThan(struck + 3);
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

/**
 * One duel, traced.
 *
 * The player is a fixed point unless a test says otherwise, which is the
 * *hardest* case for the controller rather than the easiest: a target that
 * never manoeuvres gives a canned path nothing to hide behind.
 */
function flyDuel({
	seed = 12345,
	seconds = 40,
	dt = 0.05,
	playerNose = v3(0, 0, -1),
	playerFiring = false,
	player = { pos: v3(), vel: v3() },
	tracking = false,
}: {
	seed?: number;
	seconds?: number;
	dt?: number;
	playerNose?: ReturnType<typeof v3>;
	playerFiring?: boolean;
	player?: { pos: ReturnType<typeof v3>; vel: ReturnType<typeof v3> };
	/** Keep the player's nose on the enemy every frame, which is what a pilot
	 *  in a dogfight does and the hardest case for a controller that reacts to
	 *  being tracked. */
	tracking?: boolean;
} = {}) {
	let enemy = createCombatEnemy(player, playerNose, seed);
	let combat = createCombatPrototype();
	let lowestTargetEnergy = combat.targetEnergy;
	let lowestPlayerShield = combat.foreShield + combat.aftShield;
	const trace: {
		range: number;
		phase: string;
		pos: ReturnType<typeof v3>;
		nose: ReturnType<typeof v3>;
		up: ReturnType<typeof v3>;
		aspect: number;
		turnRate: number;
		firing: boolean;
	}[] = [];
	for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
		const beforeNose = enemy.nose;
		// The geometry the controller itself decided on: range and bearing are
		// read *before* the step and the nose is the one it commanded. A trace
		// that measured range from the post-step position would disagree with
		// the firing gate by one frame's travel and go red on the boundary.
		const toPlayer = sub(player.pos, enemy.ship.pos);
		const range = length(toPlayer);
		const bearing = scale(toPlayer, 1 / range);
		if (tracking) playerNose = scale(bearing, -1);
		const step = stepCombatEnemy(
			enemy,
			player,
			playerNose,
			combat,
			playerFiring,
			dt,
		);
		enemy = step.state;
		combat = stepCombatPrototype(combat, {
			dt,
			targetInCone: step.targetInCone,
			enemyFiring: step.enemyFiring,
			enemyHitAft: step.enemyHitAft,
		});
		lowestTargetEnergy = Math.min(lowestTargetEnergy, combat.targetEnergy);
		lowestPlayerShield = Math.min(
			lowestPlayerShield,
			combat.foreShield + combat.aftShield,
		);
		trace.push({
			range,
			phase: enemy.phase,
			pos: enemy.ship.pos,
			nose: enemy.nose,
			up: enemy.up,
			aspect: dot(enemy.nose, bearing),
			turnRate:
				Math.acos(Math.min(1, Math.max(-1, dot(beforeNose, enemy.nose)))) / dt,
			firing: step.enemyFiring,
		});
	}
	return { trace, combat, enemy, lowestTargetEnergy, lowestPlayerShield };
}

const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
const DUEL_SEEDS = [1, 99, 777, 12345];

test("the enemy closes, attacks and trades through shared pulse arithmetic", () => {
	const { trace, lowestTargetEnergy, lowestPlayerShield } = flyDuel({
		seconds: 25,
	});
	expect(trace.some((row) => row.phase === "attack")).toBe(true);
	expect(trace.some((row) => row.firing)).toBe(true);
	// Minima, not end state: both pools regenerate, so a final reading proves
	// only that the fight stopped.
	expect(lowestTargetEnergy).toBeLessThan(COMBAT_PROTOTYPE_DEFAULTS.energy);
	expect(lowestPlayerShield).toBeLessThan(COMBAT_PROTOTYPE_DEFAULTS.shield * 2);
});

/**
 * The complaint this controller was rewritten for. The first build held a nine
 * kilometre orbit behind a five kilometre floor, so the target was never in a
 * range band where a fixed forward gun is a weapon and never large enough on
 * the glass to read as a ship. A duel has to be *pressed*.
 */
test("the enemy presses the attack instead of holding a standoff orbit", () => {
	for (const seed of DUEL_SEEDS) {
		const { trace } = flyDuel({ seed });
		const closest = Math.min(...trace.map((row) => row.range));
		const inGunRange = trace.filter((row) => row.range <= GUN_RANGE_KM).length;
		// It comes inside the merge distance…
		expect(closest).toBeLessThan(MERGE_BREAK_KM);
		// …but breaks rather than flying through the hull it is shooting at.
		expect(closest).toBeGreaterThan(ENEMY_COLLISION_RADIUS_KM);
		// …and most of the fight happens in its own weapon envelope.
		expect(inGunRange / trace.length).toBeGreaterThan(0.4);
	}
});

/**
 * The rejected build's complaint, in the form it can come back in.
 *
 * A pilot holds the sight on the target, so the tail rule is live for most of
 * the fight; without `evadeCooldown` bounding it the striker breaks far more
 * than it shoots. The discriminating number is the share of frames it is
 * firing, measured over eight seeds at 45 s: **0.294–0.305** with the lockout
 * and **0.154–0.230** without, so 0.26 separates them with margin on both
 * sides. Both arms re-measured on the rebase onto #181, which gave the striker
 * the raider's own 2.690 km/s² in place of the courier's 2.000; the gap held
 * its shape and both bounds moved by under a point.
 */
test("a player who keeps their nose on it cannot suppress its guns", () => {
	for (const seed of DUEL_SEEDS) {
		const { trace } = flyDuel({ seed, seconds: 45, tracking: true });
		const firing = trace.filter((row) => row.firing).length;
		expect(firing / trace.length).toBeGreaterThan(0.26);
		expect(Math.min(...trace.map((row) => row.range))).toBeLessThan(2);
		// And it does still break off — a ship that ignored the tail entirely
		// would pass both checks above and fail the point of the rule.
		expect(trace.some((row) => row.phase === "evade")).toBe(true);
	}
});

test("an attack run puts the ship's nose on the player", () => {
	for (const seed of DUEL_SEEDS) {
		const { trace } = flyDuel({ seed });
		const bestAspect = Math.max(...trace.map((row) => row.aspect));
		// Within five degrees of the boresight at the top of a run. The rejected
		// build commanded the orbit tangent and never got near this.
		expect(bestAspect).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
	}
});

/**
 * The rejected build took every lateral term from `cross(towardPlayer, up)`,
 * which is perpendicular to the world's y axis by construction: the target
 * could only crab around the horizontal. This is the check that the manoeuvre
 * direction is drawn over the whole circle instead.
 */
test("the fight is not confined to a plane", () => {
	for (const seed of DUEL_SEEDS) {
		const { trace } = flyDuel({ seed, seconds: 40 });
		const vertical = spread(trace.map((row) => row.pos.y));
		expect(vertical).toBeGreaterThan(3);
	}
});

/**
 * A gate that cannot bite is not a gate. This asserts both halves: the ship
 * does spend time inside gun range with the nose off the target, and it is
 * cold on every one of those frames.
 */
test("fire is gated on the boresight, not on being nearby", () => {
	const { trace } = flyDuel({ seconds: 40 });
	const nearButOffAim = trace.filter(
		(row) => row.range <= GUN_RANGE_KM && row.aspect < FIRE_COS,
	);
	expect(nearButOffAim.length).toBeGreaterThan(20);
	expect(nearButOffAim.every((row) => !row.firing)).toBe(true);
	expect(trace.some((row) => row.firing)).toBe(true);
});

test("the nose slews at a bounded rate and the ceiling actually binds", () => {
	const { trace } = flyDuel({ seconds: 40 });
	const fastest = Math.max(...trace.map((row) => row.turnRate));
	expect(fastest).toBeLessThanOrEqual(MAX_TURN_RATE_RAD_S + 1e-6);
	// Without this the test would pass on a ship that never turns hard, which
	// is the failure mode a rate limit is supposed to make impossible to hide.
	expect(fastest).toBeGreaterThan(MAX_TURN_RATE_RAD_S * 0.95);
});

test("two seeds fly two different fights", () => {
	const a = flyDuel({ seed: 1, seconds: 30 }).trace;
	const b = flyDuel({ seed: 99, seconds: 30 }).trace;
	const apart = a.map((row, index) => length(sub(row.pos, b[index].pos)));
	expect(Math.max(...apart)).toBeGreaterThan(3);
});

test("the ship banks into its turns and its roll reference stays a frame", () => {
	const { trace } = flyDuel({ seconds: 40 });
	for (const row of trace) {
		expect(Math.abs(length(row.up) - 1)).toBeLessThan(1e-6);
		expect(Math.abs(dot(row.up, row.nose))).toBeLessThan(1e-6);
	}
	// A ship that yawed flat would keep its roll reference near world up for the
	// whole fight; a banking one lays it over.
	expect(Math.min(...trace.map((row) => row.up.y))).toBeLessThan(0.2);
});

test("the player on the enemy's six forces a defensive spiral", () => {
	const player = { pos: v3(), vel: v3() };
	const playerNose = v3(0, 0, -1);
	let enemy = createCombatEnemy(player, playerNose);
	// Directly ahead of the player and running away from them: tracked, and not
	// looking back.
	enemy = { ...enemy, phase: "attack", phaseSeconds: 0 };
	enemy.ship.pos = v3(0, 0, -4);
	enemy.nose = v3(0, 0, -1);
	let phase = enemy.phase;
	for (let elapsed = 0; elapsed < 1; elapsed += 0.1) {
		const step = stepCombatEnemy(
			enemy,
			player,
			playerNose,
			createCombatPrototype(),
			false,
			0.1,
		);
		enemy = step.state;
		phase = enemy.phase;
	}
	expect(phase).toBe("evade");
});

test("a head-on merge is jousted rather than evaded", () => {
	const player = { pos: v3(), vel: v3() };
	const playerNose = v3(0, 0, -1);
	let enemy = createCombatEnemy(player, playerNose);
	// The same sight line as the test above — the player is pointed straight at
	// it — but nosed back at the player. That is a merge, and calling it off is
	// exactly how the rejected build stopped attacking.
	enemy = { ...enemy, phase: "attack", phaseSeconds: 0 };
	enemy.ship.pos = v3(0, 0, -4);
	enemy.nose = v3(0, 0, 1);
	for (let elapsed = 0; elapsed < 1; elapsed += 0.1)
		enemy = stepCombatEnemy(
			enemy,
			player,
			playerNose,
			createCombatPrototype(),
			false,
			0.1,
		).state;
	expect(enemy.phase).toBe("attack");
});

test("enemy flight does not inherit a change in player velocity", () => {
	const player = { pos: v3(), vel: v3(0, 0, -1) };
	const enemy = createCombatEnemy(player, v3(0, 0, -1));
	const step = stepCombatEnemy(
		enemy,
		player,
		v3(0, 0, -1),
		createCombatPrototype(),
		false,
		0.1,
	);
	// A player-relative frame would have driven this positive immediately.
	expect(step.state.ship.vel.z).toBeLessThan(0);
});

test("a critically damaged enemy flees rather than receiving a scripted final hit", () => {
	const player = { pos: v3(), vel: v3() };
	const enemy = createCombatEnemy(player, v3(0, 0, -1));
	const step = stepCombatEnemy(
		enemy,
		player,
		v3(0, 0, -1),
		createCombatPrototype({ targetHull: 20 }),
		false,
		0.1,
	);
	expect(step.state.phase).toBe("flee");
	expect(step.enemyFiring).toBe(false);
});

test("the enemy spawns beyond the player beam, nosed at them", () => {
	for (const seed of DUEL_SEEDS) {
		const player = { pos: v3(), vel: v3() };
		const enemy = createCombatEnemy(player, v3(0, 0, -1), seed);
		const range = length(sub(enemy.ship.pos, player.pos));
		expect(range).toBeGreaterThan(PLAYER_LASER_RANGE_KM);
		const toPlayer = scale(sub(player.pos, enemy.ship.pos), 1 / range);
		expect(dot(enemy.nose, toPlayer)).toBeGreaterThan(0.99);
	}
});

/**
 * The rejected build gated acquisition on the player's own forward cone, so a
 * pirate politely waited to be looked at. It does not any more — but the
 * *beam* still depends on where the player is pointed, and that half is real.
 */
test("the enemy closes even while the player looks away", () => {
	const player = { pos: v3(), vel: v3() };
	const away = v3(0, 0, 1);
	let enemy = createCombatEnemy(player, v3(0, 0, -1));
	const opening = length(sub(enemy.ship.pos, player.pos));
	let step = stepCombatEnemy(
		enemy,
		player,
		away,
		createCombatPrototype(),
		false,
		0.1,
	);
	expect(step.targetInCone).toBe(false);
	for (let elapsed = 0; elapsed < 8; elapsed += 0.1) {
		step = stepCombatEnemy(
			enemy,
			player,
			away,
			createCombatPrototype(),
			false,
			0.1,
		);
		enemy = step.state;
	}
	expect(length(sub(enemy.ship.pos, player.pos))).toBeLessThan(opening - 5);
});

test("incoming fire that connects forces an immediate evade", () => {
	const player = { pos: v3(), vel: v3() };
	const enemy = createCombatEnemy(player, v3(0, 0, -1));
	enemy.phase = "attack";
	enemy.ship.pos = v3(0, 0, -8);
	const step = stepCombatEnemy(
		enemy,
		player,
		v3(0, 0, -1),
		createCombatPrototype(),
		true,
		0.1,
	);
	expect(step.state.phase).toBe("evade");
});

test("a near miss leaves a short targeting window before a hit forces a break", () => {
	const player = { pos: v3(), vel: v3() };
	const enemy = createCombatEnemy(player, v3(0, 0, -1));
	enemy.phase = "attack";
	enemy.ship.pos = v3(0.75, 0, -8);
	expect(playerLaserHit(player.pos, v3(0, 0, -1), enemy.ship.pos).hit).toBe(
		false,
	);
	const step = stepCombatEnemy(
		enemy,
		player,
		v3(0, 0, -1),
		createCombatPrototype(),
		true,
		0.1,
	);
	expect(step.state.phase).toBe("attack");
});

test("the player beam uses a finite sim-space ray and its first sphere contact", () => {
	const direct = playerLaserHit(v3(), v3(0, 0, -1), v3(0, 0, -8));
	expect(direct.hit).toBe(true);
	expect(direct.distanceKm).toBeLessThan(8);
	expect(playerLaserHit(v3(), v3(0, 0, -1), v3(1, 0, -8)).hit).toBe(false);
	expect(
		playerLaserHit(v3(), v3(0, 0, -1), v3(0, 0, -PLAYER_LASER_RANGE_KM - 1))
			.hit,
	).toBe(false);
});

test("enemy hit-testing can use the cockpit sightline rather than ship attitude", () => {
	const player = { pos: v3(), vel: v3() };
	const enemy = createCombatEnemy(player, v3(0, 0, -1));
	enemy.ship.pos = v3(0, 0, -8);
	const step = stepCombatEnemy(
		enemy,
		player,
		v3(0, 0, 1),
		createCombatPrototype(),
		false,
		0.1,
		v3(),
		v3(0, 0, -1),
	);
	expect(step.targetInCone).toBe(true);
});
