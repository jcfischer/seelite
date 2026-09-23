/**
 * The Commander overlay (`persistent-world-state.md` §11).
 *
 * The second plain-DOM surface beside the settings screen, and for the same
 * reason (§11.1): choosing which save to play is neither station business nor
 * part of the fiction. It opens in front of every player boot, with the clock
 * held until Continue, and in play on `system.commander` — `9` unless the
 * player moved it — or the `Controls` tab's door, where the world runs under
 * it as it does under settings.
 *
 * Two halves. `commanderMenu` and its helpers are a model with no DOM, so
 * `tests/commander-overlay.test.ts` can check what the overlay offers.
 * `mountCommanderOverlay` draws it and carries out the choices through
 * `CommanderSwitch`, which holds §11.3's reload and flush rules.
 *
 * The player reads **Commander** here and never the storage word (§11.5,
 * `CONTEXT.md`).
 */

import { escapeHtml } from "./escape-html";
import {
	type BootPlan,
	type CommanderSwitch,
	messageOf,
	randomSeed,
} from "./commander-flow";
import type { OwnKey } from "./controls-reference";
import { isEditable } from "./editable-target";
import type { CommanderCatalog } from "./save-store";

/**
 * The key `system.commander` ships on, which `commands.ts` authors its default
 * from and a test holds apart from the perf panel's keys and `SETTINGS_KEY`.
 *
 * **The overlay does not read it** (#381 S5). It opens through
 * `Game.command("system.commander")` and closes on whatever key the layout in
 * force gives that command, which `OwnKey` carries. Until then it opened on
 * this constant from its own listener while the registry offered the command
 * for rebinding — so a moved Commander key was printed in the `Controls` tab,
 * did nothing, and `9` went on opening the screen.
 *
 * **A digit, because no letter is free.** Every letter is a flight binding, a
 * perf-panel key or settings' `z`; `1`–`3` are head-look and `0` the cruise
 * reset. A digit is on every keyboard layout, which a backslash or `Home` is
 * not.
 */
export const COMMANDER_KEY = "9";

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export type CommanderAction = "load" | "export" | "rename" | "delete";

const ACTIONS: readonly CommanderAction[] = [
	"load",
	"export",
	"rename",
	"delete",
];

const ACTION_LABEL: Record<CommanderAction, string> = {
	load: "Load",
	export: "Export",
	rename: "Rename",
	delete: "Delete",
};

export interface MenuInput {
	/** Every Commander on disk. */
	slots: readonly string[];
	/** The Commander this boot is for. */
	active: string;
	/** The Commander this tab has a store attached to, once it has one. */
	inPlay: string | null;
	canContinue: boolean;
	/** Set when Continue would start a new game that has no record yet. */
	pendingName: string | null;
	/** The Commander a boot fault concerns, which gets its own Export row. */
	faultSlot: string | null;
	/** `false` under `?no-save`: nothing on this page reads or writes a save. */
	saving: boolean;
}

export type MenuRow =
	| { kind: "continue"; label: string; enabled: boolean }
	| { kind: "new-game"; label: string; enabled: boolean }
	| { kind: "export-fault"; label: string; slot: string; enabled: boolean }
	| {
			kind: "commander";
			label: string;
			slot: string;
			/** The actions that can be chosen on this row, in `ACTIONS` order. */
			enabled: CommanderAction[];
	  }
	| { kind: "import"; label: string; enabled: boolean };

/**
 * What the overlay offers.
 *
 * **Load, Rename and Delete are refused on the Commander in play.** This tab's
 * own store holds that Commander's lock, so the catalog would refuse all three
 * with a message about another tab; the row says so by not offering them
 * instead (#309's note to this part).
 */
export function commanderMenu(input: MenuInput): MenuRow[] {
	const rows: MenuRow[] = [];
	// **No Continue row when there is no save to continue.** A fresh profile
	// showed a disabled "Continue — Commander "default"", naming a Commander that
	// had no save at all (#306's frames). A save that will not load keeps the
	// row, disabled, under the fault that says why (§11.2).
	if (input.inPlay !== null || input.canContinue || input.faultSlot !== null)
		rows.push({
			kind: "continue",
			label:
				input.inPlay !== null
					? `Back to flight — Commander "${input.inPlay}"`
					: input.pendingName !== null
						? `Continue — new Commander "${input.pendingName}"`
						: `Continue — Commander "${input.active}"`,
			enabled: input.canContinue,
		});
	if (!input.saving) return rows;
	if (input.faultSlot !== null)
		rows.push({
			kind: "export-fault",
			label: `Export Commander "${input.faultSlot}" as it is on disk`,
			slot: input.faultSlot,
			enabled: true,
		});
	rows.push({ kind: "new-game", label: "New game", enabled: true });
	for (const slot of input.slots)
		rows.push({
			kind: "commander",
			label: slot,
			slot,
			enabled: ACTIONS.filter(
				(action) => action === "export" || slot !== input.inPlay,
			),
		});
	rows.push({
		kind: "import",
		label: "Import a Commander from a file…",
		enabled: true,
	});
	return rows;
}

/** Continue when it can be chosen, New game otherwise (§11.2). */
export function initialCursor(rows: readonly MenuRow[]): number {
	const at = rows.findIndex((r) =>
		r.kind === "continue" ? r.enabled : r.kind === "new-game",
	);
	return Math.max(0, at);
}

/** New game's pre-filled name: the first `Commander N` nobody holds. */
export function freeCommanderName(taken: readonly string[]): string {
	for (let n = 1; ; n += 1) {
		const name = `Commander ${n}`;
		if (!taken.includes(name)) return name;
	}
}

/** A galaxy seed as typed, or `null` when it is not a whole number from 0 to
 *  2³² − 1. Digits only, so `1e3` and `-1` are refused rather than coerced. */
export function parseSeed(text: string): number | null {
	const trimmed = text.trim();
	if (!/^\d{1,10}$/.test(trimmed)) return null;
	const seed = Number(trimmed);
	return seed <= 0xffff_ffff ? seed : null;
}

// ---------------------------------------------------------------------------
// The drawing
// ---------------------------------------------------------------------------

export interface CommanderOverlayHandle {
	readonly isOpen: () => boolean;
	readonly open: () => void;
	/** Closes only once the game is running; the boot overlay stays up. */
	readonly back: () => void;
	readonly moveCursor: (delta: number) => void;
	readonly stepValue: (delta: number) => void;
	readonly activate: () => void;
	readonly unmount: () => void;
}

export interface CommanderOverlayOptions {
	/** `null` under `?no-save`. */
	catalog: CommanderCatalog | null;
	switcher: CommanderSwitch | null;
	/** The plan's fields the overlay shows, and the pending new game's name. */
	boot: Pick<
		BootPlan,
		"slot" | "canContinue" | "fault" | "faultSlot" | "notice" | "seedPrefill"
	> & { pendingName: string | null };
	/** Whether the overlay opens at once: every player boot, and not a
	 *  direct or one-shot one. */
	openAtBoot: boolean;
	/** The Commander this tab has a store attached to. */
	inPlay: () => string | null;
	/**
	 * The save fault held now, which an open in play shows (§11.5: the badge
	 * opens the overlay, which names the failure still held for each kind,
	 * `Game.saveFaultText`). Read at open rather than given at mount: a fault
	 * raised in flight did not exist at boot.
	 */
	fault: () => string | null;
	/**
	 * Continue at boot: attach the store to `slot` and release the clock.
	 * Resolves to a fault, or `null` once the game runs.
	 */
	onContinue: (slot: string) => Promise<string | null>;
	/** Called as the overlay opens, to drop keys the player is still holding. */
	releaseHeldKeys: () => void;
	/** `system.commander` in the layout in force: the key that closes the
	 *  overlay in play and the name its footer prints (#381 S5). */
	ownKey: OwnKey;
}

/**
 * The line under the rows.
 *
 * A form goes back with `Esc`; the menu closes only once the game runs, on
 * `Esc` or on `system.commander`'s keys as the layout has them — `closeKeys`,
 * so a player who moved it reads the key they chose, and one who moved it to
 * the pad reads `Esc` alone.
 */
export function commanderHint(
	kind: "menu" | "form",
	running: boolean,
	closeKeys: readonly string[],
): string {
	if (kind === "form")
		return "↑↓ choose · type in a field · Enter do it · Esc back";
	const close = running
		? ` · ${["Esc", ...closeKeys].join(" or ")} to close`
		: "";
	return `↑↓ choose · ←→ action · Enter do it${close}`;
}

const STYLE_ID = "seelite-commander-style";
const STYLE = `
#seelite-commander {
  position: fixed; inset: 0; z-index: 70; display: flex;
  align-items: safe center; justify-content: center;
  overflow-y: auto; overscroll-behavior: contain; padding: 16px;
  background: rgba(2, 6, 12, 0.78);
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #cfe3ff;
}
#seelite-commander .box {
  width: min(560px, 100%); padding: 20px 24px;
  background: rgba(6, 12, 22, 0.96);
  border: 1px solid rgba(120, 160, 220, 0.4); border-radius: 6px;
}
#seelite-commander h2 {
  margin: 0 0 14px; font-size: 13px; letter-spacing: .18em;
  text-transform: uppercase; color: #ffd479; font-weight: 600;
}
#seelite-commander .row {
  display: flex; align-items: baseline; gap: 12px; padding: 7px 10px;
  border: 1px solid transparent; border-radius: 4px; cursor: pointer;
}
#seelite-commander .row[aria-selected="true"] {
  border-color: rgba(255, 212, 121, .55); background: rgba(255, 212, 121, .07);
}
#seelite-commander .row[aria-disabled="true"] { color: #5d6f88; cursor: default; }
#seelite-commander .name { flex: 1; overflow-wrap: anywhere; }
#seelite-commander .action { color: #7f97b8; padding: 0 4px; }
#seelite-commander .action[data-chosen="true"] { color: #ffd479; text-decoration: underline; }
#seelite-commander .action[aria-disabled="true"] { color: #3f4d61; text-decoration: none; }
#seelite-commander .heading {
  margin: 12px 10px 4px; color: #7f97b8; font-size: 11.5px;
  letter-spacing: .12em; text-transform: uppercase;
}
#seelite-commander input[type="text"] {
  flex: 1; font: inherit; color: #ffd479; background: rgba(0, 0, 0, .35);
  border: 1px solid rgba(120, 160, 220, 0.4); border-radius: 3px; padding: 2px 6px;
}
#seelite-commander .refusal {
  margin: 0 0 12px; padding: 8px 10px; border-left: 3px solid #ff6b5e;
  color: #ffb1a8; background: rgba(255, 107, 94, .08); overflow-wrap: anywhere;
}
#seelite-commander .refusal::before { content: "FAULT  "; color: #ff6b5e; font-weight: 600; }
#seelite-commander .refusal .detail { margin-top: 4px; color: #a8837f; font-size: 11.5px; }
#seelite-commander .refusal .detail::before { content: "detail: "; }
#seelite-commander .info { margin: 0 0 12px; color: #9fb7d8; overflow-wrap: anywhere; }
#seelite-commander .hint { margin-top: 14px; color: #7f97b8; font-size: 11.5px; }
`;

type FormRow =
	| { kind: "input"; label: string; field: "name" | "seed" }
	| { kind: "toggle"; label: string }
	| { kind: "button"; label: string; run: () => void; enabled?: boolean };

type View =
	| { kind: "menu" }
	| { kind: "new-game"; name: string; seed: string; permadeath: boolean }
	| { kind: "rename"; from: string; name: string; seed: string }
	| { kind: "delete"; slot: string; name: string; seed: string }
	| { kind: "import"; text: string; name: string; seed: string };

/**
 * A fault as the overlay draws it: one block per fault (a blank line apart),
 * each a sentence and, dimmer, the detail on the lines after it
 * (`commander-flow.ts`'s `withDetail`).
 */
const faultHtml = (text: string) =>
	text
		.split("\n\n")
		.map((block) => {
			const [sentence, ...detail] = block.split("\n");
			const more = detail.length
				? `<div class="detail" data-commander-fault-detail>${escapeHtml(detail.join(" "))}</div>`
				: "";
			return `<div class="refusal" data-commander-fault>${escapeHtml(sentence ?? "")}${more}</div>`;
		})
		.join("");

/** Hands the player a file. A `Blob` link, because nothing here talks to a
 *  server (the map's no-backend constraint). */
function downloadText(filename: string, text: string) {
	const url = URL.createObjectURL(
		new Blob([text], { type: "application/json" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
	// **Not on the next tick.** Some browsers start the download after the click
	// returns, and a URL revoked first downloads nothing. Chromium, which the
	// probe runs, is not one of them.
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A file name for a Commander's export: letters, digits, spaces and `._()-`
 *  only, so no file system refuses it. */
const exportFileName = (slot: string) =>
	`${slot.replace(/[^\p{L}\p{N} ._()-]/gu, "_")}.seelite-save.json`;

export function mountCommanderOverlay(
	options: CommanderOverlayOptions,
): CommanderOverlayHandle {
	if (!document.getElementById(STYLE_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = STYLE;
		document.head.append(style);
	}
	const { catalog, switcher } = options;
	/** The switch, or a named refusal under `?no-save`, where no row that needs it
	 *  is offered. */
	const sw = (): CommanderSwitch => {
		if (!switcher) throw new Error("saving is off on this page (?no-save)");
		return switcher;
	};
	const wrap = (i: number, n: number) => ((i % n) + n) % n;
	/** A Commander row's chosen action: the one the player picked, or the first
	 *  the row offers. */
	const chosenOf = (row: Extract<MenuRow, { kind: "commander" }>) =>
		chosenAction.get(row.slot) ?? row.enabled[0];

	let root: HTMLElement | null = null;
	let view: View = { kind: "menu" };
	let cursor = 0;
	/** The chosen action on each Commander row, by name. */
	const chosenAction = new Map<string, CommanderAction>();
	let slots: string[] = [];
	let active = options.boot.slot;
	let canContinue = options.boot.canContinue;
	let pendingName = options.boot.pendingName;
	/** The boot's fault, then any later refusal; `null` once cleared. */
	let refusal: string | null = options.boot.fault;
	let info: string | null = options.boot.notice;
	/** The clock runs, so the overlay may close. */
	let running = !options.openAtBoot;
	let busy = false;
	let cursorPlaced = false;

	const menuRows = () =>
		commanderMenu({
			slots,
			active,
			inPlay: options.inPlay(),
			canContinue: running || canContinue,
			pendingName: running ? null : pendingName,
			faultSlot: running ? null : options.boot.faultSlot,
			saving: catalog !== null,
		});

	/** Runs an operation with the overlay locked, and shows what it refused. */
	const perform = async (work: () => Promise<void>) => {
		if (busy) return;
		busy = true;
		draw();
		try {
			await work();
		} catch (error) {
			refusal = messageOf(error);
		} finally {
			busy = false;
			draw();
		}
	};

	const refresh = async () => {
		if (!catalog) return;
		try {
			slots = await catalog.slots();
		} catch (error) {
			refusal = messageOf(error);
		}
		if (!cursorPlaced && view.kind === "menu") {
			cursor = initialCursor(menuRows());
			cursorPlaced = true;
		}
		draw();
	};

	const toMenu = () => {
		view = { kind: "menu" };
		cursor = Math.min(cursor, menuRows().length - 1);
		draw();
	};

	const formRows = (): FormRow[] => {
		const v = view;
		const cancel: FormRow = { kind: "button", label: "Cancel", run: toMenu };
		switch (v.kind) {
			case "new-game":
				return [
					{ kind: "input", label: "Name", field: "name" },
					{ kind: "input", label: "Galaxy seed", field: "seed" },
					{
						kind: "button",
						label: "Roll a new seed",
						run: () => {
							v.seed = String(randomSeed());
							draw();
						},
					},
					{ kind: "toggle", label: "Permadeath" },
					{
						kind: "button",
						label: "Start",
						run: () => {
							const seed = parseSeed(v.seed);
							if (seed === null) {
								refusal = `"${v.seed}" is not a galaxy seed — use a whole number from 0 to 4294967295`;
								draw();
								return;
							}
							void perform(() =>
								sw().newGame({
									name: v.name,
									seed,
									permadeath: v.permadeath,
								}),
							);
						},
					},
					cancel,
				];
			case "rename":
				return [
					{ kind: "input", label: "New name", field: "name" },
					{
						kind: "button",
						label: "Rename",
						run: () =>
							void perform(async () => {
								await sw().rename(v.from, v.name);
								if (active === v.from) active = v.name;
								info = `Commander "${v.from}" is now "${v.name}"`;
								refusal = null;
								await refresh();
								toMenu();
							}),
					},
					cancel,
				];
			case "delete":
				return [
					cancel,
					{
						kind: "button",
						label: `Delete Commander "${v.slot}" for good`,
						run: () =>
							void perform(async () => {
								await sw().remove(v.slot);
								if (active === v.slot) {
									canContinue = false;
									pendingName = null;
								}
								info = `Commander "${v.slot}" is deleted`;
								refusal = null;
								await refresh();
								toMenu();
							}),
					},
				];
			case "import":
				return [
					{ kind: "input", label: "Name", field: "name" },
					{
						kind: "button",
						label: "Import",
						run: () => void perform(() => sw().importCommander(v.name, v.text)),
					},
					cancel,
				];
			default:
				return [];
		}
	};

	const rowCount = () =>
		view.kind === "menu" ? menuRows().length : formRows().length;

	const fileInput = () =>
		root?.querySelector<HTMLInputElement>("[data-commander-import]") ?? null;

	const activateMenuRow = (row: MenuRow) => {
		if (!row.enabled || (row.kind === "commander" && row.enabled.length === 0))
			return;
		switch (row.kind) {
			case "continue":
				if (running) return back();
				void perform(async () => {
					const fault = await options.onContinue(active);
					if (fault !== null) {
						refusal = fault;
						return;
					}
					running = true;
					refusal = null;
					info = null;
					close();
				});
				return;
			case "new-game":
				view = {
					kind: "new-game",
					name: freeCommanderName(slots),
					seed: String(options.boot.seedPrefill ?? randomSeed()),
					permadeath: false,
				};
				cursor = 0;
				draw();
				return;
			case "export-fault":
				return exportCommander(row.slot);
			case "import":
				fileInput()?.click();
				return;
			case "commander": {
				const action = chosenOf(row);
				if (!action || !row.enabled.includes(action)) return;
				if (action === "export") return exportCommander(row.slot);
				if (action === "load") return void perform(() => sw().load(row.slot));
				view =
					action === "rename"
						? { kind: "rename", from: row.slot, name: row.slot, seed: "" }
						: { kind: "delete", slot: row.slot, name: "", seed: "" };
				cursor = 0;
				draw();
			}
		}
	};

	const exportCommander = (slot: string) =>
		void perform(async () => {
			const text = await sw().exportCommander(slot);
			downloadText(exportFileName(slot), text);
			info = `Commander "${slot}" exported`;
		});

	const draw = () => {
		if (!root) return;
		const selected = (i: number) => `aria-selected="${i === cursor}"`;
		let body: string;
		if (view.kind === "menu") {
			const rows = menuRows();
			let heading = false;
			body = rows
				.map((row, i) => {
					let html = "";
					if (row.kind === "commander" && !heading) {
						heading = true;
						html += `<div class="heading">Commanders</div>`;
					}
					if (row.kind === "commander") {
						const chosen = chosenOf(row);
						const tag =
							row.slot === options.inPlay()
								? " · in play"
								: row.slot === active && !running
									? " · last played"
									: "";
						const actions = ACTIONS.map(
							(a) =>
								`<span class="action" data-action="${a}" data-chosen="${a === chosen && row.enabled.includes(a)}" aria-disabled="${!row.enabled.includes(a)}">${ACTION_LABEL[a]}</span>`,
						).join("");
						html += `<div class="row" data-row="${i}" data-commander="${escapeHtml(row.slot)}" ${selected(i)}><span class="name">${escapeHtml(row.label)}${tag}</span>${actions}</div>`;
					} else {
						html += `<div class="row" data-row="${i}" data-kind="${row.kind}" ${selected(i)} aria-disabled="${!row.enabled}"><span class="name">${escapeHtml(row.label)}</span></div>`;
					}
					return html;
				})
				.join("");
		} else {
			const v = view;
			const title =
				v.kind === "new-game"
					? "New game"
					: v.kind === "rename"
						? `Rename Commander "${escapeHtml(v.from)}"`
						: v.kind === "delete"
							? `Delete Commander "${escapeHtml(v.slot)}"?`
							: "Import a Commander from a file";
			body =
				`<div class="heading">${title}</div>` +
				formRows()
					.map((row, i) => {
						if (row.kind === "input") {
							const value = v[row.field];
							return `<div class="row" data-row="${i}" ${selected(i)}><span class="name">${row.label}</span><input type="text" data-field="${row.field}" value="${escapeHtml(value)}" spellcheck="false" autocomplete="off"></div>`;
						}
						if (row.kind === "toggle")
							return `<div class="row" data-row="${i}" data-kind="toggle" ${selected(i)}><span class="name">${row.label}</span><span class="action" data-chosen="true">← ${v.kind === "new-game" && v.permadeath ? "on" : "off"} →</span></div>`;
						return `<div class="row" data-row="${i}" data-kind="button" ${selected(i)}><span class="name">${escapeHtml(row.label)}</span></div>`;
					})
					.join("");
		}
		const hint = escapeHtml(
			commanderHint(
				view.kind === "menu" ? "menu" : "form",
				running,
				options.ownKey.names(),
			),
		);
		root.innerHTML = `<div class="box" role="dialog" aria-label="Commander" aria-busy="${busy}">
  <h2>Commander</h2>
  ${refusal ? faultHtml(refusal) : ""}
  ${info ? `<div class="info" data-commander-info>${escapeHtml(info)}</div>` : ""}
  <div role="listbox">${body}</div>
  <div class="hint">${hint}</div>
  <input type="file" accept=".json,application/json" data-commander-import hidden>
</div>`;
		wire();
	};

	const wire = () => {
		if (!root) return;
		for (const el of root.querySelectorAll<HTMLElement>(".row"))
			el.addEventListener("click", (event) => {
				if (busy) return;
				cursor = Number(el.dataset.row);
				const actionEl = (event.target as HTMLElement).closest<HTMLElement>(
					"[data-action]",
				);
				// **A refused action does nothing.** Falling through to `activate`
				// ran the row's chosen action instead — an Export on the Commander in
				// play, whose only offered action it is.
				if (actionEl?.getAttribute("aria-disabled") === "true") return draw();
				const action = actionEl?.dataset.action as CommanderAction | undefined;
				const slot = el.dataset.commander;
				if (action && slot !== undefined) chosenAction.set(slot, action);
				if ((event.target as HTMLElement).tagName === "INPUT") return draw();
				// A disabled row does nothing, and the highlight still has to follow
				// the cursor it moved.
				activate();
				draw();
			});
		for (const input of root.querySelectorAll<HTMLInputElement>(
			"input[data-field]",
		))
			input.addEventListener("input", () => {
				if (view.kind === "menu") return;
				const field = input.dataset.field as "name" | "seed";
				view[field] = input.value;
			});
		// **The element that changed, not the one in `root` now.** A redraw while the
		// picker is open replaces the input, and the change then fires on the old one.
		const picker = fileInput();
		picker?.addEventListener("change", async () => {
			const file = picker.files?.[0];
			if (!file) return;
			let text: string;
			try {
				text = await file.text();
			} catch (error) {
				// Outside `perform`, so a failed read would otherwise be an unhandled
				// rejection and the player would see nothing happen.
				refusal = messageOf(error);
				draw();
				return;
			}
			const stem = file.name.replace(/\.seelite-save\.json$|\.json$/i, "");
			view = {
				kind: "import",
				text,
				name: stem && !slots.includes(stem) ? stem : freeCommanderName(slots),
				seed: "",
			};
			cursor = 0;
			draw();
		});
		// The focused row's field takes the keyboard; any other row gives it back,
		// so arrow keys walk the rows rather than a caret.
		const field = root.querySelector<HTMLInputElement>(
			`.row[aria-selected="true"] input[data-field]`,
		);
		if (field) {
			field.focus();
			field.setSelectionRange(field.value.length, field.value.length);
		} else if (isEditable(document.activeElement)) {
			(document.activeElement as HTMLElement).blur();
		}
	};

	const open = () => {
		if (root) return;
		options.releaseHeldKeys();
		// A locked pointer cannot reach the rows.
		if (document.pointerLockElement) document.exitPointerLock();
		root = document.createElement("section");
		root.id = "seelite-commander";
		root.dataset.commanderOverlay = "";
		document.body.append(root);
		view = { kind: "menu" };
		if (running) {
			refusal = options.fault();
			info = null;
		}
		cursor = initialCursor(menuRows());
		draw();
		void refresh();
	};

	const close = () => {
		root?.remove();
		root = null;
	};

	/** Esc: a form goes back to the menu; the menu closes once the game runs. */
	const back = () => {
		if (!root || busy) return;
		if (view.kind !== "menu") return toMenu();
		if (running) close();
	};

	const moveCursor = (delta: number) => {
		if (!root || busy || delta === 0) return;
		const n = rowCount();
		cursor = wrap(cursor + delta, n);
		draw();
		root
			.querySelector(`.row[data-row="${cursor}"]`)
			?.scrollIntoView({ block: "nearest" });
	};

	const stepValue = (delta: number) => {
		if (!root || busy || delta === 0) return;
		if (view.kind === "menu") {
			const row = menuRows()[cursor];
			if (row?.kind !== "commander" || row.enabled.length === 0) return;
			const at = row.enabled.indexOf(chosenOf(row));
			const n = row.enabled.length;
			chosenAction.set(
				row.slot,
				row.enabled[wrap(at + delta, n)] as CommanderAction,
			);
			return draw();
		}
		const row = formRows()[cursor];
		if (row?.kind === "toggle" && view.kind === "new-game") {
			view.permadeath = !view.permadeath;
			draw();
		}
	};

	const activate = () => {
		if (!root || busy) return;
		if (view.kind === "menu") {
			const row = menuRows()[cursor];
			if (row) activateMenuRow(row);
			return;
		}
		const row = formRows()[cursor];
		if (!row) return;
		if (row.kind === "button") row.run();
		else if (row.kind === "toggle") stepValue(1);
		else moveCursor(1);
	};

	const onKey = (e: KeyboardEvent) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		// **Closed, this listener does nothing** (#381 S5), which is S4's
		// settings fold one screen over. It opened the overlay on
		// `COMMANDER_KEY` itself, so the key was the panel's rather than the
		// registry's and a rebound `system.commander` changed nothing a player
		// could feel. `Game.command("system.commander")` opens it now, and the
		// `Controls` tab's Commanders door is the route no rebind can lock.
		//
		// The two guards the open carried are not restated there. `main.ts`
		// gates a typed key in a field itself (#380), and the settings screen
		// takes `keydown` in the capture phase and stops it, so a key pressed
		// over settings never reaches the bubble-phase dispatch — the guard
		// here existed because the two screens were *sibling* capture
		// listeners, where a stop does not reach across.
		if (!root) return;
		// While it is open it owns the keyboard, so the ship does not fly off
		// behind it. A field keeps its typing: only the keys the overlay walks
		// with are taken from it.
		e.stopPropagation();
		const typing = isEditable(e.target);
		if (typing && !["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(e.key))
			return;
		e.preventDefault();
		if (e.key === "Escape" || (!typing && options.ownKey.reaches(e))) back();
		else if (e.key === "ArrowDown") moveCursor(1);
		else if (e.key === "ArrowUp") moveCursor(-1);
		else if (e.key === "ArrowRight") stepValue(1);
		else if (e.key === "ArrowLeft") stepValue(-1);
		else if (e.key === "Enter" || e.key === " ") activate();
	};

	window.addEventListener("keydown", onKey, true);
	if (options.openAtBoot) open();

	return {
		isOpen: () => root !== null,
		open,
		back,
		moveCursor,
		stepValue,
		activate,
		unmount: () => {
			window.removeEventListener("keydown", onKey, true);
			close();
		},
	};
}
