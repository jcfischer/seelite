import { describe, expect, test } from "bun:test";
import { DEFAULT_BINDINGS, isHeld } from "../src/commands";
import { pressHeldKey, releaseHeldKey } from "../src/held-keys";
import { keyDispatch } from "../src/key-dispatch";

const route = (key: string, code: string, down: boolean, altKey = false) =>
	keyDispatch({
		key,
		code,
		down,
		repeat: false,
		altKey,
		ctrlKey: false,
		metaKey: false,
		editable: false,
	});

const fly = (held: Set<string>, codes: Map<string, string>) => ({
	press(key: string, code: string) {
		const r = route(key, code, true);
		if (r.kind === "key") pressHeldKey(held, codes, r.key, code);
	},
	release(key: string, code: string, altKey = false) {
		const r = route(key, code, false, altKey);
		if (r.kind === "release") releaseHeldKey(held, codes, r.key, code);
	},
});

describe("a yaw key let go is no longer held (#390)", () => {
	test("D released under Option on macOS stops the starboard yaw", () => {
		const held = new Set<string>();
		const keys = fly(held, new Map());
		keys.press("d", "KeyD");
		expect(isHeld(DEFAULT_BINDINGS, "fly.yawStarboard", held, "cockpit")).toBe(
			true,
		);
		keys.release("∂", "KeyD", true);
		expect(isHeld(DEFAULT_BINDINGS, "fly.yawStarboard", held, "cockpit")).toBe(
			false,
		);
		expect(held.size).toBe(0);
	});

	test("A then reverses the turn instead of cancelling a stuck D", () => {
		const held = new Set<string>();
		const keys = fly(held, new Map());
		keys.press("d", "KeyD");
		keys.release("∂", "KeyD", true);
		keys.press("a", "KeyA");
		expect(isHeld(DEFAULT_BINDINGS, "fly.yawPort", held, "cockpit")).toBe(true);
		expect(isHeld(DEFAULT_BINDINGS, "fly.yawStarboard", held, "cockpit")).toBe(
			false,
		);
	});

	test("an ordinary release still clears the key it names", () => {
		const held = new Set<string>();
		const keys = fly(held, new Map());
		keys.press("a", "KeyA");
		keys.press("d", "KeyD");
		keys.release("a", "KeyA");
		expect([...held]).toEqual(["d"]);
	});

	test("a release clears the key it names even when its code pressed another", () => {
		const held = new Set<string>();
		const keys = fly(held, new Map());
		keys.press("d", "KeyD");
		keys.press("a", "KeyA");
		keys.release("d", "KeyA");
		expect(held.has("d")).toBe(false);
	});

	test("keys pressed without a code do not release each other", () => {
		const held = new Set<string>();
		const keys = fly(held, new Map());
		keys.press("a", "");
		keys.press("d", "");
		keys.release("a", "");
		expect([...held]).toEqual(["d"]);
	});

	test("a released key leaves no code behind", () => {
		const codes = new Map<string, string>();
		const keys = fly(new Set<string>(), codes);
		keys.press("d", "KeyD");
		keys.release("∂", "KeyD", true);
		expect(codes.size).toBe(0);
	});
});
