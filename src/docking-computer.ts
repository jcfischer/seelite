/**
 * The docking computer's session (#596): whether it is flying, why it last let
 * go, and the corridor phase its next step is fed.
 *
 * `docking.ts` holds the law — `dockingComputerStep` decides what the computer
 * does on one step. This holds the four values that step reads and writes
 * between frames, and it holds them behind one engage and one disengage.
 * They were four fields on `Game`, and three of the four sites that engaged the
 * computer set the flag and left the last refusal standing, so the snapshot
 * reported a refusal beside `computerEngaged: true`. None of the four has a
 * setter here, so tsc refuses a write that skips the pair.
 *
 * Clearing the pilot's arrival-lane requests is not in here. It is `Game`'s
 * lane state, and two disengages do not clear them: the dock or bounce that
 * ends a flight, and the flight-session teardown. `Game.cancelComputerApproach`
 * pairs the two for every other site.
 *
 * `flyComputer` is the computer flown one step (#648): the controller, the
 * attitude follower and the throttle, for `Game` and the docking harness
 * alike, so the figures `docking.md` quotes come from the computer the game
 * runs.
 */
import type { AttitudeFollower } from "./attitude-hold";
import {
	type ApertureFrame,
	type ComputerCommand,
	type ComputerPhase,
	type DockingState,
	type EntryPose,
	dockingComputerStep,
} from "./docking";
import { ASSIST_CAP_KMS, type Angular, type FlightPerformance } from "./sim";

export type ComputerRefusal = ComputerCommand["refused"];

/** How `disengage` stops the computer: see its docblock. */
export type DisengageHow = { refused?: ComputerRefusal; idle?: boolean };

export class DockingComputer {
	#engaged = false;
	#refusal: ComputerRefusal = null;
	#phase: ComputerPhase = "idle";
	#stationId: string | null = null;
	/** The phase this step started from, kept by `beginStep`. */
	#taken: ComputerPhase = "idle";

	/** Whether it is flying. Any control input cancels it (§7). */
	get engaged(): boolean {
		return this.#engaged;
	}

	/**
	 * Why the computer last stopped flying, or `null`.
	 *
	 * Held rather than dropped because a disengagement the player cannot see is
	 * the same defect §8 records about invisible tolerances.
	 */
	get refusal(): ComputerRefusal {
		return this.#refusal;
	}

	/**
	 * The phase the last step returned, fed back into the next one (#315).
	 * `"idle"` whenever it did not fly on the last step, so a run-in always
	 * starts on the tight side of the corridor hysteresis.
	 */
	get phase(): ComputerPhase {
		return this.#phase;
	}

	/** Start flying. A refusal from an earlier approach no longer applies. */
	engage(): void {
		this.#engaged = true;
		this.#refusal = null;
		this.#phase = "idle";
	}

	/**
	 * Stop flying. `refused` records why, when the computer let go on its own;
	 * a dock, a bounce, control input or a reset names nothing and keeps the
	 * last reason. `idle` forgets the recorded phase at once, which only the
	 * pilot's toggle asks for — every other site leaves it for the next step.
	 */
	disengage(how: DisengageHow = {}): void {
		this.#engaged = false;
		if (how.refused !== undefined) this.#refusal = how.refused;
		if (how.idle) this.#phase = "idle";
	}

	/** What `dockingSnapshot` reports, under the names the probes read. */
	snapshot(): { computerEngaged: boolean; computerRefusal: ComputerRefusal } {
		return { computerEngaged: this.#engaged, computerRefusal: this.#refusal };
	}

	/**
	 * Called at the top of every step, before anything can return: it keeps
	 * the phase the last step recorded for `phaseAt` and leaves idle in its
	 * place, so every early exit leaves the corridor.
	 */
	beginStep(): void {
		this.#taken = this.#phase;
		this.#phase = "idle";
	}

	/**
	 * The phase `beginStep` kept, if the computer is still at the station that
	 * phase was flown at, else idle. A phase belongs to one station's corridor;
	 * carried to another it would start that run-in on the wide side of the
	 * hysteresis.
	 */
	phaseAt(stationId: string): ComputerPhase {
		if (stationId === this.#stationId) return this.#taken;
		this.#stationId = stationId;
		return "idle";
	}

	/** The phase this step's command returned. */
	recordPhase(phase: ComputerPhase): void {
		this.#phase = phase;
	}
}

/** What `flyComputer` is handed: one station's approach, and the pilot's
 *  follower and hull. */
export interface ComputerFlightInput {
	frame: ApertureFrame;
	/** The ship against the station, and its attitude: what the follower turns
	 *  from. */
	pose: EntryPose;
	state: DockingState;
	gameTime: number;
	/** `DockingComputer.phaseAt`'s, or `"idle"` on the first step (#315). */
	previousPhase: ComputerPhase;
	/** The follower's memory is the caller's: `Game` resets it on every frame
	 *  the computer does not fly. */
	follower: AttitudeFollower;
	perf: FlightPerformance;
	dt: number;
	/**
	 * Whether the caller's lane holds this run-in at the corridor entrance.
	 * Asked once, and only on a run-in under a live grant: `Game` registers
	 * its arrival request with Traffic then, and the route spec gives the lane
	 * to Traffic alone, so this step owns no queue and no allocator.
	 */
	runInHeld: () => boolean;
}

/** One step of the computer, flown: refused with its reason, or a stick for
 *  the Hull step and a throttle for the assist. */
export type ComputerFlight =
	| { engaged: false; refused: ComputerRefusal; phase: ComputerPhase }
	| { engaged: true; phase: ComputerPhase; stick: Angular; throttle: number };

/**
 * The docking computer flown one step (#648, `docking.md` §7, §13.2).
 *
 * - **A queued clearance lines up and waits.** It is permission to line up,
 *   not to enter, so the controller is fed a live grant to track the rotating
 *   corridor and the run-in speed is held at zero until a berth is named.
 * - **The run-in otherwise asks the caller's lane** (`runInHeld`).
 * - **Through the hull's vents** (#619, `flight-model.md` §3.6): the follower
 *   asks for a stick toward the commanded attitude, on the assist's rate law
 *   whatever the pilot's toggle says, and the Hull step turns the hull by it.
 * - The throttle is the commanded speed over the assist's cap.
 */
export function flyComputer(input: ComputerFlightInput): ComputerFlight {
	const awaitingBerth = input.state.clearance.kind === "queued";
	const command = dockingComputerStep({
		frame: input.frame,
		pose: input.pose,
		state: awaitingBerth
			? {
					...input.state,
					clearance: { kind: "granted", expiresAtS: Number.POSITIVE_INFINITY },
				}
			: input.state,
		gameTime: input.gameTime,
		maxSpeedKms: ASSIST_CAP_KMS,
		previousPhase: input.previousPhase,
	});
	if (!command.engaged)
		return { engaged: false, refused: command.refused, phase: command.phase };
	const stick = input.follower.stick(
		{ nose: input.pose.nose, up: input.pose.up },
		{ nose: command.nose, up: command.up },
		input.perf,
		input.dt,
	);
	const held =
		command.phase === "run-in" && (awaitingBerth || input.runInHeld());
	const speedKms = held ? 0 : command.speedKms;
	return {
		engaged: true,
		phase: command.phase,
		stick,
		throttle: Math.min(1, speedKms / ASSIST_CAP_KMS),
	};
}
