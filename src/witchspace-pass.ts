/**
 * The witchspace transition's screen-space term (#532): the entry's streak, the
 * swirling tunnel that covers the cut, and the flash on it, as one composer
 * pass.
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
 * volumetric mist like structures"*. So the cover is a tunnel now, and the
 * white is only a flash on the cut.
 *
 * Each pixel is a ray down a cylinder of radius one along the direction of
 * travel. The ray is sampled at `LAYERS` depths between the axis and the wall,
 * front to back, and each sample reads a domain-warped noise field in a frame
 * that **twists with depth** and streams toward the camera with the phase. The
 * samples are composited as mist — each one tints what is behind it and takes
 * some of its light — which is what makes the structure read as volume rather
 * than as a pattern painted on a wall. The colour is a cosine palette over
 * depth and density, so the tunnel is several colours at once and they flow.
 *
 * The tunnel opens from the centre with a ragged edge and fills the frame on
 * the cut (`witchspace.ts` owns when), and it collapses back into the centre in
 * the new system.
 *
 * ## Where it sits, and why
 *
 * After the bloom and before the output stage. Before the output stage because
 * it is written in **linear light** and the tone map is the output stage's.
 * After the bloom because the streak's lines and the tunnel's mist carry their
 * own glow; a tunnel fed to the bloom would halo into a smear.
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
import { WITCHSPACE_MIST_GLSL } from "./witchspace-mist";

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
 * edge of its own, so a quarter-size target loses almost nothing a player can
 * see and buys back a factor of sixteen.
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
vec3 witchTunnel(vec2 p, float t) {
	float r = max(length(p), 0.015);
	vec2 dir = p / r;
	vec3 col = vec3(0.0);
	float light = 1.0;
	for (int k = 1; k <= LAYERS; k++) {
		// Distance from the axis, and the depth that puts the ray there. The last
		// layer is the wall.
		float s = float(k) / float(LAYERS);
		float depth = 0.55 * s / r;
		float twist = depth * 0.9 + t * 1.3;
		float cs = cos(twist);
		float sn = sin(twist);
		vec2 xy = vec2(dir.x * cs - dir.y * sn, dir.x * sn + dir.y * cs) * s;
		vec3 q = vec3(xy * 1.8, depth * 0.9 - t * 2.2);
		float warp = witchFbm(q * 0.8 + vec3(0.0, 0.0, t * 0.3));
		float n = witchFbm(q * 1.4 + warp * 2.2);
		float wall = k == LAYERS ? 1.0 : 0.0;
		float density = mix(smoothstep(0.42, 0.8, n) * 0.6, 0.95, wall);
		// Hue runs down the tunnel, with the density, and in bands that follow the
		// spiral, so the colours stream rather than sit.
		float band = 0.18 * sin(atan(xy.y, xy.x) * 3.0 + depth * 0.7);
		vec3 tint = witchPalette(depth * 0.16 + n * 1.5 + band + t * 0.12);
		// Brighter where the mist is thick and toward the far end of the tunnel.
		// Low on purpose: the tone map saturates anything much above one, and the
		// first pass at this washed the whole tunnel to one pale yellow.
		float glow = mix(0.05, 0.12 + 0.55 * n * n, 1.0 - wall * 0.6)
			+ 0.35 * smoothstep(2.0, 9.0, depth);
		col += light * density * tint * glow;
		light *= 1.0 - density;
	}
	// Dark toward the rim, which is the tunnel nearest the camera: the depth
	// reads as light at the far end, not as a flat painted wall.
	col *= mix(0.3, 1.0, smoothstep(0.95, 0.12, r));
	// The vanishing point: where the tunnel goes, a bright cold core.
	col += vec3(0.6, 0.7, 1.2) * exp(-r * r * 90.0) * 0.9;
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
uniform float uWhiteout;
uniform float uFlow;
uniform float uAspect;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453); }
${WITCHSPACE_MIST_GLSL}

void main() {
	vec4 base = texture2D(tDiffuse, vUv);
	vec3 c = base.rgb;
	vec2 d = vUv - 0.5;
	vec2 p = vec2(d.x * uAspect, d.y);
	float r = length(p);
	// How much of this pixel the tunnel covers: an opening from the centre with
	// a ragged, turning edge, full-frame at 1.
	float cover = 0.0;
	if (uTunnel > 0.0) {
		float ang = atan(p.y, p.x);
		float rag = witchNoise(vec3(cos(ang) * 2.5, sin(ang) * 2.5, uFlow * 1.5));
		float edge = uTunnel * 1.45 + (rag - 0.5) * 0.35 * (1.0 - uTunnel);
		cover = 1.0 - smoothstep(edge - 0.3, edge, r);
	}
	if (uStreak > 0.0 && cover < 1.0) {
		// Zoom toward the centre: the frame is pulled into the direction of
		// travel. Weighted toward the unmoved sample so the subject stays legible
		// until late in the entry.
		vec3 acc = vec3(0.0);
		float w = 0.0;
		for (int i = 0; i < SAMPLES; i++) {
			float k = float(i) / float(SAMPLES);
			float wt = 1.0 - 0.5 * k;
			acc += texture2D(tDiffuse, 0.5 + d * (1.0 - 0.3 * uStreak * k)).rgb * wt;
			w += wt;
		}
		c = mix(c, acc / w, uStreak);
		// The radial lines, from a hash of the angle and not from the sky, and
		// coloured from the tunnel's palette so the two read as one thing.
		float lane = floor((atan(p.y, p.x) + 3.14159265) * 60.0);
		float seed = hash(lane);
		float line = step(0.72, seed);
		float flow = fract(r * 2.5 - uFlow * (1.5 + 2.0 * seed) + seed * 7.0);
		float dash = smoothstep(0.0, 0.25, flow) * (1.0 - smoothstep(0.35, 0.9, flow));
		float lit = line * dash * smoothstep(0.04, 0.5, r) * uStreak * uStreak;
		c += witchPalette(seed + uFlow * 0.1) * lit * 4.0;
		// A cold cast over the whole frame as the drive takes hold.
		c *= mix(vec3(1.0), vec3(0.8, 0.8, 1.2), 0.5 * uStreak);
	}
	if (cover > 0.0) c = mix(c, texture2D(tTunnel, vUv).rgb, cover);
	// Shaped, because the mix is in linear light toward a value the tone map
	// takes to white: a linear weight puts a fifth of the way at nearly white
	// on screen, and the flash reads as a switch rather than a flash.
	if (uWhiteout > 0.0) {
		float k = uWhiteout * uWhiteout;
		c = mix(c, vec3(WHITEOUT), k * k);
	}
	gl_FragColor = vec4(c, base.a);
}
`;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
				uTunnel: { value: 0 },
				uWhiteout: { value: 0 },
				uFlow: { value: 0 },
				uAspect: { value: 1 },
			},
			defines: {
				...defines,
				WHITEOUT: WHITEOUT_LINEAR.toFixed(1),
			},
			vertexShader: VERTEX,
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
			vertexShader: VERTEX,
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
	get look(): { streak: number; tunnel: number; whiteout: number } {
		const u = this.material.uniforms;
		return {
			streak: u.uStreak.value,
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
		look: Pick<WitchspaceLook, "streak" | "tunnel" | "whiteout">,
		flow: number,
		aspect: number,
	) {
		const u = this.material.uniforms;
		u.uStreak.value = look.streak;
		u.uTunnel.value = look.tunnel;
		u.uWhiteout.value = look.whiteout;
		u.uFlow.value = flow;
		u.uAspect.value = aspect;
		this.tunnelMaterial.uniforms.uFlow.value = flow;
		this.tunnelMaterial.uniforms.uAspect.value = aspect;
		this.enabled = look.streak > 0 || look.tunnel > 0 || look.whiteout > 0;
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
