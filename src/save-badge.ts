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

import { heldFaultText } from "./commander-flow";
import { COMMANDER_KEY } from "./commander-overlay";
import type { SaveFault, SaveRecordKind } from "./save-store";

/** The dock checkpoint first: it is the record a death restores. */
const HELD_ORDER: readonly SaveRecordKind[] = ["lastDocked", "live"];

/**
 * The fault the badge stands for, in the overlay's words, or `null` when the
 * badge is hidden.
 *
 * **With a store, the store's held faults decide, each with its own cause.** A
 * single message field was written by every later failure, so after a failed
 * dock flush a debounced write that failed once and then landed left the badge
 * up for `lastDocked` and the overlay describing the write that had landed
 * (sage, #311 round 1). A dock flush holds both kinds with one cause, which is
 * said once.
 *
 * **With no store, the boot's fault is the badge.** A direct boot whose attach
 * failed plays on with nothing that will write, and `saveFault` is the only
 * record of why. A boot with nothing wrong, and `?no-save`, have no fault.
 *
 * **With a store, `saveFault` is not read.** The one attach fault a store can
 * carry is `finishNewGame` failing after the new game's first save landed: a
 * failed save there is the store's (`flush("new-game")` holds it), and what is
 * left is the pending record, which the next boot's `resolveActive` clears
 * beside the landed save. It is logged, and nothing the player has is lost.
 */
export function heldSaveFault(
	store: { readonly heldFaults: ReadonlyMap<SaveRecordKind, SaveFault> } | null,
	bootFault: string | null,
): string | null {
	if (store === null) return bootFault;
	const texts = new Set<string>();
	for (const kind of HELD_ORDER) {
		const fault = store.heldFaults.get(kind);
		if (fault) texts.add(heldFaultText(fault));
	}
	return texts.size > 0 ? [...texts].join("; ") : null;
}

/** Whether `heldSaveFault` is not `null`, by the same rule, without building the
 *  words: the frame loop asks it every frame (sage, #311 round 2). */
export const hasHeldSaveFault = (
	store: { readonly heldFaults: ReadonlyMap<SaveRecordKind, SaveFault> } | null,
	bootFault: string | null,
): boolean => (store === null ? bootFault !== null : store.heldFaults.size > 0);

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
	element.title = "A save did not write — open the Commander overlay";
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
	};
}
