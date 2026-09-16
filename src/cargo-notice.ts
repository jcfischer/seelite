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

/** How long the notice stands on the glass. Long enough to read after the
 *  approach that earned it, short enough that three scoops in a row read as
 *  three events rather than one wall of text. */
export const SCOOP_NOTICE_S = 2.4;

/**
 * The line for one scoop attempt. A refusal is not a failure to say something:
 * a full hold leaves the canister in space, and a pilot who is not told that
 * watches it sit there and reads the scoop as broken.
 */
export function scoopNotice(input: {
	commodity: string;
	tonnes: number;
	accepted: boolean;
}): string {
	const good = input.commodity.toUpperCase();
	return input.accepted
		? `SCOOPED  ${input.tonnes} t ${good}`
		: `HOLD FULL  ${good} LEFT IN SPACE`;
}
