/**
 * Whether a start plays the boot piece (#589 D3, D3a; node #771).
 *
 * Zarathustra plays on the start click on the Commander overlay, on every
 * boot, except one that wakes from a death. A start reaches the game two
 * ways: Continue on the overlay releases the clock on the same page, and New
 * game, Load and Import reload the page into a one-shot continue. So the page
 * that reloads leaves a mark in the session store, read once by the next boot:
 * `owed` from a start, `skip` from a death. A death's own boot carries its
 * wake as well. Imports nothing; the store is passed in.
 */

/** The session-store key the mark is kept under. */
// Stryker disable next-line StringLiteral: the key only has to match itself across one reload, so any other name reads back the same
export const BOOT_PIECE_KEY = "seelite.boot-piece";

/** What the page before this one left: a start, a death, or nothing. */
export type BootMark = "owed" | "skip" | null;

/** The three calls made on `sessionStorage`, which may be absent or refuse. */
export type MarkStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The page is about to reload: say whether the next boot owes the piece. */
export function leaveBootMark(
	store: MarkStore | null,
	mark: Exclude<BootMark, null>,
): void {
	try {
		// Stryker disable next-line OptionalChaining: a null store throws into the catch below, which ends the call the same way
		store?.setItem(BOOT_PIECE_KEY, mark);
		// Stryker disable next-line BlockStatement: the catch ends the call, and so does an empty one
	} catch {
		return;
	}
}

/** Read once per page, at boot; the mark is taken whatever it says. */
export function takeBootMark(store: MarkStore | null): BootMark {
	try {
		// Stryker disable next-line OptionalChaining: a null store throws into the catch, which answers null as the chain does
		const mark = store?.getItem(BOOT_PIECE_KEY) ?? null;
		// Stryker disable next-line OptionalChaining: reached only with a store, since a null one threw on the line above
		store?.removeItem(BOOT_PIECE_KEY);
		return mark === "owed" || mark === "skip" ? mark : null;
	} catch {
		return null;
	}
}

/**
 * Whether this start plays the piece. `click` is Continue on this page's
 * overlay; otherwise the start is the one-shot continue a reload booted into.
 */
export function bootPieceOwed(input: {
	wake: unknown;
	mark: BootMark;
	click: boolean;
}): boolean {
	if (input.wake !== null && input.wake !== undefined) return false;
	return input.click ? input.mark !== "skip" : input.mark === "owed";
}
