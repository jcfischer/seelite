/**
 * The Controls tab (#372): the law of `?`, the folding tree, and the markup.
 *
 * A view of `controls-catalogue.ts` and nothing else. It holds no binding of
 * its own and spells no key — `key-names.ts` does (#499) — so #369's
 * registry replacing the catalogue's innards changes what this prints and not
 * how. Headless, so the unit tier renders the shipped catalogue through the
 * same function the right console calls.
 *
 * #370's receipt carries the nine rulings; the comments below cite them by
 * their D-number rather than restating them.
 */
import type { LayoutNotice, RejectReason } from "./layout-notice";
import { escapeHtml } from "./escape-html";
import type { RebindRefusal, TaskGroup, Trigger } from "./commands";
import { COMMANDS, PAD_CONTEXTS, TASK_GROUPS, VIEW_MODES } from "./commands";
import type { ControlCommand, ControlsCatalogue } from "./controls-catalogue";
import type { DockPhase } from "./dock-session";
import type { FocusCursor, FocusItem } from "./panel-focus";
import { setFocus } from "./panel-focus";
import type { PadContext } from "./pad-bindings";
import { padButton, triggerLabel } from "./key-names";

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
	dockPhase: DockPhase;
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
 * screen. The traversals are not docked — the head turns there, so `?`
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

/**
 * The memory `?` keeps when the player picks a right tab by hand.
 *
 * Picking `Controls` remembers the tab it replaced, the way `?` does; picking
 * any other tab forgets, because the tab `?` remembered is no longer the one the
 * player was reading. Without this, `?` from Drive, a click on Flight, a click
 * back on Controls and `?` again restored Drive — sage round 1.
 */
export function restoreOnTabPick<T extends string>(
	previous: T | typeof CONTROLS_TAB,
	next: T | typeof CONTROLS_TAB,
	restore: T | typeof CONTROLS_TAB | null,
): T | typeof CONTROLS_TAB | null {
	if (next !== CONTROLS_TAB) return null;
	return previous === CONTROLS_TAB ? restore : previous;
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

/**
 * The tab's own door to the settings panel (#369 D12).
 *
 * **Not a command, which is the whole of it.** D12 makes `z` remappable, and
 * what keeps that safe is that this tab grows a route to settings that no
 * binding table holds — #370's "nothing a binding table holds is on the path
 * to it", extended to the one door that is a letter today. A player who moves
 * `system.settings` onto a key they then forget still reaches the panel here.
 *
 * A string rather than a `CommandId` on purpose: the registry must not have a
 * row for it, or it would be bindable by the back door and the bootstrap would
 * be circular again.
 */
export const SETTINGS_ACTION = "settings";

/**
 * The tab's door to the Commander overlay (#381 S5), for `SETTINGS_ACTION`'s
 * reason.
 *
 * `system.commander` was rebindable from the moment the registry existed and
 * the overlay went on opening on its own listener, so a player who moved it
 * got the new key printed in this tab, a new key that did nothing, and `9`
 * still opening the screen. S2 refused to fold that open-trigger until a route
 * existed that no rebind could lock, and S4 left the Commander out because it
 * had none. This is the route, and the fold came with it.
 */
export const COMMANDER_ACTION = "commander";

/**
 * Every door the tab can carry.
 *
 * A closed union, so another door is a compile error at `main.ts`'s
 * dispatch — its `switch` ends in a `never` — rather than a `string` that
 * silently falls through (sage round 4 on #497, and round 3 on #498, which
 * found the `never` missing). It held one until #381 S5 added the second.
 */
export type ControlsAction = typeof SETTINGS_ACTION | typeof COMMANDER_ACTION;

export type TreeItem =
	| { kind: "header"; group: TaskGroup; count: number }
	| { kind: "row"; command: ControlCommand }
	/** A door rather than a control; see `SETTINGS_ACTION`. */
	| { kind: "action"; action: ControlsAction; label: string };

/** The cursor's name for a door, beside `groupFocusId` and `rowFocusId`. */
export const actionFocusId = (action: string) => `controls-action:${action}`;

/**
 * D6: two levels, group header and rows, in task order. A folded group keeps
 * its header — that is what the player opens it again with.
 *
 * **The doors come first**, before any group, so a player who has folded
 * everything still has them in front of them — and because the thing they are
 * for is being lost, which is not a state to go hunting in.
 */
export function controlsTree(
	catalogue: ControlsCatalogue,
	collapsed: ReadonlySet<TaskGroup>,
): TreeItem[] {
	const items: TreeItem[] = [
		{ kind: "action", action: SETTINGS_ACTION, label: "Settings" },
		{ kind: "action", action: COMMANDER_ACTION, label: "Commanders" },
	];
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

/**
 * The player's word for a pad context. `modal` is a menu on screen.
 *
 * `capture` is the rebind modal itself, and the word is what the player is
 * doing there rather than what the code calls it. A row is only ever *printed*
 * in it if a binding claims it, which today is the stick and trigger a capture
 * records and `rebind` then refuses — so the word has to exist and is not yet
 * reachable from a shipped layout. Keyed by `PadContext`, so a sixth context
 * cannot join in silence.
 */
const CONTEXT_WORDS: Readonly<Record<PadContext, string>> = {
	flight: "flight",
	instrument: "instrument",
	console: "console",
	modal: "menu",
	capture: "rebinding",
};

type PadPress = Extract<Trigger, { kind: "pad-button" | "pad-intent" }>;

const isPadPress = (t: Trigger): t is PadPress =>
	t.kind === "pad-button" || t.kind === "pad-intent";

/** The contexts a list names, in the order a note prints them, in the player's words. */
const where = (contexts: readonly PadContext[]) =>
	PAD_CONTEXTS.filter((c) => contexts.includes(c))
		.map((c) => CONTEXT_WORDS[c])
		.join(", ");

/**
 * Every other command `press`'s button reaches, by name, with the contexts in
 * which it reaches it — those where it does not mean `command`. A held button
 * is the fire trigger, a different act from a press, and is left out.
 */
function meaningsElsewhere(
	catalogue: ControlsCatalogue,
	command: ControlCommand,
	press: PadPress,
): Map<string, PadContext[]> {
	const elsewhere = new Map<string, PadContext[]>();
	for (const other of catalogue.commands) {
		if (other.id === command.id) continue;
		for (const o of other.currentTriggers) {
			if (!isPadPress(o) || o.button !== press.button) continue;
			if ("hold" in o && o.hold) continue;
			const outside = o.contexts.filter((c) => !press.contexts.includes(c));
			if (outside.length > 0)
				elsewhere.set(other.name, [
					...(elsewhere.get(other.name) ?? []),
					...outside,
				]);
		}
	}
	return elsewhere;
}

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
		const elsewhere = meaningsElsewhere(catalogue, command, t);
		if (elsewhere.size === 0) continue;
		// Two commands the button reaches in the same contexts share one clause:
		// `A` in a console is the market row *and* the generic select.
		const byWhere = new Map<string, string[]>();
		for (const [name, contexts] of elsewhere)
			byWhere.set(where(contexts), [
				...(byWhere.get(where(contexts)) ?? []),
				name,
			]);
		const others = [...byWhere]
			.map(([at, names]) => `in ${at}: ${names.join(" / ")}`)
			.join(" · ");
		parts.push(`${padButton(t.button)} in ${where(t.contexts)} · ${others}`);
	}
	return parts.join("; ");
}

function rowMarkup(catalogue: ControlsCatalogue, command: ControlCommand) {
	// A placeholder prints as no trigger at all, which is what it is (#620):
	// the row stays a row, and selecting it opens the capture on it.
	const bound = command.currentTriggers.filter((t) => t.kind !== "unbound");
	const triggers = bound.length
		? bound.map((t) => `<kbd>${escapeHtml(triggerLabel(t))}</kbd>`).join("")
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
		.map((item) => {
			// A `switch` rather than the ternary pair this replaced: the tree
			// grew a third kind in #381 S4 and a `header ? … : row` reads every
			// new kind as a row, silently (`item.command` on a door is
			// `undefined`, and the markup builder would print a row of blanks).
			switch (item.kind) {
				case "header":
					return `<button class="lc-controls-group" type="button" data-live-controls-group="${item.group}" aria-expanded="${!collapsed.has(item.group)}"><span>${collapsed.has(item.group) ? "▸" : "▾"} ${item.group.toUpperCase()}</span><small>${item.count}</small></button>`;
				case "action":
					// **A door, drawn as one.** It is not a control, so it gets
					// no trigger column — a blank one would read as a control
					// nothing is bound to, which is the opposite of what it is.
					return `<button class="lc-controls-door" type="button" data-live-controls-action="${item.action}">${escapeHtml(item.label)}</button>`;
				case "row":
					return rowMarkup(catalogue, item.command);
			}
		})
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
	const owner =
		catalogue.layout === "default" ? "DEFAULT LAYOUT" : "PLAYER LAYOUT";
	return `<div class="lc-panel-body lc-controls" data-live-controls-body><header class="lc-controls-head"><b data-live-controls-owner>${owner}</b><span>F1 or ${CONTROLS_CHORD} opens and closes this tab</span><span>The chord assumes a US layout; every other key prints as the character you type</span></header>${noticesMarkup(catalogue.notices)}<div class="lc-controls-tree" data-live-controls-tree>${controlsTreeMarkup(catalogue, collapsed)}</div></div>`;
}

// ---------------------------------------------------------------------------
// What a stored layout could not do, in the player's words (#381, slice 3)
// ---------------------------------------------------------------------------

const COMMAND_NAMES = new Map<string, string>(
	COMMANDS.map((c) => [c.id, c.name]),
);

/**
 * Why the capture modal cannot take what the player just pressed, in the
 * player's words (#381 S4).
 *
 * **A table here rather than `movedTrigger`'s thrown string**, for
 * `REJECTED_WHY`'s reason below and for a sharper one: the first pass put the
 * throw on the screen and the modal read `a rebind may move a trigger, not its
 * qualifiers: key:s::hold -> key:k::press` — half English and half the hash
 * `triggerKey` groups on. That is the *same defect the storage slice shipped
 * and had caught by looking at a frame*, on a different screen, with every
 * headless row green. The thrown message stays what a developer reads.
 *
 * **Keyed on the refusal and not on the trigger's kind**, which is what the
 * second pass got wrong (sage round 1 on #497). Two different refusals land on
 * `pad-button` — held, and claimed in every context — so a kind-keyed table
 * printed the hold sentence for both; and a `key`, which the registry normally
 * takes, is refused when the trigger being *moved* is one the game does not
 * offer, where that table had only an empty string. `RebindRefusal` carries
 * the reason and this maps it, so a new reason is a compile error here.
 */
export const CAPTURE_REFUSED_WHY: Readonly<Record<RebindRefusal, string>> = {
	"not-offered": "This control is not one the game offers for rebinding.",
	qualifiers:
		"That is not the kind of press this control takes — it is held rather than tapped, or the other way round.",
	"no-reader-held":
		"This control is held down to work, and the pad cannot yet hold a button for it. Choose a key instead.",
	"no-reader-axes":
		"A stick or a trigger cannot be bound yet — the ship still reads them in fixed positions.",
	"no-capture-surface": "The mouse is not offered for rebinding.",
	"live-nowhere":
		"Every screen already claims that button, so a control bound to it would never fire.",
};

/**
 * A stored string on its way into a sentence, cut to a length a line can hold.
 *
 * Everything the band prints is escaped by `noticesMarkup`, so this is not an
 * injection guard — it is a length one. A command id and a version come out of
 * a string store that anything can write, and the two that reach a sentence
 * were the only unbounded values left after the key and the code were capped
 * (sage round 4).
 */
const short = (v: string) => (v.length > 40 ? `${v.slice(0, 40)}…` : v);

/**
 * A control's name, or the blob's own string when this build has no such
 * control.
 *
 * Both halves are reachable: a rejected row may name a command that was
 * renamed or removed, and a notice that printed nothing in that case would be
 * a refusal the player cannot act on — which is the whole failure this slice
 * exists to prevent.
 */
const controlName = (id: string | null): string =>
	id === null
		? "A saved control"
		: (COMMAND_NAMES.get(id) ?? `An unknown control (${short(id)})`);

/**
 * What each refusal means, in the player's words.
 *
 * A table over `RejectReason` rather than the store's own message, because
 * that message is `rebind`'s and carries `triggerKey`'s hash — the tab printed
 * `key:q::hold -> key:k::press` for a round, which is a string no player can
 * act on. The store keeps the detail for a console; this is what is drawn.
 */
export const REJECTED_WHY: Record<RejectReason, string> = {
	"unreadable-row": "one of your saved changes could not be read",
	"unknown-control": "this version of the game has no such control",
	"unreadable-trigger": "the key it was saved on could not be read",
	"moved-default":
		"it has moved in this version, so your change no longer fits — set it again",
	"already-changed":
		"your saved controls change it more than once, and only the first change was kept",
	"refused-by-registry":
		"the saved change asked for more than moving a key, which this control decides",
};

/** Where a collision is live, when it is not everywhere. */
const inViews = (views: readonly string[]): string =>
	views.length === VIEW_MODES.length ? "" : ` in ${views.join(" and ")}`;

/**
 * The sentence a `LayoutNotice` prints.
 *
 * **Here rather than in `layout-notice.ts`**, beside the union it prints,
 * because a formatter beside the kinds would be a second table of the same
 * names, which is the drift #369 D11 was written against. (It said
 * `binding-store.ts` until #381 S4 moved the kinds out from behind the store —
 * the argument is the same and the module it names is not.)
 *
 * **And here rather than in `key-names.ts`**, because it names *commands*,
 * which it reads off the registry as a value, and that leaf takes types only
 * (#499 D4). The key in a collision sentence is still spelled there, by
 * `triggerLabel`.
 *
 * **The collision sentence says what the game does, not what #369 D5 says it
 * should.** D5's resolution is warn, allow, and resolve by last-changed-wins —
 * and the dispatch does not resolve: `resolveKey` returns every command a key
 * reaches and `main.ts` runs all of them. That is reachable on `main` through
 * `rebindCommand` and is not this slice's regression, but a notice promising a
 * law the game does not keep would be worse than no notice at all. **#484 owns
 * the law**, including the reason it is not simply implementable here: the
 * store is a diff and keeps no record of which row moved last. The sentence
 * becomes D5's when that node closes.
 */
export function noticeText(notice: LayoutNotice): string {
	switch (notice.kind) {
		case "unreadable":
			// **Two causes and two sentences, because only one of them can
			// promise a repair.** A store that throws on a read throws on a
			// write, so "changing a control will replace them" printed beside
			// "This change could not be saved" for a round (sage round 4). And
			// the thrown message is `detail` and is not printed: it is the
			// half-machine string this slice abolished for a rejection.
			return notice.cause === "refused"
				? "Your browser is not letting this game read what it stored, which a private window does. The default layout is in force, and a change you make now will not be saved either."
				: "Your saved controls could not be read. The default layout is in force, and changing a control will replace them.";
		case "version":
			// `JSON.stringify` rather than `String`, and the absent case named:
			// a stored `"1"` printed as `1` reads exactly like the version this
			// build *is*, and a missing one printed `undefined`.
			return `Your saved controls were written by a different build (${
				notice.stored === undefined
					? "they carry no version"
					: `version ${short(JSON.stringify(notice.stored))}`
			}). The default layout is in force, and changing a control will replace them.`;
		case "rejected":
			return `${controlName(notice.command)} kept its default: ${REJECTED_WHY[notice.reason]}.`;
		case "unsaved":
			return "This change could not be saved — your browser is refusing storage, which a private window does. It will fly until you reload the page.";
		case "collision": {
			// **Two names, and no cast to get them.** `Collision.commands` is a
			// pair in the type, because `collisions()` reports one entry per
			// overlapping *pair* — so three commands on one trigger arrive as
			// three notices with two names each, not one notice that drops a
			// name. The first pass narrowed the array by assertion, which read
			// as a truncation it is not (sage round 1); a wider report would
			// fail to compile here rather than print short.
			const [a, b] = notice.collision.commands;
			return `${controlName(a)} and ${controlName(b)} are both on ${triggerLabel(notice.at)}${inViews(notice.collision.scope.views)}. Both run; move one to separate them.`;
		}
	}
}

/** The band above the tree. Absent when there is nothing to say, rather than
 *  an empty box that reads as a screen that failed to draw. */
function noticesMarkup(notices: readonly LayoutNotice[]): string {
	if (notices.length === 0) return "";
	const rows = notices
		.map(
			(n) =>
				`<li class="lc-controls-notice" data-live-controls-notice="${n.kind}">${escapeHtml(noticeText(n))}</li>`,
		)
		.join("");
	return `<ul class="lc-controls-notices" data-live-controls-notices>${rows}</ul>`;
}
