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
		store?.setItem(BOOT_PIECE_KEY, mark);
	} catch {
		return;
	}
}

/** Read once per page, at boot; the mark is taken whatever it says. */
export function takeBootMark(store: MarkStore | null): BootMark {
	try {
		const mark = store?.getItem(BOOT_PIECE_KEY) ?? null;
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
