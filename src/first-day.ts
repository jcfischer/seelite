/**
 * A new pilot's first useful day (#408, `docs/specs/first-useful-day.md`).
 *
 * Only the choice is saved. Which step the pilot is on is derived from state
 * every time it is asked, so there is no progress record to fall out of step
 * with the journal it describes.
 */

/** New game's choice (D4): guided pilots are pushed the next step, free
 *  pilots are not. Every commander can read the First day tab (D5). */
export type FirstDayChoice = "guided" | "free";

export const FIRST_DAY_CHOICES: readonly FirstDayChoice[] = ["guided", "free"];

export const isFirstDayChoice = (value: unknown): value is FirstDayChoice =>
	(FIRST_DAY_CHOICES as readonly unknown[]).includes(value);
