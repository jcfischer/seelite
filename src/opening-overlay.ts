/**
 * The opening's frame (#535): letterbox bars, the shot's caption and the skip
 * key. DOM over the canvas, like the save badge; it draws nothing of the world.
 *
 * Every flight surface — the glass, the markers, the consoles — is off while
 * the opening runs, so this is the only thing on the screen besides the shot,
 * and the skip key is the only key that answers (#530 D2).
 */
import { escapeHtml } from "./escape-html";

export interface OpeningOverlayHandle {
	/** Show the frame with `caption`, or hide it with `null`. Touches the DOM
	 *  only when what it shows changes; it runs every frame. */
	readonly update: (caption: string | null) => void;
}

const STYLE_ID = "seelite-opening-style";
const STYLE = `
#seelite-opening { position: fixed; inset: 0; z-index: 40; pointer-events: none; }
/* An id rule's display outranks the browser's [hidden] rule (the save badge's
   lesson, #311), so the hidden state is stated here. */
#seelite-opening[hidden] { display: none; }
#seelite-opening .bar {
  position: absolute; left: 0; right: 0; height: 10vh; background: #000;
}
#seelite-opening .bar.top { top: 0; }
#seelite-opening .bar.bottom {
  bottom: 0; display: flex; align-items: center; justify-content: space-between;
  padding: 0 4vw; box-sizing: border-box;
  font: 500 13px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .14em; color: #cfd8e3;
}
#seelite-opening .skip { color: #7f8a96; }
#seelite-opening kbd {
  font: inherit; color: #cfd8e3; padding: 0 5px;
  border: 1px solid rgba(207, 216, 227, .45); border-radius: 3px;
}
`;

export function mountOpeningOverlay(
	/** `dock.launch`'s keys, printed, in the layout in force. */
	skipKeys: () => readonly string[],
): OpeningOverlayHandle {
	if (!document.getElementById(STYLE_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = STYLE;
		document.head.append(style);
	}
	const root = document.createElement("div");
	root.id = "seelite-opening";
	root.dataset.opening = "";
	root.hidden = true;
	root.innerHTML =
		'<div class="bar top"></div><div class="bar bottom"><span class="caption" data-opening-caption></span><span class="skip" data-opening-skip></span></div>';
	document.body.append(root);
	const caption = root.querySelector<HTMLElement>("[data-opening-caption]");
	const skip = root.querySelector<HTMLElement>("[data-opening-skip]");
	let shown: string | null = null;
	let skipMarkup = "";
	return {
		update(next) {
			if (next === null) {
				if (shown !== null) root.hidden = true;
				shown = null;
				return;
			}
			if (shown === null) root.hidden = false;
			if (next !== shown && caption) caption.textContent = next;
			shown = next;
			const keys = skipKeys();
			const markup =
				keys.length === 0
					? ""
					: `${keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join(" or ")} SKIP`;
			if (markup !== skipMarkup && skip) {
				skip.innerHTML = markup;
				skipMarkup = markup;
			}
		},
	};
}
