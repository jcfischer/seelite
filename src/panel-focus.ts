/**
 * One cursor, six panels — the model a pad walks and a pointer sets (#283).
 *
 * ## Why this is a module and not a field on each panel
 *
 * The repo already had this model once. `settings-panel.ts` draws a
 * `role="listbox"` of rows with `aria-selected` on one of them and walks it
 * with the arrow keys; the live cockpit's consoles, the galaxy chart's controls
 * and the finder panel had **no** non-pointer model at all, because a mouse
 * needs none — it points at the thing it means. A pad cannot point, so every
 * one of those surfaces needs a cursor, and six hand-written cursors is six
 * chances to disagree about what happens when a list changes under one.
 *
 * So the model is here, it is pure, and it is on the headless list. The panel
 * draws the ring and the pad walks it; neither owns it.
 *
 * ## The cursor is an identity **and** a position, and it needs both
 *
 * An index alone is wrong in this game specifically. The Navigation list is
 * sorted by range and re-sorts while the ship flies, so a cursor pinned to
 * index 2 slides onto whichever body took that slot — and the action at the end
 * of that cursor is *select this target*, or *buy this*. The player would act
 * on a row they never chose.
 *
 * An id alone is not enough either. Rows genuinely leave: a contact drops out
 * of scanner range, a commodity sells out. Falling back to the head of the list
 * on every disappearance drags the cursor away from the part of the list the
 * player is reading, which is worse than the small lie of staying put.
 *
 * So a cursor carries the id it means and the index it was last drawn at.
 * Resolution prefers the id and falls back to the remembered index, clamped.
 *
 * ## No imports
 *
 * `tests/headless.test.ts` holds it as a leaf for the same reason it holds
 * `gamepad.ts`: an input model that names a station or a commodity is one that
 * cannot be reused by the panel that does not have them.
 */

/**
 * A thing the cursor can sit on.
 *
 * `id` must be stable across redraws and unique within one list — it is what
 * makes the cursor survive a re-sort. A body id, a commodity name, a tab name
 * and a settings key are all already stable and unique; a row's position is
 * neither.
 */
export interface FocusItem {
	readonly id: string;
}

/**
 * Where the cursor is: what it means, and where that was last drawn.
 *
 * Both halves, for the reason in the header. `index` is a *memory* rather than
 * an authority — it is consulted only when `id` is no longer in the list.
 */
export interface FocusCursor {
	readonly id: string | null;
	readonly index: number;
}

/** A panel nobody has touched yet. Resolves to the head of whatever it is shown. */
export const NO_FOCUS: FocusCursor = { id: null, index: 0 };

const clamp = (value: number, low: number, high: number) =>
	value < low ? low : value > high ? high : value;

/**
 * Where the cursor actually is in `items`, or `-1` when the list is empty.
 *
 * `-1` rather than `0`, because a panel that draws a ring at index 0 of an
 * empty list draws it on nothing and every caller would have to re-check the
 * length anyway. One sentinel, checked once.
 */
export function resolveFocus(
	items: readonly FocusItem[],
	cursor: FocusCursor,
): number {
	if (items.length === 0) return -1;
	if (cursor.id !== null) {
		const found = items.findIndex((item) => item.id === cursor.id);
		if (found !== -1) return found;
	}
	return clamp(cursor.index, 0, items.length - 1);
}

/** The item under the cursor, or `null` when there is nothing to sit on. */
export function focusedItem(
	items: readonly FocusItem[],
	cursor: FocusCursor,
): FocusItem | null {
	const index = resolveFocus(items, cursor);
	return index === -1 ? null : (items[index] ?? null);
}

/**
 * Step the cursor by `delta`, wrapping at both ends.
 *
 * **Resolve, then step.** A cursor whose row has gone carries on from the hole
 * that row left rather than from the head — the player was reading that part of
 * the list, and a disappearing contact should not teleport them.
 *
 * Wrapping rather than stopping: a d-pad has no scrollbar to show that the end
 * has been reached, so a cursor that silently refuses to move reads as a
 * dropped input. `((n % len) + len) % len` because `%` keeps the sign of its
 * left operand in JavaScript, and a plain `%` sends a backwards step off the
 * head to a negative index.
 */
export function moveFocus(
	items: readonly FocusItem[],
	cursor: FocusCursor,
	delta: number,
): FocusCursor {
	const from = resolveFocus(items, cursor);
	if (from === -1) return NO_FOCUS;
	const length = items.length;
	const index = (((from + delta) % length) + length) % length;
	return { id: items[index]?.id ?? null, index };
}

/**
 * Re-resolve a cursor against the list as it is now, remembering where it
 * landed.
 *
 * **The header of this module was a claim its callers did not keep.** It says a
 * cursor carries "the id it means and the index it was last drawn at", and the
 * index half was only ever written by `moveFocus` — so a row focused at index 0
 * and later re-sorted to index 3 still remembered 0, and when it vanished the
 * fallback dropped the cursor to the top of the list rather than near where the
 * player was reading. That is the exact failure the two-part cursor exists to
 * prevent, arriving through the half nobody refreshed. Sage found it, round 3.
 *
 * A panel calls this wherever it draws the ring, which is what makes "last
 * drawn at" true rather than aspirational.
 */
export function refreshFocus(
	items: readonly FocusItem[],
	cursor: FocusCursor,
): FocusCursor {
	const index = resolveFocus(items, cursor);
	if (index === -1) return cursor;
	return { id: items[index]?.id ?? null, index };
}

/**
 * Put the cursor on a named row — how a pointer and a pad stay one cursor.
 *
 * The mouse click path already exists on every one of these surfaces and is not
 * changed by #283; what it gains is this call, so the ring the pad walks is the
 * ring the pointer last moved. That keeps seekolous's rule intact: whichever
 * device acted last is in charge, and no flag records which.
 *
 * An `id` that is not in the list leaves the cursor exactly as it was. The
 * alternative — moving to a row that does not exist — would put the ring
 * nowhere and lose the place the player had.
 */
export function setFocus(
	items: readonly FocusItem[],
	cursor: FocusCursor,
	id: string,
): FocusCursor {
	const index = items.findIndex((item) => item.id === id);
	return index === -1 ? cursor : { id, index };
}
