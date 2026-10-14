/**
 * The Postcard screen (#406): turn this moment into a card and a link.
 *
 * **Plain DOM over the game, like settings and the Commander overlay**, because
 * a postcard is neither station business nor fiction — the out-of-fiction
 * exception the map records for #304, not a second grammar. It opens on
 * `system.postcard`, holds the world clock while it is up so the moment on the
 * card is the moment the pilot chose, and gives the clock back as it found it.
 *
 * Three compositions, the principal's choice: **Clear** is the view from the
 * cockpit eye with no cabin, **Cockpit** is the same eye with the cabin drawn,
 * and **Exterior** is the chase camera. It opens on the one that matches the
 * view the pilot is in. The live instruments and the real hull are allowed to
 * show (the principal's ruling); the *link* still carries neither, so a card
 * of a pilot's hull rebuilds with the starting one.
 *
 * Keyboard-first: `←` `→` change the composition, `Esc` or the layout's own key
 * closes, and Tab and Enter work the buttons. While it is up it owns the
 * keyboard, so the ship does not fly on behind it.
 */
import type { OwnKey } from "./key-names";
import {
	POSTCARD_HEIGHT,
	POSTCARD_MODES,
	POSTCARD_WIDTH,
	type PostcardMode,
} from "./postcard";
import {
	type Postcard,
	type PostcardSource,
	cardBlob,
	copyText,
	makePostcard,
	postcardLink,
	saveImage,
	saveOutcomeText,
} from "./postcard-card";

const LABELS: Record<PostcardMode, string> = {
	clear: "Clear",
	cockpit: "Cockpit",
	exterior: "Exterior",
};

const STYLE_ID = "seelite-postcard-style";
const STYLE = `
#seelite-postcard {
  position: fixed; inset: 0; z-index: 60; display: flex;
  align-items: safe center; justify-content: center;
  overflow-y: auto; overscroll-behavior: contain; padding: 16px;
  background: rgba(2, 6, 12, 0.78);
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cfe3ff;
}
#seelite-postcard .box {
  width: min(960px, 100%); padding: 20px 24px; box-sizing: border-box;
  background: rgba(6, 12, 22, 0.96);
  border: 1px solid rgba(120, 160, 220, 0.4); border-radius: 6px;
}
#seelite-postcard h2 {
  margin: 0 0 14px; font-size: 13px; letter-spacing: .18em;
  text-transform: uppercase; color: #ffd479; font-weight: 600;
}
#seelite-postcard img.card {
  display: block; width: 100%; height: auto; aspect-ratio: 3 / 2;
  border-radius: 3px; background: #020406;
  box-shadow: 0 0 0 1px rgba(160, 190, 205, .15);
}
#seelite-postcard .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 14px; }
#seelite-postcard .spacer { flex: 1; }
#seelite-postcard button {
  font: inherit; padding: 6px 14px; border-radius: 4px; cursor: pointer;
  border: 1px solid rgba(120, 160, 220, .45); background: rgba(10, 20, 34, .9); color: #e6f0ff;
}
#seelite-postcard button:hover, #seelite-postcard button:focus-visible { border-color: #ffd479; outline: none; }
#seelite-postcard button[aria-pressed="true"] { border-color: #ffd479; color: #ffd479; background: rgba(255, 212, 121, .08); }
#seelite-postcard input.link {
  flex: 1; min-width: 12em; font: 11.5px ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #9fb4d0; background: rgba(0, 0, 0, .35); border: 1px solid rgba(120, 160, 220, .25);
  border-radius: 4px; padding: 6px 8px;
}
#seelite-postcard .status { min-height: 1.6em; margin: 10px 0 0; color: #ffd479; }
#seelite-postcard .hint { margin-top: 6px; color: #7f97b8; font-size: 11.5px; }
`;

export interface PostcardPanelHost {
	source: PostcardSource;
	/** The view the pilot is in, which picks the composition the screen opens on. */
	view: () => "cockpit" | "chase";
	/** Hold the world clock; the returned function restores what it was. */
	holdClock: () => () => void;
	releaseHeldKeys: () => void;
	ownKey: OwnKey;
}

/** What a probe reads, and what the pad can drive. */
export interface PostcardPanelState {
	mode: PostcardMode | null;
	fragment: string | null;
	link: string | null;
	card: { width: number; height: number } | null;
	caption: Postcard["caption"] | null;
	lastSave: string | null;
	lastCopy: boolean | null;
}

export interface PostcardPanelHandle {
	readonly isOpen: () => boolean;
	readonly open: () => void;
	readonly close: () => void;
	readonly setMode: (mode: PostcardMode) => void;
	readonly save: () => Promise<void>;
	readonly copyLink: () => Promise<void>;
	readonly state: PostcardPanelState;
	readonly unmount: () => void;
}

export const postcardHint = (closeKeys: readonly string[]): string =>
	`←→ composition · ${["Esc", ...closeKeys].join(" or ")} to close · ${POSTCARD_WIDTH}x${POSTCARD_HEIGHT}, drawn on this device`;

export function mountPostcardPanel(
	host: PostcardPanelHost,
): PostcardPanelHandle {
	if (!document.getElementById(STYLE_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = STYLE;
		document.head.append(style);
	}

	const state: PostcardPanelState = {
		mode: null,
		fragment: null,
		link: null,
		card: null,
		caption: null,
		lastSave: null,
		lastCopy: null,
	};
	let root: HTMLElement | null = null;
	let restoreClock: (() => void) | null = null;
	let current: Postcard | null = null;
	let blob: Blob | null = null;
	let objectUrl: string | null = null;

	const element = <T extends HTMLElement>(selector: string): T => {
		const found = root?.querySelector<T>(selector);
		if (!found) throw new Error(`postcard panel: no ${selector}`);
		return found;
	};
	const say = (text: string) => {
		if (root) element(".status").textContent = text;
	};

	let drawGeneration = 0;
	const setMode = async (mode: PostcardMode) => {
		if (!root) return;
		const generation = ++drawGeneration,
			opened = root;
		state.mode = mode;
		for (const button of root.querySelectorAll<HTMLButtonElement>(
			"[data-mode]",
		))
			button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
		say("");
		current = null;
		blob = null;
		state.fragment = null;
		state.link = null;
		state.caption = null;
		state.card = null;
		element<HTMLInputElement>("input.link").value = "";
		element<HTMLImageElement>("img.card").removeAttribute("src");
		try {
			await host.source.whenSkyReady?.();
			if (root !== opened || generation !== drawGeneration) return;
			current = makePostcard(host.source, mode);
		} catch (error) {
			if (root !== opened || generation !== drawGeneration) return;
			console.error("postcard: the card could not be drawn", error);
			current = null;
			blob = null;
			// Nothing of the last composition may stay copyable under this one.
			state.fragment = null;
			state.link = null;
			state.caption = null;
			state.card = null;
			element<HTMLInputElement>("input.link").value = "";
			element<HTMLImageElement>("img.card").removeAttribute("src");
			say("This moment could not be drawn as a postcard.");
			return;
		}
		state.fragment = current.fragment;
		state.link = postcardLink(current.fragment);
		state.caption = current.caption;
		state.card = { width: current.card.width, height: current.card.height };
		element<HTMLInputElement>("input.link").value = state.link;
		const drawn = current;
		blob = null;
		void cardBlob(drawn.card).then((png) => {
			if (current !== drawn || !root) return;
			blob = png;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			objectUrl = URL.createObjectURL(png);
			const img = element<HTMLImageElement>("img.card");
			img.src = objectUrl;
			img.alt = `A postcard of ${drawn.caption.place}`;
		});
	};

	const save = async () => {
		// Held across the awaits: a close or a mode change while the PNG encodes
		// must not pair one composition's pixels with another's name (sage
		// round 1).
		const drawn = current;
		if (!drawn) return;
		const png = blob ?? (await cardBlob(drawn.card));
		const outcome = await saveImage(png, drawn.fileName, drawn.caption.place);
		state.lastSave = outcome;
		say(saveOutcomeText(outcome));
	};

	const copyLink = async () => {
		if (!state.link) return;
		const ok = await copyText(state.link);
		state.lastCopy = ok;
		if (ok) say("Postcard link copied.");
		else {
			say("This page may not use the clipboard — the link is selected below.");
			// The screen may have closed while the clipboard answered.
			if (root) element<HTMLInputElement>("input.link").select();
		}
	};

	const open = () => {
		if (root) return close();
		// The pointer comes back on the next frame: an open Postcard screen is
		// the `modal` pad context, which `reconcilePointerLock` releases for.
		host.releaseHeldKeys();
		restoreClock = host.holdClock();
		root = document.createElement("div");
		root.id = "seelite-postcard";
		root.setAttribute("role", "dialog");
		root.setAttribute("aria-label", "Postcard");
		root.innerHTML = `<div class="box">
			<h2>Postcard</h2>
			<img class="card" alt="" />
			<div class="row">
				${POSTCARD_MODES.map((mode) => `<button type="button" data-mode="${mode}" aria-pressed="false">${LABELS[mode]}</button>`).join("")}
				<span class="spacer"></span>
				<button type="button" data-action="save">Save image</button>
				<button type="button" data-action="copy">Copy postcard link</button>
				<button type="button" data-action="close">Close</button>
			</div>
			<div class="row"><input class="link" readonly aria-label="Postcard link" /></div>
			<p class="status" role="status" aria-live="polite"></p>
			<p class="hint">${postcardHint(host.ownKey.names())}</p>
		</div>`;
		document.body.append(root);
		root.addEventListener("click", (e) => {
			const target = (e.target as HTMLElement).closest<HTMLElement>("button");
			if (!target) return;
			const mode = target.dataset.mode as PostcardMode | undefined;
			if (mode) setMode(mode);
			else if (target.dataset.action === "save") void save();
			else if (target.dataset.action === "copy") void copyLink();
			else if (target.dataset.action === "close") close();
		});
		setMode(host.view() === "chase" ? "exterior" : "cockpit");
		element<HTMLButtonElement>('[data-action="save"]').focus();
	};

	const close = () => {
		if (!root) return;
		root.remove();
		root = null;
		current = null;
		blob = null;
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		objectUrl = null;
		// Nothing of a closed screen stays copyable through the handle, and a
		// waiter on `fragment` sees the next open's card, not this one's.
		state.mode = null;
		state.fragment = null;
		state.link = null;
		state.caption = null;
		state.card = null;
		restoreClock?.();
		restoreClock = null;
	};

	const onKey = (e: KeyboardEvent) => {
		if (!root) return;
		// Owned while up, so the ship does not fly on behind the dialog. Tab,
		// Enter and Space keep their default so the buttons can be worked.
		e.stopPropagation();
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === "Escape" || host.ownKey.reaches(e)) {
			e.preventDefault();
			return close();
		}
		const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
		if (step !== 0 && state.mode) {
			e.preventDefault();
			// One composition per press: each is two renders at the card's size and
			// a PNG encode, and a held arrow would stack them (sage round 1).
			if (e.repeat) return;
			const at = POSTCARD_MODES.indexOf(state.mode);
			setMode(
				POSTCARD_MODES[
					(at + step + POSTCARD_MODES.length) % POSTCARD_MODES.length
				],
			);
			return;
		}
		if (e.key !== "Tab" && e.key !== "Enter" && e.key !== " ")
			e.preventDefault();
	};
	// Capture phase, like settings and the Commander overlay.
	window.addEventListener("keydown", onKey, true);
	const onKeyUp = (e: KeyboardEvent) => {
		if (root) e.stopPropagation();
	};
	window.addEventListener("keyup", onKeyUp, true);

	return {
		isOpen: () => root !== null,
		open,
		close,
		setMode,
		save,
		copyLink,
		state,
		unmount: () => {
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("keyup", onKeyUp, true);
			close();
		},
	};
}
