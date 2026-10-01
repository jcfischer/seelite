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
 */
import type { ComputerCommand, ComputerPhase } from "./docking";

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
