/**
 * `src/output-stage.ts` — the splice that has to land, and the two dials it adds.
 *
 * The subject is a shader patch, so the property worth holding is the one
 * `shader-splice.ts` exists for: **a marker three.js renamed produces a stock
 * shader that compiles, links, renders and looks almost right**. Asserting that
 * the three markers are found in three's current source is only worth anything
 * beside a case where one is not, so the rename is run here rather than
 * described.
 */
import { expect, test } from "bun:test";
import { OutputShader } from "three/addons/shaders/OutputShader.js";
import {
	DITHER_CODES,
	OUTPUT_MARKERS,
	SeeliteOutputPass,
	spliceOutputShader,
	VIGNETTE_MAX,
} from "../src/output-stage";
import { DEFAULT_SETTINGS, settingSpec } from "../src/settings";
import { makeSplicer } from "../src/shader-splice";

const spliceAgainst = (source: string) => {
	const { log, splice } = makeSplicer("test");
	const out = spliceOutputShader(source, splice);
	return { log, out };
};

test("every marker is in three's own output shader", () => {
	const { log } = spliceAgainst(OutputShader.fragmentShader);
	// Three entries, not "at least three": a marker dropped from the module
	// would leave two trues and read as a pass.
	expect(Object.keys(log).length).toBe(3);
	expect(Object.values(log).every(Boolean)).toBe(true);
});

test("a renamed marker is reported as a miss", () => {
	// The red build, run rather than promised. Each marker is renamed in turn,
	// because a splicer keyed on the wrong thing would let one hit stand in for
	// another — which is the failure `makeSplicer`'s own docstring records.
	for (const [name, marker] of Object.entries(OUTPUT_MARKERS)) {
		const renamed = OutputShader.fragmentShader.replaceAll(
			marker,
			`/* three renamed ${name} */`,
		);
		const { log } = spliceAgainst(renamed);
		const missed = Object.entries(log).filter(([, hit]) => !hit);
		expect(missed.length).toBe(1);
		expect(missed[0][0]).toContain(marker);
	}
});

test("the vignette is applied in linear light and the dither after the encode", () => {
	// Order is the whole of the design argument in the module's docstring, and
	// it is decidable from the source: a dither before the sRGB transfer would be
	// the wrong magnitude in the dark, which is the only place it is needed.
	const { out } = spliceAgainst(OutputShader.fragmentShader);
	const vignette = out.indexOf("seeliteVignette( gl_FragColor.rgb");
	const encode = out.indexOf(OUTPUT_MARKERS.dither);
	const dither = out.indexOf("seeliteDither( gl_FragColor.rgb )");
	expect(vignette).toBeGreaterThan(0);
	expect(vignette).toBeLessThan(encode);
	expect(dither).toBeGreaterThan(encode);
});

test("the dither is one output code, peak to peak, and zero-mean", () => {
	const { out } = spliceAgainst(OutputShader.fragmentShader);
	// The amplitude is asserted against the constant rather than against a
	// literal, and the shader is asserted to carry the centring: `noise - 0.5`
	// is what makes a flat region keep its exact value instead of getting
	// half a code brighter everywhere.
	expect(DITHER_CODES).toBe(1);
	// The constant is what the shader multiplies by, not a figure beside a
	// literal — `DITHER_CODES` is interpolated into the source, so a change to
	// it moves the amplitude the GPU applies rather than only this assertion.
	expect(out).toContain(
		`(seeliteNoise(gl_FragCoord.xy) - 0.5) * ${(DITHER_CODES / 255).toFixed(8)}`,
	);
});

test("the counts the player is offered are the ones the screen shows", () => {
	// **This asserts the offer and nothing about the hardware**, which an
	// earlier version of it got wrong: it was titled "every count a target can
	// take" while checking only membership and evenness, and no headless test
	// can allocate a half-float target or ask a framebuffer whether it is
	// complete. What a context will actually multisample RGBA16F at is
	// `supportedSamples`, `grantedSamples` clamps to it, and
	// `probe-output-stage.mjs` is where that is checked in front of a real
	// rasteriser.
	const allowed = settingSpec("antialias").allowed as readonly number[];
	expect(allowed).toEqual([0, 2, 4]);
	// Off by default, and that is the decision #200 closed on rather than an
	// oversight — `setComposerSamples` carries the measurement.
	expect(DEFAULT_SETTINGS.antialias).toBe(0);
});

test("a term switched off is branched around, not multiplied by zero", () => {
	// The defect this names shipped and review caught it. A dial at zero still
	// evaluates everything to its right, so the settings row removed the effect
	// and not the cost — and an on-against-off timing then subtracts the shared
	// arithmetic out of both arms and reports the term as cheaper than it is.
	// That is exactly the reading this branch published for a round.
	const { out } = spliceAgainst(OutputShader.fragmentShader);
	expect(out).toContain("if (uDither <= 0.0) return colour;");
	expect(out).toContain("if (uVignette <= 0.0) return colour;");
	// And the multiplier is gone from the dither, so the uniform is a switch
	// rather than a gain — a fraction of a code would be a silent half-dither.
	expect(out).not.toContain("uDither * (seeliteNoise");
});

test("the vignette dial is clamped at both ends", () => {
	const pass = new SeeliteOutputPass();
	const uniform = pass.material.uniforms.uVignette;
	// Off by default: chase view is the case #200 refuses to vignette, and a
	// default that had to be turned off would vignette the first frame drawn.
	expect(uniform.value).toBe(0);
	pass.setVignette(VIGNETTE_MAX);
	expect(uniform.value).toBe(VIGNETTE_MAX);
	pass.setVignette(1);
	expect(uniform.value).toBe(VIGNETTE_MAX);
	pass.setVignette(-1);
	expect(uniform.value).toBe(0);
});

test("the vignette reader reports what the uniform holds", () => {
	const pass = new SeeliteOutputPass();
	// `probe-output-stage.mjs` reads this rather than the uniform bag, whose
	// index signature types every entry as `IUniform<any>` — a reader reaching
	// into the bag cannot be typed, and one reaching for the wrong key would
	// report `undefined` for ever. There is no matching `dither` reader,
	// deliberately: nothing outside the class wants one, and the uniform below
	// is what the shader actually multiplies by.
	pass.setVignette(VIGNETTE_MAX);
	expect(pass.vignette).toBe(VIGNETTE_MAX);
	pass.setVignette(0);
	expect(pass.vignette).toBe(0);
});

test("the pass records its splices where a probe reads them", () => {
	const pass = new SeeliteOutputPass();
	// `probe-output-stage.mjs` traverses for this key by name, so the name is
	// part of the contract and not an implementation detail. It is also the only
	// way in: a `splices` field beside it was a second name for one thing.
	const log = pass.material.userData.outputSplices as Record<string, boolean>;
	expect(Object.keys(log).length).toBe(3);
	expect(Object.values(log).every(Boolean)).toBe(true);
	// The dither is on unless a probe turns it off — the player never sees the
	// control arm.
	expect(pass.material.uniforms.uDither.value).toBe(1);
	pass.setDither(false);
	expect(pass.material.uniforms.uDither.value).toBe(0);
});
