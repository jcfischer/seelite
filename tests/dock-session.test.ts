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
import { berthCentre } from "../src/arrival";
import {
	TRAVERSAL_SECONDS_DEEP,
	apertureFrame,
	slotBasis,
} from "../src/docking";
import {
	type DockPhase,
	berthOf,
	canSkipTraversal,
	interiorOfStation,
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
	advanceSystem,
	bodyVelocity,
	makeWorld,
	stationOf,
	stationPose,
} from "../src/sim";
import { STATION_GEOMETRY } from "../src/station";
import type { Berth } from "../src/station-interior";
import { velocityOnOrbit } from "../src/system";
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

/**
 * The berth this session is driven into, and the catalogue it came from.
 *
 * **Through the game's own `interiorOfStation`**, not a second
 * `stationInterior` call: the seed is the station's, and a test that built its
 * own catalogue would be asserting against a different outpost from the one the
 * game parks in.
 */
function berthFor(world: World, id: string, berthId: string) {
	const interior = interiorOfStation(stationOf(world.system, id));
	return { interior, berth: berthOf(interior, berthId) };
}

/**
 * The berth every row below drives into.
 *
 * **A deep wall berth, not a near deck one**: it is the address with lateral
 * offset in both components and the longest route, so a law that ignored a leg
 * or froze the rotating basis fails here rather than passing on a berth that
 * happens to sit on the axis.
 */
const BERTH_ID = "starboard-deep";

/** Long enough for any traversal in the game to have finished. */
const TRAVERSAL_MAX = TRAVERSAL_SECONDS_DEEP + 0.5;

/** The aperture frame as the game builds it, at the world's current clock. */
function frameNow(world: World, id: string) {
	const station = stationOf(world.system, id);
	const pose = stationPose(world.system, id, world.gameTime);
	return apertureFrame(station.type, pose.axis, pose.phaseRad, pose.reference);
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

describe("#126 — the slot's phase-zero reference is continuous", () => {
	/**
	 * **The property the withdrawn fix did not have.** Aiming the drawn station
	 * on `slotBasis` is only safe if the reference that basis is built from
	 * turns *smoothly* as the axis swings round the orbit. `anyPerpendicular`
	 * does not: it picks its seed on a `< 0.9` branch and **jumps**, which made
	 * the drawn hull snap and took `probe-station.mjs`'s repeat control from
	 * 0.02 to 0.21.
	 *
	 * So this is not "the reference is perpendicular to the axis" — that was
	 * true of the old one too, and `stationPose` orthogonalises unconditionally,
	 * so asserting it would hold for any input whatever. It is a bound on how
	 * far the reference can move between two neighbouring clock values, over a
	 * whole orbit, which is the thing that was false.
	 *
	 * **Every station in the system, not one.** The two axis kinds are different
	 * geometry: a `parent`-axis station's axis *is* its own orbital radius, so
	 * its velocity is perpendicular to it exactly, while an `outward`-axis
	 * station's axis points away from the star. Running this on a slot station
	 * alone would leave the refinery's case unproven, which is where the
	 * fallback guard would fire if it ever fired.
	 */
	test("it turns by less than a degree a second, all the way round an orbit", () => {
		const { world } = spinningWorld();
		const worstByStation: string[] = [];
		for (const station of world.system.contents.stations) {
			const periodS = station.orbit.periodS;
			const step = periodS / 720;
			let worst = 0;
			let previous = stationPose(world.system, station.id, 0).reference;
			for (let i = 1; i <= 720; i++) {
				const t = i * step;
				// The bodies have to be where the clock says before the pose is
				// read: the axis is `parent.pos − body.pos`.
				advanceSystem(world.system, t);
				const now = stationPose(world.system, station.id, t).reference;
				const turned =
					(Math.acos(Math.min(1, Math.max(-1, dot(previous, now)))) * 180) /
					Math.PI;
				worst = Math.max(worst, turned / step);
				previous = now;
			}
			worstByStation.push(`${station.id} ${worst.toFixed(4)}°/s`);
			// A station's own orbit is 90–240 minutes, so a reference that tracked
			// it exactly turns at 0.025–0.067°/s — this one measures 0.066 on the
			// trade station. The withdrawn `anyPerpendicular` reference measures
			// **23.68** on the same row: a jump shows up as orders of magnitude,
			// not as a percentage, which is why the bound is a whole degree.
			expect([station.id, worst < 1]).toEqual([station.id, true]);
		}
		console.log(worstByStation.join("\n"));
	});

	test("it is the along-track direction, not merely something perpendicular", () => {
		// **`stationPose` orthogonalises unconditionally**, so a row asserting
		// perpendicularity passes for any input direction and says nothing about
		// the geometry the docs lean on. What distinguishes the along-track
		// reference is that it lies in the plane of the orbit — so it is
		// perpendicular to the orbit's *normal*, which the velocity and the
		// radius together define.
		const { world } = spinningWorld();
		for (const station of world.system.contents.stations) {
			advanceSystem(world.system, 137.5);
			const pose = stationPose(world.system, station.id, 137.5);
			const v = velocityOnOrbit(station.orbit, 137.5);
			const speed = Math.hypot(v.x, v.y, v.z);
			// Unit velocity, and the reference along it: for a circular orbit the
			// axis is the radius and the velocity is already perpendicular to it,
			// so the projection is a no-op and the two coincide.
			const along = scale(v, 1 / speed);
			expect([station.id, Math.abs(dot(pose.reference, along)) > 0.99]).toEqual(
				[station.id, true],
			);
			expect([
				station.id,
				Math.abs(dot(pose.reference, pose.axis)) < 1e-9,
			]).toEqual([station.id, true]);
		}
	});
});

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
		const { interior, berth } = berthFor(world, id, BERTH_ID);
		let session = enterArrival(
			id,
			e.frame,
			interior,
			berth,
			e.rel,
			e.attitude,
			world.gameTime,
		);
		session = run(world, session, TRAVERSAL_MAX).session;
		expect(session.phase).toBe("docked");

		session = requestLaunch(
			session,
			frameNow(world, id),
			interior,
			world.gameTime,
		);
		const out = run(world, session, TRAVERSAL_MAX);
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

describe("§13.3 — the arrival turns the ship round, and the launch does not", () => {
	test("the nose sweeps from inward to outward over the arrival", () => {
		// **The 180° turn moved.** It used to be the launch's, because a parked
		// ship faced the back wall; §13.3 parks it facing out, so the arrival is
		// what turns it and the launch is what no longer has to. The defect this
		// guards is the same one either way: with nothing to blend from, an
		// antipodal pair snaps on the first frame, and every other row passed
		// when it did.
		const { world, id } = spinningWorld();
		const e = entryOn(world, id);
		const { interior, berth } = berthFor(world, id, BERTH_ID);
		let s = enterArrival(
			id,
			e.frame,
			interior,
			berth,
			e.rel,
			e.attitude,
			world.gameTime,
		);

		const along: number[] = [];
		// **Against the law's own frame**, which is the one it settles onto: the
		// station's aperture axis swings with its orbit, so the frame this frame
		// and the frame the law was built in differ by more than the
		// monotonicity tolerance below over a nine-second traversal.
		const axis = e.frame.axis;
		// The **whole** traversal, and only the traversal: sampled to the
		// half-way point the nose is exactly perpendicular to the axis, which
		// reads as "not out yet" and says nothing about whether it ever gets
		// there. The docked frames that follow are placed against the *current*
		// frame and belong to obligation 9's row, not this one.
		for (let i = 0; i < Math.round(TRAVERSAL_MAX * 60) + 2; i++) {
			if (s.phase !== "arriving") break;
			const out = stepDockedWorld(world, s, 1 / 60);
			s = out.session;
			if (out.ship) along.push(dot(out.ship.nose, axis));
		}
		expect(s.phase).toBe("docked");
		expect(along[0]).toBeLessThan(-0.9);
		expect(along[along.length - 1]).toBeGreaterThan(0.9);
		// Every step moves in that direction, which is what a blend does and
		// what a snap does not.
		for (let i = 1; i < along.length; i++)
			expect(along[i]).toBeGreaterThanOrEqual(along[i - 1] - 1e-9);
	});

	test("the launch keeps the nose out and settles the roll instead", () => {
		const { world, id } = spinningWorld();
		const e = entryOn(world, id);
		const { interior, berth } = berthFor(world, id, BERTH_ID);
		let session = enterArrival(
			id,
			e.frame,
			interior,
			berth,
			e.rel,
			e.attitude,
			world.gameTime,
		);
		session = run(world, session, TRAVERSAL_MAX).session;
		session = requestLaunch(
			session,
			frameNow(world, id),
			interior,
			world.gameTime,
		);

		let s = session;
		let worst = 1;
		for (let i = 0; i < Math.round(TRAVERSAL_MAX * 60) + 2; i++) {
			const out = stepDockedWorld(world, s, 1 / 60);
			s = out.session;
			if (out.ship)
				worst = Math.min(worst, dot(out.ship.nose, frameNow(world, id).axis));
		}
		// It never turns away from the exit at any point of the route.
		expect(worst).toBeGreaterThan(0.9);
	});
});

describe("§12.6 obligation 5 — every launch is skippable", () => {
	test("a launch can be skipped, unconditionally", () => {
		const { world, id } = spinningWorld();
		const e = entryOn(world, id);
		const { interior, berth } = berthFor(world, id, BERTH_ID);
		let session = enterArrival(
			id,
			e.frame,
			interior,
			berth,
			e.rel,
			e.attitude,
			world.gameTime,
		);
		session = run(world, session, TRAVERSAL_MAX).session;
		session = requestLaunch(
			session,
			frameNow(world, id),
			interior,
			world.gameTime,
		);
		// Asserted unconditionally rather than as "skippable whenever its type's
		// flag is set" — §12.2 argues that is always true, so the conditional
		// form has no reachable false branch and a regression that made a first
		// launch play would pass it.
		expect(canSkipTraversal(session)).toBe(true);
		const skipped = skipTraversal(session, world.gameTime);
		const out = stepDockedWorld(world, skipped, 1 / 60);
		expect(out.session.phase).toBe("flying");
	});

	test("an arrival can be skipped too, and it lands at the reserved berth", () => {
		// **§13.3 retired E4 rather than implementing it.** The old row here
		// asserted the arrival was *not* skippable, because the per-type novelty
		// flags had no bounded store; the gate is gone, so there is nothing left
		// to store and the skip is unconditional on both sides.
		const { world, id } = spinningWorld();
		const e = entryOn(world, id);
		const { interior, berth } = berthFor(world, id, BERTH_ID);
		const session = enterArrival(
			id,
			e.frame,
			interior,
			berth,
			e.rel,
			e.attitude,
			world.gameTime,
		);
		expect(canSkipTraversal(session)).toBe(true);
		const skipped = skipTraversal(session, world.gameTime);
		const out = stepDockedWorld(world, skipped, 1 / 60);
		expect(out.session.phase).toBe("docked");
		expect(out.session.berthId).toBe(berth.id);
		// **At the berth**, not merely in the docked state: a skip that flipped
		// the phase without re-basing the law would place the ship from nowhere.
		const body = world.system.byId.get(id);
		if (!body || !out.ship) throw new Error("station or ship missing");
		const frame = frameNow(world, id);
		const rel = sub(out.ship.pos, body.pos);
		const basis = slotBasis(frame);
		const want = berthCentre(berth);
		// A centimetre. The ship's position is a difference of two AU-scale
		// vectors, so float64's own spacing there is tens of micrometres and the
		// figure below is the arithmetic's floor rather than the law's error —
		// four orders under the smallest thing §13 talks about either way.
		const TOLERANCE_KM = 1e-5;
		expect(Math.abs(dot(rel, frame.axis) - want.axial)).toBeLessThan(
			TOLERANCE_KM,
		);
		expect(Math.abs(dot(rel, basis.across) - want.across)).toBeLessThan(
			TOLERANCE_KM,
		);
		expect(Math.abs(dot(rel, basis.up) - want.up)).toBeLessThan(TOLERANCE_KM);
	});
});

describe("§12.6 obligation 4 — the world keeps running while docked", () => {
	test("the clock advances by exactly the elapsed time, uncompressed", () => {
		const { world, id } = spinningWorld();
		const e = entryOn(world, id);
		const t0 = world.gameTime;
		const { interior, berth } = berthFor(world, id, BERTH_ID);
		let session = enterArrival(
			id,
			e.frame,
			interior,
			berth,
			e.rel,
			e.attitude,
			world.gameTime,
		);
		session = run(world, session, TRAVERSAL_MAX).session;
		const tDocked = world.gameTime;
		const dockedFor = 600;
		run(world, session, dockedFor);
		// **No compression** (#10): sim seconds pass one for one, through the
		// arrival and through ten minutes of sitting still.
		expect(world.gameTime - tDocked).toBeCloseTo(dockedFor, 6);
		expect(world.gameTime - t0).toBeCloseTo(dockedFor + TRAVERSAL_MAX, 6);
	});

	test("the bodies move along their orbits across a docked interval", () => {
		// Without this row a docked state that froze the tick would satisfy every
		// other obligation here: the clock could advance while `advanceSystem`
		// never ran, and the system would stand still around the player.
		const { world, id } = spinningWorld();
		const e = entryOn(world, id);
		const { interior, berth } = berthFor(world, id, BERTH_ID);
		let session = enterArrival(
			id,
			e.frame,
			interior,
			berth,
			e.rel,
			e.attitude,
			world.gameTime,
		);
		session = run(world, session, TRAVERSAL_MAX).session;
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
		const { interior, berth } = berthFor(world, id, BERTH_ID);
		let session = enterArrival(
			id,
			e.frame,
			interior,
			berth,
			e.rel,
			e.attitude,
			world.gameTime,
		);
		const arrived = run(world, session, TRAVERSAL_MAX);
		session = arrived.session;
		const want = berthCentre(berth);

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
		expect(Math.abs(dot(rel, frame.axis) - want.axial)).toBeLessThan(
			TOLERANCE_KM,
		);
		expect(Math.abs(dot(rel, across) - want.across)).toBeLessThan(TOLERANCE_KM);
		expect(Math.abs(dot(rel, up) - want.up)).toBeLessThan(TOLERANCE_KM);
		// The berth this station handed out is genuinely off the axis, so the row
		// above is not passing on a law that parks everything on the centreline.
		expect(Math.hypot(want.across, want.up)).toBeGreaterThan(0);
		// And the station really did move, so the row above is not passing on a
		// stationary world.
		expect(
			length(sub(out.ship.pos, arrived.ship?.pos ?? body.pos)),
		).toBeGreaterThan(100);
		// **Carried, and spun.** A berth is off the axis, so a parked ship's
		// station-frame velocity is the station's plus the rotation term — the
		// old docked position sat on the axis and had none.
		const stationVel = bodyVelocity(world.system, id, world.gameTime);
		const spinRadPerS =
			(2 * Math.PI * stationOf(world.system, id).spinRpm) / 60;
		const lateral = length(sub(out.ship.vel, stationVel));
		expect(lateral).toBeCloseTo(
			Math.hypot(want.across, want.up) * spinRadPerS,
			9,
		);
	});
});
