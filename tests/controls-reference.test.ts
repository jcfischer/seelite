/**
 * The Controls tab's arithmetic (#372): the law of `?`, the folding tree, the
 * cursor's hand-off on a fold, and how a trigger prints.
 *
 * Everything here renders from the **shipped** catalogue, `CONTROLS`. A table
 * built inside this file would test a different object from the one the game
 * prints (#370 D2, item 6).
 */
import { describe, expect, test } from "bun:test";
import { CONTROLS, TASK_GROUPS, type Trigger } from "../src/controls-catalogue";
import type { TreeItem } from "../src/controls-reference";
import {
	CONTROLS_CHORD,
	CONTROLS_TAB,
	contextNote,
	controlsBody,
	controlsKeyMove,
	controlsTree,
	focusAfterFold,
	groupFocusId,
	restoreOnTabPick,
	rowFocusId,
	toggleGroup,
	triggerLabel,
} from "../src/controls-reference";
import type { DockPhase } from "../src/dock-session";
import {
	type FocusItem,
	focusedItem,
	NO_FOCUS,
	setFocus,
} from "../src/panel-focus";

/**
 * The cursor's names for a tree, in the order the markup draws it. The game
 * reads the same names off the DOM (`focusIdOf`), and the DOM is drawn from
 * this same `controlsTree`; here so the hand-off can be tested headless.
 */
const treeFocusIds = (items: readonly TreeItem[]): FocusItem[] =>
	items.map((item) => ({
		id:
			item.kind === "header"
				? groupFocusId(item.group)
				: rowFocusId(item.command.id),
	}));

const cockpit = {
	view: "cockpit" as const,
	dockPhase: "flying" as DockPhase,
	headLook: "forward" as const,
	rightTab: "Drive",
	restoreTab: null,
};

describe("the law of ?", () => {
	test("opens the tab: head to starboard, Controls selected", () => {
		expect(controlsKeyMove(cockpit)).toEqual({
			headLook: "right",
			rightTab: CONTROLS_TAB,
			restoreTab: "Drive",
		});
	});

	test("closes it: head forward, and the tab you were reading comes back", () => {
		const open = controlsKeyMove(cockpit);
		if (!open) throw new Error("did not open");
		expect(controlsKeyMove({ ...cockpit, ...open })).toEqual({
			headLook: "forward",
			rightTab: "Drive",
			restoreTab: null,
		});
	});

	test("head already to starboard on another tab: selects Controls, remembers that tab", () => {
		expect(
			controlsKeyMove({ ...cockpit, headLook: "right", rightTab: "Tuning" }),
		).toEqual({
			headLook: "right",
			rightTab: CONTROLS_TAB,
			restoreTab: "Tuning",
		});
	});

	test("head to port: turns to starboard, the left console is not the one that opens", () => {
		expect(controlsKeyMove({ ...cockpit, headLook: "left" })?.headLook).toBe(
			"right",
		);
	});

	test("reopened on a Controls tab left selected, it keeps the tab it remembered", () => {
		// The player opened with ?, turned forward with 2, and presses ? again:
		// the restore is still the tab before Controls, not Controls itself.
		expect(
			controlsKeyMove({
				...cockpit,
				rightTab: CONTROLS_TAB,
				restoreTab: "Flight",
			}),
		).toEqual({
			headLook: "right",
			rightTab: CONTROLS_TAB,
			restoreTab: "Flight",
		});
	});

	test("closing with nothing remembered leaves the tab alone", () => {
		expect(
			controlsKeyMove({
				...cockpit,
				headLook: "right",
				rightTab: CONTROLS_TAB,
			}),
		).toEqual({
			headLook: "forward",
			rightTab: CONTROLS_TAB,
			restoreTab: null,
		});
	});

	test("silent in chase view and while docked", () => {
		expect(controlsKeyMove({ ...cockpit, view: "chase" })).toBeNull();
		expect(controlsKeyMove({ ...cockpit, dockPhase: "docked" })).toBeNull();
	});

	test("not silent in the traversals, where the head still turns", () => {
		expect(
			controlsKeyMove({ ...cockpit, dockPhase: "arriving" }),
		).not.toBeNull();
		expect(
			controlsKeyMove({ ...cockpit, dockPhase: "launching" }),
		).not.toBeNull();
	});
});

describe("the folding tree", () => {
	const all = new Set<never>();

	test("open: every group's header, then every one of its rows, in task order", () => {
		const items = controlsTree(CONTROLS, all);
		const headers = items.filter((i) => i.kind === "header");
		expect(headers.map((h) => h.group)).toEqual([...TASK_GROUPS]);
		const rows = items.filter((i) => i.kind === "row");
		expect(rows.length).toBe(CONTROLS.commands.length);
		// A row follows its own header.
		let group: string = "";
		for (const item of items) {
			if (item.kind === "header") group = item.group;
			else expect(item.command.group as string).toBe(group);
		}
	});

	test("a folded group keeps its header and loses its rows", () => {
		const folded = toggleGroup(new Set(), "fly");
		const items = controlsTree(CONTROLS, folded);
		expect(items.some((i) => i.kind === "header" && i.group === "fly")).toBe(
			true,
		);
		expect(
			items.some((i) => i.kind === "row" && i.command.group === "fly"),
		).toBe(false);
		expect(toggleGroup(folded, "fly").has("fly")).toBe(false);
	});

	test("toggling does not mutate the set it was given", () => {
		const before = new Set<(typeof TASK_GROUPS)[number]>();
		toggleGroup(before, "fight");
		expect(before.size).toBe(0);
	});

	test("folding hands the cursor to the header, not to whatever took the row's index", () => {
		const open = treeFocusIds(controlsTree(CONTROLS, new Set()));
		const onRow = setFocus(open, NO_FOCUS, rowFocusId("roll"));
		expect(focusedItem(open, onRow)?.id).toBe(rowFocusId("roll"));
		const folded = toggleGroup(new Set(), "fly");
		const after = focusAfterFold(
			treeFocusIds(controlsTree(CONTROLS, folded)),
			onRow,
			"fly",
		);
		expect(
			focusedItem(treeFocusIds(controlsTree(CONTROLS, folded)), after)?.id,
		).toBe(groupFocusId("fly"));
	});
});

describe("how a binding prints", () => {
	const key = (k: string, extra: Partial<Trigger> = {}) =>
		triggerLabel({ kind: "key", key: k, ...extra } as Trigger);

	test("characters, and words for the keys that have no character", () => {
		expect(key("v")).toBe("v");
		expect(key("?")).toBe("?");
		expect(key("`")).toBe("`");
		expect(key(" ")).toBe("Space");
		expect(key("enter")).toBe("Enter");
		expect(key("shift")).toBe("Shift");
		expect(key("control")).toBe("Ctrl");
		expect(key("arrowup")).toBe("↑");
	});

	test("a chord is spelled out", () => {
		expect(key("arrowleft", { alt: true } as Partial<Trigger>)).toBe("Alt + ←");
		expect(CONTROLS_CHORD).toBe("Shift + /");
	});

	test("the controls with no key get words", () => {
		expect(triggerLabel({ kind: "mouse-move", axis: "x" })).toMatch(/mouse/);
		expect(
			triggerLabel({
				kind: "pad-stick",
				stick: "left",
				axis: "x",
				contexts: ["flight"],
			}),
		).toMatch(/left stick/);
		expect(
			triggerLabel({
				kind: "pad-trigger",
				trigger: "r2",
				contexts: ["flight"],
			}),
		).toBe("R2");
		expect(
			triggerLabel({
				kind: "pad-button",
				button: "left",
				contexts: ["flight"],
			}),
		).toBe("d-pad ←");
	});

	test("every trigger in the shipped catalogue prints as something", () => {
		for (const c of CONTROLS.commands)
			for (const t of c.currentTriggers)
				expect(`${c.id}: ${triggerLabel(t).trim().length > 0}`).toBe(
					`${c.id}: true`,
				);
	});
});

describe("the context note", () => {
	const row = (id: string) => {
		const c = CONTROLS.commands.find((each) => each.id === id);
		if (!c) throw new Error(id);
		return c;
	};

	test("a pad button whose meaning moves with the context says both meanings", () => {
		// #370 D4's example: ↑ is head-forward in flight and the cursor in a
		// console, and the row says so.
		const note = contextNote(CONTROLS, row("head-forward"));
		expect(note).toContain("d-pad ↑ in flight");
		expect(note).toContain("in instrument, console, menu:");
		expect(note).toContain("flight");
		expect(note).toContain("console");
		expect(note).toContain(row("console-cursor").name);
	});

	test("a key-only row has none", () => {
		expect(contextNote(CONTROLS, row("dial-reset"))).toBe("");
	});
});

describe("the body the tab prints", () => {
	test("names the layout's owner, the chord and the layout assumed", () => {
		const html = controlsBody(CONTROLS, new Set());
		expect(html).toContain("DEFAULT LAYOUT");
		expect(html).not.toMatch(/your layout/i);
		expect(html).toContain(CONTROLS_CHORD);
		expect(html).toMatch(/US/);
	});

	test("prints every command in the shipped catalogue, and a header per group", () => {
		const html = controlsBody(CONTROLS, new Set());
		for (const c of CONTROLS.commands)
			expect(html).toContain(`data-live-controls-row="${c.id}"`);
		for (const g of TASK_GROUPS)
			expect(html).toContain(`data-live-controls-group="${g}"`);
	});

	test("a folded group says so on its header and prints none of its rows", () => {
		const html = controlsBody(CONTROLS, new Set(["dock"] as const));
		expect(html).toContain(
			'data-live-controls-group="dock" aria-expanded="false"',
		);
		expect(html).not.toContain('data-live-controls-row="clearance"');
	});

	test("replaces the panel body wholesale, rather than the 48-character copy column", () => {
		const html = controlsBody(CONTROLS, new Set());
		expect(html.startsWith('<div class="lc-panel-body')).toBe(true);
		expect(html).not.toContain("lc-panel-copy");
	});
});

describe("a tab picked by hand", () => {
	test("picking Controls by hand remembers the tab it replaced", () => {
		expect(restoreOnTabPick("Flight", CONTROLS_TAB, "Drive")).toBe("Flight");
	});

	test("picking another tab by hand forgets what ? remembered", () => {
		// Open with ? from Drive, then click Flight: Drive is no longer the tab
		// the player was reading.
		expect(restoreOnTabPick(CONTROLS_TAB, "Flight", "Drive")).toBeNull();
	});

	test("the sage round 1 sequence closes on the last tab read", () => {
		// ? from Drive, click Flight, click Controls, ? — Flight comes back.
		let restore = controlsKeyMove(cockpit)?.restoreTab ?? null;
		restore = restoreOnTabPick(CONTROLS_TAB, "Flight", restore);
		restore = restoreOnTabPick("Flight", CONTROLS_TAB, restore);
		expect(
			controlsKeyMove({
				...cockpit,
				headLook: "right",
				rightTab: CONTROLS_TAB,
				restoreTab: restore,
			})?.rightTab,
		).toBe("Flight");
	});

	test("clicking Controls while already on it keeps the memory", () => {
		expect(restoreOnTabPick(CONTROLS_TAB, CONTROLS_TAB, "Drive")).toBe("Drive");
	});
});
