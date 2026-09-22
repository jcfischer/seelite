/**
 * `restoreWorld` is the load path's half of world construction (#90).
 *
 * A save records a galaxy index, a system index and a clock, and none of the
 * three is what `makeWorld` produces: `makeWorld` hardcodes `START_GALAXY` and
 * clock zero, and `jumpWorldTo` **throws** on a destination in another galaxy
 * because `World.galaxy` is one galaxy held whole. So a save taken in galaxy 3
 * cannot be reached by constructing and jumping — it needs a world built for
 * that galaxy from the start.
 *
 * `makeWorld` is a call to `restoreWorld` rather than a second construction
 * path beside it — so comparing their outputs would compare a call with
 * itself. The first row checks the *delegation* instead, and
 * `tests/world-reset.test.ts` is what holds the values, because it restates
 * them rather than reading them off `makeWorld`.
 */

import { describe, expect, test } from "bun:test";
import { generateGalaxy, startSystem } from "../src/galaxy";
import { codeOf } from "./lib/source-scan";
import {
	canResetWorldToStart,
	makeWorld,
	makeWorldAtSystem,
	restoreWorld,
	START_GALAXY,
} from "../src/sim";
import { arrivalPoint } from "../src/system";

const SEED = 0x5ee11e;

describe("restoreWorld", () => {
	test("there is one construction path, and makeWorld is a call into it", () => {
		// **Comparing the two outputs would be a tautology now.** `makeWorld`
		// delegates, so `restoreWorld(seed, START_GALAXY, start, 0)` and
		// `makeWorld(seed)` are the same call and would agree on any build,
		// including one where both drifted together. What is checkable is the
		// delegation itself — a second construction path reintroduced beside
		// this one is how a load and a new game come to disagree — and the
		// *values*, which `tests/world-reset.test.ts` restates rather than
		// reading off `makeWorld`, and which is the file that goes red.
		const body = codeOf("src/sim.ts").split("export function makeWorld")[1];
		expect(body).toContain("restoreWorld(");
		expect(body.split("}")[0]).not.toContain("makeSystem(");
		// **And the pinned boot goes through the same door** (#432). The rule is
		// that there is one way to build a world; a second path introduced for
		// `?system=` is how a fixture boot and a load come to disagree about what
		// "a new game" means, quietly and for whichever one nobody re-reads.
		const pinned = codeOf("src/sim.ts").split(
			"export function makeWorldAtSystem",
		)[1];
		expect(pinned.split("}")[0]).toContain("restoreWorld(");
		expect(pinned.split("}")[0]).not.toContain("makeSystem(");
		// And the arguments a new game means: galaxy 0, the start system, t=0.
		const start = startSystem(generateGalaxy(SEED, START_GALAXY));
		const fresh = makeWorld(SEED);
		expect(fresh.galaxy.index).toBe(START_GALAXY);
		expect(fresh.system.record.index).toBe(start.index);
		expect(fresh.gameTime).toBe(0);
	});

	test("it reaches a galaxy jumpWorldTo refuses", () => {
		const world = restoreWorld(SEED, 3, 17, 4200);
		expect(world.galaxy.index).toBe(3);
		expect(world.system.record.index).toBe(17);
		expect(world.system.record.galaxy).toBe(3);
		expect(world.gameTime).toBe(4200);
	});

	test("the bodies are where the restored clock puts them, not where zero does", () => {
		// The check that the clock is *used* rather than merely stored. A
		// restore that built the system at zero and then set `gameTime` would
		// pass every field above and put every planet in the wrong place.
		const at = restoreWorld(SEED, 0, 17, 900_000);
		const zero = restoreWorld(SEED, 0, 17, 0);
		const moved = at.system.bodies.filter((body, i) => {
			const was = zero.system.bodies[i];
			return (
				body.pos.x !== was.pos.x ||
				body.pos.y !== was.pos.y ||
				body.pos.z !== was.pos.z
			);
		});
		expect(moved.length).toBeGreaterThan(0);
	});

	test("it refuses a galaxy or system index the galaxy does not have", () => {
		expect(() => restoreWorld(SEED, 8, 0, 0)).toThrow(/galaxy/);
		expect(() => restoreWorld(SEED, -1, 0, 0)).toThrow(/galaxy/);
		expect(() => restoreWorld(SEED, 0, 999, 0)).toThrow(/system/);
		expect(() => restoreWorld(SEED, 0, 0, Number.NaN)).toThrow(/clock/);
	});
});

/**
 * `makeWorldAtSystem` is `?system=`'s half of world construction (#432): a new
 * game — galaxy 0, clock 0, the ship on the arrival point — at a system the
 * caller named instead of at `startSystem`.
 *
 * It is a second name for the same construction rather than a second path
 * beside it, which is what the row above holds for `makeWorld`. What is
 * checkable here is which record the argument reached: every row below asks for
 * a system that is *not* the start system, so a build that took the parameter
 * and threw it away is red rather than green-and-quiet.
 */
describe("makeWorldAtSystem: a new game at a named system", () => {
	const galaxy = generateGalaxy(SEED, START_GALAXY);
	const start = startSystem(galaxy);
	// Chosen by index arithmetic rather than by literal, so a generator change
	// that moves the start system cannot quietly make this the start system and
	// turn every row here into a tautology.
	const asked = (start.index + 7) % galaxy.systems.length;
	const world = makeWorldAtSystem(SEED, asked);

	test("the named system is the one the world is in, not the start system", () => {
		expect(asked).not.toBe(start.index);
		expect(world.system.record.index).toBe(asked);
		expect(world.galaxy.index).toBe(START_GALAXY);
		expect(world.gameTime).toBe(0);
	});

	test("the ship is at the named system's arrival point", () => {
		// The discriminator is *which record* the arrival was computed from: a
		// build that swapped the system in and left the start system's arrival
		// point in place passes every index check above and puts the ship on the
		// wrong star. `arrivalPoint` is the shipped one, so this row holds the
		// pairing and not the arithmetic — `tests/arrival.test.ts` holds that.
		const record = galaxy.systems[asked];
		expect(world.system.record.index).toBe(asked);
		expect(world.ship.pos).toEqual(
			arrivalPoint(record, world.system.contents, null, 0),
		);
	});

	test("an index the galaxy does not have is refused, not clamped", () => {
		expect(() => makeWorldAtSystem(SEED, galaxy.systems.length)).toThrow(
			/system/,
		);
		expect(() => makeWorldAtSystem(SEED, -1)).toThrow(/system/);
	});

	/**
	 * A consequence of the pin, recorded rather than assumed. `resetWorldToStart`
	 * returns a world to *the start system*, so a pinned world is one it declines
	 * to reset — which is the right answer, and worth a row because the predicate
	 * reads as a property of the world rather than of how it was made. Why
	 * `?system=` writes nothing is a different argument, and `commander-flow.ts`
	 * carries it.
	 */
	test("a pinned world is not the start system, and says so", () => {
		expect(canResetWorldToStart(world)).toBe(false);
		expect(canResetWorldToStart(makeWorld(SEED))).toBe(true);
	});
});
