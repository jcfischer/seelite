/**
 * The one-frame-only pixel detector, page-side, for #269's two consumers.
 *
 * `probe-station-mouth.mjs` asserts on it and `measure-mouth-flicker.mjs`
 * attributes with it. They were written with a copy each and sage asked for one
 * (PR #284, round 1): a detector is a definition, and two definitions of one
 * measurement drift the moment either threshold is retuned — the probe would
 * then be gating on a rule the instrument no longer explains.
 *
 * **Here rather than in `probe-guard.mjs`**, for the reason that module's own
 * docstring gives for `view-placement.mjs`: an installer put there is injected
 * into every page this repo opens, and this one has two callers.
 *
 * ## What it measures, and why not a frame difference
 *
 * A station turns, so adjacent frames legitimately differ over the whole
 * silhouette — 25,000–30,000 pixels a frame on the principal's recording of a
 * mouth that was working. What only a discontinuity produces is a pixel where
 * the two *neighbours* agree with each other and the middle frame disagrees with
 * both. Continuous motion across an edge cannot.
 *
 * ## And why it is eroded
 *
 * A one-pixel silhouette under rotation lands on a different pixel each frame,
 * so hairlines trace every rim in the raw mask — 304 of the recording's 337
 * frames carry some. Only a region that survives an erosion is a polygon that
 * popped rather than an edge that moved, which is the distinction #269's
 * acceptance 2 draws. `rawCount` is kept beside `area` because a fix that merely
 * pushed a fight under the erosion radius would show as a raw count that did not
 * move.
 */

/**
 * Install `window.__flickerMask(a, b, c, opts)` on this page.
 *
 * Call before `page.goto`; it re-runs on every navigation.
 */
export async function installFlickerDetector(page) {
	await page.addInitScript(() => {
		const dmax = (a, b, i) =>
			Math.max(
				Math.abs(a[i] - b[i]),
				Math.abs(a[i + 1] - b[i + 1]),
				Math.abs(a[i + 2] - b[i + 2]),
			);

		/**
		 * `a`, `b`, `c` are three consecutive frames as RGBA byte arrays.
		 *
		 * Returns `{ mask, area, rawCount }` — the eroded mask, how many pixels
		 * survive it, and how many were in the raw median before it. `erode` of 0
		 * returns the raw mask unchanged.
		 */
		window.__flickerMask = (a, b, c, opts) => {
			const { width: W, height: H, erode, changed, same } = opts;
			const raw = new Uint8Array(W * H);
			let rawCount = 0;
			for (let p = 0; p < W * H; p++) {
				const i = p * 4;
				if (
					dmax(a, c, i) < same &&
					dmax(a, b, i) > changed &&
					dmax(b, c, i) > changed
				) {
					raw[p] = 1;
					rawCount++;
				}
			}
			if (erode <= 0) return { mask: raw, area: rawCount, rawCount };
			// A pixel survives only with every neighbour inside the radius also
			// set: a hairline cannot, a filled region can.
			const eroded = new Uint8Array(W * H);
			let area = 0;
			for (let y = erode; y < H - erode; y++)
				for (let x = erode; x < W - erode; x++) {
					if (!raw[y * W + x]) continue;
					let solid = 1;
					for (let oy = -erode; oy <= erode && solid; oy++)
						for (let ox = -erode; ox <= erode; ox++)
							if (!raw[(y + oy) * W + x + ox]) {
								solid = 0;
								break;
							}
					if (solid) {
						eroded[y * W + x] = 1;
						area++;
					}
				}
			return { mask: eroded, area, rawCount };
		};
	});
}

/**
 * The thresholds both consumers read, so a retune reaches both.
 *
 * `CHANGED` is the per-channel difference that counts as a change and `SAME` the
 * ceiling under which two frames count as agreeing. Neither is a tone-mapping
 * tolerance: the dither is switched off for a sweep, because it is per-pixel
 * noise in display space and therefore exactly the shape this detector looks
 * for.
 */
export const FLICKER_CHANGED = 30;
export const FLICKER_SAME = 12;
