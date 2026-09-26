/**
 * The opening cinematic's pure half (#535): the pilot script that flies a new
 * game's ship from the arrival point, and the director that chooses which shot
 * shows it.
 *
 * **A real flight, not a film** (#530 D1). The script flies the ship in the
 * sim — the arrival, a burn, a cruise leg to the start system's trade station,
 * and the station's computer bringing it in — and the shots only choose what
 * to show. `Game` is the sim; this file never touches it except through
 * `OpeningSim`.
 *
 * **Watched and skipped end in one state** (#530 D2). That holds because the
 * two halves never meet in one direction: the script decides every action from
 * sim facts alone, one fixed step at a time, and the director reads the same
 * facts to decide only how many of those steps a frame runs. A frame cadence,
 * a cut and a skip change how the steps are grouped, never which steps run. A
 * decision keyed on the wall clock would break that, and there is none.
 *
 * **A leaf**: it imports nothing, so `tests/opening.test.ts` runs the script
 * against a stand-in sim under bun.
 */

/** Which opening a new game gets (#530 D3): the whole flight to a berth, or
 *  the arrival and the fly-past with control given back at the arrival point. */
export type OpeningKind = "guided" | "free";

/** What the camera is showing. `null` in the director's answers is a cut. */
export type OpeningShot = "arrival" | "flypast" | "cruise" | "dock";

/** Where the script is in the flight. `done` and `fallback` are the ends. */
export type OpeningLeg =
	| "arrive"
	| "burn"
	| "spool"
	| "cruise"
	| "approach"
	| "done"
	| "fallback";

/** How a run ended: docked (guided), in flight (free), or handed to #530
 *  D6's fallback, which is `Game.startDockedAtHome` from wherever it is. */
export type OpeningOutcome = "docked" | "flying" | "fallback";

/** An order the script gives the sim, before the step it belongs to. */
export type PilotAction =
	| "throttle-burn"
	| "throttle-zero"
	| "engage-cruise"
	| "request-clearance"
	| "engage-computer"
	| "skip-traversal";

/** What the script and the director read off the sim, and nothing else. */
export interface PilotFacts {
	regime: "normal" | "cruise";
	/** A cruise spool-up is running. */
	spooling: boolean;
	dockPhase: "flying" | "arriving" | "docked" | "launching";
	computerEngaged: boolean;
	grantLive: boolean;
	/** The cruise leg's remaining seconds, when cruising (`timeToTarget`). */
	cruiseEtaS: number | null;
	/** Range to the trade station's centre, km. */
	stationKm: number;
	/** Inside the range a clearance can be asked for in. */
	inVicinity: boolean;
	/** The station's computer is on its run-in, not still lining up. */
	runIn: boolean;
}

/** The sim, as a run drives it. `Game` implements it; so does the test's
 *  stand-in. */
export interface OpeningSim {
	facts(): PilotFacts;
	apply(action: PilotAction): void;
	step(dt: number): void;
	/** Told on the step a shot starts or a cut begins, so a shot is framed
	 *  from the sim as it stood then — not from whichever later frame drew it
	 *  first, which a hold or a long frame would move. */
	shotChanged?(shot: OpeningShot | null): void;
}

/**
 * The script's figures and the shots' table.
 *
 * The shot lengths are #530 D4's split of about 30 s, and they are the build's
 * to tune on the strip: arrival 6 s (the exit needs 4.6 s of sky unfolding),
 * fly-past 5 s (the burn and the spool), cruise 8 s, dock about 9 s.
 *
 * Two shots show the sim faster than it runs, which is not time compression
 * (#10): nothing the pilot can act on is sped up, because the pilot is not
 * flying. The cruise ETA is accurate over its last 14 s (measured on seeds 47,
 * 42 and 7), so its window stays inside that; the dock shot is keyed on the
 * run-in and a range, because a line-up can swing past the station closer
 * than the run-in starts (seed 42 passes at 1.1 km).
 */
export const OPENING = Object.freeze({
	/** The one step the script is flown at, watched or skipped. */
	dtS: 1 / 60,
	/** The arrival: the ship at rest while the exit plays, shown 1:1. */
	arriveS: 6,
	/** The burn toward the station before cruise engages (guided), or the
	 *  whole fly-past (free). */
	burnS: Object.freeze({ guided: 2, free: 5 }),
	/** The burn's throttle. Full throttle is 2 km/s within a second, which
	 *  crosses a camera beside the ship in a hundredth of a second; a tenth of
	 *  that is a pass the eye can follow, and the spool keeps it until cruise
	 *  takes over at full throttle. */
	burnThrottle: 0.05,
	/** How long a spool-up may take before a missing cruise is a failure: the
	 *  3 s spool and a second of margin. */
	spoolCapS: 4,
	/** A cruise leg longer than this is a failure (the measured legs are
	 *  50–56 s). */
	cruiseCapS: 600,
	/** A run-in longer than this is a failure (measured 83–87 s from the
	 *  drop-out). */
	approachCapS: 300,
	/** The cruise shot: the leg's last `simS` seconds, `ratio` times faster
	 *  than they run, and `tailS` shown seconds past the drop-out. */
	cruiseShot: Object.freeze({ simS: 12, ratio: 1.5, tailS: 3 }),
	/** The dock shot: the run-in from `km` of the station's centre, `ratio`
	 *  times faster than it runs. */
	dockShot: Object.freeze({ km: 1.6, ratio: 2 }),
	/** The most steps one frame may run to cross a cut; the legs' caps keep a
	 *  real cut far below it. */
	cutStepCap: 60 * 1000,
});

/** The shots each kind shows, in order (#530 D3). */
export const OPENING_SHOTS: Readonly<
	Record<OpeningKind, readonly OpeningShot[]>
> = Object.freeze({
	guided: Object.freeze(["arrival", "flypast", "cruise", "dock"] as const),
	free: Object.freeze(["arrival", "flypast"] as const),
});

/** How fast each shot shows the sim: sim seconds per shown second. */
export const SHOT_RATIO: Readonly<Record<OpeningShot, number>> = Object.freeze({
	arrival: 1,
	flypast: 1,
	cruise: OPENING.cruiseShot.ratio,
	dock: OPENING.dockShot.ratio,
});

export interface PilotState {
	kind: OpeningKind;
	leg: OpeningLeg;
	/** Steps flown in this leg. Counted, not summed, so a leg's end does not
	 *  drift with float error. */
	legSteps: number;
}

const steps = (s: number) => Math.round(s / OPENING.dtS);

export const startPilot = (kind: OpeningKind): PilotState => ({
	kind,
	leg: "arrive",
	legSteps: 0,
});

const ended = (leg: OpeningLeg) => leg === "done" || leg === "fallback";

/**
 * The script: given the sim's facts after the last step, the orders for the
 * next one and the state that step leaves the script in. At an end leg it
 * orders nothing and the run stops stepping.
 */
export function pilotStep(
	state: PilotState,
	facts: PilotFacts,
): { state: PilotState; actions: PilotAction[] } {
	const stay = (actions: PilotAction[] = []) => ({
		state: { ...state, legSteps: state.legSteps + 1 },
		actions,
	});
	const next = (leg: OpeningLeg, actions: PilotAction[] = []) => ({
		state: { ...state, leg, legSteps: ended(leg) ? 0 : 1 },
		actions,
	});
	switch (state.leg) {
		case "arrive":
			return state.legSteps >= steps(OPENING.arriveS)
				? next("burn", ["throttle-burn"])
				: stay();
		case "burn":
			if (state.legSteps < steps(OPENING.burnS[state.kind])) return stay();
			return state.kind === "guided"
				? next("spool", ["engage-cruise"])
				: next("done", ["throttle-zero"]);
		case "spool":
			if (facts.regime === "cruise") return next("cruise");
			// Refused on the press: an engage leaves no spool-up behind it.
			if (state.legSteps === 1 && !facts.spooling) return next("fallback");
			return state.legSteps >= steps(OPENING.spoolCapS)
				? next("fallback")
				: stay();
		case "cruise":
			if (facts.regime === "normal")
				return next("approach", ["request-clearance", "engage-computer"]);
			return state.legSteps >= steps(OPENING.cruiseCapS)
				? next("fallback")
				: stay();
		case "approach":
			if (facts.dockPhase === "docked") return next("done");
			if (state.legSteps >= steps(OPENING.approachCapS))
				return next("fallback");
			// A leg that dropped out short of the station — a detour refused, a
			// tank run dry — cannot be brought in from here.
			if (facts.dockPhase === "flying" && !facts.inVicinity)
				return next("fallback");
			// The traversal is on rails into the reserved berth: skipped, as a
			// pilot's Enter skips it and as `startDockedAtHome` does.
			if (facts.dockPhase === "arriving") return stay(["skip-traversal"]);
			// A computer that dropped out is put back, asking again only when the
			// grant has lapsed — `startDockedAtHome`'s rule.
			if (facts.dockPhase === "flying" && !facts.computerEngaged)
				return stay(
					facts.grantLive
						? ["engage-computer"]
						: ["request-clearance", "engage-computer"],
				);
			return stay();
		default:
			return { state, actions: [] };
	}
}

/**
 * The director: which shot shows the sim now, or `null` for a cut. Read after
 * every step, and it orders nothing — so it cannot make a watched run differ
 * from a skipped one.
 */
export function openingShot(
	state: PilotState,
	facts: PilotFacts,
): OpeningShot | null {
	switch (state.leg) {
		case "arrive":
			return "arrival";
		case "burn":
		case "spool":
			return "flypast";
		case "cruise":
			// Dropped out already: the step before the script moves to its
			// approach leg is the shot's, not a one-step cut inside it.
			if (facts.regime === "normal") return "cruise";
			return facts.cruiseEtaS !== null &&
				facts.cruiseEtaS <= OPENING.cruiseShot.simS
				? "cruise"
				: null;
		case "approach":
			// The cruise shot holds `tailS` shown seconds past the drop-out: the
			// station only reads in the leg's last seconds, and cutting on the
			// drop-out took it away before it could be recognised (the principal's
			// second flight).
			if (
				state.legSteps <=
				steps(OPENING.cruiseShot.tailS * OPENING.cruiseShot.ratio)
			)
				return "cruise";
			return facts.runIn && facts.stationKm <= OPENING.dockShot.km
				? "dock"
				: null;
		default:
			return null;
	}
}

const outcomeOf = (state: PilotState): OpeningOutcome | null =>
	state.leg === "fallback"
		? "fallback"
		: state.leg === "done"
			? state.kind === "guided"
				? "docked"
				: "flying"
			: null;

/**
 * One opening, from the arrival to its end: the script, the director, and
 * the shown clock.
 *
 * `frame` is a watched frame, `skip` runs to the end at once, `advanceTo` is
 * #530's phase handle. All three run the same unit — the script's orders, one
 * step — so they differ only in how many units a call runs.
 */
export class OpeningRun {
	readonly kind: OpeningKind;
	pilot: PilotState;
	/** The shot on screen, or `null` for a cut or after the end. */
	shot: OpeningShot | null = "arrival";
	/** Shown seconds, in total and by shot. */
	shownS = 0;
	shownBy: Record<OpeningShot, number> = {
		arrival: 0,
		flypast: 0,
		cruise: 0,
		dock: 0,
	};
	/** Held by the phase handle: frames run no steps until `release`. */
	held = false;
	private budgetS = 0;
	private stepsRun = 0;

	constructor(kind: OpeningKind) {
		this.kind = kind;
		this.pilot = startPilot(kind);
	}

	get done(): boolean {
		return ended(this.pilot.leg);
	}

	get outcome(): OpeningOutcome | null {
		return outcomeOf(this.pilot);
	}

	/** Steps run so far: a watched run and a skipped one agree on it. */
	get steps(): number {
		return this.stepsRun;
	}

	/** One unit: the script's orders, then one step, then the director. */
	private unit(sim: OpeningSim): void {
		const facts = sim.facts();
		const { state, actions } = pilotStep(this.pilot, facts);
		this.pilot = state;
		// The step belongs to the leg the script has just put it in: the step
		// that opens the burn is the fly-past's first, not the arrival's last.
		const shownShot = openingShot(this.pilot, facts);
		for (const action of actions) sim.apply(action);
		if (this.done) {
			this.shot = null;
			return;
		}
		sim.step(OPENING.dtS);
		this.stepsRun++;
		if (shownShot !== null) {
			const shown = OPENING.dtS / SHOT_RATIO[shownShot];
			this.shownS += shown;
			this.shownBy[shownShot] += shown;
		}
		const next = openingShot(this.pilot, sim.facts());
		if (next !== this.shot) sim.shotChanged?.(next);
		this.shot = next;
	}

	/**
	 * One watched frame of `wallDt` seconds. A shot runs the steps its ratio
	 * owes this frame; a shot that changes mid-frame drops the rest, so a new
	 * shot starts on its own first frame. A cut is crossed whole, in one frame.
	 */
	frame(sim: OpeningSim, wallDt: number): void {
		if (this.done || this.held) return;
		if (this.shot === null) {
			for (let i = 0; i < OPENING.cutStepCap && !this.done; i++) {
				this.unit(sim);
				if (this.shot !== null) break;
			}
			this.budgetS = 0;
			return;
		}
		const shot = this.shot;
		this.budgetS += wallDt * SHOT_RATIO[shot];
		while (this.budgetS >= OPENING.dtS - 1e-12 && !this.done) {
			this.budgetS -= OPENING.dtS;
			this.unit(sim);
			if (this.shot !== shot) {
				this.budgetS = 0;
				return;
			}
		}
	}

	/** #530 D2: the rest of the same script, at once. */
	skip(sim: OpeningSim): void {
		this.held = false;
		while (!this.done) this.unit(sim);
	}

	/**
	 * #530's phase handle: run on to `shownS` seconds into `shot` and hold
	 * there. It only moves forward — the sim cannot be put back — and it
	 * refuses a shot this kind does not have.
	 */
	advanceTo(sim: OpeningSim, shot: OpeningShot, shownS: number): void {
		const order = OPENING_SHOTS[this.kind];
		const want = order.indexOf(shot);
		if (want < 0) throw new Error(`a ${this.kind} opening has no ${shot} shot`);
		const at = this.shot === null ? -1 : order.indexOf(this.shot);
		const passed =
			this.done ||
			order.slice(want + 1).some((later) => this.shownBy[later] > 0) ||
			(at === want && this.shownBy[shot] > shownS + 1e-9);
		if (passed)
			throw new Error(`the opening is already past ${shot} at ${shownS} s`);
		while (
			!this.done &&
			!(this.shot === shot && this.shownBy[shot] >= shownS - 1e-9)
		)
			this.unit(sim);
		if (this.done)
			throw new Error(`the opening ended before ${shot} at ${shownS} s`);
		this.held = true;
		this.budgetS = 0;
	}

	/** Give a held run back to its frames. */
	release(): void {
		this.held = false;
	}
}

/**
 * Who sees an opening, and how (#530 D3 as amended by the principal on
 * 2026-09-26, and #535's ruling on `?boot=direct`).
 *
 * A player's new game watches it, guided or free. `?boot=direct` and
 * `?system=` see no sequence, because every probe boots through them; for a
 * guided game that still means the flight — skipped, which is the same script
 * run to its end — so the probes start where a player who skips starts, and
 * for a free one it means nothing at all, at rest at the arrival point with
 * the clock at zero. `?cinematic` forces the sequence, for the strip.
 */
export function openingAtBoot(boot: {
	firstDay: OpeningKind;
	direct: boolean;
	pinnedSystem: boolean;
	cinematic: boolean;
}): { kind: OpeningKind; watched: boolean } | null {
	const watched = boot.cinematic || (!boot.direct && !boot.pinnedSystem);
	if (!watched && boot.firstDay === "free") return null;
	return { kind: boot.firstDay, watched };
}

/**
 * The line under each shot. The dock's says who flies (#530 D7): station
 * control brings a new ship in, because it has no docking computer (#408), and
 * the first day still teaches the pilot's first dock by hand.
 */
export function openingCaption(
	shot: OpeningShot | null,
	names: { system: string; station: string | null },
): string {
	switch (shot) {
		case "arrival":
			return `ARRIVING · ${names.system.toUpperCase()}`;
		case "flypast":
			return names.station ? `COURSE · ${names.station.toUpperCase()}` : "";
		case "cruise":
			return names.station ? `CRUISE · ${names.station.toUpperCase()}` : "";
		case "dock":
			return "STATION CONTROL: Cleared to berth. We are bringing you in.";
		default:
			return "";
	}
}

/**
 * Whether a loaded commander is owed the rest of its opening (the principal's
 * ruling on #535, 2026-09-26). A quit during a guided opening saves the ship
 * mid-flight — mid-cruise, or on the run-in — before the dock has written
 * `lastDocked`, and a loaded commander sees no opening. So one that is guided,
 * not docked and has never docked flies the rest of it, skipped, on load, and
 * a guided start still docks. A guided commander cannot otherwise be in flight
 * with no `lastDocked`: its first flight begins from that dock.
 */
export function openingOwedOnLoad(commander: {
	firstDay: OpeningKind;
	docked: boolean;
	hasLastDocked: boolean;
}): boolean {
	return (
		commander.firstDay === "guided" &&
		!commander.docked &&
		!commander.hasLastDocked
	);
}
