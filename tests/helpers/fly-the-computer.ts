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
 * Nothing else about a hull reaches the approach.
 */

import {
	type ApertureFrame,
	type ComputerPhase,
	type EntryPose,
	apertureFrame,
	attemptEntry,
	GRANT_WINDOW_S,
	corridorHalfWidthKm,
	dockingComputerStep,
	newDockingState,
	offAxisKm,
	orthonormalise,
	planeCrossing,
	requestClearance,
	slotBasis,
} from "../../src/docking";
import { HULL_SPECS, type HullId } from "../../src/hull";
import {
	attitudeSpin,
	attitudeStick,
	turnAttitude,
} from "../../src/attitude-hold";
import {
	ASSIST_CAP_KMS,
	type Angular,
	addRates,
	flightPerformance,
	speedDemand,
	stepAngular,
	stepFlight,
} from "../../src/sim";

const NO_TURN: Angular = Object.freeze({ pitch: 0, yaw: 0, roll: 0 });
import {
	STATION_GEOMETRY,
	type StationType,
	slotPhaseRad,
} from "../../src/station";
import { stationInterior } from "../../src/station-interior";
import { type Vec3, add, cross, dot, length, scale, v3 } from "../../src/vec3";

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
}

export interface FlightOptions {
	spinRpm: number;
	type?: StationType;
	hostile?: boolean;
	granted?: boolean;
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
}

export function flyTheComputer(opts: FlightOptions): FlightRun {
	const type = opts.type ?? "trade";
	const { axis, reference } = opts;
	const perf = flightPerformance(opts.perfHull ?? opts.hull);
	const envelope = HULL_SPECS[opts.hull].env;
	const dt = opts.dt ?? 0.05;
	const swing = opts.axisSwingRadPerS ?? 0;
	const pivot = cross(axis, reference);

	const interior = stationInterior(
		type,
		STATION_GEOMETRY[type].aperturePlaneKm,
		1,
	);
	const state =
		opts.granted === false
			? newDockingState()
			: {
					...requestClearance(newDockingState(), {
						gameTime: 0,
						rangeKm: 500,
						interior,
						hull: envelope,
						occupied: new Set<string>(),
					}),
					hostile: opts.hostile ?? false,
				};

	// Start well off the axis, so the line-up phase is genuinely exercised: a
	// start already on the corridor would never test the half of §7 that keeps
	// the hull-face approach from happening.
	const start = apertureFrame(type, axis, 0, reference);
	const basis = slotBasis(start);
	const ship = { pos: add(scale(axis, 20), scale(basis.up, 12)), vel: v3() };
	let nose = scale(axis, -1);
	let up = basis.up;
	let rates: Angular = { ...NO_TURN };
	let lastWant: { nose: Vec3; up: Vec3 } | null = null;

	let gameTime = 0;
	let docked = false;
	let refused: string | null = null;
	let violations = 0;
	let steps = 0;
	let crossingOutcome: FlightRun["crossing"] = null;
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
		const cmd = dockingComputerStep({
			frame,
			pose,
			state,
			gameTime,
			maxSpeedKms: ASSIST_CAP_KMS,
			previousPhase,
		});
		previousPhase = cmd.phase;
		if (!cmd.engaged) {
			refused = cmd.refused;
			break;
		}
		// **Through the hull's own vents** (#619): the computer asks for a stick
		// and `stepAngular` turns the hull at what its attitude couples deliver,
		// the way `main.ts`'s computer does. A freighter turns at about half the
		// courier's authority and a miner at about a third, so the line-up turn
		// and the roll tracking are genuinely harder for them.
		const want = orthonormalise(cmd.nose, cmd.up) ?? { nose: cmd.nose, up };
		const spin = lastWant ? attitudeSpin(lastWant, want, dt) : v3();
		lastWant = want;
		const attitude = stepAngular(
			rates,
			attitudeStick({ nose, up }, want, perf, dt, spin),
			NO_TURN,
			true,
			dt,
			perf,
		);
		rates = attitude.rates;
		({ nose, up } = turnAttitude({ nose, up }, rates, dt));

		const speedKms =
			opts.holdRunIn && cmd.phase === "run-in" ? 0 : cmd.speedKms;
		const throttle = speedKms / ASSIST_CAP_KMS;
		if (opts.trace) {
			const axialKm = dot(ship.pos, frame.axis);
			opts.trace.push({
				phase: cmd.phase,
				nose,
				throttle,
				rel: ship.pos,
				gameTime,
				axialKm,
				offAxisKm: offAxisKm(frame, ship.pos),
				corridorKm: corridorHalfWidthKm(frame, axialKm),
			});
		}

		const before: EntryPose = { rel: ship.pos, vRel: ship.vel, nose, up };
		const flown = stepFlight(
			ship,
			{ nose, up, demand: speedDemand(throttle), assist: true, attitude },
			dt,
			perf,
		);
		rates = addRates(rates, flown.angularKick);
		gameTime += dt;
		steps++;

		const after: EntryPose = { rel: ship.pos, vRel: ship.vel, nose, up };
		const nextFrame = frameAt(gameTime);
		const crossing = planeCrossing(nextFrame, before, after);
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
	};
}
