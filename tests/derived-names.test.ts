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
import {
	type FitCache,
	fitLine,
	RIG_MOUSE,
	rigLegend,
} from "../src/combat-rig";
import { commanderHint } from "../src/commander-overlay";
import { controlsCatalogue } from "../src/controls-catalogue";
import {
	anyOf,
	boundNames,
	COMMANDER_ACTION,
	controlsTree,
	onKeyboard,
	padHintFor,
	SETTINGS_ACTION,
	triggerLabel,
} from "../src/controls-reference";
import { saveBadgeMarkup } from "../src/save-badge";
import { settingsHint } from "../src/settings-panel";
import * as padBindings from "../src/pad-bindings";
import { shippedTrigger } from "./lib/shipped-trigger";

/**
 * A layout with one command's shipped key moved to `to`, keeping its
 * qualifiers — `rebind` refuses a move that drops a `hold`, which is the
 * command's and not the player's.
 */
const movedKey = (command: string, to: string): Layout => {
	const from = shippedTrigger(command);
	if (from.kind !== "key") throw new Error(`${command} ships no key`);
	const { code: _code, ...qualifiers } = from;
	return rebind(
		DEFAULT_BINDINGS,
		command as Parameters<typeof rebind>[1],
		from,
		{ ...qualifiers, key: to },
	);
};

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
		DEFAULT_BINDINGS.map(
			(b): Binding =>
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
		expect(boundNames(DEFAULT_BINDINGS, "fight.fireBeam")).toEqual(["hold x"]);
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

describe("the two player screens' own keys (#381 S5)", () => {
	const keys = (layout: Layout, id: string) =>
		boundNames(layout, id as Parameters<typeof boundNames>[1], onKeyboard);

	test("a footer names the keyboard's triggers and nothing else", () => {
		expect(keys(DEFAULT_BINDINGS, "system.settings")).toEqual(["z"]);
		expect(keys(DEFAULT_BINDINGS, "fly.cruise")).toEqual(["j"]);
	});

	test("the settings footer says the key the layout has", () => {
		expect(settingsHint(keys(DEFAULT_BINDINGS, "system.settings"))).toBe(
			"↑↓ choose · ←→ change · Esc or z to close · saved automatically",
		);
		expect(
			settingsHint(keys(movedKey("system.settings", "k"), "system.settings")),
		).toContain("Esc or k to close");
	});

	test("a screen whose key moved to the pad closes on Escape alone", () => {
		expect(settingsHint([])).toContain("· Esc to close ·");
	});

	test("the Commander's footer says the key the layout has", () => {
		expect(
			commanderHint("menu", true, keys(DEFAULT_BINDINGS, "system.commander")),
		).toBe("↑↓ choose · ←→ action · Enter do it · Esc or 9 to close");
		expect(
			commanderHint(
				"menu",
				true,
				keys(movedKey("system.commander", "4"), "system.commander"),
			),
		).toContain("Esc or 4 to close");
	});

	test("before the game runs the menu promises no close, and a form never did", () => {
		expect(commanderHint("menu", false, ["9"])).toBe(
			"↑↓ choose · ←→ action · Enter do it",
		);
		expect(commanderHint("form", true, ["9"])).toBe(
			"↑↓ choose · type in a field · Enter do it · Esc back",
		);
	});

	test("the save-fault badge names the key that opens the Commander", () => {
		expect(saveBadgeMarkup(["9"])).toBe("SAVE FAULT <kbd>9</kbd>");
		expect(saveBadgeMarkup(["4"])).toBe("SAVE FAULT <kbd>4</kbd>");
		expect(saveBadgeMarkup([])).toBe("SAVE FAULT");
	});

	test("a key that prints as markup reaches the badge as text", () => {
		expect(saveBadgeMarkup(["<"])).toBe("SAVE FAULT <kbd>&lt;</kbd>");
	});
});

describe("the Controls tab's doors (#381 S5)", () => {
	test("settings first, then the Commanders, both before any group", () => {
		const items = controlsTree(controlsCatalogue(), new Set());
		expect(
			items.slice(0, 2).map((i) => (i.kind === "action" ? i.action : i.kind)),
		).toEqual([SETTINGS_ACTION, COMMANDER_ACTION]);
		expect(items[2]?.kind).toBe("header");
	});
});

describe("a list of names (#381 S5)", () => {
	test("one name is itself, and several are joined with or", () => {
		expect(anyOf(["j"])).toBe("j");
		expect(anyOf(["j", "k"])).toBe("j or k");
	});

	test("a hold every name shares is said once", () => {
		expect(anyOf(["hold x", "hold left mouse button"])).toBe(
			"hold x or left mouse button",
		);
		// Only when every name shares it: a press beside a hold keeps both words.
		expect(anyOf(["x", "hold left mouse button"])).toBe(
			"x or hold left mouse button",
		);
	});
});

describe("the combat rig's legend (#381 S5)", () => {
	test("the shipped layout's keys, and the rig's own mouse on the beam", () => {
		expect(rigLegend(DEFAULT_BINDINGS)).toBe(
			"hold Space pulse · hold x or left mouse button beam · / warning · q ECM",
		);
	});

	test("each key is read off the layout", () => {
		const legend = rigLegend(movedKey("fight.fireBeam", "c"));
		expect(legend).toContain("hold c or left mouse button beam");
		expect(rigLegend(movedKey("fight.firePulse", "v"))).toContain(
			"hold v pulse",
		);
	});

	test("the mouse is the rig's reading, printed in triggerLabel's words", () => {
		expect(triggerLabel(RIG_MOUSE)).toBe("hold left mouse button");
	});
});

describe("the rig's fitter re-solves a legend that changed (#381 S5)", () => {
	/** A context that only measures: a monospace glyph is 0.6 of its size. */
	const measuring = () => {
		const ctx = {
			font: "",
			measureText: (text: string) => ({
				width: text.length * 0.6 * Number.parseFloat(ctx.font),
			}),
		};
		return ctx as unknown as Pick<
			CanvasRenderingContext2D,
			"font" | "measureText"
		>;
	};

	test("a longer legend at the same width gets its own fit", () => {
		const ctx = measuring();
		const cache: FitCache = new Map();
		const short = fitLine(ctx, cache, "legend", "x".repeat(40), 12, 390);
		const long = fitLine(ctx, cache, "legend", "x".repeat(70), 12, 390);
		// Keyed on the role and the width alone, the second call was answered
		// out of the first's entry and reported the short line's width.
		expect(long.worstWidth).toBeGreaterThan(short.worstWidth);
		expect(long.worstWidth).toBeLessThanOrEqual(390 - 16);
	});
});
