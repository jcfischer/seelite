/**
 * What `probe-postcard.mjs` and `shot-postcards.mjs` both do to a page (#406),
 * in one place (sage round 1): switch the Postcard screen's composition and
 * wait for its card, and write a card `<img>`'s own PNG bytes to disk. The
 * card's luma reading and its comparator are here too, because
 * `probe-chase-orbit.mjs` judges cards by the same rule (node #691).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

/** The Postcard screen's card, and the viewer's. */
export const PANEL_CARD = "#seelite-postcard img.card";
export const VIEWER_CARD = "#seelite-postcard-viewer img.card";

/**
 * Switch the open Postcard screen to `mode` and wait until its card is the new
 * one. The card is an object URL made after the PNG encode, so "the `src`
 * changed to a `blob:`" is the moment the new composition is on screen.
 */
export async function setPostcardMode(page, mode) {
	const before = await page.evaluate(
		(sel) => document.querySelector(sel)?.src ?? "",
		PANEL_CARD,
	);
	await page.evaluate((m) => window.__seelite.postcardPanel.setMode(m), mode);
	await page.waitForFunction(
		([sel, prev]) => {
			const img = document.querySelector(sel);
			return img && img.src !== prev && img.src.startsWith("blob:");
		},
		[PANEL_CARD, before],
		{ timeout: 30000 },
	);
}

/** Write the PNG behind a card `<img>` to `path`, byte for byte. */
export async function keepCard(page, selector, path) {
	const b64 = await page.evaluate(async (sel) => {
		const blob = await (await fetch(document.querySelector(sel).src)).blob();
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let text = "";
		for (const byte of bytes) text += String.fromCharCode(byte);
		return btoa(text);
	}, selector);
	writeFileSync(path, Buffer.from(b64, "base64"));
}

/**
 * Wait until a page opened on a postcard link shows its card: the viewer's
 * `<img>` holds the object URL of the finished PNG and has decoded it.
 */
export async function waitViewerCard(page, timeout = 60000) {
	await page.waitForFunction(
		(sel) => {
			const img = document.querySelector(sel);
			return img?.src.startsWith("blob:") && img.complete;
		},
		VIEWER_CARD,
		{ timeout },
	);
}

/**
 * Luma statistics of a card `<img>` in `target` (a page or a frame): the lit
 * share above the band, and a grid over the **whole** card — band included, so
 * a rebuilt card that captions another place differs where the caption is
 * (#406, sage round 1).
 */
export function cardPixels(target, selector) {
	return target.evaluate(async (sel) => {
		const img = document.querySelector(sel);
		await img.decode();
		const canvas = document.createElement("canvas");
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext("2d");
		ctx.drawImage(img, 0, 0);
		const h = canvas.height;
		const above = Math.round(h * 0.8);
		const { data } = ctx.getImageData(0, 0, canvas.width, h);
		const cols = 24;
		const rows = 16;
		const grid = new Array(cols * rows).fill(0);
		let lit = 0;
		for (let y = 0; y < h; y++)
			for (let x = 0; x < canvas.width; x++) {
				const i = (y * canvas.width + x) * 4;
				const luma =
					0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
				if (y < above && luma > 24) lit++;
				grid[
					Math.floor((y / h) * rows) * cols +
						Math.floor((x / canvas.width) * cols)
				] += luma;
			}
		const cell = (canvas.width / cols) * (h / rows);
		return {
			width: img.naturalWidth,
			height: img.naturalHeight,
			lit: lit / (canvas.width * above),
			grid: grid.map((v) => v / cell),
		};
	}, selector);
}

/**
 * The share of grid cells whose mean luma moved by more than ten codes.
 * A share rather than a mean, because a subject that covers a few cells — the
 * hull, in the exterior — is diluted to nothing by a mean over all of them.
 */
export const changedCells = (a, b) =>
	a.grid.filter((v, i) => Math.abs(v - b.grid[i]) > 10).length / a.grid.length;

/**
 * The share of a kept card's pixels above the band whose luma moved past
 * `threshold` codes between two kept cards (node #812). Per pixel rather than
 * per cell: a cell's mean is diluted by the sky around a subject, so whether a
 * moved subject clears `changedCells`' ten codes is a property of how bright
 * the subject is. Read off the PNGs `keepCard` wrote, byte for byte.
 */
export function movedPixels(pathA, pathB, threshold = 24) {
	const a = PNG.sync.read(readFileSync(pathA));
	const b = PNG.sync.read(readFileSync(pathB));
	if (a.width !== b.width || a.height !== b.height)
		throw new Error(
			`movedPixels: ${a.width}x${a.height} against ${b.width}x${b.height}`,
		);
	const luma = (data, i) =>
		0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
	const above = Math.round(a.height * 0.8);
	let moved = 0;
	for (let i = 0; i < a.width * above * 4; i += 4)
		if (Math.abs(luma(a.data, i) - luma(b.data, i)) > threshold) moved++;
	return moved / (a.width * above);
}
