/**
 * The frame the player sees, for a probe to read (node #806).
 *
 * Since node #806 the cockpit's laser beams are drawn into the WebGL frame,
 * behind the cabin, while chase's beams and every glass mark stay on
 * `#overlay`, the 2D canvas the page stacks over it. A probe that reads one
 * canvas sees half of what the player sees, so this draws the WebGL canvas
 * and then the overlay over it, as the page stacks them.
 *
 * It renders first, in the same task as the read: without
 * `preserveDrawingBuffer` the WebGL canvas may already have been cleared by
 * the time a later task reads it, and a read off a cleared buffer would miss
 * exactly the beam it is looking for. `render(0)` advances nothing, so the
 * pose is the one the caller left.
 *
 * Install before `page.goto`; it re-runs on every navigation.
 */
export async function installCompositeFrame(page) {
	await page.addInitScript(() => {
		let scratch = null;
		/**
		 * Render, then return the composited frame scaled to `width` x `height`
		 * as `ImageData` — the whole of it, or `region` (`{ x, y, width, height }`
		 * in those pixels) when given.
		 */
		window.__compositeFrame = (width, height, region) => {
			const g = window.__seelite;
			g.render(0);
			if (!scratch) scratch = document.createElement("canvas");
			if (scratch.width !== width) scratch.width = width;
			if (scratch.height !== height) scratch.height = height;
			const ctx = scratch.getContext("2d", { willReadFrequently: true });
			ctx.clearRect(0, 0, width, height);
			ctx.drawImage(g.renderer.domElement, 0, 0, width, height);
			ctx.drawImage(document.getElementById("overlay"), 0, 0, width, height);
			const r = region ?? { x: 0, y: 0, width, height };
			return ctx.getImageData(
				Math.floor(r.x),
				Math.floor(r.y),
				Math.ceil(r.width),
				Math.ceil(r.height),
			);
		};
	});
}
