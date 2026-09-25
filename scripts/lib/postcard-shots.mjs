/**
 * What `probe-postcard.mjs` and `shot-postcards.mjs` both do to a page (#406),
 * in one place (sage round 1): switch the Postcard screen's composition and
 * wait for its card, and write a card `<img>`'s own PNG bytes to disk.
 */
import { writeFileSync } from "node:fs";

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
