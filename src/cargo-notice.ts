/**
 * What the cockpit says when a canister is scooped, and for how long (#324).
 *
 * **A scoop had no acknowledgement a pilot could see.** `Game.lastExit` has
 * carried the words since the drop shipped — `scooped 1 t Liquor/Wines` — but
 * every `lastExit` goes to `#hud`, which `index.html` gives `width: 1px;
 * height: 1px; clip: rect(0 0 0 0)`. It is a probe-readable element, not a
 * display. So the sixth playtest read a scoop as the canister simply vanishing
 * from the glass and from the target list, which is also what a canister
 * expiring looks like, and what flying past one looks like.
 *
 * The words are here rather than in `main.ts` so the arithmetic tier can hold
 * them: what the glass does with them is the browser tier's to prove.
 */
import type { Cue } from "./audio-cue";

/** How long the notice stands on the glass. Long enough to read after the
 *  approach that earned it, short enough that three scoops in a row read as
 *  three events rather than one wall of text. */
export const SCOOP_NOTICE_S = 2.4;

/** One scoop attempt, as both lines below and the call site describe it. */
export interface ScoopEvent {
	unit?: "t" | "kg" | "g";
	commodity: string;
	tonnes: number;
	accepted: boolean;
	/** Tonnes left in the canister after a partial take (civilian-combat H11). */
	leftT?: number;
	freeT?: number;
	/** A wreck fitting must be recovered whole; its refusal names the room
	 * and the item rather than presenting it as a divisible good. */
	refusal?: string | null;
}

/**
 * The line for one scoop attempt. A refusal is not a failure to say something:
 * a full hold leaves the canister in space, and a pilot who is not told that
 * watches it sit there and reads the scoop as broken.
 */
export function scoopNotice(input: ScoopEvent): string {
	if (input.refusal) return input.refusal.toUpperCase();
	const good = input.commodity.toUpperCase();
	if (!input.accepted)
		return `HOLD FULL${input.freeT === undefined ? "" : "  " + input.freeT + " t FREE"}  ${good} LEFT IN SPACE`;
	const left = input.leftT ? `  ${input.leftT} ${input.unit ?? "t"} LEFT` : "";
	return `SCOOPED  ${input.tonnes} ${input.unit ?? "t"} ${good}${left}`;
}

/**
 * The same event in the exit line's voice, for `#hud` and anything reading it.
 *
 * Here beside the notice rather than inline at the call site (sage #355): this
 * module exists so the arithmetic tier holds the words, and half of them
 * staying in `main.ts` would have left the tier holding half a claim.
 */
export function scoopExit(input: ScoopEvent): string {
	if (!input.accepted) return "hold full: canister left in space";
	const left = input.leftT
		? `, ${input.leftT} ${input.unit ?? "t"} left in the canister`
		: "";
	return `scooped ${input.tonnes} ${input.unit ?? "t"} ${input.commodity}${left}`;
}

/** The notice on the glass: its words, how long it stands, whether it is a
 *  take, and the canister it is about. */
export interface ScoopNotice {
	text: string;
	left: number;
	accepted: boolean;
	canisterId: string | null;
}

/**
 * The notice after one scoop attempt, and the sound it earns.
 *
 * **Only a refusal can repeat**: `scoops` holds while the ship sits beside a
 * canister, so a refused one is tried every frame. So a refusal re-arms the
 * notice but sounds only when no refusal was already standing — comparing the
 * words instead let two canisters of different goods beside a full hold
 * alternate the text and restart the tone every frame (sage #355). An accepted
 * scoop always sounds: gating it silenced the second of two scoops of one good
 * inside the notice's life.
 *
 * **A partial take is not overwritten by its own remainder** (sage #368). It
 * fills the hold and leaves the rest in the canister, so the very next frame
 * refuses that canister; that refusal replaced "SCOOPED 5 t FOOD" before a
 * pilot could read it, and played the alert straight after the scoop tone. A
 * refusal of the canister a standing take is about leaves the take standing.
 */
export function nextScoopNotice(
	standing: ScoopNotice,
	event: ScoopEvent & { canisterId: string },
): {
	notice: ScoopNotice;
	cue: Extract<Cue, { kind: "scoop" } | { kind: "alert" }> | null;
} {
	const live = standing.left > 0;
	if (
		!event.accepted &&
		live &&
		standing.accepted &&
		standing.canisterId === event.canisterId
	)
		return { notice: standing, cue: null };
	const notice: ScoopNotice = {
		text: scoopNotice(event),
		left: SCOOP_NOTICE_S,
		accepted: event.accepted,
		canisterId: event.canisterId,
	};
	if (event.accepted) return { notice, cue: { kind: "scoop" } };
	return {
		notice,
		cue: live && !standing.accepted ? null : { kind: "alert" },
	};
}
