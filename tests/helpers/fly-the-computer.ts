/**
 * A headless flight harness: §7's autopilot command, turned through the
 * **hull's** attitude vents and integrated by `sim.ts`'s own assisted flight
 * law, as `main.ts`'s computer flies it (#619).
 *
 * Everything runs in the station's frame with no `frame` passed, which is
 * exactly the conversion `docking.md` §1 requires of every caller — so this
 * exercises the frame the checks are stated in rather than a convenient one.
 * That the station's orbit accelerates changes nothing here: the ship shares
 * the frame's acceleration (#529), so flight in it is flight in a still one.
 *
 * **It lives here rather than in `tests/docking.test.ts` because #181 gave it a
 * second caller.** That file owns §9.1.11 — does the computer satisfy §3 — and
 * `tests/hull-docking.test.ts` owns #26's D5 consequence: every hull on the
 * roster has to fly the same profile, and the sluggish end of it is the case
 * nothing measured while nothing varied. A second copy of the loop would let
 * the two answer different questions while appearing to answer one.
 *
 * The hull enters through exactly two doors and they are the two D5 names: its
 * `FlightPerformance`, which decides how fast it turns and accelerates, and its
 * envelope, which decides whether the station has a berth to reserve for it.
 * Nothing else about a hull reaches the approach. Collision rows can also
 * supply the station's own seeds, used by its interior and proxy together.
 */

import { type Impact, shipPose, sweepShip } from "../../src/collision";
import { hullSolid } from "./hull-solid";
import type { StationPlanOfType } from "./station-plan-corpus";
import {
	type ApertureFrame,
	type ComputerPhase,
	type DockingState,
	type EntryPose,
	apertureCrossing,
	apertureFrame,
	attemptEntry,
	GRANT_WINDOW_S,
	corridorHalfWidthKm,
	newDockingState,
	offAxisKm,
	requestClearance,
	slotBasis,
} from "../../src/docking";
import { HULL_SPECS, type HullId } from "../../src/hull";
import { AttitudeFollower } from "../../src/attitude-hold";
import { flyComputer } from "../../src/docking-computer";
import {
	type Angular,
	flightPerformance,
	speedDemand,
	stepHull,
} from "../../src/sim";

const NO_TURN: Angular = Object.freeze({ pitch: 0, yaw: 0, roll: 0 });
import {
	OUTPOST_FORM,
	STATION_GEOMETRY,
	type StationFormId,
	type StationType,
	slotPhaseRad,
} from "../../src/station";
import {
	type StationInterior,
	stationInterior,
} from "../../src/station-interior";
import {
	type StationProxy,
	stationProxyOf,
	stationMotions,
} from "../../src/station-proxy";
import { type Vec3, add, cross, dot, length, scale, v3 } from "../../src/vec3";

/**
 * A deliberately awkward axis, not a world axis.
 *
 * Every check is stated in the aperture frame, so an axis-aligned fixture
 * would let a sign error in `slotBasis` hide behind coordinates that happen to
 * agree. This one agrees with nothing.
 */
export const FIXTURE_AXIS: Vec3 = (() => {
	const a = v3(0.37, -0.82, 0.44);
	return scale(a, 1 / length(a));
})();

/**
 * The aperture's phase-zero direction, a fixed perpendicular to `FIXTURE_AXIS`.
 * In the game it is the station's along-track direction; what the tests check
 * is the arithmetic against *some* reference.
 */
export const FIXTURE_REFERENCE: Vec3 = (() => {
	const p = cross(FIXTURE_AXIS, v3(0, 0, 1));
	return scale(p, 1 / length(p));
})();

/** The docking axis's swing at the fastest orbit the generator makes, 90 min —
 *  in the game the axis points at the parent body, so it turns once per orbit. */
export const FASTEST_ORBIT_SWING_RAD_PER_S = (2 * Math.PI) / (90 * 60);

/** One step of the computer's flying, for a caller asking how it flew. */
export interface ComputerTraceStep {
	phase: ComputerPhase;
	nose: Vec3;
	throttle: number;
	/** Ship position in the station's frame, km, at the start of the step. */
	rel: Vec3;
	gameTime: number;
	/** Distance out along this step's docking axis, km. */
	axialKm: number;
	/** Distance from that axis, km. */
	offAxisKm: number;
	/** The corridor's half-width at this axial distance, km. */
	corridorKm: number;
}

/** Rotate `v` about `pivot` by `rad` (Rodrigues). */
export function rotateAbout(v: Vec3, pivot: Vec3, rad: number): Vec3 {
	const k = scale(pivot, 1 / length(pivot));
	const c = Math.cos(rad);
	return add(
		add(scale(v, c), scale(cross(k, v), Math.sin(rad))),
		scale(k, dot(k, v) * (1 - c)),
	);
}

export interface FlightRun {
	docked: boolean;
	refused: string | null;
	/** A crossing that failed a check. Zero is the claim; a positive count names
	 *  a hull that reached the plane in a pose §3 refuses — a failed entry. */
	violations: number;
	steps: number;
	gameTime: number;
	/** The evaluation at the crossing, when there was one — so a failing row can
	 *  print which of the six rows went red rather than a boolean. */
	crossing: ReturnType<typeof attemptEntry> | null;
	/**
	 * The impacts the flown hull's box made with the station's proxy while
	 * flying (`collision.md` §9.1.15): collision is live here as in the game,
	 * and the run ends at the first, so this holds at most one step's. Empty is
	 * the claim.
	 */
	impacts: Impact[];
	/** Steps that began with the box overlapping the proxy (§4.3). A computer
	 *  run is never placed, so zero is the claim here too. */
	ghostSteps: number;
}

export interface FlightOptions {
	spinRpm: number;
	type?: StationType;
	hostile?: boolean;
	granted?: boolean;
	/**
	 * Fly under a queued clearance (`docking.md` §13.2): the computer lines up
	 * as if granted and holds the run-in at zero, because a queued request is
	 * permission to wait and not to enter (#648).
	 */
	queued?: boolean;
	/** Whose handling and whose envelope. Required: a default here would let a
	 *  sweep over the roster quietly fly one hull eleven times. */
	hull: HullId;
	/** The docking axis and the aperture's phase-zero reference, supplied by the
	 *  caller so both callers fly the same deliberately awkward fixture rather
	 *  than each inventing an axis that might agree with a sign error. */
	axis: Vec3;
	reference: Vec3;
	/**
	 * Whose *handling* to fly, when it is not the hull's own.
	 *
	 * The control arm, and it exists for one row: flying every hull at the
	 * baseline's performance has to collapse the spread this file's caller
	 * measures. Without it, a spread produced by the envelope, the berth
	 * allocation or the fixture would read exactly like a spread produced by
	 * #26's D5.
	 */
	perfHull?: HullId;
	/**
	 * Seconds of sim time before the run is abandoned.
	 *
	 * **`GRANT_WINDOW_S` and not more.** A generous 900 s was unreachable: the
	 * computer calls `grantLive` every frame, so a run past 600 s comes back
	 * `refused: "no-clearance"` rather than timing out, and a caller that treats
	 * a refusal as a broken harness would report a genuinely slow hull that way.
	 * At the window, running out of grant *is* the timeout and reads as one.
	 */
	limitS?: number;
	/** Seconds per step. 0.05 unless a caller asks for the renderer's cadence. */
	dt?: number;
	/**
	 * Hold the run-in at zero speed, the way `main.ts` does while a request is
	 * queued or the lane is busy (#315). The computer still lines up; it parks
	 * wherever it entered the corridor and waits there.
	 */
	holdRunIn?: boolean;
	/**
	 * Swing the docking axis, rad/s. In the game the axis points at the parent
	 * body, so it turns once per orbit; a fixed axis cannot move the corridor
	 * off a parked ship (#315).
	 */
	axisSwingRadPerS?: number;
	/** Filled with one entry per step, when given. */
	trace?: ComputerTraceStep[];
	/**
	 * The station the hull meets (`collision.md` §2.2), when it is not the
	 * proxy of the plan at `stationPlan` — for a row that builds a red proxy
	 * on purpose.
	 */
	proxy?: StationProxy;
	/** Explicit plan for seeded collision rows. Historical handling fixtures
	 * retain berth 1, assembly 0 when omitted, in `HISTORICAL_FORM` — the form
	 * each role flew when their ceilings were measured — and a row about every
	 * form iterates `stationPlansFor`. The berth catalogue and proxy must read
	 * the same plan. */
	stationPlan?: StationPlanOfType;
}

/** The clearance a run starts under: none, queued, or a live grant. Every
 *  case carries `hostile` (sage, #648 round 1). */
function initialState(
	opts: FlightOptions,
	interior: ReturnType<typeof stationInterior>,
	envelope: (typeof HULL_SPECS)[HullId]["env"],
): DockingState {
	const hostile = opts.hostile ?? false;
	if (opts.granted === false) return { ...newDockingState(), hostile };
	if (opts.queued)
		return {
			...newDockingState(),
			clearance: { kind: "queued", position: 0 },
			hostile,
		};
	return {
		...requestClearance(newDockingState(), {
			gameTime: 0,
			rangeKm: 500,
			interior,
			hull: envelope,
			occupied: new Set<string>(),
		}),
		hostile,
	};
}

/**
 * The form each role flew before node #717, when the historical handling
 * fixtures' ceilings were measured: trade and shipyard `a`, refinery `d`,
 * the outpost's own. Named rather than read off the pool (sage, node #717
 * round 2): a fixture that followed `formsInPlay(type)[0]` would fly its
 * ceilings against another form the day a pool were reordered, with no row
 * going red. `collision-stations.test.ts` names its Coriolis for the same
 * reason.
 */
export const HISTORICAL_FORM: Readonly<Record<StationType, StationFormId>> = {
	trade: "a",
	shipyard: "a",
	refinery: "d",
	outpost: OUTPOST_FORM,
};

/**
 * The station a flight is flown against: the interior its berths come from and
 * the proxy it is swept against. These and the rest of `FlightOptions` are
 * everything `flyTheComputer` reads.
 */
export function flightStation(
	opts: Pick<FlightOptions, "type" | "stationPlan" | "proxy">,
): { interior: StationInterior; proxy: StationProxy } {
	const type = opts.type ?? "trade";
	const seeds = opts.stationPlan ?? {
		formId: HISTORICAL_FORM[type],
		berthSeed: 1,
		assemblySeed: 0,
	};
	return {
		interior: stationInterior(
			type,
			STATION_GEOMETRY[type].aperturePlaneKm,
			seeds.berthSeed,
		),
		proxy: opts.proxy ?? stationProxyOf({ type, ...seeds }),
	};
}

export function flyTheComputer(opts: FlightOptions): FlightRun {
	const type = opts.type ?? "trade";
	const { axis, reference } = opts;
	const perf = flightPerformance(opts.perfHull ?? opts.hull);
	const envelope = HULL_SPECS[opts.hull].env;
	const dt = opts.dt ?? 0.05;
	const swing = opts.axisSwingRadPerS ?? 0;
	const pivot = cross(axis, reference);
	const { interior, proxy } = flightStation(opts);
	const state = initialState(opts, interior, envelope);

	// Start well off the axis, so the line-up phase is genuinely exercised: a
	// start already on the corridor would never test the half of §7 that keeps
	// the hull-face approach from happening.
	const start = apertureFrame(type, axis, 0, reference);
	const basis = slotBasis(start);
	const ship = { pos: add(scale(axis, 20), scale(basis.up, 12)), vel: v3() };
	let nose = scale(axis, -1);
	let up = basis.up;
	let rates: Angular = { ...NO_TURN };
	const follower = new AttitudeFollower();

	let gameTime = 0;
	let docked = false;
	let refused: string | null = null;
	let violations = 0;
	let steps = 0;
	let crossingOutcome: FlightRun["crossing"] = null;
	const impacts: Impact[] = [];
	let ghostSteps = 0;
	// The station stands at the origin of its own frame, which is the frame
	// this harness flies in: a proxy at rest, turning with the slot. // glossary-ignore: slot
	const box = hullSolid(opts.hull);
	const limitS = opts.limitS ?? GRANT_WINDOW_S;
	let previousPhase: ComputerPhase = "idle";

	const frameAt = (t: number): ApertureFrame =>
		apertureFrame(
			type,
			rotateAbout(axis, pivot, swing * t),
			slotPhaseRad(opts.spinRpm, t),
			rotateAbout(reference, pivot, swing * t),
		);

	while (gameTime < limitS && !docked) {
		const frame = frameAt(gameTime);
		const pose: EntryPose = { rel: ship.pos, vRel: ship.vel, nose, up };
		// The game's own computer step (#648): the controller, the follower and
		// the throttle, the queued-clearance rule among them. `holdRunIn` stands
		// in for the lane, which is `Game`'s and Traffic's.
		const flight = flyComputer({
			frame,
			pose,
			state,
			gameTime,
			previousPhase,
			follower,
			perf,
			dt,
			runInHeld: () => opts.holdRunIn === true,
		});
		previousPhase = flight.phase;
		if (!flight.engaged) {
			refused = flight.refused;
			break;
		}
		const { throttle } = flight;

		// **Through the hull's own vents** (#619), by the game's Hull step (#646):
		// the computer's stick turns the hull at what the attitude couples
		// deliver, and the drive moves it along the nose it has just turned to. A
		// freighter turns at about half the courier's authority and a miner at
		// about a third, so the line-up turn and the roll tracking are genuinely
		// harder for them.
		const start = { rel: { ...ship.pos }, vRel: { ...ship.vel } };
		const attitudeBefore = { nose, up };
		({ nose, up, rates } = stepHull(
			ship,
			{ nose, up, rates },
			{
				stick: flight.stick,
				turnAssist: true,
				translation: { demand: speedDemand(throttle), assist: true },
			},
			dt,
			perf,
		));
		// The crossing is read between the step's two ends at the attitude it
		// turned to, as it was before the Hull step.
		const before: EntryPose = { ...start, nose, up };
		if (opts.trace) {
			// Where the step started, and the attitude it turned to.
			const axialKm = dot(before.rel, frame.axis);
			opts.trace.push({
				phase: flight.phase,
				nose,
				throttle,
				rel: before.rel,
				gameTime,
				axialKm,
				offAxisKm: offAxisKm(frame, before.rel),
				corridorKm: corridorHalfWidthKm(frame, axialKm),
			});
		}

		gameTime += dt;
		steps++;

		const after: EntryPose = { rel: ship.pos, vRel: ship.vel, nose, up };
		const nextFrame = frameAt(gameTime);
		// `collision.md` §4.2, decided as `stepWorld` decides it: the plane's
		// time against the earliest impact's, a tie to the impact.
		const found = apertureCrossing(
			nextFrame,
			before,
			after,
			STATION_GEOMETRY[type].coreRadiusKm,
		);
		const swept = sweepShip(
			{
				primitives: box,
				start: shipPose(start.rel, attitudeBefore.nose, attitudeBefore.up),
				end: shipPose(ship.pos, nose, up),
				velStart: start.vRel,
				velEnd: ship.vel,
			},
			stationMotions(
				proxy,
				{ frame: frameAt(gameTime - dt), origin: v3(), vel: v3() },
				{ frame: nextFrame, origin: v3(), vel: v3() },
			),
			dt,
			{ planeS: found ? found.fraction * dt : null },
		);
		if (swept.ghosts.length > 0) ghostSteps++;
		impacts.push(...swept.impacts);
		ship.pos = swept.pos;
		ship.vel = swept.vel;
		// **An impact ends the run, as a failed check does.** The hull met the
		// station instead of the plane, which is a run that failed; flying on
		// would bounce it to the grant window's end and report a timeout.
		if (swept.impacts.length > 0) break;
		const crossing = swept.planeOwns ? (found?.pose ?? null) : null;
		if (crossing) {
			const outcome = attemptEntry({
				frame: nextFrame,
				pose: crossing,
				state,
				gameTime,
			});
			crossingOutcome = outcome;
			if (!outcome.docked) violations++;
			docked = outcome.docked;
			break;
		}
	}
	return {
		docked,
		refused,
		violations,
		steps,
		gameTime,
		crossing: crossingOutcome,
		impacts,
		ghostSteps,
	};
}
