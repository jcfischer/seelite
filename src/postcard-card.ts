/**
 * The postcard's pixels and its two ways out of the page (#406).
 *
 * `drawPostcardCard` lays the card's chrome over a frame the game drew —
 * full bleed, with a dark band along the foot carrying the name, the place and
 * an understated inscription (the principal's choice of the three offered).
 * `saveImage` hands the finished card to the native share sheet where the
 * browser can share files, and to a download everywhere else. `copyText` puts
 * a link on the clipboard.
 *
 * **Nothing here reaches the network.** The type is the platform's system
 * stacks rather than a webfont, which would be a runtime fetch; the download is
 * an object URL of a blob made in the page; the share sheet is the browser's.
 * `scripts/probe-postcard.mjs` records every request the page makes and holds
 * that the postcard adds none.
 */
import {
	POSTCARD_HEIGHT,
	POSTCARD_WIDTH,
	type PostcardCaption,
	type PostcardMode,
	type PostcardPose,
	type PostcardRecipe,
	type PostcardScene,
	decodePostcard,
	encodePostcard,
	postcardCaption,
	postcardFileName,
	postcardPose,
	postcardRecipe,
} from "./postcard";

const MONO =
	'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';
const SANS =
	'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

/**
 * The band, in card pixels. Drawn for 1800 x 1200 and scaled from it, so a card
 * at another size keeps its proportions rather than its pixel figures.
 */
const BAND = {
	height: 150,
	fade: 90,
	margin: 64,
	titleSize: 19,
	placeSize: 44,
	inscriptionSize: 18,
};

type Spaced = CanvasRenderingContext2D & { letterSpacing?: string };

/** The finished card: `frame` full bleed, the caption in the band. */
export function drawPostcardCard(
	frame: CanvasImageSource,
	caption: PostcardCaption,
	width = POSTCARD_WIDTH,
	height = POSTCARD_HEIGHT,
): HTMLCanvasElement {
	const card = document.createElement("canvas");
	card.width = width;
	card.height = height;
	const ctx = card.getContext("2d") as Spaced | null;
	if (!ctx) throw new Error("postcard: no 2D context for the card");
	const k = height / POSTCARD_HEIGHT;
	ctx.drawImage(frame, 0, 0, width, height);

	const top = height - BAND.height * k;
	const shade = ctx.createLinearGradient(0, top - BAND.fade * k, 0, height);
	shade.addColorStop(0, "rgba(3, 6, 10, 0)");
	shade.addColorStop(0.45, "rgba(3, 6, 10, 0.55)");
	shade.addColorStop(1, "rgba(3, 6, 10, 0.82)");
	ctx.fillStyle = shade;
	ctx.fillRect(0, top - BAND.fade * k, width, height - top + BAND.fade * k);

	const left = BAND.margin * k;
	const right = width - BAND.margin * k;
	const baseline = height - 50 * k;
	ctx.textBaseline = "alphabetic";

	ctx.letterSpacing = `${0.34 * BAND.titleSize * k}px`;
	ctx.font = `600 ${BAND.titleSize * k}px ${MONO}`;
	ctx.fillStyle = "rgba(170, 196, 206, 0.86)";
	ctx.textAlign = "left";
	ctx.fillText(caption.title.toUpperCase(), left, baseline - 62 * k);

	ctx.letterSpacing = `${0.04 * BAND.placeSize * k}px`;
	ctx.font = `500 ${BAND.placeSize * k}px ${SANS}`;
	ctx.fillStyle = "rgba(240, 245, 247, 0.97)";
	ctx.fillText(caption.place, left, baseline, right - left - 420 * k);

	ctx.letterSpacing = `${0.22 * BAND.inscriptionSize * k}px`;
	ctx.font = `${BAND.inscriptionSize * k}px ${MONO}`;
	ctx.fillStyle = "rgba(196, 212, 218, 0.55)";
	ctx.textAlign = "right";
	ctx.fillText(caption.inscription, right, baseline);
	ctx.letterSpacing = "0px";
	return card;
}

/** The card as a PNG. */
export function cardBlob(card: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) =>
		card.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error("postcard: no PNG from card")),
			"image/png",
		),
	);
}

export type SaveOutcome = "shared" | "downloaded" | "cancelled";

/** What the screen says after a save: the panel's and the viewer's one line. */
export const saveOutcomeText = (outcome: SaveOutcome): string =>
	outcome === "shared" ? "Shared." : outcome === "downloaded" ? "Saved." : "";

/**
 * The share sheet where the browser can share this file, a download
 * everywhere else. A share the person dismisses is `cancelled` and nothing
 * else happens; a share that fails for any other reason falls back to the
 * download, because the button said *save*.
 */
export async function saveImage(
	blob: Blob,
	fileName: string,
	title: string,
): Promise<SaveOutcome> {
	const file = new File([blob], fileName, { type: "image/png" });
	const nav = navigator as Navigator & {
		canShare?: (data: ShareData) => boolean;
	};
	if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
		try {
			await nav.share({ files: [file], title });
			return "shared";
		} catch (error) {
			if ((error as DOMException)?.name === "AbortError") return "cancelled";
		}
	}
	const url = URL.createObjectURL(blob);
	try {
		const link = document.createElement("a");
		link.href = url;
		link.download = fileName;
		link.rel = "noopener";
		document.body.append(link);
		link.click();
		link.remove();
	} finally {
		// After the click has been handled: revoking in the same task can cancel
		// the download in some engines.
		window.setTimeout(() => URL.revokeObjectURL(url), 4000);
	}
	return "downloaded";
}

/** Put `text` on the clipboard. `false` where the page may not. */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

/** The link a recipe is opened by: the game's root, the recipe in the fragment. */
export function postcardLink(fragment: string): string {
	const root = new URL(import.meta.env.BASE_URL, window.location.href);
	root.search = "";
	root.hash = fragment;
	return root.href;
}

/** What a card is made from: `Game` answers all three. */
export interface PostcardSource {
	/** A progressive sky must settle before its pixels enter a shared card. */
	whenSkyReady?(): Promise<void>;
	postcardScene(mode: PostcardMode): PostcardScene;
	postcardPlace(): { place: string | null; system: string };
	capturePostcardFrame(
		pose: PostcardPose,
		width: number,
		height: number,
	): HTMLCanvasElement;
}

export interface Postcard {
	card: HTMLCanvasElement;
	recipe: PostcardRecipe;
	caption: PostcardCaption;
	/** The recipe's one spelling, without `#`. */
	fragment: string;
	fileName: string;
}

/**
 * One card, composed as `mode`: the frame, the caption, and the recipe that
 * rebuilds it. **The recipe is parsed back before it is offered**, so a link
 * the viewer would refuse is an error here rather than a dead link in
 * somebody's message.
 */
export function makePostcard(
	source: PostcardSource,
	mode: PostcardMode,
): Postcard {
	const scene = source.postcardScene(mode);
	const recipe = postcardRecipe(scene);
	const fragment = encodePostcard(recipe);
	const parsed = decodePostcard(fragment);
	if (!parsed.ok)
		throw new Error(
			`postcard: this moment spells a refused link (${parsed.reason})`,
		);
	const caption = postcardCaption({
		...source.postcardPlace(),
		galaxy: recipe.galaxy,
		seed: recipe.seed,
	});
	const frame = source.capturePostcardFrame(
		postcardPose(recipe),
		POSTCARD_WIDTH,
		POSTCARD_HEIGHT,
	);
	return {
		card: drawPostcardCard(frame, caption),
		recipe,
		caption,
		fragment,
		fileName: postcardFileName(caption, recipe.seed),
	};
}
