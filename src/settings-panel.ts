/**
 * The settings screen.
 *
 * Deliberately plain DOM rather than a cockpit surface. `hud-and-scanner.md` §5
 * keeps developer tuning readouts off the persistent flight floor; a settings
 * screen is not a tuning readout, but it is also not part of the fiction, and
 * drawing it into the cockpit would make it one. It sits over the game, pauses
 * nothing, and closes back to exactly the view it opened on.
 *
 * Keyboard-first, because the flight controls are: arrows to move and change,
 * `Escape` or the settings key to close. The mouse works too.
 */
import {
	SETTING_KEYS,
	type Settings,
	type SettingsStore,
	settingSpec,
} from "./settings";

/** The key that opens it, exported so a test can hold it apart from the flight
 *  bindings and from the perf panel's. */
export const SETTINGS_KEY = "z";

const STYLE_ID = "seelite-settings-style";
const STYLE = `
#seelite-settings {
  position: fixed; inset: 0; z-index: 60; display: flex;
  /* Centred while it fits, and scrolled from the top when it does not. Plain
     centring clips a dialog taller than the viewport at BOTH ends, and the top
     end cannot be scrolled back to: the overflow goes above the scroll origin.
     #200 added three rows, which took the dialog past a 640px-tall window and
     put the first row and the hint out of reach. No backticks in this comment,
     deliberately - the block is a template literal. */
  align-items: safe center; justify-content: center;
  overflow-y: auto; overscroll-behavior: contain;
  padding: 16px 0;
  background: rgba(2, 6, 12, 0.72);
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #cfe3ff;
}
#seelite-settings .box {
  min-width: 420px; max-width: 560px; padding: 20px 24px;
  background: rgba(6, 12, 22, 0.96);
  border: 1px solid rgba(120, 160, 220, 0.4); border-radius: 6px;
}
#seelite-settings .granted { color: #7f97b8; }
#seelite-settings h2 {
  margin: 0 0 14px; font-size: 13px; letter-spacing: .18em;
  text-transform: uppercase; color: #ffd479; font-weight: 600;
}
#seelite-settings .row {
  display: flex; align-items: baseline; gap: 12px; padding: 8px 10px;
  border: 1px solid transparent; border-radius: 4px;
}
#seelite-settings .row[aria-selected="true"] {
  border-color: rgba(255, 212, 121, .55); background: rgba(255, 212, 121, .07);
}
#seelite-settings .name { flex: 1; }
#seelite-settings .value { color: #ffd479; min-width: 5em; text-align: right; }
#seelite-settings .note {
  margin: 2px 10px 10px; color: #7f97b8; font-size: 11.5px; max-width: 46em;
}
#seelite-settings .hint { margin-top: 14px; color: #7f97b8; font-size: 11.5px; }
`;

/**
 * What a mounted settings screen can be asked to do.
 *
 * The panel kept its own integer cursor rather than adopting `panel-focus`
 * (#283), and that is deliberate rather than an omission: `SETTING_KEYS` is a
 * fixed list that never re-sorts and never loses a row, so the identity-versus-
 * position problem the shared model exists to solve does not arise here. What
 * the pad needed was a way in, not a second cursor beside this one.
 */
export interface SettingsPanelHandle {
	/** Whether the screen is currently mounted over the canvas. */
	readonly isOpen: () => boolean;
	readonly close: () => void;
	/** Walk the row cursor, wrapping. A no-op while the screen is closed. */
	readonly moveCursor: (delta: number) => void;
	/** Change the focused row's value, as ←→ does. */
	readonly stepValue: (delta: number) => void;
	/** Tear the screen and its key listener down. */
	readonly unmount: () => void;
}

export function mountSettingsPanel(
	store: SettingsStore,
	/** Called as the screen opens, to drop keys the player is still holding. */
	releaseHeldKeys?: () => void,
	/**
	 * What a row is *actually* getting, when that differs from what it says.
	 *
	 * The panel cannot work this out: only the renderer knows, and this module
	 * deliberately holds no reference to one. It exists because #200's
	 * antialiasing count is clamped to what the GPU will multisample a
	 * half-float target at — so a machine that grants 2x renders 2x for a player
	 * who chose 4x, and a row reading "4x" with no qualification is a lie the
	 * player cannot see through. Returning `null` means the row is telling the
	 * truth as written.
	 */
	granted?: <K extends keyof Settings>(
		key: K,
		value: Settings[K],
	) => string | null,
): SettingsPanelHandle {
	if (!document.getElementById(STYLE_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = STYLE;
		document.head.append(style);
	}

	let root: HTMLElement | null = null;
	let cursor = 0;

	// A setting's value can be a number or a mode name, so the panel steps
	// through `allowed` positionally and never looks at what a value *is*. That
	// is what keeps this screen from growing a branch per setting kind.
	const step = (key: keyof Settings, direction: number) => {
		const allowed = settingSpec(key).allowed as readonly Settings[typeof key][];
		const at = allowed.indexOf(store.value[key]);
		const next = allowed[(at + direction + allowed.length) % allowed.length];
		store.set(key, next);
	};

	const draw = () => {
		if (!root) return;
		const rows = SETTING_KEYS.map((key, i) => {
			const spec = settingSpec(key);
			// The cast is hoisted rather than wrapped around the call: `describe`
			// is a union of one-per-key signatures, and a reader should see the
			// call, not unpick a parenthesised assertion to find it.
			const describe = spec.describe as (v: Settings[typeof key]) => string;
			const value = describe(store.value[key]);
			const actual = granted?.(key, store.value[key]);
			return `<div class="row" role="option" aria-selected="${i === cursor}">
  <span class="name">${spec.label}</span>
  <span class="value">← ${value}${actual ? ` <span class="granted">(${actual})</span>` : ""} →</span>
</div>
<div class="note">${spec.note}</div>`;
		}).join("");
		root.innerHTML = `<div class="box" role="dialog" aria-label="Settings">
  <h2>Settings</h2>
  <div role="listbox">${rows}</div>
  <div class="hint">↑↓ choose · ←→ change · Esc or ${SETTINGS_KEY.toUpperCase()} to close · saved automatically</div>
</div>`;
		for (const [i, el] of [...root.querySelectorAll(".row")].entries())
			el.addEventListener("click", () => {
				cursor = i;
				step(SETTING_KEYS[i] as keyof Settings, 1);
				draw();
			});
	};

	const close = () => {
		root?.remove();
		root = null;
	};

	const open = () => {
		if (root) return close();
		// Taking `keydown` does not take back the keys already down. Without
		// this, a held throttle or pitch key keeps flying the ship behind a
		// screen the player is reading.
		releaseHeldKeys?.();
		root = document.createElement("section");
		root.id = "seelite-settings";
		root.dataset.settingsPanel = "";
		document.body.append(root);
		draw();
	};

	/**
	 * Walk the row cursor, wrapping, and reveal where it landed.
	 *
	 * One implementation for the arrow keys and the pad (#283, round 6): the
	 * handle repeated the wrap and the redraw, so settings navigation had two
	 * bodies to keep in step and only one of them scrolled.
	 */
	const moveCursor = (delta: number) => {
		if (!root || delta === 0) return;
		cursor =
			(((cursor + delta) % SETTING_KEYS.length) + SETTING_KEYS.length) %
			SETTING_KEYS.length;
		draw();
		// **The screen scrolls, and the pad has no other way to scroll it.** At
		// 700x480 the last three rows sit below the viewport, so a cursor walked
		// onto one changed a setting the player could not see. The keyboard had
		// the same hole and nobody had noticed, because a mouse can scroll.
		// Sage found it, round 6.
		root.querySelectorAll(".row")[cursor]?.scrollIntoView({ block: "nearest" });
	};

	const stepValue = (delta: number) => {
		if (!root || delta === 0) return;
		step(SETTING_KEYS[cursor] as keyof Settings, delta);
		draw();
	};

	const onKey = (e: KeyboardEvent) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (!root) {
			if (e.key === SETTINGS_KEY) {
				e.preventDefault();
				open();
			}
			return;
		}
		// While it is open it owns the keyboard, so the ship does not fly off
		// behind a dialog the player is reading.
		e.preventDefault();
		e.stopPropagation();
		if (e.key === "Escape" || e.key === SETTINGS_KEY) return close();
		if (e.key === "ArrowDown") moveCursor(1);
		else if (e.key === "ArrowUp") moveCursor(-1);
		else if (e.key === "ArrowRight") stepValue(1);
		else if (e.key === "ArrowLeft") stepValue(-1);
	};

	// Capture phase, so the game's own handler does not also act on a key that
	// belongs to the dialog while the dialog is up.
	window.addEventListener("keydown", onKey, true);
	const unsubscribe = store.subscribe(draw);

	return {
		isOpen: () => root !== null,
		close,
		moveCursor,
		stepValue,
		unmount: () => {
			window.removeEventListener("keydown", onKey, true);
			unsubscribe();
			close();
		},
	};
}
