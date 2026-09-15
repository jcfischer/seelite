/**
 * The raider flies by the player's rules (`combat-model.md` §1, node #324's
 * follow-ups after part d).
 *
 * Two places it did not. Its assist held speed in the star's frame while the
 * player's holds it in the local frame, so near a moving body the two caps were
 * different speeds. And its nose snapped to its turn rate in one frame while the
 * player's ship spins up through `stepAngular`'s angular acceleration.
 */
import { expect, test } from "bun:test";
import { createCombatPrototype } from "../src/combat-prototype";
import {
	ENEMY_COLLISION_RADIUS_KM,
	STRIKER_HULL_ID,
	createCombatEnemy,
	stepCombatEnemy,
} from "../src/combat-enemy";
import { ASSIST_CAP_KMS, flightPerformance } from "../src/sim";
import {
	type Vec3,
	add,
	cross,
	dot,
	length,
	scale,
	sub,
	v3,
} from "../src/vec3";

const RAIDER = flightPerformance(STRIKER_HULL_ID);
const DT = 1 / 60;

const angle = (a: Vec3, b: Vec3) =>
	Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

test("the assist holds the raider's speed in the fight's frame, as it holds the player's", () => {
	// A fight beside a body moving 30 km/s: fifteen times the cap.
	const frameVel = v3(30, 0, 0);
	const player = { pos: v3(), vel: { ...frameVel } };
	const nose = v3(0, 0, -1);
	let enemy = createCombatEnemy(player, nose, 99);
	let fastest = 0;
	let farthest = 0;
	for (let t = 0; t < 15; t += DT) {
		enemy = stepCombatEnemy(
			enemy,
			player,
			nose,
			createCombatPrototype(),
			false,
			DT,
			player.pos,
			nose,
			ENEMY_COLLISION_RADIUS_KM,
			frameVel,
		).state;
		player.pos = add(player.pos, scale(frameVel, DT));
		fastest = Math.max(fastest, length(sub(enemy.ship.vel, frameVel)));
		farthest = Math.max(farthest, length(sub(enemy.ship.pos, player.pos)));
	}
	expect(fastest).toBeLessThanOrEqual(ASSIST_CAP_KMS + 1e-9);
	// A raider braking toward the star's frame is left kilometres behind a
	// fight that moves at 30 km/s.
	expect(farthest).toBeLessThan(30);
});

/** A duel against a still player, tracing the nose's angular velocity. */
function noseRates(seed: number, seconds: number) {
	const player = { pos: v3(), vel: v3() };
	const playerNose = v3(0, 0, -1);
	let enemy = createCombatEnemy(player, playerNose, seed);
	const rates: Vec3[] = [];
	for (let t = 0; t < seconds; t += DT) {
		const before = enemy.nose;
		enemy = stepCombatEnemy(
			enemy,
			player,
			playerNose,
			createCombatPrototype(),
			false,
			DT,
		).state;
		const turned = angle(before, enemy.nose);
		const axis = cross(before, enemy.nose);
		const size = length(axis);
		rates.push(size === 0 ? v3() : scale(axis, turned / size / DT));
	}
	return { rates, enemy };
}

/**
 * **The row that was red on `main`, and all it shows is that the snap is
 * gone.** Measured in world space, the nose's rate mixes pitch, yaw and the
 * roll carrying the turn axis round, so its bound is loose: about twice what
 * one axis at the hull's acceleration would allow (sage #345). The exact rule
 * is the next row's.
 */
test("the nose's turn rate does not snap from one frame to the next", () => {
	const { angularMax, angularAccel } = RAIDER;
	const bound =
		(Math.SQRT2 * angularAccel + angularMax.yaw * angularMax.roll) * DT * 1.05;
	let largest = 0;
	for (const seed of [1, 99, 777, 12345]) {
		const { rates } = noseRates(seed, 40);
		for (let i = 1; i < rates.length; i++)
			largest = Math.max(largest, length(sub(rates[i], rates[i - 1])));
	}
	// `main`'s slew read 2.19 rad/s in one frame here.
	expect(largest).toBeLessThanOrEqual(bound);
});

/**
 * The exact rule, on the body rates `stepAngular` carries: **a rate only grows
 * through a commanded acceleration**, by at most `angularAccel · dt` a step.
 * The assist's damping and the rate clamp only ever shrink one, so shrinking is
 * not bounded here — it is faster than the acceleration at full rate, for the
 * player's ship as well.
 */
test("each body rate grows by at most the hull's angular acceleration, and that limit binds", () => {
	const player = { pos: v3(), vel: v3() };
	const playerNose = v3(0, 0, -1);
	const step = RAIDER.angularAccel * DT;
	let largest = 0;
	for (const seed of [1, 99, 777, 12345]) {
		let enemy = createCombatEnemy(player, playerNose, seed);
		for (let t = 0; t < 40; t += DT) {
			const before = enemy.rates;
			enemy = stepCombatEnemy(
				enemy,
				player,
				playerNose,
				createCombatPrototype(),
				false,
				DT,
			).state;
			for (const axis of ["pitch", "yaw", "roll"] as const)
				largest = Math.max(
					largest,
					Math.abs(enemy.rates[axis]) - Math.abs(before[axis]),
				);
		}
	}
	expect(largest).toBeLessThanOrEqual(step + 1e-12);
	// A raider that never spun up at full acceleration would pass on nothing.
	expect(largest).toBeGreaterThan(0.9 * step);
});

test("a turn settles on its heading instead of hunting around it", () => {
	// Fleeing a still player: the heading it wants barely moves, and it starts
	// nosed straight at the player, half a turn away.
	const player = { pos: v3(), vel: v3() };
	const playerNose = v3(0, 0, -1);
	let enemy = createCombatEnemy(player, playerNose, 1);
	const fleeing = createCombatPrototype({ targetHull: 20 });
	let arrived = false;
	let worstAfter = 0;
	let last = Math.PI;
	for (let t = 0; t < 8; t += DT) {
		enemy = stepCombatEnemy(
			enemy,
			player,
			playerNose,
			fleeing,
			false,
			DT,
		).state;
		const away = scale(
			sub(enemy.ship.pos, player.pos),
			1 / length(sub(enemy.ship.pos, player.pos)),
		);
		last = angle(enemy.nose, away);
		if (last < (1 * Math.PI) / 180) arrived = true;
		if (arrived) worstAfter = Math.max(worstAfter, last);
	}
	expect(enemy.phase).toBe("flee");
	expect(arrived).toBe(true);
	expect(worstAfter).toBeLessThan((2 * Math.PI) / 180);
	expect(last).toBeLessThan((0.5 * Math.PI) / 180);
});
