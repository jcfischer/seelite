/**
 * The three states `docs/specs/docking.md` §12 creates, and the tick that runs
 * them: **arriving, docked, launching**.
 *
 * `arrival.ts` holds the law — where the ship is at a progress value. This
 * module holds the state machine around it and the frame it is stepped in, so
 * that everything §12.6's obligations 3, 4, 8 and 9 assert is arithmetic a
 * headless test can drive rather than behaviour only a running browser has.
 *
 * **Why it takes the `World` when `docking.ts` deliberately does not.** §12.6's
 * obligation 4 is that the world keeps running while docked — the clock
 * advances and the bodies move, with no compression (#10) — and it exists
 * precisely because "a docked state that froze the tick would satisfy every
 * other obligation here". A check of that has to drive the same clock advance
 * the game drives, or it is checking a copy of the game rather than the game.
 * So `stepDockedWorld` below is the docked tick itself, called by `main.ts` and
 * by `tests/dock-session.test.ts`, and the arrow still points one way: `sim.ts`
 * imports neither this module nor `docking.ts`.
 */

import {
	type ArrivalLaw,
	arrivalAttitude,
	arrivalProgress,
	arrivalRel,
	arrivalRelVelocity,
	beginArrival,
	beginLaunch,
	berthCentre,
	parkedAttitude,
	recomposeOffset,
} from "./arrival";
import {
	type ApertureFrame,
	apertureFrame,
	frameAtPhase,
	slotBasis,
} from "./docking";
import {
	advanceWorldClock,
	bodyVelocity,
	stationOf,
	stationPose,
	type World,
} from "./sim";
import { STATION_GEOMETRY } from "./station";
import {
	type Berth,
	type StationInterior,
	stationInterior,
} from "./station-interior";
import { add, scale, type Vec3 } from "./vec3";

/**
 * Where a dock is.
 *
 * **It lives here rather than in `station-console.ts`, where #70 first put
 * it.** The console displays this; §12 decides it. Leaving the type in the
 * screen module and adding `"launching"` there would have made the state
 * machine's own vocabulary a re-export from a module that does not run it —
 * and §12.3's third row is a claim about all three of these states, not about
 * what a canopy shows. `station-console.ts` re-exports it, so its importers are
 * unchanged.
 *
 * **`"launching"` is not an addition to a settled list**: §12.2 makes launch
 * the mirror of the arrival, and §12.3's table records that an earlier draft
 * omitting it left a launching ship collidable inside the throat it was on
 * rails in.
 */
export type DockPhase = "flying" | "arriving" | "docked" | "launching";

/**
 * §12.3's third row, as a predicate.
 *
 * The three states in which the ship "is not a collidable body" — neither §2's
 * aperture rectangle nor the collision system's. #75 inherits the other half of
 * obligation 8: that its system honours this. Until then, §12.7's joint 5
 * records that the physical claim has no check and only this — the state being
 * *visible* — is live.
 */
export const collisionExempt = (phase: DockPhase): boolean =>
	phase !== "flying";

/**
 * **E5**: docked means flight is suspended — the throttle, the stick and the
 * docking computer all go inert. It covers the two traversals for the same
 * reason: E2 makes them scripted, and a player steering inside the throat is
 * the control problem E2 declined.
 */
export const flightLive = (phase: DockPhase): boolean => phase === "flying";

export interface DockSession {
	phase: DockPhase;
	/** The station this session is at. `null` exactly when flying. */
	stationId: string | null;
	/** The berth reserved for this session (§13.2). `null` exactly when flying.
	 *  Held from the grant through arrival, docking and launch, and released by
	 *  the outward aperture crossing. */
	berthId: string | null;
	/** The traversal in progress. `null` while flying and while docked — a
	 *  docked ship is *placed*, not interpolated, which is what makes
	 *  obligation 9 hold over an arbitrarily long interval. */
	law: ArrivalLaw | null;
}

export const newDockSession = (): DockSession => ({
	phase: "flying",
	stationId: null,
	berthId: null,
	law: null,
});

/**
 * The interior one station presents (§13).
 *
 * Here rather than at each call site: the placement, the traversal and the
 * renderer all need the same catalogue, and three lookups is three chances to
 * pass a different seed and get a different outpost.
 */
export const interiorOfStation = (station: {
	type: keyof typeof STATION_GEOMETRY;
	berthSeed: number;
}): StationInterior =>
	stationInterior(
		station.type,
		STATION_GEOMETRY[station.type].aperturePlaneKm,
		station.berthSeed,
	);

/** The berth an id names, or a throw: a session holding an id no catalogue
 *  answers for is the reservation and the generator having diverged, not a case
 *  to paper over with a default berth. */
export function berthOf(interior: StationInterior, id: string): Berth {
	const berth = interior.berths.find((candidate) => candidate.id === id);
	if (!berth) throw new Error(`no berth ${id} at a ${interior.type} station`);
	return berth;
}

/** Where the tick says the ship must be this frame. `null` while flying, when
 *  the ship owns its own position. */
export interface DockedShip {
	pos: Vec3;
	vel: Vec3;
	nose: Vec3;
	up: Vec3;
}

/**
 * Enter the arrival, from the crossing §3's checks have just passed.
 *
 * `entryRel` and the attitude are `planeCrossing`'s interpolated pose, so the
 * arrival begins exactly where the skill test ended (E2).
 */
export function enterArrival(
	stationId: string,
	frame: ApertureFrame,
	interior: StationInterior,
	berth: Berth,
	entryRel: Vec3,
	attitude: { nose: Vec3; up: Vec3 },
	gameTime: number,
): DockSession {
	return {
		phase: "arriving",
		stationId,
		berthId: berth.id,
		law: beginArrival(frame, interior, berth, entryRel, gameTime, attitude),
	};
}

/**
 * §12.2's launch, requested.
 *
 * **Unconditional, and it reads no flag.** The tempting argument is that a
 * player cannot launch from a station they did not arrive at, so E4's flag must
 * be set — but E5 depends on a save that may restore a *docked* ship and E4
 * resets its flags on entering a galaxy, so a restored session can reach a
 * launch with the flag clear. Rather than patch the argument, the rule drops
 * the dependency.
 *
 * Refused only when there is nothing to launch from, which is a state error
 * rather than a policy: the session is returned unchanged.
 */
export function requestLaunch(
	session: DockSession,
	frame: ApertureFrame,
	interior: StationInterior,
	gameTime: number,
): DockSession {
	if (session.phase !== "docked" || !session.stationId || !session.berthId)
		return session;
	return {
		phase: "launching",
		stationId: session.stationId,
		berthId: session.berthId,
		// The route back out, from the berth the ship is parked in. The parked
		// nose already points outward (§13.3), so the launch settles the roll
		// rather than turning the ship round.
		law: beginLaunch(
			frame,
			interior,
			berthOf(interior, session.berthId),
			gameTime,
		),
	};
}

/**
 * Whether the traversal in progress can be skipped (§12.6's obligation 5).
 *
 * **A launch always can.** Asserted unconditionally rather than as "skippable
 * whenever its type's flag is set": §12.2 argues that is always true, so the
 * conditional form has an unreachable false branch, and stated unconditionally
 * a regression that made a first launch play fails the row.
 *
 * **An arrival can too, since §13.3, and that retires E4 rather than
 * implementing it.** E4 made an arrival skippable only once the player had
 * arrived at that *type* of station before — four booleans of per-galaxy player
 * state that `persistent-world-state.md` §6 declined to bound. §13.3 makes both
 * traversals unconditionally skippable, so the flags have nothing left to gate
 * and the storage question does not arise. An arrival's skip completes **at the
 * reserved berth**; a launch's completes outside the aperture.
 */
export function canSkipTraversal(session: DockSession): boolean {
	return session.phase === "arriving" || session.phase === "launching";
}

/**
 * Skip it: the law is re-based so that `gameTime` is already its end.
 *
 * Re-based rather than mutated to a "done" flag, because the ship must still be
 * *placed* by the same law on the frame the skip lands — a flag would hand the
 * next frame a session whose position came from nowhere.
 */
export function skipTraversal(
	session: DockSession,
	gameTime: number,
): DockSession {
	if (!canSkipTraversal(session) || !session.law) return session;
	return {
		...session,
		law: { ...session.law, startedAtS: gameTime - session.law.durationS },
	};
}

/**
 * One frame of a session that is not flying: the world first, then the ship.
 *
 * **The clock and the bodies move first, unconditionally** — the ordering
 * `stepWorld` uses, and obligation 4's whole subject. A frame must not mix a
 * body position from one clock value with a ship position from another, and a
 * docked state that skipped this line would freeze the system around a player
 * sitting in it, which #10's constraint forbids outright.
 *
 * Returns the session that follows and where the ship must be put. A flying
 * session is returned untouched with no ship, so a caller may run this every
 * frame without asking first.
 */
export function stepDockedWorld(
	world: World,
	session: DockSession,
	dt: number,
	/**
	 * The station's berth catalogue, supplied by the caller.
	 *
	 * **Built here, it was ~27 allocations a frame for as long as the player sat
	 * docked** — and §12.6's obligation 4 says ten minutes is a case. It is a
	 * pure function of the type, the table and the seed, so the one cache that
	 * should hold it is the session's: `Game.interiorOf`. Passed in rather than
	 * memoised in this module, because a module-level cache in a sim module is
	 * a second lifetime for a value the game already owns.
	 *
	 * Optional so the flying path — which reads none of it — costs nothing.
	 */
	interior?: StationInterior,
): { session: DockSession; ship: DockedShip | null } {
	if (session.phase === "flying" || !session.stationId)
		return { session, ship: null };

	advanceWorldClock(world, dt);

	const id = session.stationId;
	const body = world.system.byId.get(id);
	// The same throw `stationPose` and `bodyVelocity` make, for the same reason:
	// a station missing from the placement is the generator and the placement
	// having disagreed, not a state this function should paper over. It is not
	// defensive code with no reachable case — `advanceSystem` above rejects a
	// system whose placement and contents have diverged before this line runs,
	// so this is the narrowing that lets the placement's own guard be the one
	// that speaks.
	if (!body) throw new Error(`station ${id} has no placed body`);

	const station = stationOf(world.system, id);
	const pose = stationPose(world.system, id, world.gameTime);
	const frame = apertureFrame(
		station.type,
		pose.axis,
		pose.phaseRad,
		pose.reference,
	);
	const stationVel = bodyVelocity(world.system, id, world.gameTime);
	// **From the geometry, not from the drawn rpm.** `frameAtPhase` forces a
	// pad's phase to zero because a pad does not rotate, so a pad carrying a
	// non-zero `spinRpm` would get rotation terms in the velocity that its own
	// position law does not have — and the velocity would stop being the
	// derivative of the position mid-traversal. `apertureFrame` normalises the
	// phase for the same reason; this is that rule applied to the rate.
	const spinRadPerS = STATION_GEOMETRY[station.type].spins
		? (2 * Math.PI * station.spinRpm) / 60
		: 0;

	if (session.phase === "docked") {
		if (!session.berthId)
			throw new Error(`docked at ${id} with no berth reserved`);
		const berth = berthOf(
			interior ?? interiorOfStation(station),
			session.berthId,
		);
		// **Placed, not interpolated.** Obligation 9's long interval is exactly
		// this: the station translates at orbital speed and spins the whole time,
		// and a docked position integrated from where the ship was would drift
		// away from it. Recomputed from the berth every frame, it cannot.
		const local = berthCentre(berth);
		const rel = recomposeOffset(frame, local, pose.phaseRad);
		const { across, up } = slotBasis(frameAtPhase(frame, pose.phaseRad));
		// **A berth is off the axis, so a docked ship is carried by the spin.**
		// The old docked position sat on the axis and took no rotation term at
		// all; a wall berth on a 3 rpm Coriolis is 105 m out, which is 33 m/s of
		// station-frame velocity the ship genuinely has.
		const lateral = add(
			scale(across, -local.up * spinRadPerS),
			scale(up, local.across * spinRadPerS),
		);
		return {
			session,
			ship: {
				pos: add(body.pos, rel),
				vel: add(stationVel, lateral),
				// One spelling of the parked pose, which the launch also starts
				// from: nose along the berth's own `parkedNose`, up away from
				// the berth surface (§13.3) — so a docked ship sits square in
				// its berth and turns with the station rather than holding a
				// world-space roll it has rotated away from.
				...parkedAttitude(
					{ frame, berthNormal: berth.normal, berthNose: berth.parkedNose },
					pose.phaseRad,
				),
			},
		};
	}

	const law = session.law;
	if (!law) return { session: newDockSession(), ship: null };
	const u = arrivalProgress(law, world.gameTime);
	const rel = arrivalRel(law, u, pose.phaseRad);
	const vel = arrivalRelVelocity(law, u, pose.phaseRad, spinRadPerS);
	const attitude = arrivalAttitude(law, u, pose.phaseRad);
	const ship: DockedShip = {
		pos: add(body.pos, rel),
		vel: add(stationVel, vel),
		nose: attitude.nose,
		up: attitude.up,
	};
	if (u < 1) return { session, ship };

	// The traversal has ended. An arrival hands over to the docked state; a
	// launch releases the ship — and it releases it **outside the plane**
	// (§12.2), which is what makes the very next frame one in which §3's checks
	// can be evaluated again.
	return law.kind === "arrival"
		? {
				session: {
					phase: "docked",
					stationId: id,
					berthId: session.berthId,
					law: null,
				},
				ship,
			}
		: { session: newDockSession(), ship };
}
