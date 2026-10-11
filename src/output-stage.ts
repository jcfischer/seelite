/**
 * The last pass: multisample the composed frame, dither the black, and vignette
 * the cockpit (**#200**).
 *
 * Three separate complaints, one stage, because all three are the same edit to
 * the same place — the moment the linear HDR frame becomes eight bits on the
 * screen.
 *
 * ## Why `antialias: true` on the renderer did nothing
 *
 * `main.ts` asks the `WebGLRenderer` for antialiasing, and has since the first
 * frame this game drew. That flag configures the **default framebuffer**, and
 * every frame here is rendered into an `EffectComposer` target instead
 * (`main.ts`, the four-pass stack). The default framebuffer is only ever the
 * destination of a full-screen blit of an already-aliased texture, so the flag
 * was inert: it cost a multisampled back buffer's memory and smoothed nothing.
 * The fix is to multisample the *composer's* target, which is what
 * `composerTarget` builds and `setComposerSamples` re-gates.
 *
 * No FXAA pass, deliberately (#200's **Do not**): the HUD and the scanner are a
 * canvas texture drawn into the frame, and a screen-space edge filter cannot
 * tell their glyph edges from a hull's. MSAA runs before the composite and
 * touches geometry edges only.
 *
 * ## Why a dither at all
 *
 * The composer's targets are half-float, so the frame carries far more than
 * eight bits of gradient right up to the output pass — and then `OutputShader`
 * tone-maps, encodes and hands it to an 8-bit surface. Space is black and the
 * gradient behind a planet's terminator crosses a handful of codes over hundreds
 * of pixels, which is the textbook banding case. A zero-mean ±0.5/255 noise
 * added **after** the sRGB transfer, in display space, is what turns a step into
 * a stipple: the quantiser rounds each pixel to a neighbouring code with a
 * probability set by where the true value sits between them, and the eye
 * integrates the average back. Added before the transfer it would be the wrong
 * size — the OETF is steep in the dark, and half a code at the output is a far
 * smaller number in linear light than half a code in the middle of the range.
 *
 * The noise is interleaved gradient noise rather than a Bayer matrix or a
 * texture: it is three arithmetic ops on `gl_FragCoord`, it needs no sampler
 * bound in a pass whose material is a `RawShaderMaterial` with two uniforms, and
 * it has no 8x8 cell to read as a pattern on a flat wall.
 *
 * ## Why the splice is recorded
 *
 * `String.replace` with a marker three.js has renamed returns the source
 * unchanged and says nothing — `shader-splice.ts` carries that argument in full.
 * The output shader is not a `MeshStandardMaterial` chunk assembly, so the
 * markers here are three.js's own `#include` lines and two statements of
 * `OutputShader`'s `main`; they are exactly as liable to move. The log rides on
 * the material's `userData.outputSplices`, and `probe-output-stage.mjs` reads
 * it.
 */
import * as THREE from "three";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { makeSplicer } from "./shader-splice";

/**
 * The strongest vignette the cockpit ever gets, as a fraction of corner
 * brightness removed.
 *
 * #200 caps it at 15% and the cap is the declaration: a vignette is a lens
 * artefact, the player is looking through a canopy rather than a lens, and the
 * only thing it is here to do is stop the frame's corners competing with the
 * instruments. Anything stronger reads as a photograph of a cockpit.
 */
export const VIGNETTE_MAX = 0.15;

/** Where the corner falloff starts and ends, in units of half-diagonal — the
 *  centre is 0 and a corner of a 2:1 frame is 1. Well outside the HUD's own
 *  reach, so the vignette never darkens an instrument. Module-private: it is
 *  interpolated into the GLSL below and nothing outside asks for it. */
const VIGNETTE_INNER = 0.55;

/** Peak-to-peak dither, in output codes. One code, centred: the noise spans
 *  ±0.5/255 so its mean is zero and a flat region keeps its exact value.
 *
 *  Interpolated into the shader below rather than sitting beside a hard-coded
 *  literal — a constant a consumer can read while the GLSL says something else
 *  is a figure that documents nothing. */
export const DITHER_CODES = 1;

/**
 * The three markers, named so a test can rename them.
 *
 * `pars` is where the helpers are declared, `vignette` is the last statement
 * before the colour-space encode (so the darkening is a multiply in linear
 * light, which is what a lens does), and `dither` is the encode itself, after
 * which the frame is in display space and half a code means half a code.
 */
export const OUTPUT_MARKERS = Object.freeze({
	pars: "#include <colorspace_pars_fragment>",
	vignette: "#ifdef SRGB_TRANSFER",
	dither: "gl_FragColor = sRGBTransferOETF( gl_FragColor );",
});

const PARS = /* glsl */ `#include <colorspace_pars_fragment>

uniform float uVignette;
uniform float uDither;

// Interleaved gradient noise (Jimenez), centred by the 0.5 below so the offset
// it adds is signed rather than always positive. **Centred is not the same as
// zero-mean**: that would need the hash to be exactly uniform over the pixels
// actually rendered, which neither this implementation nor any test here
// establishes, and an earlier comment claimed a flat region "keeps its exact
// value" on the strength of it. What is wanted of it is weaker and is what a
// dither needs — a signed sub-code offset with no visible period across a
// 1440x900 frame.
float seeliteNoise(vec2 p) {
	return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 seeliteVignette(vec3 colour, vec2 uv) {
	// **Branched, not multiplied by zero.** A dial at zero still evaluates
	// everything to its right, so a term switched off in the settings went on
	// costing what it cost — and an on-against-off timing then subtracts the
	// shared arithmetic out of both arms and reports it as free. Both branches
	// here are uniform across the whole draw, so every fragment in a pass takes
	// the same one and the branch itself is coherent.
	if (uVignette <= 0.0) return colour;
	// Half-diagonal units: 0 at the centre, 1 in a corner, whatever the aspect.
	float r = length(uv - 0.5) / 0.70710678;
	return colour * (1.0 - uVignette * smoothstep(${VIGNETTE_INNER.toFixed(2)}, 1.0, r));
}

vec3 seeliteDither(vec3 colour) {
	if (uDither <= 0.0) return colour;
	return colour + (seeliteNoise(gl_FragCoord.xy) - 0.5) * ${(DITHER_CODES / 255).toFixed(8)};
}`;

const VIGNETTE = /* glsl */ `gl_FragColor.rgb = seeliteVignette( gl_FragColor.rgb, vUv );

			#ifdef SRGB_TRANSFER`;

const DITHER = /* glsl */ `gl_FragColor = sRGBTransferOETF( gl_FragColor );
				gl_FragColor.rgb = seeliteDither( gl_FragColor.rgb );`;

/**
 * Patch `OutputShader`'s fragment source, recording each hit.
 *
 * Pure and exported so `tests/output-stage.test.ts` can run it against three's
 * own source and against a source with a marker renamed — the second is what
 * proves the log can say `false`, which is the only thing that makes the first
 * worth asserting.
 */
export function spliceOutputShader(
	source: string,
	splice: (
		stage: string,
		source: string,
		marker: string,
		code: string,
	) => string,
): string {
	let out = splice("fragment", source, OUTPUT_MARKERS.pars, PARS);
	out = splice("fragment", out, OUTPUT_MARKERS.vignette, VIGNETTE);
	return splice("fragment", out, OUTPUT_MARKERS.dither, DITHER);
}

/**
 * `OutputPass` with the dither and the vignette in it.
 *
 * A subclass rather than a `ShaderPass` copy of `OutputShader`, because the base
 * class rebuilds `material.defines` from the renderer's tone mapping and output
 * colour space **on every render**, and a copy would have to reimplement that or
 * silently stop tracking a tone-mapping change.
 *
 * The splice log is filled synchronously in the constructor, not in a compile
 * callback: this material's source is assembled here rather than by three's
 * program builder, so there is no later moment when the answer could change.
 */
export class SeeliteOutputPass extends OutputPass {
	constructor() {
		super();
		const { log, splice } = makeSplicer("output stage");
		this.material.fragmentShader = spliceOutputShader(
			this.material.fragmentShader,
			splice,
		);
		this.material.uniforms.uVignette = { value: 0 };
		this.material.uniforms.uDither = { value: 1 };
		// **The only way in.** A `readonly splices` field beside this was a second
		// name for one thing, read by nothing but the test asserting the two
		// agreed. `probe-output-stage.mjs` reads `userData` by name, as every
		// other patched material in this repo is read.
		this.material.userData.outputSplices = log;
		this.material.needsUpdate = true;
	}

	/** What the vignette is currently rendering at. A reader rather than a raw
	 *  uniform, so `probe-output-stage.mjs` does not have to reach through
	 *  three's index-signature uniform bag to ask a one-word question. There is
	 *  deliberately no matching `dither` reader: nothing outside this class needs
	 *  one, and a getter whose only caller is the test asserting it exists is
	 *  API for its own sake. */
	get vignette(): number {
		return this.material.uniforms.uVignette.value as number;
	}

	/** Corner darkening, clamped to `VIGNETTE_MAX`. `main.ts` calls this with the
	 *  cap in cockpit view and zero in chase — #200's ruling that a vignette on
	 *  an exterior shot reads as a photograph. */
	setVignette(strength: number) {
		this.material.uniforms.uVignette.value = Math.min(
			VIGNETTE_MAX,
			Math.max(0, strength),
		);
	}

	/**
	 * Turn the dither off.
	 *
	 * The player's row calls this and so does the probe: banding is a claim
	 * about *more distinct codes in a gradient*, and a claim like that needs the
	 * same frame measured both ways in one run rather than two builds compared
	 * across two.
	 *
	 * ## What it costs — and what this repo can and cannot say about it
	 *
	 * **Not separated, and no bound claimed.** Two shuffled sweeps of
	 * `scripts/measure-light-cost.mjs` read −0.002 ms/frame and +0.066, at
	 * 61/144 and 101/144 block pairings — a coin toss and a lean. The unsampled
	 * arm's own twelve blocks spread 1.84–1.98 ms in the same runs, which is
	 * wider than either estimate.
	 *
	 * That is a **failure to detect** and it is left as one. Two revisions of
	 * this docstring turned it into an upper bound — first "under a tenth of a
	 * millisecond", then "smaller than this instrument resolves, around 0.07 ms"
	 * — and neither had a calibration behind it: a within-arm range is not a
	 * detection threshold, and no power analysis was run. Review refused both,
	 * correctly.
	 *
	 * So: this design did not measure a difference, a design that could would
	 * have to isolate a full-screen term far smaller than a frame's own
	 * block-to-block variation, and nothing here says how small the term is.
	 *
	 * `docs/pitfalls.md` carries the wrong answers this one term produced and why
	 * each was wrong — it is a lesson about measuring, not about dithering.
	 */
	setDither(on: boolean) {
		this.material.uniforms.uDither.value = on ? 1 : 0;
	}
}

/**
 * The sample counts this context will multisample RGBA16F at, ascending.
 *
 * **Not `MAX_SAMPLES`.** That parameter answers for the normalised formats; a
 * *floating-point* multisampled renderbuffer is optional in WebGL2, and a
 * context that grants 4x for RGBA8 may grant 2x or none for RGBA16F. The
 * composer's targets are `HalfFloatType`, so asking for a count this list has
 * no answer for leaves the framebuffer incomplete — which is a black frame, not
 * an exception.
 *
 * `getInternalformatParameter(RENDERBUFFER, RGBA16F, SAMPLES)` is the question
 * that answers for the format actually being allocated. It comes back
 * descending and is reversed here. A context that cannot answer at all — no
 * float colour buffer extension, or a driver returning nothing — reads as empty,
 * which turns the setting off rather than gambling on it.
 */
function supportedSampleCounts(renderer: THREE.WebGLRenderer): number[] {
	const gl = renderer.getContext() as WebGL2RenderingContext;
	if (typeof gl.getInternalformatParameter !== "function") return [];
	try {
		const counts = gl.getInternalformatParameter(
			gl.RENDERBUFFER,
			gl.RGBA16F,
			gl.SAMPLES,
		) as Int32Array | null;
		return counts?.length ? [...counts].sort((a, b) => a - b) : [];
	} catch {
		return [];
	}
}

/**
 * The count a request will actually be **rendered at**.
 *
 * **Not `Math.min(wanted, max)`, which is what this was and which quietly
 * lied.** `renderbufferStorageMultisample` does not round a request *down* to
 * the nearest supported count — the spec guarantees the resulting `SAMPLES` is
 * at least what was asked for, so a request lands on the smallest supported
 * count **at or above** it, and only falls back to the largest when it is above
 * every one of them. A context reporting `[4]` therefore renders a 2x request at
 * 4x, and the old clamp returned 2 — so the settings row, its qualifier and the
 * probe all said 2 while the GPU drew 4. SwiftShader is such a context, which
 * is where review found it.
 *
 * Clamped rather than refused, still: a machine that grants only 2x should give
 * the player who asked for 4x the 2x it has, not a black frame and not a silent
 * revert of their setting. The settings screen goes on offering all three,
 * because what a *different* machine supports is not a preference to store.
 *
 * This is derived from what the driver advertises. What it is actually drawing
 * into is `gl.getParameter(SAMPLES)` on the bound framebuffer, and
 * `probe-output-stage.mjs` compares the two rather than trusting this.
 */
export function grantedSamples(
	renderer: THREE.WebGLRenderer,
	wanted: number,
): number {
	if (wanted <= 0) return 0;
	const counts = supportedSampleCounts(renderer);
	if (!counts.length) return 0;
	return counts.find((c) => c >= wanted) ?? counts[counts.length - 1];
}

/**
 * The composer's own target, multisampled.
 *
 * `EffectComposer` clones whatever it is handed for its second buffer and
 * `RenderTarget.copy` carries `samples`, so both buffers are multisampled from
 * one construction. Sized at the current drawing buffer; `main.ts`'s `onResize`
 * runs once at boot and owns the size from then on.
 */
export function composerTarget(
	renderer: THREE.WebGLRenderer,
	samples: number,
): THREE.WebGLRenderTarget {
	const size = renderer.getDrawingBufferSize(new THREE.Vector2());
	const target = new THREE.WebGLRenderTarget(size.x, size.y, {
		type: THREE.HalfFloatType,
		samples: grantedSamples(renderer, samples),
		// **Four layer passes share this target, and three says that is
		// undefined** (#200, sage round 7). `updateMultisampleRenderTarget`
		// pushes `COLOR_ATTACHMENT0` into the invalidation list for the *read*
		// framebuffer — the multisampled one — after every `WebGLRenderer.render`,
		// so the far, approach and near passes composite with `clear = false`
		// over a backdrop the driver has been told it may discard.
		//
		// It is not discarded on either rasteriser this repo can reach. Deep sky
		// keeps 333k lit pixels at 0 samples against 341k at 4 on SwiftShader and
		// 335k against 343k on ANGLE Metal, and the whole frame's lit mask
		// disagrees on 0.35–0.47% of pixels, which is edges.
		//
		// **Those checks guard this repo's rasterisers and not a player's.** An
		// earlier revision of this comment said a driver that started honouring
		// the hint would go red; it would not. `probe-output-stage.mjs` runs on
		// SwiftShader and the view capture on whatever this machine has, so what
		// they establish is that two implementations do not discard — which is
		// evidence about those two and nothing about a third. A player on a
		// driver that does honour it, with the setting turned up, would see
		// layers go missing and no check here would know.
		//
		// What actually bounds the exposure is that it is opt-in: `antialias`
		// defaults to 0, and at that setting the target is not multisampled and
		// none of this applies.
		//
		// The fix is structural — one resolve for the whole ladder rather than
		// one per pass — and it is #15's render ladder to make, not this
		// module's. Charted as node #219, which answers this and the frame cost
		// together, because they are the same restructure.
		//
		// **Nothing downstream reads depth**: bloom and the output pass are
		// full-screen quads over the colour texture. Resolving it is a second
		// full-buffer blit per `render`, and this game does four of those a
		// frame. `RenderTarget.copy` carries the flag, so the composer's cloned
		// second buffer gets it too.
		//
		// Measured: 2x went 8.80 to 7.26 ms/frame and 4x 14.53 to 13.14, about
		// 10% of each.
		//
		// It has a companion in `main.ts` — `farPass.clearDepth = true` — and the
		// two are one change, because three invalidates the depth attachment of
		// the **multisampled** framebuffer after each resolve and not only of the
		// single-sample one (`updateMultisampleRenderTarget` pushes the depth
		// style into `invalidationArrayRead`). A pass starting with
		// `clear = false` and no `clearDepth` would then test against undefined
		// content.
		//
		// **That companion is reasoning from three's source, not a check that
		// was watched fail.** Removing it changes nothing measurable on either
		// rasteriser — SwiftShader or ANGLE Metal, both tried — so either the
		// invalidation is not reaching this configuration or the far layer's
		// ordering does not depend on it in the framings tested. It stays
		// because clearing depth the backdrop never wrote is free, and the
		// alternative is relying on an invariant three explicitly discards. The
		// probe checks that nothing *stopped being drawn* at the granted count,
		// which is a weaker statement than the companion being necessary.
		resolveDepthBuffer: false,
	});
	target.texture.name = "EffectComposer.rt1";
	return target;
}

/**
 * Re-gate an existing composer's sample count.
 *
 * ## What this costs, measured
 *
 * Headed on an M1 Pro through ANGLE Metal, at 1440x900 and `deviceScaleFactor`
 * 2, framed on the trade station at 3 radii, by
 * `scripts/measure-light-cost.mjs` — the one home for these figures, which
 * `settings.ts`'s player-facing note rounds and points at rather than restates.
 * Twelve blocks per arm, round-robin across the counts, medians.
 *
 * **A range across sweeps of *this* build, not one run's figures.** The
 * absolute level moved 25% between sweeps early on, and one sweep quoted as a
 * constant is a trap this repo has recorded before. These are post-depth-resolve
 * and post-shuffle; the earlier figures this docstring carried (8.5–9.3 and
 * 14.1–15.1) were a different build and are not comparable.
 *
 * | samples | ms/frame | fps | against unsampled |
 * | ---: | ---: | ---: | ---: |
 * | 0 | 1.84–1.88 | 532–542 | — |
 * | 2 | 7.06–7.26 | 138–142 | 3.8–3.9x |
 * | 4 | 12.81–13.14 | 76–78 | 6.9–7.0x |
 *
 * 144 of 144 block pairings separate at both counts on every sweep, so the size
 * of the total is not in doubt. What it is *spent on* is a weaker claim, and
 * worth keeping apart from it.
 *
 * The **mechanism** is read rather than measured, and it is solid as far as it
 * goes: `WebGLRenderer.render` ends in `updateMultisampleRenderTarget`,
 * `WEBGL_multisampled_render_to_texture` is absent here — checked on the page,
 * not assumed — so three.js blits the multisampled renderbuffer down to its
 * texture at the end of **every** render, and the composer runs four
 * `RenderPass`es into one target before bloom ever reads it. Four resolves per
 * frame, by construction.
 *
 * **What that costs is not established, and an earlier revision of this
 * docstring said it was.** Disabling passes on one build gave 7.5 ms for one
 * pass, 11.9 for two and 18.4 for four — but disabling a `RenderPass` removes
 * its drawing as well as its resolve, so the per-pass figure is an upper bound
 * on the resolve and not a measurement of it. A run that separated the two would
 * have to keep the same geometry drawn while changing how many times the target
 * is resolved, and nothing here does that. **Nor does the linear shape
 * discriminate**, which an earlier revision claimed it did: per-fragment work
 * scales with the pass count too, so 7.5/11.9/18.4 is equally consistent with
 * either explanation. The mechanism argument stands on three's source and the
 * absent extension; the pass-count timings add an upper bound and nothing more.
 *
 * The count **is** a lever — 3.8x against 6.9x is not nothing — but there is no
 * cheap setting of it: the least this game can pay for any antialiasing at all
 * is four times its whole unsampled frame. Moving that floor means changing how
 * many layer passes share the multisampled target, which is #15's render ladder
 * rather than anything this module owns. Until it moves, the count is the
 * player's own row in `settings.ts` and it defaults to off.
 *
 * `dispose()` on a render target drops the GPU-side framebuffer and nothing
 * else: three re-creates it from the object's current fields the next time it
 * is bound, so assigning `samples` and disposing is how a live switch is made
 * without rebuilding the composer and its five passes. Skipped when the count
 * already matches, so a change that does not move this term does not reallocate
 * two full-frame buffers.
 */
export function setComposerSamples(
	targets: readonly THREE.WebGLRenderTarget[],
	samples: number,
) {
	for (const target of targets) {
		if (target.samples === samples) continue;
		target.samples = samples;
		target.dispose();
	}
}
