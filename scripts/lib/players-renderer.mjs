/**
 * "Is this the renderer the player has?", and the refusal when it is not.
 *
 * #98 settled that the former headless default rendered through **SwiftShader**
 * and that the same scene measured 16.8 fps headless against 371 fps headed on
 * an M1 Pro. `npm run probe` now selects the headed hardware lane; `probe:cpu`
 * retains that software path for portability checks. Headed is still a request
 * — a machine with no display is a real thing — so every hardware lane has to
 * check what it actually got.
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
 * Turn a WebGL identity reading into either a proven player renderer or a
 * refusal. Keeping this pure lets both a game's renderer and a blank browser
 * preflight use exactly the same standard of proof.
 */
export function assertHardwareRenderer(gpu, what) {
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

/** Read the renderer from a fresh WebGL canvas, before any game has booted. */
export async function assertBrowserRenderer(page, what) {
	const gpu = await page.evaluate(() => {
		const canvas = document.createElement("canvas");
		const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
		const ext = gl?.getExtension("WEBGL_debug_renderer_info");
		return {
			unmasked: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
			generic: gl?.getParameter(gl.RENDERER) ?? null,
		};
	});
	return assertHardwareRenderer(gpu, what);
}

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
export async function assertPlayersRenderer(
	page,
	what,
	// The game publishes its renderer on `__seelite`; the workbench, which
	// never constructs `Game`, on `__seeliteModelViewer`. One refusal for
	// both, or the two workbench scripts re-inline it and drift — which they
	// did, until sage counted three behaviours in four files.
	{ global = "__seelite" } = {},
) {
	const gpu = await page.evaluate((name) => {
		const gl = window[name].renderer.getContext();
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		return {
			unmasked: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
			generic: gl.getParameter(gl.RENDERER),
		};
	}, global);
	return assertHardwareRenderer(gpu, what);
}
