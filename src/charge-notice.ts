/**
 * What the cockpit says when the sustained-fire clock crosses, and for how long
 * (#457, on #447's ruling).
 *
 * **A charge had no voice a pilot could hear.** `civilian-combat.md` H4's third
 * rung is charged at `ASSAULT_FIRE_S` of landed fire, and until this module the
 * only thing written at that frame was `Game.lastExit` — which goes to `#hud`,
 * an element `index.html` clips to `1 px x 1 px`. `cargo-notice.ts:4-8` already
 * says out loud, for the scoop, that this is a probe-readable element and not a
 * display. The principal flew the rung blind and read the charge as `Standing:
 * Wanted`, which a single hull strike produces too; #447 ruled that a charge is
 * not paid until the pilot can tell they were charged.
 *
 * The words are here rather than in `main.ts` so the arithmetic tier can hold
 * them — the shape `cargo-notice.ts` set, and the shape a line inline at the
 * call site was let drift out of.
 *
 * **No figure, deliberately.** The pilot is told the act and who it was done
 * to, and not the heat it cost: `distress.ts`'s hail is held to the same rule
 * by `tests/distress.test.ts`, and a console that quotes a number invites a
 * pilot to fly the arithmetic instead of the fiction.
 */

/**
 * How long the charge notice stands on the glass, s.
 *
 * Longer than the scoop's 2.4 s (`cargo-notice.ts`) because this is the one
 * thing the pilot is told at that moment and it is the sentence #447 was opened
 * over — a scoop is also answered by the hold filling and the canister going,
 * and a charge is answered by nothing else on the glass. Short enough that it
 * is gone well before the divert it may lead to, so the two read as two events.
 */
export const CHARGE_NOTICE_S = 3.6;

/**
 * How long a standing notice may not be pushed off the glass, s.
 *
 * The charge is latched one per carrier per incident, so a second one is
 * another carrier — rare, and possible with a turret held across two of them.
 * A newer charge that replaced the line immediately would leave the pilot
 * charged twice and told once; one that never replaced it would do the same.
 * So the first line is guaranteed its read and the second takes the glass
 * after it, and the Communications log holds both either way.
 */
export const CHARGE_READ_S = 1.2;

/** One sustained-fire charge, as the glass and the log both need it. */
export interface ChargeEvent {
	/** The carrier the fire was held on: who the act was done to. */
	callsign: string;
}

/** The notice on the glass: its words, and what is left of its time. */
export interface ChargeNotice {
	text: string;
	left: number;
}

/**
 * The line on the glass. Upper case and two words wide, like the scoop's, and
 * in the law's voice rather than the victim's: the hail is the carrier speaking
 * (`distress.ts`), and this is what the pilot has been booked for.
 */
export const chargeNotice = (event: ChargeEvent): string =>
	`CHARGED  SUSTAINED FIRE ON ${event.callsign.toUpperCase()}`;

/**
 * The same charge on the Communications log, in the log's own sentence shape
 * (`raider-log.ts`: `LETHARGY ONE destroyed`).
 *
 * The log is read by turning away from the glass (`hud-and-scanner.md`), so it
 * is the record and never the voice — it says the same thing the notice did,
 * because a record that says something else is a second claim.
 */
export const chargeLogText = (event: ChargeEvent): string =>
	`${event.callsign} — sustained fire, charged as an offence`;

/**
 * The same event in the exit line's voice, for `#hud` and anything reading it.
 *
 * Here beside the notice rather than inline at the call site, which is where it
 * was when #447 found the claim that it was a voice. `charged` is false for a
 * five seconds the target's own standing made lawful (F7): nothing was charged,
 * so nothing is said on the glass, and the exit line still records the act.
 */
export const chargeExit = (event: ChargeEvent, charged: boolean): string =>
	charged
		? `${event.callsign} — sustained fire on a citizen, and that is an offence`
		: `${event.callsign} — sustained fire`;

/**
 * The notice after one charge, given whatever is still standing.
 *
 * A standing notice younger than its read time keeps the glass; the charge is
 * on the log regardless, so nothing is lost by making the pilot finish the
 * sentence they are already reading.
 */
export function nextChargeNotice(
	standing: ChargeNotice,
	event: ChargeEvent,
): ChargeNotice {
	const read = CHARGE_NOTICE_S - standing.left;
	if (standing.left > 0 && read < CHARGE_READ_S) return standing;
	return { text: chargeNotice(event), left: CHARGE_NOTICE_S };
}
