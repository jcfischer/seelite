import { describe, expect, test } from "bun:test";
import {
	BOOT_PIECE_KEY,
	bootPieceOwed,
	leaveBootMark,
	type MarkStore,
	takeBootMark,
} from "../src/boot-piece";

const memory = (): MarkStore & { items: Map<string, string> } => {
	const items = new Map<string, string>();
	return {
		items,
		getItem: (k) => items.get(k) ?? null,
		setItem: (k, v) => void items.set(k, v),
		removeItem: (k) => void items.delete(k),
	};
};

describe("the boot piece (D3, D3a)", () => {
	test("Continue on the overlay plays it", () => {
		expect(bootPieceOwed({ wake: null, mark: null, click: true })).toBe(true);
	});

	test("New game, Load or Import plays it on the page their reload boots", () => {
		const store = memory();
		leaveBootMark(store, "owed");
		const mark = takeBootMark(store);
		expect(bootPieceOwed({ wake: null, mark, click: false })).toBe(true);
	});

	test("a one-shot continue nobody clicked for plays none", () => {
		expect(bootPieceOwed({ wake: null, mark: null, click: false })).toBe(false);
	});

	test("a boot that wakes from a death plays none, whatever the mark", () => {
		for (const mark of ["owed", "skip", null] as const)
			for (const click of [true, false])
				expect(
					bootPieceOwed({ wake: { cause: "destroyed" }, mark, click }),
				).toBe(false);
	});

	test("after a death that opened the overlay, the next start plays none (D3a)", () => {
		expect(bootPieceOwed({ wake: null, mark: "skip", click: true })).toBe(
			false,
		);
		expect(bootPieceOwed({ wake: null, mark: "skip", click: false })).toBe(
			false,
		);
	});

	test("the mark is read once", () => {
		const store = memory();
		leaveBootMark(store, "skip");
		expect(store.items.get(BOOT_PIECE_KEY)).toBe("skip");
		expect(takeBootMark(store)).toBe("skip");
		expect(takeBootMark(store)).toBeNull();
	});

	test("no session store, or one that throws, reads as no mark", () => {
		expect(takeBootMark(null)).toBeNull();
		const refusing: MarkStore = {
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("denied");
			},
			removeItem: () => {},
		};
		expect(() => leaveBootMark(refusing, "owed")).not.toThrow();
		expect(takeBootMark(refusing)).toBeNull();
	});
});
