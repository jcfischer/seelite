/**
 * The settings screen.
 *
 * Deliberately plain DOM rather than a cockpit surface. `hud-and-scanner.md` §5
 * keeps developer tuning readouts off the persistent flight floor; a settings
 * screen is not a tuning readout, but it is also not part of the fiction, and
 * drawing it into the cockpit would make it one. It sits over the game, pauses
 * nothing, and closes back to exactly the view it opened on.
 *
 * **Three tabs and one note area** (#645). Thirteen rows in one list took a
 * 700x480 window past its height and clipped the last ones, and every row
 * carried its own note at once, so half the screen was text about settings the
 * player was not touching. Rows are grouped by tab now, the tab strip is a
 * cursor position like a row is, and only the selected row's note is drawn, in
 * a box of fixed height below the list. The box reserves the longest tab's row
 * count so moving between tabs does not resize it, and the selected row and the
 * note are both kept on screen when the window is too short for the whole box.
 *
 * Keyboard-first, because the flight controls are: arrows to move and change,
 * `Escape` or the settings key to close. On the strip the arrows change tab; on
 * a row they change its value. The mouse works too.
 */
import type { OwnKey } from "./key-names";
import {
	SETTING_TABS,
	type SettingTab,
	type Settings,
	type SettingsStore,
	TAB_LABELS,
	settingKeysIn,
	settingSpec,
} from "./settings";
import { escapeHtml } from "./escape-html";

/**
 * The key `system.settings` ships on, exported so a test can hold it apart from
 * the perf panel's.
 *
 * **The screen does not read it** (#381 S5). It opens through
 * `Game.command("system.settings")` since S4 and closes on whatever key the
 * layout in force gives that command, which `OwnKey` carries — so this is the
 * shipped default and nothing more. `commands.ts` restates it rather than
 * importing it, for the reason its `AUTHORED` doc gives.
 */
export const SETTINGS_KEY = "z";

/**
 * The line under the note, naming the key that closes the screen.
 *
 * The arrows and `Esc` are this screen's own and are not in the registry;
 * `closeKeys` is `system.settings`'s triggers as the layout has them, so a
 * player who moved it reads the key they chose. With none left on the keyboard
 * it says `Esc` alone rather than naming a key that does nothing.
 */
export const settingsHint = (closeKeys: readonly string[]): string =>
	`↑↓ choose · ←→ change · ${["Esc", ...closeKeys].join(" or ")} to close · saved automatically`;

/** What the note area reads while the tab strip holds the cursor. */
export const STRIP_NOTE = "←→ changes the tab. ↓ goes to the first setting.";

const STYLE_ID = "seelite-settings-style";
const STYLE = `
#seelite-settings {
  position: fixed; inset: 0; z-index: 60; display: flex;
  /* Centred while it fits, and scrolled from the top when it does not. Plain
     centring clips a dialog taller than the viewport at BOTH ends, and the top
     end cannot be scrolled back to: the overflow goes above the scroll origin.
     #200 added three rows, which took the dialog past a 640px-tall window and
     put the first row and the hint out of reach. #645 reserves the box's height,
     so what is left to overflow is the window, not the tab. No backticks in this
     comment, deliberately - the block is a template literal. */
  align-items: safe center; justify-content: center;
  overflow-y: auto; overscroll-behavior: contain;
  padding: 16px 0;
  background: rgba(2, 6, 12, 0.72);
  font: 13px/1.6 Menlo, monospace;
  color: #cfe3ff;
}
#seelite-settings .box {
  width: 560px; box-sizing: border-box; padding: 16px 6px 14px;
  background: rgba(6, 12, 22, 0.96);
  border: 1px solid rgba(120, 160, 220, 0.4); border-radius: 6px;
}
#seelite-settings .head {
  display: flex; align-items: baseline; gap: 14px;
  margin: 0 2px 8px; padding: 2px 8px;
  border: 1px solid transparent; border-radius: 4px;
}
#seelite-settings .box[data-cursor="strip"] .head {
  border-color: rgba(255, 212, 121, .55); background: rgba(255, 212, 121, .07);
}
#seelite-settings h2 {
  margin: 0; font-size: 13px; letter-spacing: .18em;
  text-transform: uppercase; color: #ffd479; font-weight: 600;
}
#seelite-settings .tabs { display: flex; gap: 2px; }
#seelite-settings .tab {
  font: inherit; padding: 1px 8px; border: 1px solid transparent;
  border-radius: 3px; background: none; color: #7f97b8; cursor: pointer;
}
#seelite-settings .tab[aria-selected="true"] {
  color: #ffd479; border-color: rgba(255, 212, 121, .45);
  background: rgba(255, 212, 121, .08);
}
#seelite-settings .rows { margin: 0 2px; }
#seelite-settings .row {
  display: flex; align-items: baseline; gap: 12px; padding: 4px 10px;
  border: 1px solid transparent; border-radius: 4px;
}
#seelite-settings .row[aria-selected="true"] {
  border-color: rgba(255, 212, 121, .55); background: rgba(255, 212, 121, .07);
}
#seelite-settings .name { flex: 1; }
#seelite-settings .value { color: #ffd479; min-width: 5em; text-align: right; }
#seelite-settings .granted { color: #7f97b8; }
#seelite-settings .note {
  margin-top: 8px; padding: 6px 0 0;
  border-top: 1px solid rgba(120, 160, 220, .25);
  height: calc(5 * 1.6em); overflow: hidden;
  color: #7f97b8; font-size: 11.5px; line-height: 1.6;
}
#seelite-settings .hint {
  margin-top: 12px; padding: 0 10px; color: #7f97b8; font-size: 11.5px;
}
`;

const rowMarkup = (r: {
	readonly rowId: string;
	readonly selected: boolean;
	readonly label: string;
	readonly value: string;
}): string => `<div class="row" role="option" aria-selected="${r.selected}" data-settings-row="${r.rowId}">
  <span class="name">${r.label}</span>
  <span class="value">← ${r.value} →</span>
</div>`;

/**
 * The keyboard layout row, which the settings store does not hold (#639).
 *
 * The keyboard layout is chosen on this screen and stored in the binding blob,
 * beside the moves it is the base of, so its value is read and changed through
 * the game rather than through `SettingsStore`. It is drawn and walked as one
 * more row, the last one on the Controls tab, and it names that tab itself
 * (#645): the screen draws it from this field rather than guessing where a row
 * that is not in `SCHEMA` belongs.
 */
export interface LayoutRow {
	readonly label: string;
	readonly tab: SettingTab;
	readonly value: () => string;
	readonly note: () => string;
	readonly step: (direction: number) => void;
}

/** One row as the page-level read names it (#645): id, label and tab. */
export interface SettingsRowView {
	readonly id: string;
	readonly label: string;
	readonly tab: SettingTab;
}

interface ScreenRow extends SettingsRowView {
	readonly value: () => string;
	readonly note: () => string;
	readonly step: (direction: number) => void;
}

/**
 * What the settings screen tells a probe about itself.
 *
 * A probe used to reach the row it cared about by counting rows or by relying
 * on ↑ wrapping onto the last one, and every one of those counts moved when the
 * screen gained a row or a tab. This is the read they share instead: the open
 * tab, the tab list, every row's id, label and tab, and whether the cursor is
 * on `"strip"` or on a row id.
 */
export interface SettingsPanelRead {
	readonly open: boolean;
	readonly tab: SettingTab;
	readonly tabs: readonly SettingTab[];
	readonly cursor: "strip" | string;
	readonly rows: readonly SettingsRowView[];
}

/**
 * What a mounted settings screen can be asked to do.
 *
 * The panel kept its own integer cursor rather than adopting `panel-focus`
 * (#283), and that is deliberate rather than an omission: `SETTING_KEYS` is a
 * fixed list that never re-sorts and never loses a row, so the identity-versus-
 * position problem the shared model exists to solve does not arise here. What
 * the pad needed was a way in, not a second cursor beside this one.
 *
 * **Callable, and that is the page-level read** (#645). `window.__seelite` is
 * the `Game`, so `window.__seelite.settingsPanel` is this handle; a probe asks
 * it for `SettingsPanelRead` by calling it. The methods below stay methods, so
 * the guard that waits for the mount (`!== null`) and the one probe that asks
 * `isOpen()` keep working unchanged.
 */
export interface SettingsPanelHandle {
	(): SettingsPanelRead;
	/** Whether the screen is currently mounted over the canvas. */
	readonly isOpen: () => boolean;
	/**
	 * Put the screen up — or take it down, which is what `system.settings`'s key
	 * does from the layout in force.
	 *
	 * Exposed since #381 S4 for the `Controls` tab's door. #369 D12 makes `z`
	 * remappable, so the key is no longer the only way in and the only way in
	 * may no longer be a key: a player who moved `system.settings` onto a button
	 * they forgot reaches the panel through the tab instead.
	 */
	readonly open: () => void;
	readonly close: () => void;
	/** Walk the cursor — the strip and this tab's rows — wrapping within the tab. */
	readonly moveCursor: (delta: number) => void;
	/** What ←→ does: change the tab on the strip, the row's value on a row. */
	readonly stepValue: (delta: number) => void;
	/** What the shoulders do: step the tab, keeping the strip or landing on a row. */
	readonly moveTab: (delta: number) => void;
	/** Put the cursor on one row by id, without stepping it. */
	readonly focusRow: (id: string) => void;
	/** Tear the screen and its key listener down. */
	readonly unmount: () => void;
}

export function mountSettingsPanel(
	store: SettingsStore,
	/**
	 * `system.settings` in the layout in force: the key that closes this screen
	 * and the name its footer prints (#381 S5). Required, as the Commander
	 * overlay's is: without it the screen closes on `Esc` alone and the footer
	 * names nothing, and nothing would say so (sage round 1 on #498).
	 */
	ownKey: OwnKey,
	/** Called as the screen opens, to drop keys the player is still holding. */
	releaseHeldKeys?: () => void,
	/**
	 * What a row is *actually* getting, when that differs from what it says.
	 *
	 * The panel cannot work this out: only the renderer knows, and this module
	 * deliberately holds no reference to one. It exists because #200's
	 * antialiasing count is clamped to what the GPU will multisample a half-float
	 * target at — so a machine that grants 2x renders 2x for a player who chose
	 * 4x, and a row reading "4x" with no qualification is a lie the player
	 * cannot see through. Returning `null` means the row is telling the truth as
	 * written.
	 */
	granted?: <K extends keyof Settings>(
		key: K,
		value: Settings[K],
	) => string | null,
	/** The keyboard layout row (#639), on the tab it names. */
	layoutRow?: LayoutRow,
): SettingsPanelHandle {
	if (!document.getElementById(STYLE_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = STYLE;
		document.head.append(style);
	}

	let root: HTMLElement | null = null;
	let tab: SettingTab = "display";
	let cursor = 0;

	const stepSetting = (key: keyof Settings, direction: number) => {
		const allowed = settingSpec(key).allowed as readonly Settings[typeof key][];
		const at = allowed.indexOf(store.value[key]);
		const next = allowed[(at + direction + allowed.length) % allowed.length];
		store.set(key, next);
	};

	const settingRow = (key: keyof Settings, which: SettingTab): ScreenRow => {
		const spec = settingSpec(key);
		const describe = spec.describe as (v: Settings[typeof key]) => string;
		return {
			id: key,
			label: spec.label,
			tab: which,
			value: () => {
				const shown = describe(store.value[key]);
				const actual = granted?.(key, store.value[key]);
				return actual
					? `${shown} <span class="granted">(${actual})</span>`
					: shown;
			},
			note: () => spec.note,
			step: (direction) => stepSetting(key, direction),
		};
	};

	const rowsIn = (which: SettingTab): ScreenRow[] => {
		const rows = settingKeysIn(which).map((key) => settingRow(key, which));
		if (layoutRow?.tab === which)
			rows.push({
				id: "layout",
				label: layoutRow.label,
				tab: which,
				value: () => escapeHtml(layoutRow.value()),
				note: () => layoutRow.note(),
				step: (direction) => layoutRow.step(direction),
			});
		return rows;
	};

	const laneCount = (which: SettingTab) => rowsIn(which).length + 1;

	const widestTab = () =>
		Math.max(...SETTING_TABS.map((which) => rowsIn(which).length));

	const stepRow = (index: number, direction: number) => {
		rowsIn(tab)[index]?.step(direction);
	};

	const changeTab = (direction: number) => {
		const at = SETTING_TABS.indexOf(tab);
		tab =
			SETTING_TABS[
				(at + direction + SETTING_TABS.length) % SETTING_TABS.length
			] ?? tab;
	};

	const reveal = () => {
		const overlay = root;
		if (!overlay) return;
		const rows = [...overlay.querySelectorAll(".row")];
		const note = overlay.querySelector<HTMLElement>(".note");
		const head = overlay.querySelector<HTMLElement>(".head");
		const at = cursor === 0 ? head : (rows[cursor - 1] ?? null);
		if (!at) return;
		const frame = overlay.getBoundingClientRect();
		const top = at.getBoundingClientRect().top - frame.top + overlay.scrollTop;
		const bottom =
			(note ?? at).getBoundingClientRect().bottom -
			frame.top +
			overlay.scrollTop;
		const pad = 16;
		if (top - pad < overlay.scrollTop) overlay.scrollTop = top - pad;
		else if (bottom + pad > overlay.scrollTop + overlay.clientHeight)
			overlay.scrollTop = bottom + pad - overlay.clientHeight;
	};

	const draw = () => {
		if (!root) return;
		const rows = rowsIn(tab);
		const drawn = rows.map((row, i) =>
			rowMarkup({
				rowId: row.id,
				selected: cursor === i + 1,
				label: escapeHtml(row.label),
				value: row.value(),
			}),
		);
		const selected = rows[cursor - 1];
		const note = selected ? escapeHtml(selected.note()) : STRIP_NOTE;
		root.innerHTML = `<div class="box" role="dialog" aria-label="Settings" data-cursor="${cursor === 0 ? "strip" : "row"}">
  <div class="head"><h2>Settings</h2><div class="tabs" role="tablist">${SETTING_TABS.map(
		(which) =>
			`<button type="button" class="tab" role="tab" aria-selected="${which === tab}" data-settings-tab="${which}">${TAB_LABELS[which]}</button>`,
	).join("")}</div></div>
  <div class="rows" role="listbox">${drawn.join("")}</div>
  <div class="note">${note}</div>
  <div class="hint">${escapeHtml(settingsHint(ownKey.names()))}</div>
</div>`;
		const list = root.querySelector<HTMLElement>(".rows");
		const first = list?.querySelector<HTMLElement>(".row");
		if (list && first)
			list.style.minHeight = `${widestTab() * first.getBoundingClientRect().height}px`;
		for (const el of root.querySelectorAll<HTMLElement>(".row"))
			el.addEventListener("click", () => {
				const rows = [...root!.querySelectorAll(".row")];
				cursor = rows.indexOf(el) + 1;
				stepRow(cursor - 1, 1);
				draw();
			});
		for (const el of root.querySelectorAll<HTMLElement>(".tab"))
			el.addEventListener("click", () => {
				tab = (el.dataset.settingsTab as SettingTab | undefined) ?? tab;
				cursor = 0;
				draw();
			});
		reveal();
	};

	const close = () => {
		root?.remove();
		root = null;
	};

	const open = () => {
		if (root) return close();
		releaseHeldKeys?.();
		root = document.createElement("section");
		root.id = "seelite-settings";
		root.dataset.settingsPanel = "";
		document.body.append(root);
		draw();
	};

	const moveCursor = (delta: number) => {
		if (!root || delta === 0) return;
		const lanes = laneCount(tab);
		cursor = (((cursor + delta) % lanes) + lanes) % lanes;
		draw();
	};

	const stepValue = (delta: number) => {
		if (!root || delta === 0) return;
		if (cursor === 0) changeTab(delta);
		else stepRow(cursor - 1, delta);
		draw();
	};

	const moveTab = (delta: number) => {
		if (!root || delta === 0) return;
		changeTab(delta);
		cursor = cursor === 0 ? 0 : 1;
		draw();
	};

	const focusRow = (id: string) => {
		if (!root) return;
		for (const which of SETTING_TABS) {
			const at = rowsIn(which).findIndex((row) => row.id === id);
			if (at === -1) continue;
			tab = which;
			cursor = at + 1;
			draw();
			return;
		}
	};

	const read = (): SettingsPanelRead => ({
		open: root !== null,
		tab,
		tabs: SETTING_TABS,
		cursor: cursor === 0 ? "strip" : (rowsIn(tab)[cursor - 1]?.id ?? "strip"),
		rows: SETTING_TABS.flatMap((which) =>
			rowsIn(which).map(({ id, label, tab: rowTab }) => ({
				id,
				label,
				tab: rowTab,
			})),
		),
	});

	const onKey = (e: KeyboardEvent) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (!root) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.key === "Escape" || ownKey.reaches(e)) return close();
		if (e.key === "ArrowDown") moveCursor(1);
		else if (e.key === "ArrowUp") moveCursor(-1);
		else if (e.key === "ArrowRight") stepValue(1);
		else if (e.key === "ArrowLeft") stepValue(-1);
	};

	window.addEventListener("keydown", onKey, true);
	const unsubscribe = store.subscribe(draw);

	return Object.assign(read, {
		isOpen: () => root !== null,
		open,
		close,
		moveCursor,
		stepValue,
		moveTab,
		focusRow,
		unmount: () => {
			window.removeEventListener("keydown", onKey, true);
			unsubscribe();
			close();
		},
	});
}
