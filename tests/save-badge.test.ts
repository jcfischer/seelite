/**
 * What the save-fault badge stands for (`persistent-world-state.md` §11.5,
 * `hud-and-scanner.md` §5.3).
 *
 * The drawing is `scripts/probe-save.mjs`'s to check: it forces a failed write
 * in a running page and reads the badge on the glass. This is the rule it draws.
 */

import { describe, expect, test } from "bun:test";
import { flushFault, writeFault } from "../src/commander-flow";
import { hasHeldSaveFault, heldSaveFault } from "../src/save-badge";
import type { SaveFault, SaveRecordKind } from "../src/save-store";

const quota = new Error("QuotaExceededError");
const dock: SaveFault = { reason: "dock", error: quota };
const capped: SaveFault = { reason: "debounce", error: quota, consecutive: 3 };
const store = (...held: [SaveRecordKind, SaveFault][]) => ({
	heldFaults: new Map<SaveRecordKind, SaveFault>(held),
});

describe("heldSaveFault", () => {
	test("an attached store's held faults are the badge, each in its own words", () => {
		expect(heldSaveFault(store(["live", capped]), null)).toBe(
			writeFault(3, quota),
		);
		// A dock flush holds both kinds with one cause, said once.
		expect(
			heldSaveFault(store(["live", dock], ["lastDocked", dock]), null),
		).toBe(flushFault("dock", quota));
	});

	test("two different causes are both named, the dock checkpoint first", () => {
		expect(
			heldSaveFault(store(["live", capped], ["lastDocked", dock]), null),
		).toBe(`${flushFault("dock", quota)}\n\n${writeFault(3, quota)}`);
	});

	test("an attached store with nothing held hides the badge", () => {
		expect(heldSaveFault(store(), null)).toBeNull();
	});

	test("with no store, the boot's fault is the badge: nothing will write until it is fixed", () => {
		// A direct boot whose attach failed plays on with no store (round 4 of
		// #310 named the badge as that fault's surface).
		const lock = 'Commander "default" is open in another tab';
		expect(heldSaveFault(null, lock)).toBe(lock);
		// `?no-save`, or a boot that has not attached yet with nothing wrong.
		expect(heldSaveFault(null, null)).toBeNull();
	});

	test("the frame loop's yes-or-no agrees with the words in every case", () => {
		const lock = 'Commander "default" is open in another tab';
		const cases: [ReturnType<typeof store> | null, string | null][] = [
			[store(["live", capped]), null],
			[store(["lastDocked", dock]), lock],
			[store(), null],
			[store(), lock],
			[null, lock],
			[null, null],
		];
		for (const [s, boot] of cases)
			expect(hasHeldSaveFault(s, boot)).toBe(heldSaveFault(s, boot) !== null);
	});
});
