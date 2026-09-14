/**
 * When the save-fault badge shows (`persistent-world-state.md` §11.5,
 * `hud-and-scanner.md` §5.3).
 *
 * The drawing is `scripts/probe-save.mjs`'s to check: it forces a failed write
 * in a running page and reads the badge on the glass. This is the rule it draws.
 */

import { describe, expect, test } from "bun:test";
import { saveFaultHeld } from "../src/save-badge";
import type { SaveRecordKind } from "../src/save-store";

const store = (...kinds: SaveRecordKind[]) => ({
	faultKinds: new Set<SaveRecordKind>(kinds),
});

describe("saveFaultHeld", () => {
	test("an attached store shows the badge while it holds a fault of any kind", () => {
		expect(saveFaultHeld(store("live"), "x")).toBe(true);
		expect(saveFaultHeld(store("lastDocked"), "x")).toBe(true);
		expect(saveFaultHeld(store("live", "lastDocked"), "x")).toBe(true);
	});

	test("an attached store with no fault held hides it, whatever message is left", () => {
		// A write that landed cleared the kinds; the message it replaced is history.
		expect(saveFaultHeld(store(), "the save would not write")).toBe(false);
		expect(saveFaultHeld(store(), null)).toBe(false);
	});

	test("with no store, a fault is the badge: nothing will write until it is fixed", () => {
		// A direct boot whose attach failed plays on with no store (round 4 of
		// #310 named the badge as that fault's surface).
		expect(
			saveFaultHeld(null, 'Commander "default" is open in another tab'),
		).toBe(true);
		// `?no-save`, or a boot that has not attached yet with nothing wrong.
		expect(saveFaultHeld(null, null)).toBe(false);
	});
});
