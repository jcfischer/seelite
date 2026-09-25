/**
 * A new pilot's first useful day (#408, `docs/specs/first-useful-day.md`).
 *
 * Only the choice is saved. Which step the pilot is on is derived from state
 * every time it is asked, so there is no progress record to fall out of step
 * with the journal it describes.
 *
 * Pure: the caller reads the facts off the game and passes the keys as bound,
 * so every sentence here can be tested headless and follows a rebind.
 */

import type { CarrierKey } from "./carrier-key";

/** New game's choice (D4): guided pilots are pushed the next step, free
 *  pilots are not. Every commander can read the First day tab (D5). */
export type FirstDayChoice = "guided" | "free";

export const FIRST_DAY_CHOICES: readonly FirstDayChoice[] = ["guided", "free"];

export const isFirstDayChoice = (value: unknown): value is FirstDayChoice =>
	(FIRST_DAY_CHOICES as readonly unknown[]).includes(value);

export type FirstDayStepId =
	| "find-station"
	| "take-work"
	| "launch"
	| "fly"
	| "report"
	| "trade";

/** The day in order, as the tab lists it. `find-station` leads because a pilot
 *  in flight with no work — a free start, or a reload — docks before anything
 *  else can happen. */
export const FIRST_DAY_STEPS: readonly { id: FirstDayStepId; title: string }[] =
	[
		{ id: "find-station", title: "Dock at a station" },
		{ id: "take-work", title: "Take work" },
		{ id: "launch", title: "Launch" },
		{ id: "fly", title: "Fly the job" },
		{ id: "report", title: "Report and get paid" },
		{ id: "trade", title: "Trade, or take more work" },
	];

/** The job the day is about: the tracked running request, else the first. */
export interface FirstDayJob {
	reportAt: CarrierKey;
	reportName: string;
	reportSystemName: string;
	/** The delivery station is in the system the pilot is in. */
	sameSystem: boolean;
}

/** What the step is derived from — all of it read off live state. */
export interface FirstDayFacts {
	/** Parked in a berth: `dockPhase === "docked"`, not arriving or launching. */
	docked: boolean;
	/** The station the ship is at, docked or on rails; `null` in flight. */
	dockedAt: CarrierKey | null;
	running: FirstDayJob | null;
	/** The journal holds a completed request — the one fact that ends the day. */
	settledAny: boolean;
	/** The board at the station the ship is docked at posts a Local run. */
	localRunOnBoard: boolean;
	/** The ship carries a docking computer. A new ship has none: it is bought
	 *  (#408), so a new pilot is told to fly in, not which key docks. */
	computerFitted: boolean;
}

/** The keys as bound, as the prompt line names them. */
export interface FirstDayKeys {
	launch: string;
	clearance: string;
	computer: string;
	cruise: string;
	/** Head-look to the port console, where the Navigation list selects a
	 *  station by name. Named rather than the next-target key, which cycles
	 *  through every contact in the system. */
	navigation: string;
}

/**
 * Which step the pilot is on.
 *
 * **Ordered, and the order is the rule.** A reported job ends the day before
 * anything else is asked: after a report the pilot is docked with nothing
 * running, which is also `take-work`'s condition, and the day would otherwise
 * start again. A job running outranks being docked, because docked with a job
 * is `launch` or `report` and never `take-work`.
 */
export function firstDayStep(facts: FirstDayFacts): FirstDayStepId {
	if (facts.settledAny) return "trade";
	if (facts.running) {
		if (facts.docked && facts.dockedAt === facts.running.reportAt)
			return "report";
		return facts.docked ? "launch" : "fly";
	}
	return facts.docked ? "take-work" : "find-station";
}

/** Where a delivery is, in words: the station, and its system when that is
 *  not this one. */
const whereTo = (job: FirstDayJob): string =>
	job.sameSystem
		? job.reportName
		: `${job.reportName} in the ${job.reportSystemName} system`;

/** How the pilot gets from a cleared approach into the berth. */
const dockTail = (facts: FirstDayFacts, keys: FirstDayKeys): string =>
	facts.computerFitted
		? `then ask for clearance with ${keys.clearance} and dock with ${keys.computer}.`
		: `then ask for clearance with ${keys.clearance}, line up with the opening and fly in slowly.`;

/**
 * The step in one or two plain sentences, for the tab and for station
 * control's line on the console.
 */
export function firstDayText(facts: FirstDayFacts, keys: FirstDayKeys): string {
	const step = firstDayStep(facts);
	const job = facts.running;
	switch (step) {
		case "find-station":
			return `Select a station on the Navigation console (${keys.navigation}), cruise to it with ${keys.cruise}, ${dockTail(facts, keys)}`;
		case "take-work":
			return facts.localRunOnBoard
				? "Open the Requests tab on the station console and accept the Local run. It is a short delivery inside this system."
				: "Open the Requests tab on the station console and accept a job you can fly.";
		case "launch":
			return `You have the job. Press ${keys.launch} to launch.`;
		case "fly":
			if (!job) return "";
			return job.sameSystem
				? `Fly to ${whereTo(job)}: select it on the Navigation console (${keys.navigation}), cruise with ${keys.cruise}, ${dockTail(facts, keys)}`
				: `Fly to ${whereTo(job)}: set a course on the Galaxy Map and jump, then find the station and dock.`;
		case "report":
			return "You are at the delivery station. Open the Requests tab and report the job to get paid.";
		case "trade":
			return "Your first job is paid. The Market tab buys and sells, and the Requests tab has more work. The rest is up to you.";
	}
}

/** What the prompt line needs to know about the selected target. `null` when
 *  nothing is selected. */
export interface FirstDayTarget {
	/** The selected station's key, or `null` when the target is not a
	 *  station. */
	key: CarrierKey | null;
	/** Close enough that clearance answers (`docking.ts`'s `VICINITY_KM`). */
	inVicinity: boolean;
	grantLive: boolean;
	computerEngaged: boolean;
}

/**
 * The glass's line for a guided pilot in flight, or `""` to leave the line to
 * the cruise prompt beneath it.
 *
 * It speaks only where the ordinary prompt cannot know what the day is for:
 * which station to select, and — near one — the two keys that dock. A far
 * selected station is left to "press J to cruise", which already says it.
 */
export function firstDayPrompt(
	facts: FirstDayFacts,
	target: FirstDayTarget | null,
	keys: FirstDayKeys,
): string {
	const step = firstDayStep(facts);
	if (step !== "fly" && step !== "find-station") return "";
	const job = facts.running;
	if (step === "fly" && job) {
		if (!job.sameSystem)
			return `deliver to ${whereTo(job)} · set a course on the Galaxy Map`;
		if (target?.key !== job.reportAt)
			return `deliver to ${job.reportName} · select it on the Navigation console (${keys.navigation})`;
	} else if (target?.key === null || target === null) return "";
	if (!target.inVicinity || target.computerEngaged) return "";
	if (!target.grantLive) return `press ${keys.clearance} for clearance`;
	return facts.computerFitted
		? // No "cleared": the docking director prints CLEARED on the line above.
			`press ${keys.computer} to dock`
		: "line up with the opening and fly in slowly";
}
