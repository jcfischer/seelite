/**
 * The Controls tab (#372): the law of `?`, the folding tree, and the markup.
 *
 * A view of `controls-catalogue.ts` and nothing else. It holds no binding of
 * its own, so #369's registry replacing the catalogue's innards changes what
 * this prints and not how. Headless, so the unit tier renders the shipped
 * catalogue through the same function the right console calls.
 *
 * #370's receipt carries the nine rulings; the comments below cite them by
 * their D-number rather than restating them.
 */
import type {
	ControlCommand,
	ControlsCatalogue,
	TaskGroup,
	Trigger,
} from "./controls-catalogue";
import { PAD_CONTEXTS, TASK_GROUPS } from "./controls-catalogue";
import type { FocusCursor, FocusItem } from "./panel-focus";
import { setFocus } from "./panel-focus";
import type { PadContext } from "./pad-bindings";

/** D1: the tab's name, between `Drive` and `Tuning`. */
export const CONTROLS_TAB = "Controls";

/**
 * D7: the chord, not the glyph. `?` is `Shift + /` on the US layout and a
 * different chord elsewhere, so the header names the chord and the layout it
 * assumes.
 */
export const CONTROLS_CHORD = "Shift + /";

// ---------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------

export interface ControlsKeyState<T extends string> {
	view: "cockpit" | "chase";
	dockPhase: string;
	headLook: "forward" | "left" | "right";
	rightTab: T;
	/** The right tab `?` found when it opened, or null. */
	restoreTab: T | null;
}

export type ControlsKeyMove<T extends string> = Pick<
	ControlsKeyState<T>,
	"headLook" | "rightTab" | "restoreTab"
>;

/**
 * D3: what `?` does, or `null` for nothing.
 *
 * **Open** is the head to starboard with `Controls` selected; `?` there closes
 * it — head forward, and the tab it found restored. Anywhere else it opens,
 * remembering the tab it replaces. Silent outside the cockpit view, which is
 * the abstention `1` and `3` already make: `?` borrows head-look, so it
 * borrows its limits.
 *
 * **Silent while docked, and that asymmetry is deliberate.** Head-look itself
 * still works docked and `3` still turns the head; only `?` abstains, because
 * §8's M2 puts the station console on the forward wall and it owns the docked
 * screen. The bay traversals are not docked — the head turns there, so `?`
 * does too.
 */
export function controlsKeyMove<T extends string>(
	state: ControlsKeyState<T | typeof CONTROLS_TAB>,
): ControlsKeyMove<T | typeof CONTROLS_TAB> | null {
	if (state.view !== "cockpit" || state.dockPhase === "docked") return null;
	if (state.headLook === "right" && state.rightTab === CONTROLS_TAB)
		return {
			headLook: "forward",
			rightTab: state.restoreTab ?? state.rightTab,
			restoreTab: null,
		};
	return {
		headLook: "right",
		rightTab: CONTROLS_TAB,
		restoreTab:
			state.rightTab === CONTROLS_TAB ? state.restoreTab : state.rightTab,
	};
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

export type TreeItem =
	| { kind: "header"; group: TaskGroup; count: number }
	| { kind: "row"; command: ControlCommand };

/**
 * D6: two levels, group header and rows, in task order. A folded group keeps
 * its header — that is what the player opens it again with.
 */
export function controlsTree(
	catalogue: ControlsCatalogue,
	collapsed: ReadonlySet<TaskGroup>,
): TreeItem[] {
	const items: TreeItem[] = [];
	for (const group of TASK_GROUPS) {
		const rows = catalogue.commands.filter((c) => c.group === group);
		items.push({ kind: "header", group, count: rows.length });
		if (!collapsed.has(group))
			for (const command of rows) items.push({ kind: "row", command });
	}
	return items;
}

/** A new set with `group` folded or opened. The one it is given is left alone. */
export function toggleGroup(
	collapsed: ReadonlySet<TaskGroup>,
	group: TaskGroup,
): Set<TaskGroup> {
	const next = new Set(collapsed);
	if (next.has(group)) next.delete(group);
	else next.add(group);
	return next;
}

/** The cursor's names for the tree's items, as `live-cockpit.ts` reads them off the DOM. */
export const groupFocusId = (group: TaskGroup) => `controls-group:${group}`;
export const rowFocusId = (id: string) => `controls-row:${id}`;

export const treeFocusIds = (items: readonly TreeItem[]): FocusItem[] =>
	items.map((item) => ({
		id:
			item.kind === "header"
				? groupFocusId(item.group)
				: rowFocusId(item.command.id),
	}));

/**
 * D9: a fold hands the cursor to the header that folded.
 *
 * Without this the cursor keeps its id, the id is gone, and `panel-focus`
 * falls back to the index — which is now some other group's row, and `A`
 * would act on it.
 */
export function focusAfterFold(
	items: readonly FocusItem[],
	cursor: FocusCursor,
	group: TaskGroup,
): FocusCursor {
	return setFocus(items, cursor, groupFocusId(group));
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const KEY_WORDS: Readonly<Record<string, string>> = {
	" ": "Space",
	enter: "Enter",
	shift: "Shift",
	control: "Ctrl",
	arrowup: "↑",
	arrowdown: "↓",
	arrowleft: "←",
	arrowright: "→",
};

const PAD_WORDS: Readonly<Record<string, string>> = {
	up: "d-pad ↑",
	down: "d-pad ↓",
	left: "d-pad ←",
	right: "d-pad →",
	start: "Start",
	select: "Select",
	home: "Home",
};

const padButton = (button: string) =>
	PAD_WORDS[button] ?? button.toUpperCase();

/** The player's word for a pad context. `modal` is a menu on screen. */
const CONTEXT_WORDS: Readonly<Record<PadContext, string>> = {
	flight: "flight",
	instrument: "instrument",
	console: "console",
	modal: "menu",
};

/**
 * D7 and D8: a key prints as its character, a chord spelled out, and a control
 * with no character gets words.
 */
export function triggerLabel(t: Trigger): string {
	switch (t.kind) {
		case "key": {
			const base = KEY_WORDS[t.key] ?? t.key;
			const chord = t.alt ? `Alt + ${base}` : base;
			return t.surface ? `${chord} (${t.surface})` : chord;
		}
		case "mouse-button":
			return t.action === "hold" ? "hold left mouse button" : "click";
		case "mouse-move":
			return `move the mouse ${t.axis === "x" ? "↔" : "↕"}`;
		case "pad-button":
			return t.hold ? `hold ${padButton(t.button)}` : padButton(t.button);
		case "pad-stick":
			return `${t.stick} stick ${t.axis === "x" ? "↔" : "↕"}`;
		case "pad-trigger":
			return t.trigger.toUpperCase();
		case "pad-intent":
			return padButton(t.button);
	}
}

type PadPress = Extract<Trigger, { kind: "pad-button" | "pad-intent" }>;

const isPadPress = (t: Trigger): t is PadPress =>
	t.kind === "pad-button" || t.kind === "pad-intent";

/**
 * D4: the context note, derived.
 *
 * For each pad button on this row whose meaning depends on the context, where
 * it means this row and what it means elsewhere — ↑ is head-forward in flight
 * and the cursor in a console. Empty for a row whose pad buttons mean one thing
 * wherever they act, and for a row with no pad button at all.
 */
export function contextNote(
	catalogue: ControlsCatalogue,
	command: ControlCommand,
): string {
	const parts: string[] = [];
	const seen = new Set<string>();
	for (const t of command.currentTriggers) {
		if (!isPadPress(t) || seen.has(t.button)) continue;
		seen.add(t.button);
		// Every command this button reaches, by context.
		const elsewhere = new Map<string, PadContext[]>();
		for (const other of catalogue.commands) {
			if (other.id === command.id) continue;
			for (const o of other.currentTriggers)
				if (isPadPress(o) && o.button === t.button && !("hold" in o && o.hold))
					for (const c of o.contexts)
						if (!t.contexts.includes(c))
							elsewhere.set(other.name, [
								...(elsewhere.get(other.name) ?? []),
								c,
							]);
		}
		if (elsewhere.size === 0) continue;
		const where = (cs: readonly PadContext[]) =>
			PAD_CONTEXTS.filter((c) => cs.includes(c))
				.map((c) => CONTEXT_WORDS[c])
				.join(", ");
		// Two commands the button reaches in the same contexts share one clause:
		// `A` in a console is the market row *and* the generic select.
		const byWhere = new Map<string, string[]>();
		for (const [name, cs] of elsewhere)
			byWhere.set(where(cs), [...(byWhere.get(where(cs)) ?? []), name]);
		const others = [...byWhere]
			.map(([at, names]) => `${at}: ${names.join(" / ")}`)
			.join(" · ");
		parts.push(`${padButton(t.button)} — ${where(t.contexts)} · ${others}`);
	}
	return parts.join("; ");
}

const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");

const GROUP_WORDS: Readonly<Record<TaskGroup, string>> = {
	fly: "FLY",
	fight: "FIGHT",
	dock: "DOCK",
	trade: "TRADE",
	view: "VIEW",
	system: "SYSTEM",
};

function rowMarkup(catalogue: ControlsCatalogue, command: ControlCommand) {
	const triggers = command.currentTriggers.length
		? command.currentTriggers
				.map((t) => `<kbd>${escapeHtml(triggerLabel(t))}</kbd>`)
				.join("")
		: "<em>unbound</em>";
	const note = contextNote(catalogue, command);
	return `<div class="lc-controls-row" data-live-controls-row="${command.id}"><span class="lc-controls-name">${escapeHtml(command.name)}</span><span class="lc-controls-keys">${triggers}</span>${note ? `<small class="lc-controls-note">${escapeHtml(note)}</small>` : ""}</div>`;
}

/** The tree alone: what a fold redraws. */
export function controlsTreeMarkup(
	catalogue: ControlsCatalogue,
	collapsed: ReadonlySet<TaskGroup>,
): string {
	return controlsTree(catalogue, collapsed)
		.map((item) =>
			item.kind === "header"
				? `<button class="lc-controls-group" type="button" data-live-controls-group="${item.group}" aria-expanded="${!collapsed.has(item.group)}"><span>${collapsed.has(item.group) ? "▸" : "▾"} ${GROUP_WORDS[item.group]}</span><small>${item.count}</small></button>`
				: rowMarkup(catalogue, item.command),
		)
		.join("");
}

/**
 * The whole right-console body for the tab: header line and tree.
 *
 * D6: the panel's body is replaced wholesale, on the `[data-live-chart-body]`
 * precedent — the rail-and-copy grid would put the tree in a 48-character
 * column. D5: the owner line reads `DEFAULT LAYOUT` until the registry can
 * report a player one, and never "your layout" before it can.
 */
export function controlsBody(
	catalogue: ControlsCatalogue,
	collapsed: ReadonlySet<TaskGroup>,
): string {
	const owner = catalogue.layout === "default" ? "DEFAULT LAYOUT" : "PLAYER LAYOUT";
	return `<div class="lc-panel-body lc-controls" data-live-controls-body><header class="lc-controls-head"><b data-live-controls-owner>${owner}</b><span>${CONTROLS_CHORD} opens and closes this tab</span><span>Keys print as a US keyboard types them</span></header><div class="lc-controls-tree" data-live-controls-tree>${controlsTreeMarkup(catalogue, collapsed)}</div></div>`;
}
