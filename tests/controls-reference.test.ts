/**
 * The Controls tab's arithmetic (#372): the law of `?`, the folding tree, the
 * cursor's hand-off on a fold, and how a trigger prints.
 *
 * Everything here renders from the **shipped** catalogue, `CONTROLS`. A table
 * built inside this file would test a different object from the one the game
 * prints (#370 D2, item 6).
 */
import { describe, expect, test } from "bun:test";
import { LAYOUT_VERSION, parseLayout } from "../src/binding-store";
import type { LayoutNotice, RejectReason } from "../src/layout-notice";
import {
	type CommandId,
	commandById,
	DEFAULT_BINDINGS,
	offAuthoredLayout,
	rebound,
	SHIPPED_LAYOUTS,
	TASK_GROUPS,
	type Trigger,
	triggerKey,
} from "../src/commands";
import { CONTROLS, controlsCatalogue } from "../src/controls-catalogue";
import {
	CONTROLS_CHORD,
	CONTROLS_TAB,
	OFF_LAYOUT_MARK,
	contextNote,
	controlsBody,
	controlsKeyMove,
	controlsTree,
	focusAfterFold,
	actionFocusId,
	groupFocusId,
	noticeText,
	REJECTED_WHY,
	rowFocusId,
	restoreOnTabPick,
	toggleGroup,
} from "../src/controls-reference";
import { triggerLabel } from "../src/key-names";
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
				: item.kind === "action"
					? actionFocusId(item.action)
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
			else if (item.kind === "row")
				expect(item.command.group as string).toBe(group);
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

	test("a held key says so, as a held pad button always has", () => {
		// **#369 D3's split on `x`, which this screen could not show.**
		// `fly.assist` is `x` pressed and `fight.fireBeam` is `x` held, and
		// both printed `x` until #381 S4 — while the pad branch had said
		// `hold Y` since #372, so the inconsistency was inside one function.
		// Found by looking at the capture modal: a player moving `fly.pitchUp`
		// onto a new key has to know the new key is one they hold.
		expect(key("w", { hold: true } as Partial<Trigger>)).toBe("hold w");
		expect(key("arrowdown", { hold: true } as Partial<Trigger>)).toBe("hold ↓");
		expect(
			key("arrowleft", { alt: true, hold: true } as Partial<Trigger>),
		).toBe("hold Alt + ←");
		// And a press is unchanged, which is what makes the pair legible.
		expect(key("x")).toBe("x");
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
	// Derived from the shipped table rather than written out: a hand-copied
	// list is caught by `Record<RejectReason, string>` when a reason is *added*
	// there and silently skipped by the uniqueness check here (sage round 3).
	const REJECT_REASONS = Object.keys(REJECTED_WHY) as RejectReason[];
	const rejected: LayoutNotice = {
		kind: "rejected",
		command: ROLL,
		reason: "refused-by-registry",
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

	test("a store that refuses a read promises no repair it cannot make", () => {
		// A store that throws on `getItem` throws on `setItem`, so the sentence
		// that ends "changing a control will replace them" printed beside
		// "This change could not be saved" for a round (sage round 4).
		const refused = noticeText({
			kind: "unreadable",
			cause: "refused",
			detail: "access denied",
		});
		expect(refused).not.toMatch(/will replace/i);
		expect(refused).toMatch(/will not be saved/i);
		// The blob is there and unreadable: the store works, so the promise is
		// true and is made.
		expect(
			noticeText({ kind: "unreadable", cause: "corrupt", detail: "x" }),
		).toMatch(/will replace/i);
	});

	test("the thrown message is kept and never drawn", () => {
		for (const cause of ["refused", "corrupt"] as const)
			expect(
				noticeText({ kind: "unreadable", cause, detail: "SecurityError: x" }),
			).not.toContain("SecurityError");
	});

	test("a stored string reaching a sentence is cut to a line", () => {
		const long = "z".repeat(500);
		expect(
			noticeText({
				kind: "rejected",
				command: long,
				reason: "unknown-control",
				detail: "d",
			}).length,
		).toBeLessThan(200);
		expect(noticeText({ kind: "version", stored: long }).length).toBeLessThan(
			200,
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

	test("a key out of the string store cannot reach the markup as markup", () => {
		// **The only thing between a player-writable store and `innerHTML` is
		// `rowMarkup`'s `escapeHtml`, and nothing asserted it** — the store's
		// own comment named it and a length cap was standing in for a proof
		// (sage round 5). A future change to `rowMarkup` fails here.
		const from = DEFAULT_BINDINGS.find(
			(b) => b.command === "fly.pitchUp" && b.trigger.kind === "key",
		)?.trigger;
		if (from === undefined || from.kind !== "key")
			throw new Error("no shipped pitch-up key");
		const read = parseLayout(
			JSON.stringify({
				version: LAYOUT_VERSION,
				moves: [
					{
						command: "fly.pitchUp",
						from,
						to: { ...from, key: "<img src=x onerror=1>", code: undefined },
					},
				],
			}),
		);
		expect(read.notices).toEqual([]);
		const html = controlsBody(controlsCatalogue(read.layout), new Set());
		expect(html).toContain("&lt;img");
		expect(html).not.toContain("<img");
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

/**
 * Whose layout the printed characters came from (node #382).
 *
 * #369 D7 dispatches on the physical key and prints the character a binding
 * was recorded with, so a printed character is evidence about the keyboard a
 * row was bound on. Every fixture below is built by the shipped path —
 * `rebound`, or a stored blob through `parseLayout` — and printed by
 * `controlsCatalogue`, never a struct this file authored.
 */
describe("whose layout a printed key came from", () => {
	const JUMP: CommandId = "fly.jump";
	const jumpKey = () => {
		const t = DEFAULT_BINDINGS.find(
			(b) => b.command === JUMP && b.trigger.kind === "key",
		)?.trigger;
		if (t === undefined) throw new Error("no shipped jump key");
		return t;
	};
	/** The jump moved onto what a capture would hand over for this press. */
	const capture = (key: string, code: string) =>
		rebound(DEFAULT_BINDINGS, JUMP, jumpKey(), { kind: "key", key, code });
	const marks = (html: string) =>
		html.match(/data-live-controls-off-layout/g)?.length ?? 0;

	test("no shipped layout carries a key off the layout it was authored on", () => {
		for (const [name, layout] of Object.entries(SHIPPED_LAYOUTS)) {
			const off = layout.filter((b) => offAuthoredLayout(b.trigger));
			expect({ name, off }).toEqual({ name, off: [] });
			const html = controlsBody(controlsCatalogue(layout), new Set());
			expect(marks(html)).toBe(0);
			expect(html).not.toContain(OFF_LAYOUT_MARK);
		}
	});

	test("an AZERTY capture prints the character it was recorded with, marked", () => {
		// The key at A's position types `q` on AZERTY. KeyA carries no press
		// in the shipped table, so the move collides with nothing.
		const { layout, stored } = capture("q", "KeyA");
		expect(stored).toMatchObject({ kind: "key", key: "q", code: "KeyA" });
		expect(offAuthoredLayout(stored)).toBe(true);
		const catalogue = controlsCatalogue(layout);
		expect(catalogue.notices).toEqual([]);
		const html = controlsBody(catalogue, new Set());
		const row = html.match(
			/<div class="lc-controls-row" data-live-controls-row="fly\.jump">.*?<\/div>/,
		)?.[0];
		if (row === undefined) throw new Error("no jump row");
		// The printed label is the recorded character, never one derived from
		// the position: `q`, not `a`.
		expect(row).toContain("<kbd>q</kbd>");
		expect(row).not.toContain("<kbd>a</kbd>");
		expect(marks(row)).toBe(1);
		expect(row).toContain(OFF_LAYOUT_MARK);
		expect(marks(html)).toBe(1);
	});

	test("the mark is on the trigger, not the row", () => {
		// The jump has a pad button beside the key, and only the key was // glossary-ignore: pad
		// recorded anywhere.
		const html = controlsBody(
			controlsCatalogue(capture("q", "KeyA").layout),
			new Set(),
		);
		const row = html.match(
			/<div class="lc-controls-row" data-live-controls-row="fly\.jump">.*?<\/div>/,
		)?.[0];
		expect(row?.match(/<kbd>/g)?.length).toBeGreaterThan(1);
		expect(marks(row ?? "")).toBe(1);
	});

	test("a US capture of a shifted character is not marked", () => {
		// `?` and `!` are what a US keyboard types at Slash and Digit1 under
		// Shift, so the sentence above them stays true.
		expect(offAuthoredLayout(capture("?", "Slash").stored)).toBe(false);
		expect(offAuthoredLayout(capture("!", "Digit1").stored)).toBe(false);
		expect(offAuthoredLayout(capture("/", "Slash").stored)).toBe(false);
		expect(offAuthoredLayout(capture("w", "KeyW").stored)).toBe(false);
	});

	test("a key another layout types at a US position is marked", () => {
		// German: the key at Slash types `-`, the one at Minus types `ß`, and
		// the one at KeyZ types `y`.
		expect(offAuthoredLayout(capture("-", "Slash").stored)).toBe(true);
		expect(offAuthoredLayout(capture("ß", "Minus").stored)).toBe(true);
		expect(offAuthoredLayout(capture("y", "KeyZ").stored)).toBe(true);
		// A key the US layout does not have types nothing there.
		expect(offAuthoredLayout(capture("<", "IntlBackslash").stored)).toBe(true);
	});

	test("a key string of several code points is a character, not a name", () => {
		// UI Events allows a key string such as `ḍ̇` — d, dot below, dot
		// above: three code points, one character some keyboard types.
		const combining = "ḍ̇";
		const { layout, stored } = capture(combining, "KeyA");
		expect(stored).toMatchObject({ key: combining, code: "KeyA" });
		expect(offAuthoredLayout(stored)).toBe(true);
		const html = controlsBody(controlsCatalogue(layout), new Set());
		expect(html).toContain(`<kbd>${combining}</kbd>`);
		expect(marks(html)).toBe(1);
		expect(html).toContain('data-live-controls-attribution="recorded"');
	});

	test("a codeless key the US layout types nowhere is marked", () => {
		// A stored blob can carry a character with no code; it names no
		// position, so it is compared against every character a US keyboard
		// types, and `ü` is none of them.
		const from = jumpKey();
		if (from.kind !== "key") throw new Error("shipped jump key is not a key");
		const read = parseLayout(
			JSON.stringify({
				version: LAYOUT_VERSION,
				moves: [
					{
						command: JUMP,
						from,
						to: { kind: "key", key: "ü", hold: from.hold },
					},
				],
			}),
		);
		expect(read.notices).toEqual([]);
		const stored = read.layout.find((b) => b.command === JUMP)?.trigger;
		expect(stored).toMatchObject({ kind: "key", key: "ü" });
		expect(
			stored && "code" in stored ? stored.code : undefined,
		).toBeUndefined();
		if (stored === undefined) throw new Error("no jump binding");
		expect(offAuthoredLayout(stored)).toBe(true);
		const html = controlsBody(controlsCatalogue(read.layout), new Set());
		expect(html).toContain("<kbd>ü</kbd>");
		expect(marks(html)).toBe(1);
		expect(html).toContain('data-live-controls-attribution="recorded"');
		// The codeless characters a US keyboard does type stay unmarked.
		expect(offAuthoredLayout({ kind: "key", key: "?" })).toBe(false);
		expect(offAuthoredLayout({ kind: "key", key: "7" })).toBe(false);
		expect(offAuthoredLayout({ kind: "key", key: " " })).toBe(false);
	});

	test("the number pad is compared against the US pad, not exempt", () => {
		// The US pad types these, so the sentence above them stays true.
		expect(offAuthoredLayout(capture("1", "Numpad1").stored)).toBe(false);
		expect(offAuthoredLayout(capture(".", "NumpadDecimal").stored)).toBe(false);
		expect(offAuthoredLayout(capture("+", "NumpadAdd").stored)).toBe(false);
		// A Brazilian or German pad types `,` at NumpadDecimal, which a US one
		// types as `.`.
		expect(offAuthoredLayout(capture(",", "NumpadDecimal").stored)).toBe(true);
		// The US layout has no NumpadComma, so it types nothing there.
		expect(offAuthoredLayout(capture(",", "NumpadComma").stored)).toBe(true);
		// Num Lock off sends a named key, spelled alike everywhere.
		expect(offAuthoredLayout(capture("delete", "NumpadDecimal").stored)).toBe(
			false,
		);
		// The printed label is the recorded comma, marked.
		const html = controlsBody(
			controlsCatalogue(capture(",", "NumpadDecimal").layout),
			new Set(),
		);
		expect(html).toContain("<kbd>,</kbd>");
		expect(marks(html)).toBe(1);
	});

	test("names, chords and codeless keys are never marked", () => {
		expect(offAuthoredLayout(capture("arrowup", "ArrowUp").stored)).toBe(false);
		expect(offAuthoredLayout(capture("f6", "F6").stored)).toBe(false);
		// A chord stores the character its position types on the authored
		// layout (`movedTrigger`), so it cannot be off it.
		const HEAD_PORT: CommandId = "view.headPort";
		const shippedChord = DEFAULT_BINDINGS.find(
			(b) =>
				b.command === HEAD_PORT &&
				b.trigger.kind === "key" &&
				b.trigger.alt === true,
		)?.trigger;
		if (shippedChord === undefined) throw new Error("no shipped chord");
		expect(offAuthoredLayout(shippedChord)).toBe(false);
		const chord = rebound(DEFAULT_BINDINGS, HEAD_PORT, shippedChord, {
			kind: "key",
			key: "∂",
			code: "KeyD",
			alt: true,
		});
		expect(chord.stored).toMatchObject({ key: "d", alt: true });
		expect(offAuthoredLayout(chord.stored)).toBe(false);
		expect(offAuthoredLayout({ kind: "key", key: "`" })).toBe(false);
	});

	test("the header says whose characters they are, and says the exception when a row disagrees", () => {
		const head = (html: string) =>
			html.match(/<header class="lc-controls-head">.*?<\/header>/)?.[0] ?? "";
		const shipped = head(controlsBody(CONTROLS, new Set()));
		expect(shipped).toContain('data-live-controls-attribution="authored"');
		expect(shipped).toContain("US keyboard");
		expect(shipped).not.toContain(OFF_LAYOUT_MARK);
		// The sentence it replaces claimed every key prints as the character
		// the player types, which a default never was on another layout.
		expect(shipped).not.toContain("the character you type");

		// A player layout rebound on a US keyboard is still all US characters.
		const usOnly = head(
			controlsBody(controlsCatalogue(capture("k", "KeyK").layout), new Set()),
		);
		expect(usOnly).toContain("PLAYER LAYOUT");
		expect(usOnly).toContain('data-live-controls-attribution="authored"');
		expect(usOnly).not.toContain(OFF_LAYOUT_MARK);

		const mixed = head(
			controlsBody(controlsCatalogue(capture("q", "KeyA").layout), new Set()),
		);
		expect(mixed).toContain("PLAYER LAYOUT");
		expect(mixed).toContain('data-live-controls-attribution="recorded"');
		expect(mixed).toContain("US keyboard");
		expect(mixed).toContain(OFF_LAYOUT_MARK);
		expect(mixed).toContain("another layout");
	});

	test("a stored capture keeps its position and its character across a reload", () => {
		const from = jumpKey();
		const read = parseLayout(
			JSON.stringify({
				version: LAYOUT_VERSION,
				moves: [
					// glossary-ignore: Command
					{ command: JUMP, from, to: { kind: "key", key: "q", code: "KeyA" } },
				],
			}),
		);
		expect(read.notices).toEqual([]);
		const html = controlsBody(controlsCatalogue(read.layout), new Set());
		expect(html).toContain("<kbd>q</kbd>");
		expect(marks(html)).toBe(1);
	});
});
