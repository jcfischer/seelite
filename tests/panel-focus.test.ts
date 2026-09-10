/**
 * The cursor every panel shares — #283's F5.
 *
 * The settings panel already had one (`settings-panel.ts`: `role="listbox"`, a
 * cursor row, ↑↓ to choose) and the live cockpit's consoles had none, so the
 * model is lifted out rather than invented: one implementation, six surfaces,
 * and it is a pure function over a list so it can be checked here rather than
 * through a browser.
 */
import { describe, expect, test } from "bun:test";
import {
	type FocusCursor,
	type FocusItem,
	NO_FOCUS,
	focusedItem,
	moveFocus,
	refreshFocus,
	resolveFocus,
	setFocus,
} from "../src/panel-focus";

const items = (...ids: string[]): FocusItem[] => ids.map((id) => ({ id }));

/** A cursor that has been sitting on `id`, at the index it was last drawn at. */
const at = (id: string, index: number): FocusCursor => ({ id, index });

describe("an empty list has no cursor at all", () => {
	test("resolve reports no index rather than zero", () => {
		// −1 and not 0: a panel drawing a ring at index 0 of an empty list draws
		// it on nothing, and `focusedItem` would have to guess.
		expect(resolveFocus([], NO_FOCUS)).toBe(-1);
		expect(resolveFocus([], at("gone", 3))).toBe(-1);
	});

	test("moving does not invent one", () => {
		expect(moveFocus([], NO_FOCUS, 1)).toEqual(NO_FOCUS);
		expect(moveFocus([], at("gone", 3), -1)).toEqual(NO_FOCUS);
	});

	test("nothing is focused", () => {
		expect(focusedItem([], NO_FOCUS)).toBeNull();
	});
});

describe("a fresh cursor starts at the head", () => {
	test("resolve on NO_FOCUS is the first item", () => {
		expect(resolveFocus(items("a", "b", "c"), NO_FOCUS)).toBe(0);
		expect(focusedItem(items("a", "b", "c"), NO_FOCUS)?.id).toBe("a");
	});

	test("the first move steps off the head rather than onto it", () => {
		// A pad player's first press should move. Treating NO_FOCUS as "before
		// the list" would make the first press land on `a` and the second on
		// `b`, which reads as a dropped input.
		expect(moveFocus(items("a", "b", "c"), NO_FOCUS, 1).id).toBe("b");
	});
});

describe("the cursor walks and wraps", () => {
	const three = items("a", "b", "c");

	test("forward", () => {
		expect(moveFocus(three, at("a", 0), 1).id).toBe("b");
		expect(moveFocus(three, at("b", 1), 1).id).toBe("c");
	});

	test("off the end and round", () => {
		expect(moveFocus(three, at("c", 2), 1).id).toBe("a");
	});

	test("backwards off the head and round", () => {
		expect(moveFocus(three, at("a", 0), -1).id).toBe("c");
	});

	test("a step of more than one wraps the same way", () => {
		expect(moveFocus(three, at("a", 0), 4).id).toBe("b");
		expect(moveFocus(three, at("a", 0), -4).id).toBe("c");
	});

	test("a step of zero is a re-resolve, not a move", () => {
		expect(moveFocus(three, at("b", 1), 0).id).toBe("b");
	});

	test("a one-item list is a fixed point in both directions", () => {
		const one = items("only");
		expect(moveFocus(one, at("only", 0), 1).id).toBe("only");
		expect(moveFocus(one, at("only", 0), -1).id).toBe("only");
	});
});

describe("identity beats position, which is the whole reason the cursor is not an index", () => {
	test("a row that moved is followed, not left behind", () => {
		// The Navigation list is sorted by range and re-sorts while the ship
		// flies. An index-only cursor would slide onto whichever body happened
		// to take that slot, and the player would buy or select the wrong one.
		const before = items("moon", "station", "planet");
		const after = items("station", "planet", "moon");
		const cursor = setFocus(before, at("moon", 0), "moon");
		expect(resolveFocus(after, cursor)).toBe(2);
		expect(focusedItem(after, cursor)?.id).toBe("moon");
	});

	test("a row that is gone falls back to the place it was", () => {
		// Not to the head. A contact leaving scanner range should not send the
		// cursor to the top of the list — the player is looking at that part of
		// it.
		const after = items("a", "b", "c", "d");
		expect(resolveFocus(after, at("gone", 2))).toBe(2);
		expect(focusedItem(after, at("gone", 2))?.id).toBe("c");
	});

	test("a list that shrank under the cursor clamps to its end", () => {
		expect(resolveFocus(items("a", "b"), at("gone", 7))).toBe(1);
	});

	test("a negative remembered index clamps to the head", () => {
		expect(resolveFocus(items("a", "b"), { id: "gone", index: -3 })).toBe(0);
	});

	test("a move from a vanished row carries on from where it was", () => {
		// Resolve first, then step: from the hole at index 2, forward is index 3.
		expect(moveFocus(items("a", "b", "c", "d"), at("gone", 2), 1).id).toBe("d");
	});
});

describe("a move records where it landed", () => {
	test("the returned cursor carries both halves", () => {
		expect(moveFocus(items("a", "b", "c"), at("a", 0), 1)).toEqual({
			id: "b",
			index: 1,
		});
	});

	test("so the next resolve needs no list history", () => {
		const three = items("a", "b", "c");
		const moved = moveFocus(three, at("a", 0), 1);
		expect(resolveFocus(three, moved)).toBe(1);
	});
});

describe("setFocus is how the mouse and the pad stay one cursor", () => {
	test("pointing at a row moves the cursor there", () => {
		// The mouse hovering or clicking a row sets the same cursor the pad
		// walks, so the ring is never in one place while the pointer acts on
		// another. Seekolous's rule: whichever device acted last is in charge,
		// and no flag records which.
		const three = items("a", "b", "c");
		expect(setFocus(three, NO_FOCUS, "c")).toEqual({ id: "c", index: 2 });
	});

	test("pointing at something not in the list leaves the cursor alone", () => {
		const three = items("a", "b", "c");
		const cursor = at("b", 1);
		expect(setFocus(three, cursor, "nowhere")).toEqual(cursor);
	});
});

describe("refreshFocus makes 'the index it was last drawn at' true", () => {
	// The header's claim was aspirational until #283's round 3: only `moveFocus`
	// ever wrote the index, so a row that was focused at one position and later
	// re-sorted to another still remembered the old one — and the fallback then
	// dropped the cursor to the wrong part of the list the moment that row left.

	test("a re-sorted row's remembered position follows it", () => {
		const before = items("moon", "station", "planet");
		const after = items("station", "planet", "moon");
		const cursor = setFocus(before, NO_FOCUS, "moon");
		expect(cursor.index).toBe(0);
		expect(refreshFocus(after, cursor)).toEqual({ id: "moon", index: 2 });
	});

	test("and that is what the fallback then uses when the row goes", () => {
		const before = items("moon", "station", "planet");
		const after = items("station", "planet", "moon");
		const gone = items("station", "planet", "beacon");
		const stale = setFocus(before, NO_FOCUS, "moon");
		// Without the refresh the cursor still says index 0, so a vanished row
		// sends the player to the head of the list.
		expect(resolveFocus(gone, stale)).toBe(0);
		// With it, the cursor lands where the row was last actually drawn.
		expect(resolveFocus(gone, refreshFocus(after, stale))).toBe(2);
	});

	test("an empty list leaves the cursor untouched rather than blanking it", () => {
		const cursor = at("moon", 2);
		expect(refreshFocus([], cursor)).toEqual(cursor);
	});

	test("refreshing an unchanged list is a no-op", () => {
		const three = items("a", "b", "c");
		const cursor = at("b", 1);
		expect(refreshFocus(three, cursor)).toEqual(cursor);
	});
});
