/**
 * Every key name the game prints outside the `Controls` tab, derived (#381 S5).
 *
 * #369 D11: one owner for every printed key name, and the arm it refuses is
 * deriving only the tab. Each surface here is asked twice — once over the
 * shipped layout, so the words a player sees today are pinned, and once over a
 * layout with the command moved, so a surface that authored its key instead of
 * deriving it goes red. The first half alone is the check this repo keeps
 * finding: a string that equals the right answer because it was typed in.
 */
import { describe, expect, test } from "bun:test";
import {
	type Binding,
	DEFAULT_BINDINGS,
	type Layout,
	layoutOf,
	rebind,
	type Trigger,
} from "../src/commands";
import { boundNames, padHintFor } from "../src/controls-reference";
import * as padBindings from "../src/pad-bindings";
import { shippedTrigger } from "./lib/shipped-trigger";

const key = (k: string): Trigger => ({ kind: "key", key: k });

/** A layout with one command's shipped key moved to `to`. */
const movedKey = (command: string, to: string): Layout =>
	rebind(
		DEFAULT_BINDINGS,
		command as Parameters<typeof rebind>[1],
		shippedTrigger(command),
		key(to),
	);

/**
 * A layout with one pad-intent row's button replaced.
 *
 * **Built rather than rebound, and that is the point of it.** `rebind` refuses
 * a panel intent — the console's grammar is not offered for rebinding — so no
 * player layout can move one. A hint that was typed in would still pass every
 * row over the shipped layout; this is the only way to tell it from a derived
 * one.
 */
const movedIntent = (command: string, button: string): Layout =>
	layoutOf(
		DEFAULT_BINDINGS.map((b): Binding =>
			b.command === command && b.trigger.kind === "pad-intent"
				? { ...b, trigger: { ...b.trigger, button } as Trigger }
				: b,
		),
	);

describe("the one formatter (#381 S5)", () => {
	test("a command's triggers, printed, in the layout's order", () => {
		expect(boundNames(DEFAULT_BINDINGS, "fly.cruise")).toEqual(["j", "Y"]);
	});

	test("it reads the layout it is given, not the shipped one", () => {
		expect(boundNames(movedKey("fly.cruise", "k"), "fly.cruise")).toEqual([
			"k",
			"Y",
		]);
	});

	test("a filter keeps only the triggers a surface can name", () => {
		expect(
			boundNames(DEFAULT_BINDINGS, "fly.cruise", (t) => t.kind === "key"),
		).toEqual(["j"]);
	});

	test("a held trigger says so, because triggerLabel does", () => {
		expect(boundNames(DEFAULT_BINDINGS, "fight.fireBeam")).toEqual([
			"hold x",
		]);
	});
});

describe("the pad hint (#381 S5)", () => {
	test("it lives beside the other printed names, not beside the bindings", () => {
		expect("padHintFor" in padBindings).toBe(false);
	});

	test("a walkable console off the station names all four", () => {
		expect(
			padHintFor(DEFAULT_BINDINGS, { station: false, walkable: true }),
		).toBe("CONTROLLER · d-pad ↑/↓ WALK · A SELECT · B BACK · L1/R1 TAB");
	});

	test("an empty walk promises none, and the station promises no back", () => {
		expect(
			padHintFor(DEFAULT_BINDINGS, { station: false, walkable: false }),
		).toBe("CONTROLLER · B BACK · L1/R1 TAB");
		expect(
			padHintFor(DEFAULT_BINDINGS, { station: true, walkable: true }),
		).toBe("CONTROLLER · d-pad ↑/↓ WALK · A SELECT · L1/R1 TAB");
	});

	test("each segment is read off the layout", () => {
		const hint = (layout: Layout) =>
			padHintFor(layout, { station: false, walkable: true });
		expect(hint(movedIntent("panel.activate", "x"))).toContain("X SELECT");
		expect(hint(movedIntent("panel.back", "y"))).toContain("Y BACK");
		expect(hint(movedIntent("panel.tabNext", "r2"))).toContain("L1/R2 TAB");
		expect(hint(movedIntent("panel.cursorDown", "left"))).toContain(
			"d-pad ↑/← WALK",
		);
	});
});
