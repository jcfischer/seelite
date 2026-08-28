/**
 * The state machine `docs/specs/docking.md` §12 creates — §12.6's headless
 * obligations 3, 4, 5, 8 and 9.
 *
 * These are driven against a **real world**: `makeWorld` plus the shipped
 * `stepDockedWorld`, rather than a hand-built stand-in. `#25` records why that
 * matters — a test that constructs its own struct is testing a different object
 * from the one the game uses, and it was the tell that a whole rule had never
 * shipped.
 */

import { describe, expect, test } from "bun:test";
import { dockedAxialKm, ARRIVAL_SECONDS } from "../src/arrival";
import { apertureFrame, slotBasis } from "../src/docking";
import {
	type DockPhase,
	canSkipTraversal,
	collisionExempt,
	enterArrival,
	flightLive,
	newDockSession,
	requestLaunch,
	skipTraversal,
	stepDockedWorld,
} from "../src/dock-session";
import {
	type World,
	bodyVelocity,
	makeWorld,
	stationOf,
	stationPose,
} from "../src/sim";
import { STATION_GEOMETRY } from "../src/station";
import { add, dot, length, scale, sub } from "../src/vec3";

/** A world whose start system has a spinning slot station — so the rotating
 *  frame is exercised rather than sidestepped by a pad. */
function spinningWorld(): { world: World; id: string } {
	for (let seed = 1; seed < 400; seed++) {
		const world = makeWorld(seed);
		const station = world.system.contents.stations.find(
			(s) => STATION_GEOMETRY[s.type].aperture.kind === "slot" && s.spinRpm > 0,
		);
		if (station && world.system.byId.has(station.id))
			return { world, id: station.id };
	}
	throw new Error("no start system with a spinning slot station in 400 seeds");
}

/** The aperture frame as the game builds it, at the world's current clock. */
function frameNow(world: World, id: string) {
	const station = stationOf(world.system, id);
	const pose = stationPose(world.system, id, world.gameTime);
	return apertureFrame(station.type, pose.axis, pose.phaseRad);
}

/** A crossing pose on the plane, offset within the aperture as check 5 allows. */
function entryOn(world: World, id: string) {
	const frame = frameNow(world, id);
	const { across, up } = slotBasis(frame);
	const a = frame.aperture;
	const rel = add(
		scale(frame.axis, frame.planeKm),
		add(scale(across, a.widthKm * 0.3), scale(up, a.heightKm * 0.3)),
	);
	return {
		frame,
		rel,
		attitude: { nose: scale(frame.axis, -1), up },
	};
}

/** Drive the session for `seconds` at a 1/60 s step, the way the frame loop
 *  does, and hand back the last ship placement. */
function run(
	world: World,
	session: ReturnType<typeof newDockSession>,
	seconds: number,
) {
	const dt = 1 / 60;
	let s = session;
	let ship = null as ReturnType<typeof stepDockedWorld>["ship"];
	for (let i = 0; i < Math.round(seconds / dt); i++) {
		const out = stepDockedWorld(world, s, dt);
		s = out.session;
		// The **last placement made**, not the last frame's. A launch hands the
		// ship back on the frame it releases and returns nothing after that,
		// because from then on the ship owns its own position — so a loop that
		// took the final frame's value would report no placement at all.
		if (out.ship) ship = out.ship;
	}
	return { session: s, ship };
}

describe("§12.3 obligation 8 — the three exempt states are distinguishable", () => {
	test("every state §12 creates is exempt, and flying is not", () => {
		// The tempting form — "assert the ship is not collidable" — is vacuous,
		// because nothing collides with anything today (§12.3). What is checkable
		// now is the thing #75 will read: that the three are exposed as such.
		const phases: DockPhase[] = ["flying", "arriving", "docked", "launching"];
		expect(phases.filter(collisionExempt)).toEqual([
			"arriving",
			"docked",
			"launching",
		]);
	});

	test("launching is exempt, which is the row an earlier draft omitted", () => {
		// §12.3 records that a table introduced as "stated so neither system has
		// to guess" once left the launching ship collidable, traversing the same
		// throat on the same rails with the exemption switched off.
		expect(collisionExempt("launching")).toBe(true);
	});
});

describe("§12.6 obligation 3 — flight is inert unless the ship is flying", () => {
	test("E5's predicate covers the traversals as well as the parked ship", () => {
		expect(flightLive("flying")).toBe(true);
		for (const phase of ["arriving", "docked", "launching"] as const)
			expect(flightLive(phase)).toBe(false);
	});

	test("a launch ends outside the plane, where §3's checks can run again", () => {
		const { world, id } = spinningWorld();
		const e = entryOn(world, id);
		let session = enterArrival(id, e.frame, e.rel, e.attitude, world.gameTime);
		session = run(world, session, ARRIVAL_SECONDS + 0.5).session;
		expect(session.phase).toBe("docked");

		session = requestLaunch(session, frameNow(world, id), world.gameTime);
		const out = run(world, session, ARRIVAL_SECONDS + 0.5);
		expect(out.session.phase).toBe("flying");
		// The ship is where §3 can see it: outside the plane, on the outward
		// side, so the very next inward crossing is a fresh entry.
		const body = world.system.byId.get(id);
		if (!body) throw new Error("station vanished");
		if (!out.ship) throw new Error("the launch made no placement");
		const rel = sub(out.ship.pos, body.pos);
		expect(dot(rel, frameNow(world, id).axis)).toBeGreaterThan(
			frameNow(world, id).planeKm,
		);
	});
});

describe("§12.6 obligation 5 — every launch is skippable", () => {
	test("a launch can be skipped, unconditionally", () => {
		const { world, id } = spinningWorld();
		const e = entryOn(world, id);
		let session = enterArrival(id, e.frame, e.rel, e.attitude, world.gameTime);
		session = run(world, session, ARRIVAL_SECONDS + 0.5).session;
		session = requestLaunch(session, frameNow(world, id), world.gameTime);
		// Asserted unconditionally rather than as "skippable whenever its type's
		// flag is set" — §12.2 argues that is always true, so the conditional
		// form has no reachable false branch and a regression that made a first
		// launch play would pass it.
		expect(canSkipTraversal(session)).toBe(true);
		const skipped = skipTraversal(session, world.gameTime);
		const out = stepDockedWorld(world, skipped, 1 / 60);
		expect(out.session.phase).toBe("flying");
	});

	test("the arrival is not skippable, because E4 has no store yet", () => {
		// **Not a decision reversed — a dependency unmet.** §12.7's joint 6:
		// E4's four booleans are a typed domain `persistent-world-state.md` must
		// approve and bound, and §6 of that spec explicitly does not bound this
		// class. So the arrival ships unskippable and E4 is a follow-up; this row
		// fails the day someone wires a skip without the store.
		const { world, id } = spinningWorld();
		const e = entryOn(world, id);
		const session = enterArrival(
			id,
			e.frame,
			e.rel,
			e.attitude,
			world.gameTime,
		);
		expect(canSkipTraversal(session)).toBe(false);
		expect(skipTraversal(session, world.gameTime)).toBe(session);
	});
});

describe("§12.6 obligation 4 — the world keeps running while docked", () => {
	test("the clock advances by exactly the elapsed time, uncompressed", () => {
		const { world, id } = spinningWorld();
		const e = entryOn(world, id);
		const t0 = world.gameTime;
		let session = enterArrival(id, e.frame, e.rel, e.attitude, world.gameTime);
		session = run(world, session, ARRIVAL_SECONDS + 0.5).session;
		const tDocked = world.gameTime;
		const dockedFor = 600;
		run(world, session, dockedFor);
		// **No compression** (#10): sim seconds pass one for one, through the
		// arrival and through ten minutes of sitting still.
		expect(world.gameTime - tDocked).toBeCloseTo(dockedFor, 6);
		expect(world.gameTime - t0).toBeCloseTo(
			dockedFor + ARRIVAL_SECONDS + 0.5,
			6,
		);
	});

	test("the bodies move along their orbits across a docked interval", () => {
		// Without this row a docked state that froze the tick would satisfy every
		// other obligation here: the clock could advance while `advanceSystem`
		// never ran, and the system would stand still around the player.
		const { world, id } = spinningWorld();
		const e = entryOn(world, id);
		let session = enterArrival(id, e.frame, e.rel, e.attitude, world.gameTime);
		session = run(world, session, ARRIVAL_SECONDS + 0.5).session;
		const before = new Map(
			[...world.system.byId].map(([k, b]) => [k, { ...b.pos }]),
		);
		run(world, session, 600);
		let moved = 0;
		for (const [k, p] of before) {
			const now = world.system.byId.get(k);
			if (now && length(sub(now.pos, p)) > 0) moved++;
		}
		// Every body but the star, which is at the origin by construction.
		expect(moved).toBe(before.size - 1);
	});
});

describe("§12.6 obligation 9 — a parked ship holds station", () => {
	test("after ten minutes it is still at the docked position, in the station's frame", () => {
		const { world, id } = spinningWorld();
		const e = entryOn(world, id);
		let session = enterArrival(id, e.frame, e.rel, e.attitude, world.gameTime);
		const arrived = run(world, session, ARRIVAL_SECONDS + 0.5);
		session = arrived.session;
		const station = stationOf(world.system, id);
		const want = dockedAxialKm(STATION_GEOMETRY[station.type]);

		const out = run(world, session, 600);
		const body = world.system.byId.get(id);
		if (!body || !out.ship) throw new Error("station or ship missing");
		const frame = frameNow(world, id);
		const rel = sub(out.ship.pos, body.pos);
		const { across, up } = slotBasis(frame);
		// **In the station's own rotating frame**, not merely somewhere near
		// where it started: the station has translated thousands of kilometres
		// along its orbit and turned tens of times in that interval.
		// **An absolute tolerance in kilometres, not a digit count.** The ship's
		// position is a station-relative offset taken from a body an AU from the
		// origin, so float64's own spacing there is tens of micrometres — a
		// relative-precision assertion would be measuring the arithmetic's
		// distance from the star, not the ship's from the docked position. One
		// millimetre is four orders under the smallest thing §12 talks about.
		const TOLERANCE_KM = 1e-6;
		expect(Math.abs(dot(rel, frame.axis) - want)).toBeLessThan(TOLERANCE_KM);
		expect(Math.abs(dot(rel, across))).toBeLessThan(TOLERANCE_KM);
		expect(Math.abs(dot(rel, up))).toBeLessThan(TOLERANCE_KM);
		// And the station really did move, so the row above is not passing on a
		// stationary world.
		expect(
			length(sub(out.ship.pos, arrived.ship?.pos ?? body.pos)),
		).toBeGreaterThan(100);
		// Its velocity is the station's, exactly — a docked ship is carried.
		const stationVel = bodyVelocity(world.system, id, world.gameTime);
		for (const k of ["x", "y", "z"] as const)
			expect(out.ship.vel[k]).toBe(stationVel[k]);
	});
});
