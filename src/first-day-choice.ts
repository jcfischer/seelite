/**
 * New game's first-day choice (#408 D4), on its own.
 *
 * A leaf, because the save format carries it: `save-envelope.ts` and
 * `save-store.ts` read it, and they should not depend on the module that owns
 * the day's steps and its sentences (`first-day.ts`), which changes for
 * reasons the save does not (sage, #528 round 3).
 */

/** Guided pilots are pushed the next step, free pilots are not. Every
 *  commander can read the First day tab (D5). */
export type FirstDayChoice = "guided" | "free";

export const FIRST_DAY_CHOICES: readonly FirstDayChoice[] = ["guided", "free"];

export const isFirstDayChoice = (value: unknown): value is FirstDayChoice =>
	(FIRST_DAY_CHOICES as readonly unknown[]).includes(value);
