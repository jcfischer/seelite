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
import {
	ASSIST_CAP_KMS,
	flightPerformance,
	frameMean,
	steadyFrame,
} from "../src/sim";
import * as orbiting from "./helpers/orbiting-frame";
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
			steadyFrame(frameVel),
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

test("a raider fights beside an orbiting station exactly as it fights in deep space (#529)", () => {
	// The frame the fight is flown in is a station on an orbit, and it
	// accelerates — 71.7 m/s² at USBISO's gas-giant shipyard. A raider holding
	// only its velocity lags it by `a × assistLateralTauS` and drifts off the
	// player. Sharing the acceleration makes the frame the local inertial one,
	// so the same duel, read relative to the player, is the same duel.
	const { framePos, frameVel, frameOver } = orbiting;
	const nose = v3(0, 0, -1);
	const duel = (orbits: boolean) => {
		const player = orbits
			? { pos: framePos(0), vel: frameVel(0) }
			: { pos: v3(), vel: v3() };
		let enemy = createCombatEnemy(player, nose, 99);
		const track: Vec3[] = [];
		for (let i = 0; i < 30 / DT; i++) {
			const t = i * DT;
			const frame = orbits ? frameOver(t, DT) : steadyFrame(v3());
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
				frame,
			).state;
			// The player at rest in the frame, carried as `stepFlight` carries it.
			player.pos = add(player.pos, scale(frameMean(frame), DT));
			player.vel = frame.end;
			track.push(sub(enemy.ship.pos, player.pos));
		}
		return track;
	};
	const still = duel(false);
	const circling = duel(true);
	let worst = 0;
	for (let i = 0; i < still.length; i++)
		worst = Math.max(worst, length(sub(circling[i], still[i])));
	expect(worst).toBeLessThan(1e-3);
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
	// Per axis since #619: each couple delivers its own authority, solved
	// equal to #181's figure at six significant figures.
	const step = (axis: "pitch" | "yaw" | "roll") =>
		RAIDER.angularAuthority[axis] * DT;
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
					(Math.abs(enemy.rates[axis]) - Math.abs(before[axis])) / step(axis),
				);
		}
	}
	expect(largest).toBeLessThanOrEqual(1 + 1e-9);
	// A raider that never spun up at full acceleration would pass on nothing.
	expect(largest).toBeGreaterThan(0.9);
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
	// 3°, and why not 2 (#619): the heading this raider wants is *away from
	// the player*, and it moves for as long as the raider slides sideways. The
	// assist's old clamp to the cap also deleted that slide in a hard turn;
	// the vents remove it at the translation pairs' rate (`flight-model.md`
	// §3.10), so the target moves for longer. Measured on this seed: 1.79° on
	// `main` before vents, 2.55° on them, at the same instant of the same
	// turn. A hunt would overshoot both ways and grow; the last row holds the
	// settle.
	expect(worstAfter).toBeLessThan((3 * Math.PI) / 180);
	expect(last).toBeLessThan((0.5 * Math.PI) / 180);
});
