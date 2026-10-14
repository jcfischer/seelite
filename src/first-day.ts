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
import type { FittedCapacity } from "./hull";

export {
	FIRST_DAY_CHOICES,
	type FirstDayChoice,
	isFirstDayChoice,
} from "./first-day-choice";

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
	/** The journal holds a request reported and paid (`status: "completed"`) —
	 *  the one fact that ends the day. */
	settledAny: boolean;
	/** The board at the station the ship is docked at posts a Local run. */
	localRunOnBoard: boolean;
	/** The ship carries a docking computer. A new ship has none: it is bought
	 *  (#408), so a new pilot is told to fly in, not which key docks. */
	computerFitted: boolean;
}

/** The keys as bound, as the prompt line names them. */
export interface FirstDayKeys {
	/** Head-look to the starboard console, where LAUNCH is. Named rather than
	 *  the launch key: on the docked console that key acts on whatever control
	 *  has focus, and in playtest it tracked the job instead of launching. */
	starboard: string;
	clearance: string;
	computer: string;
	cruise: string;
	/** Head-look to the port console, where the Navigation list selects a
	 *  station by name. Named rather than the next-target key, which cycles
	 *  through every contact in the system. */
	navigation: string;
	/** Head-look back to the forward view, which the glass and the flight
	 *  controls answer to. */
	forward: string;
	/** Turn the nose toward the selected target (playtest, 2026-09-25: the
	 *  step between selecting a station and cruising to it). */
	face: string;
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

/** From a selected target to cruising toward it. */
const flyTail = (keys: FirstDayKeys): string =>
	`press ${keys.forward} to face forward, ${keys.face} to turn toward it and ${keys.cruise} to cruise`;

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
			return `Select a station on the Navigation console (${keys.navigation}), ${flyTail(keys)}, ${dockTail(facts, keys)}`;
		case "take-work":
			return facts.localRunOnBoard
				? "Open the Requests tab on the station console and accept the Local run. It is a short delivery inside this system."
				: "Open the Requests tab on the station console and accept a job you can fly.";
		case "launch":
			return `You have the job. Press ${keys.starboard} to turn to the right console, and select LAUNCH on its Flight tab.`;
		case "fly":
			if (!job) return "";
			return job.sameSystem
				? `Fly to ${whereTo(job)}: select it on the Navigation console (${keys.navigation}), ${flyTail(keys)}, ${dockTail(facts, keys)}`
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
	/** What the pilot calls it. */
	name: string;
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
 * which station to select, how to turn toward it and cruise, and — near one —
 * how to dock.
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
	if (!target.inVicinity)
		return `press ${keys.face} to face ${target.name}, then ${keys.cruise} to cruise`;
	if (target.computerEngaged) return "";
	if (!target.grantLive) return `press ${keys.clearance} for clearance`;
	return facts.computerFitted
		? // No "cleared": the docking director prints CLEARED on the line above.
			`press ${keys.computer} to dock`
		: "line up with the opening and fly in slowly";
}

/** A station is selected: what to press to go to it (playtest, 2026-09-25). */
const selectedLine = (name: string, keys: FirstDayKeys): string =>
	`${name} is selected. Press ${keys.forward} to face forward, ${keys.face} to turn toward it, then ${keys.cruise} to cruise.`;

/**
 * Station control's line on the port console, or `null` (#408 D3).
 *
 * The pilot selects a station there with the head turned, where the glass is
 * not drawn — so what to press next has to be said on the console itself
 * (playtest, 2026-09-25): select the station, then face forward, turn toward
 * it and cruise.
 */
export function firstDayConsoleLine(
	facts: FirstDayFacts,
	target: FirstDayTarget | null,
	keys: FirstDayKeys,
): string | null {
	const step = firstDayStep(facts);
	if (step !== "fly" && step !== "find-station") return null;
	const job = facts.running;
	if (step === "fly" && job) {
		if (!job.sameSystem)
			return `Deliver to ${whereTo(job)}: set a course on the Galaxy Map tab and jump.`;
		if (target?.key !== job.reportAt)
			return `Select ${job.reportName} on the Navigation list.`;
		return selectedLine(job.reportName, keys);
	}
	if (!target?.key) return "Select a station on the Navigation list.";
	return selectedLine(target.name, keys);
}

/**
 * Whether station control logs a line for this step (#408 D3).
 *
 * On a change of step, except the one change a session did not make: a
 * session that **opens** on a finished day (`prev` is `null` — nothing has been
 * logged yet this session — and the step is `trade`) says nothing, or a
 * finished guided commander would hear the closing line on every reload,
 * forever. The day cannot leave `trade`, so nothing after it is logged either.
 */
export function firstDayLogsStep(
	prev: FirstDayStepId | null,
	current: FirstDayStepId,
): boolean {
	if (current === prev) return false;
	return !(prev === null && current === "trade");
}

/**
 * The First day tab's escape-pod row (#660 D9, node #704), or `null` while no
 * pod is fitted. No new pilot is exempt and none is given a pod, so the day
 * teaches the eject key **at the first pod purchase** — the moment the key
 * starts to mean something — and keeps it there while the pod is aboard.
 * Every commander has the tab, guided or free.
 *
 * `prompt` is `ejectPrompt` (`key-names.ts`): the control as bound, so a
 * rebound key is the one taught.
 *
 * A permadeath commander is told the truth instead: an eject ends their save
 * as any death does (#89 D7), so the row names the key with what it costs
 * them — the promise that the ship is kept is not theirs (`economy-trade.md` §9).
 *
 * `pod` is the fitted pod's survival figures (`fittedCapacity`, #977): a
 * pod that keeps cargo says how much, and an E pod keeps the sentence it had.
 */
export function firstDayEjectLine(
	podFitted: boolean,
	permadeath: boolean,
	prompt: string,
	pod?: Pick<
		FittedCapacity,
		"podCargoShare" | "podCapsuleT" | "podCarriedModules"
	>,
): string | null {
	if (!podFitted) return null;
	if (permadeath)
		return `An escape pod is fitted, but this commander has one life: ${prompt}, and the eject ends the save as any death does.`;
	if (pod && pod.podCargoShare > 0) {
		const module =
			pod.podCarriedModules > 0
				? ", and your most valuable carried module"
				: "";
		return `An escape pod is fitted. When the hull is failing, ${prompt}: the pod brings back ${Math.round(pod.podCargoShare * 100)}% of your own cargo, up to ${pod.podCapsuleT} t${module}. You lose the rest of the hold and the pod, and keep the ship. Destroyed without ejecting, you lose the ship.`;
	}
	return `An escape pod is fitted. When the hull is failing, ${prompt}: you lose the hold and the pod and keep the ship. Destroyed without ejecting, you lose the ship.`;
}
