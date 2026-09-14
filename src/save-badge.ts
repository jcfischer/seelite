/**
 * The save-fault badge (`hud-and-scanner.md` §5.3).
 *
 * A fixed corner of the glass that shows while a save fault is held
 * (`persistent-world-state.md` §11.5) and opens the Commander overlay when
 * activated, where the fault's message is.
 *
 * **Its own element on `body`, not a child of `#live-cockpit`.** That root is
 * hidden in chase view and takes no pointer, and the badge has to show in both
 * views, docked and in flight, and take a click. It sits above the cockpit (4)
 * and below the settings screen (60) and the overlay (70), which it opens.
 */

import { COMMANDER_KEY } from "./commander-overlay";
import type { SaveRecordKind } from "./save-store";

/**
 * Whether the badge shows.
 *
 * **With a store, the store's held kinds decide, and the message does not.**
 * `saveFault` keeps the last text written to it after the write that replaced
 * it lands, so it cannot say whether a fault is still held.
 *
 * **With no store, a fault is the badge.** A direct boot whose attach failed
 * plays on with nothing that will write, and the fault on `saveFault` is the
 * only record of why. A boot with nothing wrong, and `?no-save`, have no fault.
 */
export const saveFaultHeld = (
	store: { readonly faultKinds: ReadonlySet<SaveRecordKind> } | null,
	fault: string | null,
): boolean => (store !== null ? store.faultKinds.size > 0 : fault !== null);

export type BadgeCorner =
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";

/** §5.3 leaves the corner to a rendered frame. Provisional until that ruling. */
export const DEFAULT_BADGE_CORNER: BadgeCorner = "top-left";

export interface SaveBadgeHandle {
	/** Shows or hides the badge; touches the DOM only when that changes. */
	readonly update: (held: boolean) => void;
	/** For the frame capture that decides the corner. */
	readonly setCorner: (corner: BadgeCorner) => void;
	readonly element: HTMLButtonElement;
}

const STYLE_ID = "seelite-save-badge-style";
// §4's refusal tone, the overlay's own fault red, and a shape and a word beside
// the colour, so it does not rest on colour alone.
const STYLE = `
#seelite-save-badge {
  position: fixed; z-index: 50; margin: 0;
  display: flex; align-items: center; gap: 8px; padding: 5px 10px;
  font: 600 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .12em; color: #ffb1a8;
  background: rgba(40, 6, 4, .88); border: 1px solid #ff6b5e; border-radius: 4px;
  box-shadow: 0 0 14px rgba(255, 107, 94, .35); cursor: pointer;
}
#seelite-save-badge::before { content: "\\25B2"; color: #ff6b5e; }
#seelite-save-badge kbd {
  font: inherit; color: #ff6b5e; padding: 0 4px;
  border: 1px solid rgba(255, 107, 94, .6); border-radius: 3px;
}
#seelite-save-badge[data-corner="top-left"] { top: 12px; left: 12px; }
#seelite-save-badge[data-corner="top-right"] { top: 12px; right: 12px; }
#seelite-save-badge[data-corner="bottom-left"] { bottom: 12px; left: 12px; }
#seelite-save-badge[data-corner="bottom-right"] { bottom: 12px; right: 12px; }
`;

export function mountSaveBadge(onActivate: () => void): SaveBadgeHandle {
	if (!document.getElementById(STYLE_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = STYLE;
		document.head.append(style);
	}
	const element = document.createElement("button");
	element.id = "seelite-save-badge";
	element.type = "button";
	element.dataset.saveBadge = "";
	element.dataset.corner = DEFAULT_BADGE_CORNER;
	element.hidden = true;
	element.title = "The last save did not write — open the Commander overlay";
	element.innerHTML = `SAVE FAULT <kbd>${COMMANDER_KEY}</kbd>`;
	element.addEventListener("click", (e) => {
		e.stopPropagation();
		// A button keeps focus after a click, and a focused button takes the
		// next Space or Enter as another click.
		element.blur();
		onActivate();
	});
	document.body.append(element);
	let shown = false;
	return {
		update: (held) => {
			if (held === shown) return;
			shown = held;
			element.hidden = !held;
		},
		setCorner: (corner) => {
			element.dataset.corner = corner;
		},
		element,
	};
}
