import { fittedCapacity, fittingValue, stockModuleAt } from "./loadout";
/**
 * What a death costs the pilot, past the leg it already cost (#660, built by
 * node #704): the escape pod's eject (D2), a death without one (D6), the
 * warning that says to eject while there is still time (D12), and the notice
 * the pilot wakes to.
 *
 * Which fields of the commander a death restores, and what it takes from
 * them, is `commanderAfterDeath`'s in `holdings.ts`, the one copy; the
 * journal's half is `requestsAfterLostHold` in `requests.ts`. This module
 * holds what those two do not: the cause, the threshold and its derivation,
 * and the wake.
 *
 * Pure: no Three.js, no DOM, no store.
 */

import { EJECT_HOLD_S } from "./eject";
import { HULL_IDS, type HullId } from "./hull";
import { requestsAfterLostHold, entrustedTonnesAboard } from "./requests";
import type { CommanderRecord } from "./save-envelope";
import { HULL_KILL_TOLERANCE, PULSE_LASER } from "./ship-condition";
import { commodity } from "./market";
import {
	commanderHold,
	type CommanderState,
	type RecoveredFitting,
} from "./station-commerce";
import { MAX_DT } from "./units";

/**
 * How a life ended. **`eject`** is the escape pod: the pilot launched it in
 * time, and wakes with the launch hull and fittings, what the pod kept of the
 * hold (`ejectSurvivors`) and no pod (#660 D2, #977). **`destroyed`** is every other death — no pod, or a pod never
 * launched, since the pod is manual only (D4) — and costs the ship (D6).
 */
export type DeathCause = "eject" | "destroyed";

// ---------------------------------------------------------------------------
// What an eject keeps (#977)
// ---------------------------------------------------------------------------

/** What the escape pod brings back: own cargo and carried modules. */
export interface EjectSurvivors {
	cargo: Readonly<Record<string, number>>;
	carried: readonly RecoveredFitting[];
}

/**
 * What the dying ship's best fitted pod brings back from an eject (principal,
 * 2026-10-14, on #977): `ESCAPE_POD_SURVIVAL` read through `fittedCapacity`.
 *
 * - **Own cargo only.** Entrusted lots live in Requests and are lost with the
 *   hold, so their jobs fail as before (#660 D3).
 * - Each good keeps its share, rounded down. A tonne good counts against the
 *   capsule and a kilogram or gram good does not, the hold's own rule
 *   (`heldTonnes`). Past the capsule the dearer good is kept first, by base
 *   price and then by name, so the cut is the same every time.
 * - The most valuable carried module comes too when the grade keeps one,
 *   by `fittingValue` and then by id. Fitted modules stay on the ship
 *   whatever the pod (#660 D2).
 *
 * An E pod keeps nothing: the eject as it was before #977.
 */
export function ejectSurvivors(state: CommanderState): EjectSurvivors {
	const pod = fittedCapacity(state.hull, state.loadout);
	const kept: Record<string, number> = {};
	const tonneGoods: [string, number][] = [];
	for (const [name, amount] of Object.entries(state.cargo)) {
		const share = Math.floor(amount * pod.podCargoShare);
		if (share <= 0) continue;
		if (commodity(name).unit === "t") tonneGoods.push([name, share]);
		else kept[name] = share;
	}
	tonneGoods.sort(
		([a], [b]) =>
			commodity(b).basePrice - commodity(a).basePrice || a.localeCompare(b),
	);
	let roomT = pod.podCapsuleT;
	for (const [name, share] of tonneGoods) {
		const take = Math.min(share, Math.floor(roomT));
		if (take <= 0) break;
		kept[name] = take;
		roomT -= take;
	}
	const carried = [...(state.recoveredFittings ?? [])]
		.sort(
			(a, b) => fittingValue(b) - fittingValue(a) || a.id.localeCompare(b.id),
		)
		.slice(0, pod.podCarriedModules);
	return {
		cargo: Object.fromEntries(
			Object.entries(kept).sort(([a], [b]) => a.localeCompare(b)),
		),
		carried,
	};
}

/** The dying state less what the pod brings back: what an eject leaves in
 *  the wreck's draw (`deathWreckContents`). */
export function leftByEject(state: CommanderState): CommanderState {
	const { cargo, carried } = ejectSurvivors(state);
	const left = Object.fromEntries(
		Object.entries(state.cargo).flatMap(([name, amount]) => {
			const rest = amount - (cargo[name] ?? 0);
			return rest > 0 ? [[name, rest]] : [];
		}),
	);
	const fittings = (state.recoveredFittings ?? []).filter(
		(f) => !carried.includes(f),
	);
	const { recoveredFittings: _, ...rest } = state;
	return {
		...rest,
		cargo: left,
		...(fittings.length ? { recoveredFittings: fittings } : {}),
	};
}

// ---------------------------------------------------------------------------
// The eject warning's threshold (#660 D12)
// ---------------------------------------------------------------------------

/**
 * Every weapon a hostile fires at the player, with the most **hull** damage it
 * lands in a second. Hull, not shield: the warning is about the last hits, and
 * by then a shield is down, so all of it reaches the hull.
 *
 * **One row today, and that is read off the code rather than chosen.** A
 * raider (its relay-defender call included) and a carrier returning fire both
 * fire through `stepCondition`, which fires `PULSE_LASER` and nothing else, at
 * one gun per ship — `combat-model.md` §2's one forward weapon. A hostile
 * weapon added later is a row here, added by hand, and the threshold moves
 * with it. `tests/death-cost.test.ts` checks that no hull in the roster fires
 * a harder gun through `stepCondition` than this table's strongest row; a
 * weapon fired by some other path it cannot see.
 *
 * **One weapon, not a fleet**: two hostiles firing at once land twice the
 * rate, and the warning can then come later than D12 asks. D12 is written
 * against the strongest weapon, and this is that; a fight against two is not
 * covered, and is said here rather than discovered.
 */
export const HOSTILE_WEAPONS: readonly {
	readonly name: string;
	readonly hullDamagePerS: number;
}[] = [{ name: "Pulse Laser", hullDamagePerS: PULSE_LASER.damagePerS }];

/**
 * A pilot's reaction to the warning, s: #660 D12's "about one second", from
 * the sentence appearing to the hand on the key.
 */
export const EJECT_REACTION_S = 1;

/**
 * The time the warning has to buy, s: the reaction, then the hold itself — a
 * pilot cannot eject faster than `EJECT_HOLD_S` (node #703) — and **two**
 * longest frames, `MAX_DT`, because the game reads the line and lands the
 * hits in a fixed order. `step` runs the eject first and the guns after it,
 * so the hit that crosses the line is read on the next frame (one frame
 * late), and the hold ends on a frame boundary, where the eject goes before
 * that frame's hits but a press made between frames waits for the next one
 * (up to one more). `tests/death-cost.test.ts` flies that order at three
 * frame times and every press alignment.
 */
export const EJECT_WARNING_WINDOW_S =
	EJECT_REACTION_S + EJECT_HOLD_S + 2 * MAX_DT;

/**
 * Below this hull, in points, a pilot with a pod is told to eject (#660 D12).
 *
 * **Derived, not chosen**: the strongest hostile weapon's hull damage over
 * `EJECT_WARNING_WINDOW_S`, so a pilot who reacts in about a second and holds
 * the key the whole hold is out before that weapon can finish the hull — plus
 * the half point `HULL_KILL_TOLERANCE` rounds to nothing, because a hull that
 * low is already dead (#367 D1) and the gun does not have to spend it. Points
 * rather than a share of the hull, once for the whole roster (`economy-trade.md`
 * §9): what kills is the rate of the gun, which does not care how big the
 * hull is, and a share would warn a capital's pilot minutes early and a light
 * hull's too late.
 */
export const EJECT_WARNING_HULL =
	Math.max(...HOSTILE_WEAPONS.map((w) => w.hullDamagePerS)) *
		EJECT_WARNING_WINDOW_S +
	HULL_KILL_TOLERANCE;

/** Whether the warning stands this frame: a pod fitted, a live ship in
 *  flight off the rails — where an eject is not refused (D5) — and the hull
 *  below the line. No pod, no warning (D12).
 *
 *  **Never for a permadeath commander**: the store restores nothing for them
 *  (#89 D7), so an eject ends their save as any death does, and a sentence
 *  urging it would promise them a ship the pod does not keep
 *  (`economy-trade.md` §9). */
export const ejectWarningDue = (facts: {
	readonly podFitted: boolean;
	readonly permadeath: boolean;
	readonly flying: boolean;
	readonly alive: boolean;
	readonly hull: number;
}): boolean =>
	facts.podFitted &&
	!facts.permadeath &&
	facts.flying &&
	facts.alive &&
	facts.hull < EJECT_WARNING_HULL;

/**
 * One frame of the warning: whether to speak. The sentence on the glass stands
 * for as long as the warning is due; the voice line is said **once** each time
 * it becomes due, and is said again only after the warning has lapsed — a
 * repaired hull, a dock, a pod sold — and come back.
 */
export function stepEjectWarning(
	spoken: boolean,
	due: boolean,
): { spoken: boolean; speak: boolean } {
	if (!due) return { spoken: false, speak: false };
	return { spoken: true, speak: !spoken };
}

/** The warning's sentence on the glass, naming the control as bound
 *  (`ejectPrompt` in `key-names.ts`: "hold Backspace to eject"). */
export const ejectWarningText = (prompt: string): string =>
	`HULL FAILING · ${prompt.toUpperCase()}`;

// ---------------------------------------------------------------------------
// The wake (what the death took)
// ---------------------------------------------------------------------------

/**
 * What a death took, carried across the reload for the notice the pilot wakes
 * to. Written by `SaveStore.revertToLastDocked` after the restored `live`
 * record, and taken once by the next boot (`CommanderCatalog.takeWake`), for
 * the Commander it names.
 *
 * Counts, not lists: the notice says how much went, and the Requests board
 * already says which jobs failed and why.
 */
export interface DeathWake {
	saveSlot: string;
	cause: DeathCause;
	/** The hull flown at the launch: kept by an eject, lost otherwise. */
	hull: HullId;
	/** Tonnes aboard at the launch, the pilot's own and entrusted. */
	holdT: number;
	/** Fittings beyond the hull stock fit lost; the pod after an eject. */
	fittingsLost: number;
	/** Jobs that failed with the hold (#660 D3). */
	failedJobs: number;
	/** What the pod brought back of the hold, as printed ("10 t Food", a
	 *  carried module's name); absent when it kept nothing (#977). */
	kept?: readonly string[];
	/** A pilot who had never docked, woken as a new commander at the start
	 *  system's trade station (#660 D10): there was no launch to go back to,
	 *  so what was lost is read off the dying commander instead. */
	firstLife: boolean;
}

/**
 * The wake for a death, read off the commander whose loss it reports: the
 * launch record a death restores from — what it takes is what that record
 * held — or, for a pilot who never docked (`firstLife`), the dying commander,
 * since the checkpoint that pilot wakes to is a new one and held nothing.
 */
export function deathWake(
	saveSlot: string,
	lost: CommanderRecord,
	cause: DeathCause,
	firstLife: boolean,
	survivors?: EjectSurvivors,
): DeathWake {
	const kept = survivors ? keptLines(survivors) : [];
	const entrustedT = entrustedTonnesAboard(lost.requests);
	// The notice already counts the hull. Its stock plant and primary pulse
	// are part of that baseline, while upgraded modules and extra slots count.
	const fittingsLost = Object.entries(lost.state.loadout).filter(
		([slot, module]) => !stockModuleAt(lost.state.hull, slot, module),
	).length;
	return {
		saveSlot,
		cause,
		hull: lost.state.hull,
		holdT: commanderHold(lost.state, entrustedT).usedT,
		fittingsLost: cause === "eject" ? 1 : fittingsLost,
		failedJobs: requestsAfterLostHold(lost.requests).failed.length,
		firstLife,
		...(kept.length ? { kept } : {}),
	};
}

/** The pod's survivors as the wake prints them: goods first, by name, then
 *  the carried modules. */
const keptLines = (s: EjectSurvivors): string[] => [
	...Object.entries(s.cargo).map(
		([name, amount]) => `${amount} ${commodity(name).unit} ${name}`,
	),
	...s.carried.map((f) => f.id),
];

const listed = (items: readonly string[]): string =>
	items.length < 2
		? (items[0] ?? "")
		: `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const count = (v: unknown): v is number =>
	typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * A stored wake, or `null` for anything this build cannot read. Never a
 * throw: the wake is a courtesy on top of a save that already loaded, and a
 * bad one is dropped rather than allowed to stop a boot.
 */
export function parseDeathWake(raw: unknown): DeathWake | null {
	if (typeof raw !== "object" || raw === null) return null;
	const o = raw as Record<string, unknown>;
	if (
		typeof o.saveSlot !== "string" ||
		(o.cause !== "eject" && o.cause !== "destroyed") ||
		typeof o.hull !== "string" ||
		!(HULL_IDS as readonly string[]).includes(o.hull) ||
		typeof o.holdT !== "number" ||
		!Number.isFinite(o.holdT) ||
		o.holdT < 0 ||
		!count(o.fittingsLost) ||
		!count(o.failedJobs) ||
		typeof o.firstLife !== "boolean" ||
		(o.kept !== undefined &&
			!(
				Array.isArray(o.kept) &&
				o.kept.length > 0 &&
				o.kept.every((k) => typeof k === "string")
			))
	)
		return null;
	return {
		saveSlot: o.saveSlot,
		cause: o.cause,
		hull: o.hull as HullId,
		holdT: o.holdT,
		fittingsLost: o.fittingsLost,
		failedJobs: o.failedJobs,
		firstLife: o.firstLife,
		...(o.kept !== undefined ? { kept: o.kept as string[] } : {}),
	};
}

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

/**
 * The notice the pilot wakes to: how the life ended, what went, and what is
 * left — said once, on the docked console's message line. What survives is
 * named as plainly as what was lost, because "you are back" with no word of
 * the ship reads as a free death, which #660 exists to end.
 */
export function wakeText(wake: DeathWake): string {
	const hold =
		wake.holdT > 0 ? `the hold (${Math.round(wake.holdT)} t)` : "an empty hold";
	const jobs =
		wake.failedJobs > 0
			? ` ${plural(wake.failedJobs, "job", "jobs")} failed with it: see Requests.`
			: "";
	if (wake.cause === "eject") {
		const kept = wake.kept?.length;
		const with_ = kept ? `, with ${listed(wake.kept ?? [])}` : "";
		const lost = kept ? "the rest of the hold" : hold;
		return `Your escape pod brought you back where you launched${with_}. Lost: ${lost} and the pod. Your ${wake.hull} and its fittings are kept.${jobs}`;
	}
	const fittings =
		wake.fittingsLost > 0
			? `, ${plural(wake.fittingsLost, "fitting", "fittings")}`
			: "";
	const lost = `Lost: your ${wake.hull}${fittings} and ${hold}.${jobs}`;
	if (wake.firstLife)
		return `Your ship was destroyed before you ever docked. You wake as a new commander at the start system's trade station. ${lost}`;
	return `Your ship was destroyed. You are back where you launched, in a stock courier with a full tank and your credits. ${lost}`;
}
