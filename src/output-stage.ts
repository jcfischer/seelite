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
import { type SpliceLog, makeSplicer } from "./shader-splice";

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

// Interleaved gradient noise (Jimenez). Zero-mean once the 0.5 is taken off,
// and its period is long enough across a 1440x900 frame that a flat area
// stipples rather than tiles.
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
	/** Every splice this pass made, by stage and marker. Also on
	 *  `material.userData.outputSplices`, which is where a probe reads it. */
	readonly splices: SpliceLog;

	constructor() {
		super();
		const { log, splice } = makeSplicer("output stage");
		this.material.fragmentShader = spliceOutputShader(
			this.material.fragmentShader,
			splice,
		);
		this.splices = log;
		this.material.uniforms.uVignette = { value: 0 };
		this.material.uniforms.uDither = { value: 1 };
		this.material.userData.outputSplices = log;
		this.material.needsUpdate = true;
	}

	/**
	 * A dial pinned against the frame loop, or `null` to give it back.
	 *
	 * `main.ts` calls `setVignette` from the view on **every** frame, so a probe
	 * that assigns the uniform directly has its assignment overwritten before the
	 * frame it wanted to measure is drawn — which is not a failure a readback can
	 * distinguish from a vignette that does nothing. It read 1.000 against 1.000
	 * and the check was right to fail. This is what a control arm sets.
	 */
	vignetteOverride: number | null = null;

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
			Math.max(0, this.vignetteOverride ?? strength),
		);
	}

	/**
	 * Turn the dither off.
	 *
	 * Here for the probe and for nothing else: banding is a claim about *more
	 * distinct codes in a gradient*, and a claim like that needs the same frame
	 * measured both ways in one run rather than two builds compared across two.
	 */
	setDither(on: boolean) {
		this.material.uniforms.uDither.value = on ? 1 : 0;
	}
}

/**
 * The composer's own target, multisampled.
 *
 * `EffectComposer` clones whatever it is handed for its second buffer and
 * `RenderTarget.copy` carries `samples`, so both buffers are multisampled from
 * one construction. Sized at the current drawing buffer; `main.ts`'s `onResize`
 * runs once at boot and owns the size from then on.
 */
/**
 * The largest sample count this context will actually multisample RGBA16F at.
 *
 * **Not `MAX_SAMPLES`.** That parameter answers for the normalised formats; a
 * *floating-point* multisampled renderbuffer is optional in WebGL2, and a
 * context that grants 4x for RGBA8 may grant 2x or none for RGBA16F. The
 * composer's targets are `HalfFloatType`, so asking for a count this returns
 * nothing for leaves the framebuffer incomplete — which is a black frame, not
 * an exception.
 *
 * `getInternalformatParameter(RENDERBUFFER, RGBA16F, SAMPLES)` is the question
 * that answers for the format actually being allocated. It comes back in
 * descending order. A context that cannot answer at all — no float colour
 * buffer extension, or a driver returning nothing — reads as zero, which turns
 * the setting off rather than gambling on it.
 */
function supportedSamples(renderer: THREE.WebGLRenderer): number {
	const gl = renderer.getContext() as WebGL2RenderingContext;
	if (typeof gl.getInternalformatParameter !== "function") return 0;
	try {
		const counts = gl.getInternalformatParameter(
			gl.RENDERBUFFER,
			gl.RGBA16F,
			gl.SAMPLES,
		) as Int32Array | null;
		return counts?.length ? Math.max(...counts) : 0;
	} catch {
		return 0;
	}
}

/**
 * The count to actually ask a target for, given what the player chose.
 *
 * Clamped rather than refused: a machine that grants 2x should give the player
 * who asked for 4x the 2x it has, not a black frame and not an unexplained
 * revert of their setting. The settings screen keeps offering all three,
 * because what a *different* machine supports is not a preference to store.
 */
export const grantedSamples = (renderer: THREE.WebGLRenderer, wanted: number) =>
	Math.min(wanted, supportedSamples(renderer));

export function composerTarget(
	renderer: THREE.WebGLRenderer,
	samples: number,
): THREE.WebGLRenderTarget {
	const size = renderer.getDrawingBufferSize(new THREE.Vector2());
	const target = new THREE.WebGLRenderTarget(size.x, size.y, {
		type: THREE.HalfFloatType,
		samples: grantedSamples(renderer, samples),
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
 * **A range across three sweeps, not one run's figures.** The absolute level
 * moved 25% between sweeps of the same build — 2.34 ms unsampled on the first,
 * 1.84 on the two after it — and the ratio moved with it. One sweep quoted as a
 * constant is the trap this repo has recorded before.
 *
 * | samples | ms/frame | fps | against unsampled |
 * | ---: | ---: | ---: | ---: |
 * | 0 | 1.8–2.3 | 430–545 | — |
 * | 2 | 8.5–9.3 | 107–118 | 4.0–4.7x |
 * | 4 | 14.1–15.1 | 66–71 | 6.4–7.8x |
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
 * is resolved, and nothing here does that. What those three do establish is that
 * the cost is roughly linear in the pass count, which the resolve mechanism
 * predicts and a per-fragment cost would not. `resolveDepthBuffer = false`, on
 * the same run, recovered 4 ms of the 18.
 *
 * The count **is** a lever — 4.0x against 6.4x is not nothing — but there is no
 * cheap setting of it: the least this game can pay for any antialiasing at all
 * is four times its whole unsampled frame. Moving that floor means changing how
 * many layer passes share the multisampled target, which is #15's render ladder
 * rather than anything this module owns. Until it moves, the count is the
 * player's own row in `settings.ts` and it defaults to off.
 *
 * **The dither is 0.12–0.14 ms/frame**, 6–7%, 144/144 separated on both sweeps
 * that measured it — around 40% of what #99's whole baked environment costs on
 * the same runs. Small, and not the "nothing measurable" this docstring and the
 * player-facing note both asserted before anything measured it.
 *
 * That figure only means anything because the shader **branches** rather than
 * multiplying by a zeroed dial. The first version of it did the latter, so the
 * off arm still evaluated the noise; the difference then excluded the
 * arithmetic, and a decline written on the strength of it — that guarding the
 * term would buy nothing — was reasoning from a comparison whose two arms did
 * the same work. Review caught that. With the branch in, off is off: the
 * measured 0.20–0.27 ms became 0.12–0.14, and what is left is the term rather
 * than the term minus itself.
 *
 * `dispose()` on a render target drops the GPU-side framebuffer and nothing
 * else: three re-creates it from the object's current fields the next time it is
 * bound, so assigning `samples` and disposing is how a live switch is made
 * without rebuilding the composer and its five passes. Skipped when the count
 * already matches, so a quality change that does not move this term does not
 * reallocate two full-frame buffers.
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
