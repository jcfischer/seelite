/**
 * `jumpWorldTo`: the act §8 describes, and §7.4's arrival point used in anger
 * for the first time (#187).
 *
 * ## What this can and cannot compare against
 *
 * `tests/world-reset.test.ts` states the rule this follows: both the code and a
 * test that re-called `arrivalPoint` would be the same function, so comparing
 * them proves nothing about it. What is checkable without restating it is the
 * **property §7.4 is written to deliver** — the exit lies on the inbound
 * bearing, which is `normalize(p_origin − p_this)` in galaxy coordinates. The
 * push-out only ever moves the point *along* that bearing, so the direction is
 * exact at every clock value and for every system, whether or not a body was in
 * the way. That is a comparison against the spec rather than against the code,
 * and the implementation this replaces — the only caller passing
 * `originPos: null` — fails it.
 *
 * The second half is the same claim from the player's side: two different
 * origins into one destination put the ship in two different places. A build
 * that kept passing `null` would put it in the same place both times and pass
 * every other assertion in this file.
 */
import { describe, expect, test } from "bun:test";
import {
	type SystemRecord,
	generateGalaxy,
	neighbours,
	startSystem,
} from "../src/galaxy";
import { carrierKey } from "../src/carrier-key";
import { readDeficit, recordTrade } from "../src/deficits";
import {
	ARRIVAL_CLEARANCE_AU,
	ARRIVAL_DISTANCE_AU,
	generateContents,
	placeBodies,
} from "../src/system";
import {
	advanceWorldClock,
	jumpWorldTo,
	makeSystem,
	makeWorld,
	resetWorldToStart,
} from "../src/sim";
import { AU_KM } from "../src/units";
import { length, sub } from "../src/vec3";

const SEED = 20260902;

/** The galaxy the world below is generated from — the same call `makeWorld`
 *  makes, so the records are the world's own. */
const GALAXY = generateGalaxy(SEED, 0);
const HOME = startSystem(GALAXY);

/** Unit vector, in whatever space it is handed. */
const unit = (v: { x: number; y: number; z: number }) => {
	const len = Math.hypot(v.x, v.y, v.z);
	return { x: v.x / len, y: v.y / len, z: v.z / len };
};

/** §7.4's bearing, written out of the spec rather than imported from the code
 *  that implements it. */
const inboundBearing = (origin: SystemRecord, destination: SystemRecord) =>
	unit(sub(origin.pos, destination.pos));

const neighbourOf = (system: SystemRecord, nth = 0) => {
	const list = neighbours(GALAXY.systems, system);
	if (list.length <= nth)
		throw new Error(`${system.name} has no neighbour ${nth}`);
	return list[nth];
};

describe("jumpWorldTo", () => {
	test("the world is in the new system, with the new system's bodies", () => {
		const world = makeWorld(SEED);
		const to = neighbourOf(HOME);
		expect(world.system.record.index).toBe(HOME.index);

		jumpWorldTo(world, to);

		expect(world.system.record).toBe(to);
		expect(world.system.record.name).toBe(to.name);
		// The whole system object, not an edited one: `byId` is rebuilt, so a
		// destination with a different body count is not an `advanceSystem` throw
		// three frames later.
		expect(world.system.byId.size).toBe(world.system.bodies.length);
		for (const body of world.system.bodies)
			expect(world.system.byId.get(body.id)).toBe(body);
	});

	test("the bodies are placed at the clock the ship arrives on, not at zero", () => {
		const world = makeWorld(SEED);
		advanceWorldClock(world, 4000);
		const to = neighbourOf(HOME);
		jumpWorldTo(world, to);

		expect(world.gameTime).toBe(4000);
		// Against `makeSystem` at the same clock rather than against the jump's
		// own arithmetic: what this catches is a jump that generated the system
		// and then forgot to place it, or placed it at zero.
		const atArrival = makeSystem(to, 4000);
		const atZero = makeSystem(to, 0);
		let differsFromZero = false;
		for (const body of world.system.bodies) {
			const arrived = atArrival.byId.get(body.id);
			const zero = atZero.byId.get(body.id);
			if (!arrived || !zero) throw new Error(`no body ${body.id}`);
			expect(body.pos).toEqual(arrived.pos);
			if (length(sub(zero.pos, arrived.pos)) > 1) differsFromZero = true;
		}
		// The premise: 4,000 s of orbit moves something in this system, so the
		// comparison above is discriminating rather than trivially true.
		expect(differsFromZero).toBe(true);
	});

	test("the clock is not advanced by the transition (#10)", () => {
		const world = makeWorld(SEED);
		advanceWorldClock(world, 1234.5);
		jumpWorldTo(world, neighbourOf(HOME));
		expect(world.gameTime).toBe(1234.5);
	});

	test("the exit is on §7.4's inbound bearing, at rest", () => {
		const world = makeWorld(SEED);
		const to = neighbourOf(HOME);
		jumpWorldTo(world, to);

		const bearing = inboundBearing(HOME, to);
		const exit = unit(world.ship.pos);
		// Exact to a dozen digits: the push-out slides along the bearing and
		// cannot rotate it, so this holds whether or not a body was in the way.
		expect(exit.x).toBeCloseTo(bearing.x, 12);
		expect(exit.y).toBeCloseTo(bearing.y, 12);
		expect(exit.z).toBeCloseTo(bearing.z, 12);
		expect(world.ship.vel).toEqual({ x: 0, y: 0, z: 0 });
	});

	test("the same destination from two origins is two different arrivals", () => {
		// §7.4's whole reason: "the system genuinely looks different depending on
		// your route". A build still passing `originPos: null` puts the ship in
		// the same place from both and passes every other row in this file.
		const to = neighbourOf(HOME);
		const otherOrigins = neighbours(GALAXY.systems, to).filter(
			(s) => s.index !== HOME.index,
		);
		expect(otherOrigins.length).toBeGreaterThan(0);
		const other = otherOrigins[0];

		const viaHome = makeWorld(SEED);
		jumpWorldTo(viaHome, to);

		const viaOther = makeWorld(SEED);
		jumpWorldTo(viaOther, other);
		const fromOther = { ...viaOther.ship.pos };
		jumpWorldTo(viaOther, to);

		// Both arrived at `to`, from different places, so the exits differ — and
		// by an astronomical margin rather than by rounding.
		expect(viaOther.system.record.index).toBe(to.index);
		expect(length(sub(viaHome.ship.pos, viaOther.ship.pos))).toBeGreaterThan(
			0.1 * AU_KM,
		);
		// And the second jump left the first arrival behind, which is the "a
		// naive implementation is written for the first jump only" case.
		expect(length(sub(fromOther, viaOther.ship.pos))).toBeGreaterThan(0);
	});

	test("the exit is at least 1 AU out and clear of every body", () => {
		// Swept over every neighbour of the start system, because a clearance rule
		// checked on one arrival is a rule checked on one arrival.
		const world = makeWorld(SEED);
		advanceWorldClock(world, 777);
		let checked = 0;
		for (const to of neighbours(GALAXY.systems, HOME)) {
			const flown = makeWorld(SEED);
			advanceWorldClock(flown, 777);
			jumpWorldTo(flown, to);
			expect(length(flown.ship.pos)).toBeGreaterThanOrEqual(
				ARRIVAL_DISTANCE_AU * AU_KM - 1e-6,
			);
			for (const body of placeBodies(flown.system.contents, 777)) {
				expect(length(sub(body.pos, flown.ship.pos))).toBeGreaterThanOrEqual(
					ARRIVAL_CLEARANCE_AU * AU_KM - 1e-6,
				);
			}
			checked++;
		}
		expect(checked).toBeGreaterThan(0);
	});

	test("a foreign galaxy throws — that is the Galactic Hyperdrive", () => {
		const world = makeWorld(SEED);
		const elsewhere = startSystem(generateGalaxy(SEED, 3));
		expect(() => jumpWorldTo(world, elsewhere)).toThrow(/galaxy 3/);
		// And the world is untouched by the refusal.
		expect(world.system.record.index).toBe(HOME.index);
	});
});

describe("resetWorldToStart after a jump", () => {
	test("it refuses rather than resetting to the wrong star", () => {
		const world = makeWorld(SEED);
		jumpWorldTo(world, neighbourOf(HOME));
		expect(() => resetWorldToStart(world)).toThrow(/start system/);
	});

	test("it still resets a world that never left", () => {
		const world = makeWorld(SEED);
		advanceWorldClock(world, 500);
		resetWorldToStart(world);
		expect(world.gameTime).toBe(0);
		expect(world.ship.pos).toEqual(makeWorld(SEED).ship.pos);
	});
});

/**
 * Per-galaxy state across a jump (#187).
 *
 * The map's constraint is that a jump moves `systemIndex`, which is a save key
 * — `world-state.ts` files every fact under `(galaxyIndex, systemIndex,
 * localCarrierId)`. What that has to buy is a market memory that follows the
 * *station* rather than the role: two systems both have a trade post, both call
 * it `LOCAL_CARRIER_ID.trade`, and a key missing the system index would have
 * them share a deficit — so selling a hold at one would move the price at the
 * other, light years away.
 */
describe("a jump moves a save key", () => {
	test("two systems' trade posts are different carriers", () => {
		const world = makeWorld(SEED);
		const home = world.system.record;
		const to = neighbourOf(home);
		const stationOfSystem = (record: SystemRecord) => {
			const station = generateContents(record).stations.find(
				(s) => s.type === "trade",
			);
			if (!station) throw new Error(`${record.name} has no trade post`);
			return station;
		};
		const here = stationOfSystem(home);
		const there = stationOfSystem(to);
		// The premise: both really are the same local carrier, so the system
		// index is the whole of what keeps them apart.
		expect(there.localCarrierId).toBe(here.localCarrierId);
		expect(carrierKey(home.index, here.localCarrierId)).not.toBe(
			carrierKey(to.index, there.localCarrierId),
		);
	});

	test("a deficit recorded before a jump is still there on the way back", () => {
		const world = makeWorld(SEED);
		const home = world.system.record;
		const to = neighbourOf(home);
		const key = carrierKey(home.index, "station-trade");
		const away = carrierKey(to.index, "station-trade");
		const deficits = recordTrade({}, key, {
			goodName: "Food",
			units: 12,
			gameTimeMin: 0,
			holdT: 20,
		});

		jumpWorldTo(world, to);
		// Nothing in the destination is holding the origin's memory…
		expect(readDeficit(deficits, away, "Food", 0)).toBe(0);
		jumpWorldTo(world, home);
		expect(world.system.record.index).toBe(home.index);
		// …and it is still filed under the origin when the ship comes back. The
		// clock is what decays it (20-minute half-life, #7), and a jump does not
		// move the clock — see `jumpWorldTo`.
		expect(readDeficit(deficits, key, "Food", 0)).toBe(12);
	});
});
