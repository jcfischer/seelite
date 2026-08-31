/**
 * `resetWorldToStart` puts a flown world back where `makeWorld` left it.
 *
 * ## Why this test is the guard and not the probe
 *
 * `probe-arrival.mjs` flies two legs on one page, with a reset between them
 * (#121). The reset exists so leg 2 starts from the arrival point the seed-481
 * fixture was classified against — *host between arrival point and station at
 * leg start* — rather than from wherever leg 1 parked the ship.
 *
 * A reset that forgets a field measures a state no player ever has, and the
 * browser probe using it cannot detect that: it would fly a leg from a slightly
 * wrong place and report a perfectly formed number about it. So the guard is
 * here, on the tier that runs on every push, and it compares against a fresh
 * `makeWorld(seed)` rather than against the reset's own arithmetic.
 *
 * **How independent that comparison is, exactly.** Not fully, and the earlier
 * wording here said "a genuinely independent construction", which was too
 * strong: both sides call the same `arrivalPoint`, so this cannot catch a bug
 * *inside* that function. What it catches is everything around it — the four
 * arguments, the clock value, the ordering of the two, and any field the reset
 * does not write at all. Every one of those was confirmed by deleting the line
 * and watching this file go red.
 *
 * **The reset restates its values; this test proves they are the right ones.**
 * Building the reset *from* `makeWorld` would make the comparison a tautology:
 * it could not fail, so it would prove nothing about whether boot state and
 * reset state agree.
 */
import { describe, expect, test } from "bun:test";
import {
	advanceWorldClock,
	makeWorld,
	resetWorldToStart,
	stepWorld,
} from "../src/sim";

/** The probe's fixture, so this test guards the world the reset is used on. */
const SEED = 481;

/** Fly a world forward the way a cruise leg does: the clock advances, the
 *  bodies move with it, and the ship ends up somewhere else entirely. */
function flyForward(seed: number, seconds: number) {
	const world = makeWorld(seed);
	advanceWorldClock(world, seconds);
	// Not a cruise integration — this test is about what the reset restores, not
	// about how the ship got away from the arrival point. Any displacement will
	// do, and a large one makes a missed field loud.
	world.ship.pos = { x: 1e9, y: -2e9, z: 3e9 };
	world.ship.vel = { x: 7, y: -11, z: 13 };
	return world;
}

describe("resetWorldToStart", () => {
	test("the clock goes back to zero", () => {
		const world = flyForward(SEED, 900);
		expect(world.gameTime).toBe(900);
		resetWorldToStart(world);
		expect(world.gameTime).toBe(makeWorld(SEED).gameTime);
		expect(world.gameTime).toBe(0);
	});

	test("the ship is back at the arrival point, at rest", () => {
		const world = flyForward(SEED, 900);
		resetWorldToStart(world);
		const fresh = makeWorld(SEED);
		expect(world.ship.pos).toEqual(fresh.ship.pos);
		expect(world.ship.vel).toEqual(fresh.ship.vel);
	});

	test("every body is back where t0 put it", () => {
		const world = flyForward(SEED, 900);
		const fresh = makeWorld(SEED);
		// The premise: 900 s of orbit actually moves something. Without this the
		// body comparison below could pass on a reset that does nothing at all.
		const moved = world.system.bodies.some((b) => {
			const at0 = fresh.system.byId.get(b.id);
			if (!at0) throw new Error(`body ${b.id} is not in a fresh world`);
			return (
				b.pos.x !== at0.pos.x || b.pos.y !== at0.pos.y || b.pos.z !== at0.pos.z
			);
		});
		expect(moved).toBe(true);

		resetWorldToStart(world);
		expect(world.system.bodies.length).toBe(fresh.system.bodies.length);
		for (const body of world.system.bodies) {
			const at0 = fresh.system.byId.get(body.id);
			if (!at0) throw new Error(`body ${body.id} is not in a fresh world`);
			expect(body.pos).toEqual(at0.pos);
		}
	});

	test("the system is the same object, not a regenerated one", () => {
		// #121 ratified a **ship-state reset within one system**, never a world
		// rebuild. `Game` calls `makeWorld` exactly once and holds two per-system
		// caches that are deliberately never invalidated on that basis — the baked
		// `environmentMap` and the `interiors` berth catalogue, whose own comment
		// says a build that adds a jump owes it a clear. A reset that swapped the
		// system out would be that build, silently.
		const world = flyForward(SEED, 900);
		const system = world.system;
		const contents = world.system.contents;
		const byId = world.system.byId;
		resetWorldToStart(world);
		expect(world.system).toBe(system);
		expect(world.system.contents).toBe(contents);
		expect(world.system.byId).toBe(byId);
	});

	test("a reset world steps forward exactly as a fresh one does", () => {
		// The property the probe actually depends on: after the reset, leg 2 is
		// the leg it would have been on a freshly booted page. Equality of the
		// listed fields is the mechanism; this is the claim.
		const flown = flyForward(SEED, 900);
		resetWorldToStart(flown);
		const fresh = makeWorld(SEED);
		const control = { throttle: 1, nose: { x: 1, y: 0, z: 0 }, assist: true };
		for (let i = 0; i < 200; i++) {
			stepWorld(flown, control, 0.05);
			stepWorld(fresh, control, 0.05);
		}
		expect(flown.gameTime).toBe(fresh.gameTime);
		expect(flown.ship.pos).toEqual(fresh.ship.pos);
		expect(flown.ship.vel).toEqual(fresh.ship.vel);
		for (const body of flown.system.bodies) {
			const other = fresh.system.byId.get(body.id);
			if (!other) throw new Error(`body ${body.id} is not in a fresh world`);
			expect(body.pos).toEqual(other.pos);
		}
	});
});
