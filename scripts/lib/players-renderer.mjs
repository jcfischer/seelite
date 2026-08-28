/**
 * "Is this the renderer the player has?", and the refusal when it is not.
 *
 * #98 settled that every browser script in this repo renders through
 * **SwiftShader** — `launchChromium` passes plain defaults and no GPU flags —
 * and that the same scene measures 16.8 fps headless against 371 fps headed on
 * an M1 Pro. Two scripts deliberately break that: `capture-views.mjs`, whose
 * output is judged by eye, and `measure-light-cost.mjs` (#99), whose output is
 * a frame cost. Both launch headed, and headed is a *request* — a machine with
 * no display is a real thing — so both have to check what they actually got.
 *
 * It lives here because it was written twice. `measure-light-cost.mjs` first
 * carried its own copy of the regex and the refusal, with a comment conceding
 * the copy; two homes for the list of rasteriser names drift the day a fourth
 * one matters, and this repo has the constraint about two authoritative homes
 * in writing. `capture-views.mjs` is a script with no exports, so extracting it
 * *here* rather than exporting it from there keeps that file a script.
 *
 * The lens is deliberately narrow: it answers whether the renderer can be
 * *shown* not to be a software rasteriser, and nothing about how fast it is.
 */

/** Renderers that are not the player's. */
export const SOFTWARE = /swiftshader|llvmpipe|software|mesa offscreen/i;

/**
 * The renderer's name, or a throw naming why it cannot be trusted.
 *
 * Two ways to fail, and both are refusals rather than warnings. A name matching
 * a known software rasteriser is the obvious one. The other is subtler and was
 * a real hole: without `WEBGL_debug_renderer_info` the only readable name is the
 * generic `gl.RENDERER`, which on a masked or unlisted software stack says
 * nothing and passes a substring test. A name match cannot prove hardware, so an
 * unreadable name is treated as unproven and refused.
 *
 * `what` names what the caller was about to do, because the two callers refuse
 * for different reasons and a shared message would be vague in both.
 */
export async function assertPlayersRenderer(page, what) {
	const gpu = await page.evaluate(() => {
		const gl = window.__seelite.renderer.getContext();
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		return {
			unmasked: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
			generic: gl.getParameter(gl.RENDERER),
		};
	});
	const renderer = gpu.unmasked ?? gpu.generic;
	const refusal = !gpu.unmasked
		? `cannot read the real renderer — WEBGL_debug_renderer_info is unavailable, and "${gpu.generic}" does not say what is drawing`
		: SOFTWARE.test(renderer)
			? `this is a software rasteriser (${renderer})`
			: null;
	if (refusal)
		throw new Error(
			`refusing to ${what}: ${refusal}.\n` +
				"Run this on a machine with a display; there is deliberately no\n" +
				"headless mode.",
		);
	return renderer;
}
