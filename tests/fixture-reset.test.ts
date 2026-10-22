/**
 * Node #725: the decision `resetToFixture` refuses on.
 *
 * The reset itself runs in a page and cannot run here. What can is the rule it
 * reads: a gate that was shut before the reset and is open after it means the
 * boot position the ship was sent to is enclosed, and every reading taken next
 * would be drawn with #241's pair on for a reason that is not the framing.
 * And the rule it reads when the gate was already open: an open gate the boot
 * frames did not start closing is one the boot position is holding open.
 */
import { describe, expect, test } from "bun:test";
import {
	resetHeldGateOpen,
	resetOpenedGate,
	waitForGateShut,
} from "../scripts/lib/fixture-reset.mjs";
import { OCCLUSION, stepOcclusionGate } from "../src/occlusion";

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

// The reset above cannot see an enclosed boot when the gate was already open
// before it: open → open passes. What can is the gate's own close counter.
// `stepOcclusionGate` zeroes `pending` on every frame the gate already wants
// the state it is in, so an open gate whose boot frames left `pending` at 0 is
// one the boot position is holding open. These rows step the shipped reducer
// rather than hand-built pairs, so a change to that rule turns them red here.
describe("resetHeldGateOpen", () => {
	const open = { open: true, pending: 0 };
	const at = (rad: number) => [
		// A subject whose apparent radius from the origin is `rad`.
		{ center: [0, 0, 1 / Math.sin(rad)] as const, radiusKm: 1 },
	];
	const twoFrames = (rad: number) =>
		stepOcclusionGate(stepOcclusionGate(open, at(rad)), at(rad));

	test("an open gate the boot frames held open is refused", () => {
		const held = twoFrames(OCCLUSION.gate.closeRad + 0.01);
		expect(held).toEqual({ open: true, pending: 0 });
		expect(resetHeldGateOpen(held)).toBe(true);
	});

	test("an open gate the boot frames started closing passes", () => {
		const closing = twoFrames(OCCLUSION.gate.closeRad - 0.01);
		expect(closing).toEqual({ open: true, pending: 2 });
		expect(resetHeldGateOpen(closing)).toBe(false);
	});

	test("a shut gate passes whatever its counter reads", () => {
		expect(resetHeldGateOpen({ open: false, pending: 0 })).toBe(false);
		expect(resetHeldGateOpen({ open: false, pending: 1 })).toBe(false);
	});

	test("a gate state it cannot read is refused, not passed", () => {
		for (const [o, pending] of [
			[undefined, 0],
			[true, undefined],
			[true, Number.NaN],
			["true", 0],
		])
			expect(() =>
				resetHeldGateOpen({ open: o, pending } as unknown as {
					open: boolean;
					pending: number;
				}),
			).toThrow(/gate/);
	});
});

describe("waitForGateShut", () => {
	const fakePage = (script: unknown[]) => {
		let i = 0;
		return {
			evaluate: async () => script[Math.min(i++, script.length - 1)],
		};
	};
	const advance = async () => {};

	test("a shut gate returns at once with no frames drawn", async () => {
		const page = fakePage([{ open: false, pending: 0, enclosureRad: 0.1 }]);
		expect(await waitForGateShut(page, advance)).toEqual({
			frames: 0,
			enclosureRad: 0.1,
		});
	});

	test("an open gate is waited out in batches until it shuts", async () => {
		const drawn: number[] = [];
		const page = fakePage([
			{ open: true, pending: 0, enclosureRad: 0.1 },
			{ open: true, pending: 10, enclosureRad: 0.1 },
			{ open: false, pending: 0, enclosureRad: 0.1 },
		]);
		const result = await waitForGateShut(
			page,
			async (_p, n) => {
				drawn.push(n as number);
			},
			{ batchFrames: 10 },
		);
		expect(drawn).toEqual([10, 10]);
		expect(result.frames).toBe(20);
	});

	test("a gate the pose holds open throws instead of reading on", async () => {
		const page = fakePage([{ open: true, pending: 0, enclosureRad: 0.4 }]);
		await expect(
			waitForGateShut(page, advance, { batchFrames: 10, maxFrames: 30 }),
		).rejects.toThrow(/still open after 30 frames/);
	});

	test("a gate state it cannot read is refused, not passed", async () => {
		await expect(
			waitForGateShut(fakePage([{ pending: 0 }]), advance),
		).rejects.toThrow(/gate/);
	});

	test("the default cap is far beyond the frames a close needs", () => {
		expect(OCCLUSION.gate.closeFrames * 3).toBeLessThan(300);
	});
});
