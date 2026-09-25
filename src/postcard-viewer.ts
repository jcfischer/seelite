/**
 * The page a postcard link opens (#406): the card, rebuilt from its recipe,
 * and two ways on — save the image, or start a game of one's own in the same
 * universe.
 *
 * **Read-only by construction, not by care.** The boot branch that mounts this
 * builds no catalog and no store, and the `Game` it hands over was built on the
 * recipe's arm, which installs no input listener and runs no frame loop. So
 * there is no key here that can open settings, rebind a layout, or advance the
 * world; the card is drawn once, on demand.
 *
 * **Visit this universe** is the ordinary new-game path and nothing else: it
 * opens the Commander overlay with the seed filled in, where New game asks for
 * a Commander name of its own — `beginNewGame` refuses a name already taken,
 * so a visit cannot land on a pilot's save. It starts where every new game
 * starts; the recipe's place and moment are the postcard's, not the game's.
 */
import type { PostcardRecipe } from "./postcard";
import {
	type Postcard,
	type PostcardSource,
	cardBlob,
	makePostcard,
	saveImage,
} from "./postcard-card";
import { escapeHtml } from "./escape-html";

const STYLE = `
#seelite-postcard-viewer {
  position: fixed; inset: 0; z-index: 100; overflow: auto;
  display: flex; flex-direction: column; align-items: center; justify-content: safe center;
  gap: 18px; padding: 24px 16px;
  background: radial-gradient(ellipse at 50% 30%, #0f1d28 0, #05080c 70%);
  color: #cfdce2; font: 14px/1.6 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
#seelite-postcard-viewer .card {
  display: block; width: min(92vw, calc((100vh - 170px) * 1.5)); height: auto;
  aspect-ratio: 3 / 2; border-radius: 3px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, .6), 0 0 0 1px rgba(160, 190, 205, .12);
  background: #020406;
}
#seelite-postcard-viewer .line { margin: 0; color: #8fa6b0; text-align: center; }
#seelite-postcard-viewer .actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
#seelite-postcard-viewer button, #seelite-postcard-viewer a.visit {
  font: inherit; padding: 9px 18px; border-radius: 4px; cursor: pointer; text-decoration: none;
  border: 1px solid rgba(150, 190, 210, .45); background: rgba(12, 24, 34, .9); color: #e6f0f3;
}
#seelite-postcard-viewer button:hover, #seelite-postcard-viewer a.visit:hover { border-color: #ffd479; }
#seelite-postcard-viewer .status { min-height: 1.6em; margin: 0; color: #ffd479; }
`;

/** What a probe reads off the page, under `__seelite.postcardView`. */
export interface PostcardViewState {
	recipe: PostcardRecipe;
	/** The recipe the rebuilt game spells back: equal to the link's, or a bug. */
	rebuiltFragment: string | null;
	card: { width: number; height: number } | null;
	caption: Postcard["caption"] | null;
	lastSave: string | null;
}

export function mountPostcardViewer(
	game: PostcardSource & { renderer: { domElement: HTMLCanvasElement } },
	recipe: PostcardRecipe,
): void {
	const style = document.createElement("style");
	style.textContent = STYLE;
	document.head.append(style);
	game.renderer.domElement.style.display = "none";
	document.title = "A postcard — The Far Between";

	const visit = new URL(import.meta.env.BASE_URL, window.location.href);
	visit.hash = "";
	visit.search = `?seed=${recipe.seed}`;

	const root = document.createElement("div");
	root.id = "seelite-postcard-viewer";
	root.innerHTML = `
		<img class="card" alt="" />
		<p class="line">A postcard from The Far Between. Opening it changed nothing on this device.</p>
		<div class="actions">
			<button type="button" data-action="save">Save image</button>
			<a class="visit" data-action="visit" href="${escapeHtml(visit.href)}">Visit this universe</a>
		</div>
		<p class="status" role="status" aria-live="polite"></p>`;
	document.body.append(root);

	const img = root.querySelector<HTMLImageElement>("img.card");
	const status = root.querySelector<HTMLElement>(".status");
	const save = root.querySelector<HTMLButtonElement>('[data-action="save"]');
	if (!img || !status || !save) throw new Error("postcard viewer: markup");

	const state: PostcardViewState = {
		recipe,
		rebuiltFragment: null,
		card: null,
		caption: null,
		lastSave: null,
	};
	(
		window as unknown as { __seelite: { postcardView: PostcardViewState } }
	).__seelite.postcardView = state;

	// A different postcard pasted into this tab changes only the fragment, which
	// a browser does not reload for; the page is built from one recipe.
	window.addEventListener("hashchange", () => window.location.reload());

	let postcard: Postcard | null = null;
	let blob: Blob | null = null;
	save.disabled = true;
	requestAnimationFrame(async () => {
		try {
			postcard = makePostcard(game, recipe.mode);
			state.rebuiltFragment = postcard.fragment;
			state.caption = postcard.caption;
			state.card = { width: postcard.card.width, height: postcard.card.height };
			img.alt = `A postcard of ${postcard.caption.place}, from The Far Between`;
			blob = await cardBlob(postcard.card);
			img.src = URL.createObjectURL(blob);
			save.disabled = false;
		} catch (error) {
			console.error("postcard: the card could not be drawn", error);
			status.textContent = "This postcard could not be drawn here.";
		}
	});

	save.addEventListener("click", async () => {
		if (!postcard || !blob) return;
		const outcome = await saveImage(
			blob,
			postcard.fileName,
			postcard.caption.place,
		);
		state.lastSave = outcome;
		status.textContent =
			outcome === "shared"
				? "Shared."
				: outcome === "downloaded"
					? "Saved."
					: "";
	});
}
