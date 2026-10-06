/**
 * The eject input: the held control that launches the escape pod, and where it
 * is refused (node #703, on #660's D4 and D5).
 *
 * #660 D4 makes the pod **manual only**, as in Elite: a pilot destroyed before
 * ejecting has a no-pod death whether a pod is fitted or not. So the control
 * is a binding like any other — `fly.eject` in `commands.ts` — and what an
 * eject *costs* is not here: that is D2 and D6, built by node #704 behind the
 * event this module produces.
 *
 * **Held, not pressed, and that is the confirm.** An accidental eject costs the
 * leg, the hold and the pod, so a stray press must not be able to cause one. A
 * double press was the other candidate and is the worse of the two: it shows
 * nothing between the presses, so a pilot cannot tell an armed control from a
 * dead one, and two quick taps are what a pilot fumbling for another key
 * produces. A hold shows its own progress on the glass for every frame it is
 * down (`ejectArmingText`), and letting go is the cancel. Where there is no
 * glass to show it on — the head turned to a side console — the control is
 * idle rather than armed unseen (`stepEject` in `main.ts`).
 *
 * **A refusal needs no hold.** It is said on the first frame the control is
 * down, because a key that sometimes does nothing is indistinguishable from a
 * key that is not bound (the rule `chargeJump` states for the jump). And a hold
 * that began refused stays spent until it is let go: the state clearing under
 * a held key — a launch completing — must not eject a pilot who was being told
 * no a moment ago.
 *
 * Headless and on the list in `tests/headless.test.ts`.
 */
import type { DockPhase } from "./dock-session";

/**
 * How long the control is held before the pod goes, s.
 *
 * **A feel figure, not a derived one**, and the principal's to move. Long
 * enough that a tap — a key brushed on the way to another, a button knocked —
 * is nowhere near it; short enough that it is not most of the reaction a pilot
 * has left. #660 D12's warning threshold is derived from about one second of
 * reaction, and the hold is **inside** that second rather than beside it: the
 * warning's build (node #704) adds this figure to its reaction budget, which
 * is why it is exported rather than written there again.
 */
export const EJECT_HOLD_S = 0.75;

/** Why an eject is refused. */
export type EjectRefusal = "docked" | "arriving" | "launching" | "no-pod";

/**
 * #660 D5 by dock phase: the pilot may eject at any time in flight, not docked,
 * and not on the rails of an arrival or a launch.
 *
 * A record over `DockPhase` rather than a chain of comparisons, so a phase
 * added to the union is a compile error here instead of a phase the eject
 * quietly allows.
 */
export const EJECT_PHASE_REFUSAL: Readonly<
	Record<DockPhase, EjectRefusal | null>
> = {
	flying: null,
	arriving: "arriving",
	docked: "docked",
	launching: "launching",
};

/**
 * Whether an eject is refused now, and why.
 *
 * **The phase first, the pod second.** A docked pilot without a pod is told
 * they are docked: that is the refusal that holds whatever they buy.
 *
 * `no-pod` is not one of D5's three. It is here because the event this module
 * produces means "the pod goes", and with no pod there is nothing to send —
 * an event the cost's build would then have to refuse a second time, after
 * the glass had already shown the hold completing.
 */
export function ejectRefusal(facts: {
	readonly phase: DockPhase;
	readonly podFitted: boolean;
}): EjectRefusal | null {
	const byPhase = EJECT_PHASE_REFUSAL[facts.phase];
	if (byPhase !== null) return byPhase;
	return facts.podFitted ? null : "no-pod";
}

/** The control's progress through one hold. */
export interface EjectHold {
	/** How long this hold has been down and arming, s. */
	readonly heldS: number;
	/** This hold has already fired or been refused, and does nothing more
	 *  until it is let go. */
	readonly spent: boolean;
}

export const EJECT_IDLE: EjectHold = { heldS: 0, spent: false };

export type EjectEvent =
	| { readonly kind: "eject" }
	| { readonly kind: "refused"; readonly refusal: EjectRefusal };

/**
 * One frame of the control.
 *
 * - Let go: back to idle, whatever happened during the hold.
 * - Down while refused: the refusal, once, and the hold is spent.
 * - Down and allowed: the hold accrues `dtS`, and the eject fires on the frame
 *   it reaches `EJECT_HOLD_S` — once, because the hold is then spent.
 */
export function stepEjectHold(
	hold: EjectHold,
	held: boolean,
	dtS: number,
	refusal: EjectRefusal | null,
): { hold: EjectHold; event: EjectEvent | null } {
	if (!held) return { hold: EJECT_IDLE, event: null };
	if (hold.spent) return { hold, event: null };
	if (refusal !== null)
		return {
			hold: { heldS: 0, spent: true },
			event: { kind: "refused", refusal },
		};
	const heldS = hold.heldS + dtS;
	if (heldS >= EJECT_HOLD_S)
		return { hold: { heldS, spent: true }, event: { kind: "eject" } };
	return { hold: { heldS, spent: false }, event: null };
}

/** The share of the hold done, 0..1, or `null` when the control is not arming. */
export function ejectArming(hold: EjectHold): number | null {
	if (hold.spent || hold.heldS <= 0) return null;
	return Math.min(1, hold.heldS / EJECT_HOLD_S);
}

/** How many cells the arming bar has. */
const ARMING_CELLS = 5;

/**
 * The glass line while the control is down and arming: what is happening and
 * how far it has got, so the hold is never a dead key for its duration.
 */
export function ejectArmingText(share: number): string {
	const done = Math.min(ARMING_CELLS, Math.floor(share * ARMING_CELLS));
	return `HOLD TO EJECT  ${"■".repeat(done)}${"□".repeat(ARMING_CELLS - done)}`;
}

/**
 * A refusal on the flight glass. Upper case and two words wide, like the
 * scoop's and the charge's, and red on `hud-and-scanner.md` §4's grammar.
 */
export const EJECT_REFUSED_TEXT: Readonly<Record<EjectRefusal, string>> = {
	docked: "CANNOT EJECT  DOCKED",
	arriving: "CANNOT EJECT  ON THE ARRIVAL",
	launching: "CANNOT EJECT  ON THE LAUNCH",
	"no-pod": "CANNOT EJECT  NO ESCAPE POD",
};

/**
 * The docked refusal on the station console, which is the glass a docked
 * cockpit has (`flightGlassShown`): the forward console fills the canopy, and
 * its message line is where the till already says no.
 */
export const EJECT_DOCKED_SENTENCE = "You cannot eject while docked.";

/** How long a refusal stands on the glass, s — the scoop's figure. */
export const EJECT_REFUSED_S = 2.4;
