/**
 * The firsts a commander has heard (#589 D13, node #771): the once-per-commander
 * set-pieces that have played, and the mark a shipyard sale leaves for the next
 * launch to play the Largo on (D5). Saved as an additive field of the commander
 * record, carried through a death (the principal's ruling on #771, Q1). Imports
 * nothing, so the save parser reads it without the music.
 */

/** Every entry the set may hold, in the order it is written. */
export const MUSIC_FIRSTS = [
	"hull-bought",
	"dvorak-largo",
	"bruckner-7-adagio",
	"holst-mars",
] as const;

export type MusicFirst = (typeof MUSIC_FIRSTS)[number];

/** Whether `value` names a first. */
export const isMusicFirst = (value: unknown): value is MusicFirst =>
	(MUSIC_FIRSTS as readonly unknown[]).includes(value);

/** The set with `first` in it, in `MUSIC_FIRSTS` order; the same array when
 *  it is already there. */
export const withFirst = (
	firsts: readonly MusicFirst[],
	first: MusicFirst,
): readonly MusicFirst[] =>
	firsts.includes(first)
		? firsts
		: MUSIC_FIRSTS.filter((f) => f === first || firsts.includes(f));

/**
 * The saved field read back: absent is the empty set, which is what every
 * record written before #771 loads as. Anything else must be an array of
 * distinct known entries, or the record is refused by name.
 */
export function parseMusicFirsts(raw: unknown): readonly MusicFirst[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw))
		throw new Error("save: commander: musicFirsts is not an array");
	const seen = new Set<MusicFirst>();
	for (const entry of raw) {
		if (!isMusicFirst(entry))
			throw new Error(
				`save: commander: musicFirsts ${String(entry)} is not a first`,
			);
		if (seen.has(entry))
			throw new Error(`save: commander: musicFirsts repeats ${entry}`);
		seen.add(entry);
	}
	return MUSIC_FIRSTS.filter((f) => seen.has(f));
}
