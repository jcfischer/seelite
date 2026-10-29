import { expect, test } from "bun:test";
import { HULL_SPECS, withPrototypeSecondHardpoint } from "../src/hull";
import { makeModule, parseLoadout, stockLoadout } from "../src/loadout";
import { withoutPrototypeSlot } from "../src/rock-drill";

test("the prototype miner gains h2 beside h1, the same size, and nothing else moves (Q12)", () => {
	const before = HULL_SPECS.miner;
	const after = withPrototypeSecondHardpoint(before);
	expect(after.hardpoints).toBe(2);
	expect(after.slots.map((s) => s.key)).toEqual([
		"h1",
		"h2",
		...before.slots.slice(1).map((s) => s.key),
	]);
	expect(after.slots[1]).toEqual({ ...before.slots[0], key: "h2" });
	expect(before.slots[0].key).toBe("h1");
	const { hardpoints: _a, slots: _b, ...rest } = after;
	const { hardpoints: _c, slots: _d, ...was } = before;
	expect(rest).toEqual(was);
	expect(withPrototypeSecondHardpoint(after)).toBe(after);
	expect(HULL_SPECS.miner.hardpoints).toBe(1);
});

test("a save carrying h2 does not load without the flag, so the prototype writes none", () => {
	const loadout: Record<string, ReturnType<typeof makeModule>> = {
		...stockLoadout("miner"),
		h2: makeModule("mining-laser", 3),
	};
	expect(() => parseLoadout(loadout, "miner")).toThrow(
		"module does not fit h2",
	);
	const written = withoutPrototypeSlot(loadout);
	expect(written).toEqual(stockLoadout("miner"));
	expect(() => parseLoadout(written, "miner")).not.toThrow();
});
