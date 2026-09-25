/**
 * #408: the flight controls a new pilot is shown — throttle, pitch, yaw, roll —
 * on the keyboard and the controller, from the layout in force.
 *
 * The principal's playtest (2026-09-25) asked for them on screen so a first
 * flight knows how to fly and steer. Derived rather than typed, for the reason
 * every other surface that names a key is (#369 D11): a rebind moves them.
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_BINDINGS, rebind } from "../src/commands";
import { flightControls } from "../src/key-names";

describe("#408 — the flight controls, as bound", () => {
	test("the shipped layout reads as the four controls, keyboard and controller", () => {
		const lines = flightControls(DEFAULT_BINDINGS);
		expect(lines.keyboard).toBe(
			"THROTTLE Shift/Ctrl · PITCH w/s · YAW a/d · ROLL q/e",
		);
		expect(lines.controller).toBe(
			"THROTTLE R2/L2 · PITCH right stick up/down · YAW right stick left/right · ROLL left stick left/right",
		);
	});

	test("a rebind moves the line", () => {
		const moved = rebind(
			DEFAULT_BINDINGS,
			"fly.rollPort",
			{ kind: "key", key: "q", hold: true },
			{ kind: "key", key: "z", hold: true },
		);
		expect(flightControls(moved).keyboard).toContain("ROLL z/e");
	});
});
