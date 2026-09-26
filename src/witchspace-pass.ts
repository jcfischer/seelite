/**
 * The witchspace transition's screen-space term (#532): the starbow and the
 * streak, the dark that closes to a point, the flash on the cut, and the
 * tunnel ridden after it, as one pass in the render ladder.
 *
 * ## Why a composer pass
 *
 * #195's receipt verified it: `rebuildSystem()` disposes every mesh and body
 * visual and rebuilds the environment and the derived sky, and it does not touch
 * the composer's passes. So a full-screen term here **survives the cut**, and
 * the tunnel can stay up across the frame the world is replaced on. An effect
 * built from the old sky or its stars would be torn down under it.
 *
 * For the same reason everything drawn here is **procedural**. The pass smears
 * what is in the frame, but the streak's radial lines come from a hash of the
 * angle and the tunnel from noise, so a jump looks the same in a system with a
 * thin sky as in one with a rich one.
 *
 * ## The tunnel
 *
 * The first build covered the cut with a whiteout, and the principal flew it
 * and found it boring: *"a more colorful, swirly tunnel animation, with
 * volumetric mist like structures"*. So there is a tunnel, and the white is
 * only a flash on the cut. On the third flight the principal added *we are
 * faster than light, so we are escaping the light*: the wind-up now squeezes
 * the sky into a starbow (the sky cameras' zoom does the aberration, this pass
 * the Doppler colour and the beaming), black closes in from the rim to one
 * point, and the tunnel opens out of that point after the cut. `witchspace.ts`
 * owns the timeline.
 *
 * Each pixel is a ray down a tube of radius one along the direction of travel.
 * The ray is sampled at `LAYERS` depths between the axis and the wall, front to
 * back, and each sample reads a domain-warped noise field that streams toward
 * the camera with the phase. **Nothing turns** — the principal's fifth flight:
 * space bends, it does not swirl — so the tube **bends** instead: its axis
 * drifts off the centre with depth, and the far end curves away ahead. The
 * samples are composited as mist — each one tints what is behind it and takes
 * some of its light — which is what makes the structure read as volume rather
 * than as a pattern painted on a wall. The colour is a cosine palette over
 * depth and density, so the tunnel is several colours at once and they flow.
 *
 * The tunnel opens from the centre with a ragged edge and fills the frame,
 * and it collapses back into the centre before the new sky unfolds.
 *
 * ## Where it sits, and why
 *
 * **Between the approach layer and the near one**, on the principal's ruling
 * that the tunnel is outside the canopy. It reads the sky and the bodies
 * composited so far, bends them round the nose and round the rift, and draws
 * the tunnel over them; the near pass then draws the cabin and the hull over that, so neither
 * is ever covered or warped. It is written in **linear light**, and the bloom
 * and the tone map come after it, so the plasma strands, the rim and the throat
 * are hot enough to glow and the mist is not. The first build sat after the
 * bloom and covered the cabin; `probe-witchspace.mjs` holds the order and the
 * cabin's pixels.
 *
 * ## The `quality` key (#99)
 *
 * **Both sides draw it**, because a jump without its transition is the hard cut
 * #195 exists to remove. What `low` changes is the streak's sample count and
 * the tunnel's mist layers and noise octaves, which is `WITCHSPACE_PASS_QUALITY`
 * below — data, so a test reads it rather than a comment. The pass is
 * **disabled** whenever the look is dark, so outside a jump it costs nothing on
 * either side; inside one, every term also branches on its uniform (`CLAUDE.md`:
 * a dial at zero still evaluates everything to its right), and the tunnel is
 * evaluated only inside its own opening.
 *
 * What it costs while it draws is `scripts/measure-witchspace-cost.mjs`'s to
 * print, per side and with the renderer it ran on; the figure is not restated
 * here.
 */
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import type { WitchspaceLook } from "./witchspace";
import { WITCHSPACE_MIST_GLSL, WITCHSPACE_VERTEX } from "./witchspace-mist";

/** The linear-light value the flash mixes toward. ACES takes it to white. */
export const WHITEOUT_LINEAR = 10;

/**
 * What each side of #99's `quality` key draws.
 *
 * `scale` is the tunnel's own resolution, per axis, as a fraction of the
 * drawing buffer. **The tunnel is drawn small and upsampled**, because it is
 * the dearest thing in the renderer: drawn at full size over a retina buffer it
 * cost more than a whole 60 Hz frame on the high side (the first measurement
 * with `scripts/measure-witchspace-cost.mjs`). It is soft mist with no hard
 * edge of its own. `high` draws it at 0.35 per axis — about an eighth of the
 * pixels — and `low` at 0.25, a sixteenth. That the upsampled tunnel looks the
 * same as a full-size one was judged by eye, once, on a pair of captures while
 * the tunnel was being built; it is not a measured claim.
 */
export const WITCHSPACE_PASS_QUALITY = Object.freeze({
	high: Object.freeze({ samples: 12, layers: 7, octaves: 4, scale: 0.35 }),
	low: Object.freeze({ samples: 6, layers: 4, octaves: 3, scale: 0.25 }),
});

export type WitchspaceQuality = keyof typeof WITCHSPACE_PASS_QUALITY;

/**
 * The tunnel on its own, drawn into the small target. Exported so a test can
 * read it.
 */
export const WITCHSPACE_TUNNEL_FRAGMENT = /* glsl */ `
uniform float uFlow;
uniform float uAspect;
varying vec2 vUv;
${WITCHSPACE_MIST_GLSL}

// The tunnel's colour along the ray through screen point p (aspect-corrected,
// centre at the origin), at time t.
//
// **It does not swirl** (the principal's fifth flight): nothing here rotates
// with depth or time, the mist streams straight toward the camera, and the
// colour runs down the tunnel rather than round it. What moves is the tunnel
// itself — it **bends**. Its far end drifts off the axis, so the tube curves
// away ahead of the ship the way space does, and the throat goes with it.
vec3 witchTunnel(vec2 p, float t) {
	vec2 throat = 0.16 * vec2(sin(t * 0.55 + 1.3), sin(t * 0.4 - 0.4));
	float r0 = max(length(p), 0.012);
	vec3 col = vec3(0.0);
	float light = 1.0;
	float wallDepth = 0.55 / r0;
	for (int k = 1; k <= LAYERS; k++) {
		// Distance from the axis, and the depth that puts the ray there. The last
		// layer is the wall. The axis at that depth is bent toward the throat:
		// not at all beside the camera, fully far down the tube.
		float s = float(k) / float(LAYERS);
		float bend = smoothstep(0.6, 6.0, 0.55 * s / r0);
		vec2 pk = p - throat * bend;
		float r = max(length(pk), 0.012);
		vec2 xy = (pk / r) * s;
		float depth = 0.55 * s / r;
		vec3 q = vec3(xy * 1.8, depth * 0.9 - t * 3.2);
		float warp = witchFbm(q * 0.8 + vec3(0.0, 0.0, t * 0.4));
		float n = witchFbm(q * 1.4 + warp * 2.4);
		float wall = k == LAYERS ? 1.0 : 0.0;
		if (k == LAYERS) wallDepth = depth;
		float density = mix(smoothstep(0.45, 0.85, n) * 0.5, 0.95, wall);
		// Hue runs down the tunnel and with the density, and in stripes along
		// it — the angle alone, so a stripe is a straight line down the tube.
		float stripe = 0.2 * sin(atan(xy.y, xy.x) * 3.0);
		float hue = depth * 0.16 + n * 1.5 + stripe + t * 0.15;
		vec3 tint = witchPalette(hue);
		// Low on purpose: the tone map saturates anything much above one, and
		// the first pass at this washed the whole tunnel to one pale yellow.
		float glow = mix(0.04, 0.1 + 0.5 * n * n, 1.0 - wall * 0.6)
			+ 0.3 * smoothstep(2.0, 9.0, depth);
		// Plasma: thin strands along the warp field's middle contour, in the
		// complementary hue and hot enough for the bloom to take.
		float ridge = 1.0 - abs(2.0 * warp - 1.0);
		float strand = pow(ridge, 22.0) * smoothstep(0.5, 0.8, n);
		vec3 hot = witchPalette(hue + 0.5) * 1.6;
		col += light * (density * tint * glow + strand * hot * (1.0 - 0.5 * wall));
		light *= 1.0 - density;
	}
	// Rings of light rushing past on the wall: speed, read off the depth.
	float rings = pow(max(0.0, sin(wallDepth * 3.5 - t * 22.0)), 14.0);
	col += rings * witchPalette(wallDepth * 0.1 + t * 0.2) * 0.45
		* smoothstep(0.9, 2.5, wallDepth);
	// Dark toward the rim, which is the tunnel nearest the camera: the depth
	// reads as light at the far end, not as a flat painted wall.
	col *= mix(0.25, 1.0, smoothstep(0.95, 0.12, r0));
	// The throat, where the bent tube goes: a white-hot core in a cold halo.
	float rt = length(p - throat);
	col += vec3(1.0, 0.95, 1.2) * exp(-rt * rt * 220.0) * 1.6;
	col += vec3(0.4, 0.55, 1.2) * exp(-rt * rt * 18.0) * 0.35;
	return col;
}

void main() {
	vec2 d = vUv - 0.5;
	gl_FragColor = vec4(witchTunnel(vec2(d.x * uAspect, d.y), uFlow), 1.0);
}
`;

/** The composite. Exported so a test reads the branches it relies on. */
export const WITCHSPACE_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tTunnel;
uniform float uStreak;
uniform float uTunnel;
uniform float uBeta;
uniform float uDark;
uniform vec2 uLensAt;
uniform float uLensE;
uniform float uWhiteout;
uniform float uFlow;
uniform float uAspect;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453); }
${WITCHSPACE_MIST_GLSL}

vec2 toUv(vec2 p) { return vec2(p.x / uAspect, p.y) + 0.5; }

// A point lens: the sky seen at p comes from r - E²/r along the same line
// through the centre. Nothing turns — space bends, it does not swirl (the
// principal's fourth flight) — and the stars near the centre stretch round it
// into an Einstein ring at r = E, with the far side's image inside it.
vec2 witchLens(vec2 p, vec2 centre, float einstein) {
	vec2 d = p - centre;
	float r2 = max(dot(d, d), 1e-5);
	return centre + d * (1.0 - einstein * einstein / r2);
}

// The Doppler spectrum across the visible sky: blue-white ahead, through cyan,
// green and gold, to deep red at the rim. The starbow is this, compressed.
vec3 starbow(float x) {
	vec3 c = mix(vec3(0.9, 0.95, 1.7), vec3(0.35, 0.95, 1.5), smoothstep(0.0, 0.25, x));
	c = mix(c, vec3(0.45, 1.35, 0.5), smoothstep(0.25, 0.5, x));
	c = mix(c, vec3(1.45, 1.1, 0.3), smoothstep(0.5, 0.75, x));
	return mix(c, vec3(1.6, 0.3, 0.12), smoothstep(0.75, 1.0, x));
}

void main() {
	vec2 d = vUv - 0.5;
	vec2 p = vec2(d.x * uAspect, d.y);
	float r = length(p);
	float ang = atan(p.y, p.x);
	// The pull: the drive's field bends the sky round the nose like a lens, and
	// the arrival rift bends it round itself. Only the layers behind the cabin
	// are read here, so the cabin never swims.
	float pull = max(uStreak * 0.3, uTunnel);
	// How much of this pixel the tunnel covers: an opening from the centre with
	// a ragged, shifting edge, full-frame at 1.
	float cover = 0.0;
	float edge = 0.0;
	if (uTunnel > 0.0) {
		float rag = witchNoise(vec3(cos(ang) * 2.5, sin(ang) * 2.5, uFlow * 1.5));
		edge = uTunnel * 1.45 + (rag - 0.5) * 0.35 * (1.0 - uTunnel);
		cover = 1.0 - smoothstep(edge - 0.25, edge, r);
	}
	// What the dark leaves visible: a disc that shrinks to nothing at 1.
	float visible = mix(1.45, 0.0, uDark);
	vec3 c;
	// Not under a full cover, nor outside what the dark leaves: the sky there is
	// not seen, and this is the pass's dearest loop outside the tunnel itself.
	// Round 1 found it running on every pixel the closing dark then blacked out.
	if ((pull > 0.0 || uLensE > 0.0) && cover < 1.0 && r < visible) {
		vec2 q = witchLens(p, uLensAt, uLensE);
		q = witchLens(q, vec2(0.0), pull * 0.16);
		if (uStreak > 0.0) {
			// Smeared inward along the pull.
			vec3 acc = vec3(0.0);
			float w = 0.0;
			for (int i = 0; i < SAMPLES; i++) {
				float k = float(i) / float(SAMPLES);
				float wt = 1.0 - 0.6 * k;
				acc += texture2D(tDiffuse, toUv(q * (1.0 - 0.25 * uStreak * k))).rgb * wt;
				w += wt;
			}
			c = acc / w;
		} else {
			// Nothing to smear: the rift's lens alone, late in the arrival, where
			// every tap of the loop would read the same texel (sage round 2).
			c = texture2D(tDiffuse, toUv(q)).rgb;
		}
	} else {
		c = texture2D(tDiffuse, vUv).rgb;
	}
	if (uStreak > 0.0 && cover < 1.0) {
		// The streak's lines, from a hash of the angle and not from the sky,
		// straight out from the nose — a lens keeps a radial line radial — in
		// the tunnel's palette.
		float lanes = (ang + 3.14159265) * 19.099;
		float seed = hash(floor(lanes));
		// A thin line down the middle of its lane, not the whole lane: a lane is
		// a wedge, and at the frame's edge a wedge is a broad pale band.
		float across = abs(fract(lanes) - 0.5);
		float line = step(0.7, seed) * (1.0 - smoothstep(0.04, 0.12, across));
		float flow = fract(r * 2.5 - uFlow * (1.5 + 2.0 * seed) + seed * 7.0);
		float dash = smoothstep(0.0, 0.25, flow) * (1.0 - smoothstep(0.35, 0.9, flow));
		float lit = line * dash * smoothstep(0.04, 0.5, r) * uStreak * uStreak;
		c += witchPalette(seed + uFlow * 0.1) * 1.4 * lit * 2.0;
	}
	// Escaping the light. The sky left inside the closing dark carries the
	// Doppler spectrum from its centre to its edge and the light beamed ahead,
	// so as the dark closes the spectrum closes with it into a ring round the
	// point: the starbow. The aberration itself is the sky cameras' zoom,
	// which main.ts sets from the same term.
	if (uBeta > 0.0) {
		// Across what is on screen: the disc the dark leaves, or the frame's own
		// corner radius while the dark is still beyond it. Normalised to the
		// disc alone, the rim's red was off the screen and the probe read the
		// starbow as bluer at the edge than at the nose.
		float corner = length(vec2(0.5 * uAspect, 0.5));
		float x = clamp(r / max(min(visible, corner), 0.02), 0.0, 1.0);
		float beam = 1.0 + 2.5 * (1.0 - x) * (1.0 - x);
		c *= mix(vec3(1.0), starbow(x) * beam, uBeta);
	}
	if (uDark > 0.0) {
		c *= 1.0 - smoothstep(visible - 0.18 * (1.0 - uDark) - 0.015, visible, r);
		// The point ahead: all the light there is once the dark has closed,
		// and what the tunnel opens out of.
		c += vec3(1.0, 0.96, 1.15) * exp(-r * r / 0.0005) * 5.0
			* smoothstep(0.6, 1.0, uDark) * (1.0 - uTunnel);
	}
	if (cover > 0.0) {
		// A radial colour split, growing toward the frame's edge.
		vec2 split = d * 0.014 * (0.4 + r);
		vec3 tunnel = vec3(
			texture2D(tTunnel, vUv + split).r,
			texture2D(tTunnel, vUv).g,
			texture2D(tTunnel, vUv - split).b);
		c = mix(c, tunnel, cover);
	}
	// The opening's rim: a hot ring that flickers round the edge while the
	// tunnel opens and closes, and is gone when it fills the frame.
	if (uTunnel > 0.0 && uTunnel < 1.0) {
		// The ring wanders a little off the edge and crackles along it.
		float crackle = witchNoise(vec3(cos(ang) * 14.0, sin(ang) * 14.0, uFlow * 9.0));
		float x = (r - edge + 0.12 + (crackle - 0.5) * 0.03) / 0.016;
		float ring = exp(-x * x);
		float flicker = 0.4 + 1.6 * crackle * crackle;
		c += (witchPalette(crackle * 0.9 + uFlow * 0.1) + 0.25) * ring * flicker * 1.3
			* sin(3.14159265 * uTunnel);
	}
	// Shaped, because the mix is in linear light toward a value the tone map
	// takes to white: a linear weight puts a fifth of the way at nearly white
	// on screen, and the flash reads as a switch rather than a flash.
	if (uWhiteout > 0.0) {
		float k = uWhiteout * uWhiteout;
		c = mix(c, vec3(WHITEOUT), k * k);
	}
	gl_FragColor = vec4(c, 1.0);
}
`;

const definesFor = (quality: WitchspaceQuality) => {
	const q = WITCHSPACE_PASS_QUALITY[quality];
	return { SAMPLES: q.samples, LAYERS: q.layers, OCTAVES: q.octaves };
};

export class WitchspacePass extends ShaderPass {
	/** The small target the tunnel is drawn into and upsampled from. */
	private readonly tunnelTarget: THREE.WebGLRenderTarget;
	private readonly tunnelQuad: FullScreenQuad;
	private readonly tunnelMaterial: THREE.ShaderMaterial;
	private readonly bufferSize = new THREE.Vector2();
	/** The tunnel's resolution per axis, as a fraction of the drawing buffer. */
	scale: number;

	constructor(quality: WitchspaceQuality) {
		const defines = definesFor(quality);
		super({
			uniforms: {
				tDiffuse: { value: null },
				tTunnel: { value: null },
				uStreak: { value: 0 },
				uBeta: { value: 0 },
				uDark: { value: 0 },
				uLensAt: { value: new THREE.Vector2() },
				uLensE: { value: 0 },
				uTunnel: { value: 0 },
				uWhiteout: { value: 0 },
				uFlow: { value: 0 },
				uAspect: { value: 1 },
			},
			defines: {
				...defines,
				WHITEOUT: WHITEOUT_LINEAR.toFixed(1),
			},
			vertexShader: WITCHSPACE_VERTEX,
			fragmentShader: WITCHSPACE_FRAGMENT,
		});
		this.scale = WITCHSPACE_PASS_QUALITY[quality].scale;
		// Half-float, like the composer's own targets: the tunnel is linear light
		// and runs above one at its brightest.
		this.tunnelTarget = new THREE.WebGLRenderTarget(1, 1, {
			type: THREE.HalfFloatType,
			depthBuffer: false,
		});
		this.tunnelMaterial = new THREE.ShaderMaterial({
			uniforms: { uFlow: { value: 0 }, uAspect: { value: 1 } },
			defines: { ...defines },
			vertexShader: WITCHSPACE_VERTEX,
			fragmentShader: WITCHSPACE_TUNNEL_FRAGMENT,
			depthTest: false,
			depthWrite: false,
		});
		this.tunnelQuad = new FullScreenQuad(this.tunnelMaterial);
		this.material.uniforms.tTunnel.value = this.tunnelTarget.texture;
		this.enabled = false;
	}

	/** The streak sample count the material is built with — what `quality` chose. */
	get samples(): number {
		return this.material.defines.SAMPLES as number;
	}

	/** The tunnel's mist layers the material is built with. */
	get layers(): number {
		return this.tunnelMaterial.defines.LAYERS as number;
	}

	/** The tunnel target's size in pixels, for a probe to read by name. */
	get tunnelSize(): { width: number; height: number } {
		return { width: this.tunnelTarget.width, height: this.tunnelTarget.height };
	}

	/** What is currently on screen, for a probe to read by name. */
	get look(): {
		streak: number;
		beta: number;
		dark: number;
		tunnel: number;
		whiteout: number;
	} {
		const u = this.material.uniforms;
		return {
			streak: u.uStreak.value,
			beta: u.uBeta.value,
			dark: u.uDark.value,
			tunnel: u.uTunnel.value,
			whiteout: u.uWhiteout.value,
		};
	}

	/** Switch sides of #99's key live; each program is rebuilt once. */
	setQuality(quality: WitchspaceQuality) {
		this.scale = WITCHSPACE_PASS_QUALITY[quality].scale;
		const want = definesFor(quality);
		for (const material of [this.material, this.tunnelMaterial]) {
			const have = material.defines;
			if (
				have.SAMPLES === want.SAMPLES &&
				have.LAYERS === want.LAYERS &&
				have.OCTAVES === want.OCTAVES
			)
				continue;
			Object.assign(have, want);
			material.needsUpdate = true;
		}
	}

	/**
	 * Draw a look. Called every frame from the state, never poked from outside —
	 * the vignette's lesson (`CLAUDE.md`): a probe writing a uniform the frame
	 * loop rewrites measures its own write being overwritten.
	 *
	 * `flow` is the phase, so a held phase draws the same frame every capture.
	 */
	apply(
		look: Pick<
			WitchspaceLook,
			"streak" | "beta" | "dark" | "tunnel" | "whiteout" | "rift"
		>,
		flow: number,
		aspect: number,
	) {
		const u = this.material.uniforms;
		u.uStreak.value = look.streak;
		u.uTunnel.value = look.tunnel;
		u.uBeta.value = look.beta;
		u.uDark.value = look.dark;
		u.uWhiteout.value = look.whiteout;
		u.uFlow.value = flow;
		u.uAspect.value = aspect;
		this.tunnelMaterial.uniforms.uFlow.value = flow;
		this.tunnelMaterial.uniforms.uAspect.value = aspect;
		// Any term at all, read off the look rather than listed: a term added to
		// `WitchspaceLook` lights the pass without an edit here.
		this.enabled = Object.values(look).some((v) => v > 0);
	}

	/**
	 * The lens the arrival rift puts in the sky (#532, the fourth flight): its
	 * centre in the pass's aspect-corrected screen units and its Einstein
	 * radius there. `main.ts` projects the rift every frame; zero is no lens.
	 */
	setLens(x: number, y: number, einstein: number) {
		const u = this.material.uniforms;
		(u.uLensAt.value as THREE.Vector2).set(x, y);
		u.uLensE.value = Math.max(0, einstein);
	}

	/** The rift's lens as drawn, for a probe to read by name. */
	get lens(): { x: number; y: number; einstein: number } {
		const u = this.material.uniforms;
		const at = u.uLensAt.value as THREE.Vector2;
		return { x: at.x, y: at.y, einstein: u.uLensE.value as number };
	}

	/** The tunnel into its small target, when it is showing; then the composite. */
	override render(
		renderer: THREE.WebGLRenderer,
		writeBuffer: THREE.WebGLRenderTarget,
		readBuffer: THREE.WebGLRenderTarget,
		deltaTime: number,
		maskActive: boolean,
	) {
		if (this.material.uniforms.uTunnel.value > 0) {
			renderer.getDrawingBufferSize(this.bufferSize);
			const width = Math.max(1, Math.round(this.bufferSize.x * this.scale));
			const height = Math.max(1, Math.round(this.bufferSize.y * this.scale));
			if (
				this.tunnelTarget.width !== width ||
				this.tunnelTarget.height !== height
			)
				this.tunnelTarget.setSize(width, height);
			renderer.setRenderTarget(this.tunnelTarget);
			this.tunnelQuad.render(renderer);
		}
		super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
	}

	override dispose() {
		super.dispose();
		this.tunnelTarget.dispose();
		this.tunnelMaterial.dispose();
		this.tunnelQuad.dispose();
	}
}
