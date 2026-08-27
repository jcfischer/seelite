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
  align-items: center; justify-content: center;
  background: rgba(2, 6, 12, 0.72);
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #cfe3ff;
}
#seelite-settings .box {
  min-width: 420px; max-width: 560px; padding: 20px 24px;
  background: rgba(6, 12, 22, 0.96);
  border: 1px solid rgba(120, 160, 220, 0.4); border-radius: 6px;
}
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

export function mountSettingsPanel(
	store: SettingsStore,
	/** Called as the screen opens, to drop keys the player is still holding. */
	releaseHeldKeys?: () => void,
) {
	if (!document.getElementById(STYLE_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = STYLE;
		document.head.append(style);
	}

	let root: HTMLElement | null = null;
	let cursor = 0;

	const step = (key: keyof Settings, direction: number) => {
		const spec = settingSpec(key as "renderScale");
		const allowed = spec.allowed as readonly number[];
		const at = allowed.indexOf(store.value[key]);
		const next = allowed[(at + direction + allowed.length) % allowed.length];
		store.set(key, next);
	};

	const draw = () => {
		if (!root) return;
		const rows = SETTING_KEYS.map((key, i) => {
			const spec = settingSpec(key);
			const value = spec.describe(store.value[key]);
			return `<div class="row" role="option" aria-selected="${i === cursor}">
  <span class="name">${spec.label}</span>
  <span class="value">← ${value} →</span>
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
		if (e.key === "ArrowDown") cursor = (cursor + 1) % SETTING_KEYS.length;
		else if (e.key === "ArrowUp")
			cursor = (cursor - 1 + SETTING_KEYS.length) % SETTING_KEYS.length;
		else if (e.key === "ArrowRight")
			step(SETTING_KEYS[cursor] as keyof Settings, 1);
		else if (e.key === "ArrowLeft")
			step(SETTING_KEYS[cursor] as keyof Settings, -1);
		else return;
		draw();
	};

	// Capture phase, so the game's own handler does not also act on a key that
	// belongs to the dialog while the dialog is up.
	window.addEventListener("keydown", onKey, true);
	const unsubscribe = store.subscribe(draw);

	return () => {
		window.removeEventListener("keydown", onKey, true);
		unsubscribe();
		close();
	};
}
