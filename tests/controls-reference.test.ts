/**
 * The Controls tab's arithmetic (#372): the law of `?`, the folding tree, the
 * cursor's hand-off on a fold, and how a trigger prints.
 *
 * Everything here renders from the **shipped** catalogue, `CONTROLS`. A table
 * built inside this file would test a different object from the one the game
 * prints (#370 D2, item 6).
 */
import { describe, expect, test } from "bun:test";
import type { LayoutNotice, RejectReason } from "../src/binding-store";
import {
	type CommandId,
	commandById,
	DEFAULT_BINDINGS,
	TASK_GROUPS,
	type Trigger,
	triggerKey,
} from "../src/commands";
import { CONTROLS, controlsCatalogue } from "../src/controls-catalogue";
import {
	CONTROLS_CHORD,
	CONTROLS_TAB,
	contextNote,
	controlsBody,
	controlsKeyMove,
	controlsTree,
	focusAfterFold,
	groupFocusId,
	noticeText,
	rowFocusId,
	restoreOnTabPick,
	toggleGroup,
	triggerLabel,
} from "../src/controls-reference";
import type { TreeItem } from "../src/controls-reference";
import type { DockPhase } from "../src/dock-session";
import {
	type FocusItem,
	NO_FOCUS,
	focusedItem,
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
		const onRow = setFocus(open, NO_FOCUS, rowFocusId("fly.rollPort"));
		expect(focusedItem(open, onRow)?.id).toBe(rowFocusId("fly.rollPort"));
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
		// **The direction word, not just the noun.** `half` exists because a
		// split pair would otherwise print one string on two rows, so a row
		// matching only /mouse/ would stay green with the `WAY` table's
		// entries swapped — or with `way()` deleted.
		expect(triggerLabel({ kind: "mouse-move", axis: "x", half: "+" })).toBe(
			"move the mouse right",
		);
		expect(triggerLabel({ kind: "mouse-move", axis: "y", half: "-" })).toBe(
			"move the mouse up",
		);
		expect(
			triggerLabel({
				kind: "pad-stick",
				stick: "left",
				axis: "x",
				half: "-",
				contexts: ["flight"],
			}),
		).toBe("left stick left");
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
		const note = contextNote(CONTROLS, row("view.headForward"));
		expect(note).toContain("d-pad ↑ in flight");
		expect(note).toContain("in instrument, console, menu:");
		expect(note).toContain("flight");
		expect(note).toContain("console");
		expect(note).toContain(row("panel.cursorUp").name);
	});

	test("a key-only row has none", () => {
		expect(contextNote(CONTROLS, row("tune.reset"))).toBe("");
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

describe("the band above the tree (#381 S3)", () => {
	const ROLL: CommandId = "fly.rollPort";
	const PITCH_UP: CommandId = "fly.pitchUp";
	const PITCH_DOWN: CommandId = "fly.pitchDown";
	const REJECT_REASONS: readonly RejectReason[] = [
		"unreadable-row",
		"unknown-control",
		"unreadable-trigger",
		"moved-default",
		"already-changed",
		"not-just-a-key",
	];
	const rejected: LayoutNotice = {
		kind: "rejected",
		command: ROLL,
		reason: "not-just-a-key",
		detail:
			"a rebind may move a key, not its qualifiers: key:q::hold -> key:k::press",
	};

	test("a catalogue with no notices draws no band at all", () => {
		// Absent rather than empty: a box with nothing in it reads as a screen
		// that failed to draw.
		expect(controlsBody(CONTROLS, new Set())).not.toContain(
			"data-live-controls-notices",
		);
	});

	test("a notice is drawn, in the tab, above the tree", () => {
		const html = controlsBody(
			controlsCatalogue(DEFAULT_BINDINGS, [rejected]),
			new Set(),
		);
		expect(html).toContain("data-live-controls-notices");
		expect(html).toContain('data-live-controls-notice="rejected"');
		expect(html).toContain(commandById(ROLL).name);
		expect(html.indexOf("data-live-controls-notices")).toBeLessThan(
			html.indexOf("data-live-controls-tree"),
		);
	});

	test("what is drawn is the sentence, never the detail's hash", () => {
		// `rebind`'s message is kept for a console; the tab prints a table over
		// the reason. The band read `key:q::hold -> key:k::press` for a round.
		const html = controlsBody(
			controlsCatalogue(DEFAULT_BINDINGS, [rejected]),
			new Set(),
		);
		expect(html).not.toContain("key:q::hold");
	});

	test("a version the build refused names it, and quotes a string one", () => {
		// `"1"` printed through `String` reads exactly like the number this
		// build is, and an absent version printed `undefined`.
		expect(noticeText({ kind: "version", stored: 2 })).toContain("version 2");
		expect(noticeText({ kind: "version", stored: "1" })).toContain('"1"');
		expect(noticeText({ kind: "version", stored: undefined })).toContain(
			"no version",
		);
	});

	test("a control this build does not have is still named", () => {
		// Reachable: a saved row may name a command that has since been removed,
		// and a notice that printed nothing there is a refusal nobody can act on.
		const text = noticeText({
			kind: "rejected",
			command: "fly.wiggle",
			reason: "unknown-control",
			detail: "no command is called fly.wiggle",
		});
		expect(text).toContain("fly.wiggle");
		expect(text.trim().length).toBeGreaterThan(0);
	});

	test("a change the browser refused says so, and says what still works", () => {
		// The rebind flies and does not survive the page. Saying nothing was
		// the same silent failure the band exists to abolish (sage round 2).
		const text = noticeText({ kind: "unsaved" });
		expect(text).toMatch(/could not be saved/i);
		expect(text).toMatch(/reload/i);
	});

	test("every reason a row can be rejected for has its own sentence", () => {
		// A `Record<RejectReason, string>` makes a missing one a type error, and
		// this is the row that makes a *duplicated* one visible: two reasons
		// with the same words are two answers the player cannot tell apart.
		const said = REJECT_REASONS.map((reason) =>
			noticeText({
				kind: "rejected",
				command: "fly.rollPort",
				reason,
				detail: "d",
			}),
		);
		expect(new Set(said).size).toBe(REJECT_REASONS.length);
		for (const t of said) expect(t.trim().length).toBeGreaterThan(0);
	});

	test("a collision names both commands and the key, in words", () => {
		const trigger = DEFAULT_BINDINGS.find(
			(b) => b.command === PITCH_DOWN && b.trigger.kind === "key",
		)?.trigger;
		if (trigger === undefined) throw new Error("no shipped pitch-down key");
		const text = noticeText({
			kind: "collision",
			collision: {
				trigger: triggerKey(trigger),
				commands: [PITCH_UP, PITCH_DOWN],
				scope: { pad: ["flight"], views: ["cockpit", "chase"] },
			},
			at: trigger,
		});
		expect(text).toContain(commandById(PITCH_UP).name);
		expect(text).toContain(commandById(PITCH_DOWN).name);
		expect(text).toContain(triggerLabel(trigger));
		// It says what the game does — both commands run — and not #369 D5's
		// last-changed law, which no dispatch implements. #484 owns that.
		expect(text).toMatch(/both run/i);
	});
});
