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
 * **How independent that comparison is, exactly.** Not fully, and an earlier
 * wording here said "a genuinely independent construction", which was too
 * strong: both sides call the same `arrivalPoint`, so this cannot catch a bug
 * *inside* that function. What it catches is everything around it — the four
 * arguments, the clock value, the order of the reset's first two lines, and any
 * field the reset does not write at all.
 *
 * The ordering half needed the code to change before the claim was true.
 * `sim.ts` passed `advanceSystem` a literal `0` rather than `world.gameTime`,
 * which made those two lines commute — so no swap could go red, and a receipt
 * here nonetheless said one had. The clock is read back now, and the ordering
 * test below is what would have caught the claim.
 */
import { describe, expect, test } from "bun:test";
import { codeOf } from "./lib/source-scan";
import {
	advanceWorldClock,
	makeWorld,
	resetWorldToStart,
	stepWorld,
	flightPerformance,
} from "../src/sim";
import { PLAYER_BASELINE_HULL } from "../src/hull";

/** The baseline hull's handling — see `tests/sim.test.ts` for why these rows
 *  pass a hull's performance and why the courier's is the one they pass. */
const BASELINE = flightPerformance(PLAYER_BASELINE_HULL);

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

	test("the clock is set before the bodies are placed against it", () => {
		// Two halves, because neither alone is the claim. The source check pins the
		// order; the behavioural half proves the order matters — swap the lines and
		// `advanceSystem` runs on the pre-reset clock, leaving every body at t=900.
		// `codeOf`, not `readFileSync`: comments are blanked, so the rejected form
		// quoted in the comment beside the fix cannot redden this. Bounded at the
		// next export, so a function appended below cannot widen it either.
		const source = codeOf("src/sim.ts");
		const from = source.indexOf("export function resetWorldToStart");
		const next = source.indexOf("\nexport ", from + 1);
		const fn = source.slice(from, next === -1 ? undefined : next);

		// Both literals present before their order means anything: `indexOf`
		// returns -1 for a miss, and -1 is less than every real index, so the
		// comparison on its own goes green having matched nothing.
		expect(fn).toContain("world.gameTime = 0;");
		expect(fn).toContain("advanceSystem(world.system, world.gameTime)");
		expect(fn.indexOf("world.gameTime = 0;")).toBeLessThan(
			fn.indexOf("advanceSystem(world.system, world.gameTime)"),
		);
		expect(fn).not.toContain("advanceSystem(world.system, 0)");

		const world = flyForward(SEED, 900);
		resetWorldToStart(world);
		const fresh = makeWorld(SEED);
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
			stepWorld(flown, control, 0.05, BASELINE);
			stepWorld(fresh, control, 0.05, BASELINE);
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
