/**
 * Node #725: the decision `resetToFixture` refuses on.
 *
 * The reset itself runs in a page and cannot run here. What can is the rule it
 * reads: a gate that was shut before the reset and is open after it means the
 * boot position the ship was sent to is enclosed, and every reading taken next
 * would be drawn with #241's pair on for a reason that is not the framing.
 */
import { describe, expect, test } from "bun:test";
import { resetOpenedGate } from "../scripts/lib/fixture-reset.mjs";

describe("resetOpenedGate", () => {
	test("shut before and open after is the reset opening the gate", () => {
		expect(resetOpenedGate({ before: false, after: true })).toBe(true);
	});

	test("the other three transitions pass", () => {
		expect(resetOpenedGate({ before: false, after: false })).toBe(false);
		expect(resetOpenedGate({ before: true, after: true })).toBe(false);
		expect(resetOpenedGate({ before: true, after: false })).toBe(false);
	});

	// `!undefined && undefined` is falsy, so a gate the page no longer reports
	// would pass every reset in silence. A guard that cannot read its input
	// refuses (#206).
	test("a gate state that is not a boolean is refused, not passed", () => {
		for (const [before, after] of [
			[undefined, true],
			[false, undefined],
			[null, null],
			[0, 1],
		])
			expect(() =>
				resetOpenedGate({ before, after } as unknown as {
					before: boolean;
					after: boolean;
				}),
			).toThrow(/gate/);
	});
});
