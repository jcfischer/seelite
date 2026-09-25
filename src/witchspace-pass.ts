/**
 * The witchspace transition's screen-space term (#532): the entry's streak and
 * the whiteout over the cut, as one composer pass.
 *
 * ## Why a composer pass
 *
 * #195's receipt verified it: `rebuildSystem()` disposes every mesh and body
 * visual and rebuilds the environment and the derived sky, and it does not touch
 * the composer's passes. So a full-screen term here **survives the cut**, and
 * the whiteout can stay up across the frame the world is replaced on. An effect
 * built from the old sky or its stars would be torn down under it.
 *
 * For the same reason the streak's lines are **procedural**, not drawn from the
 * stars: the pass does smear what is in the frame, but the radial lines that
 * read as "the drive is taking hold" come from a hash of the angle, so the entry
 * looks the same in a system with a thin sky as in one with a rich one.
 *
 * ## Where it sits, and why
 *
 * After the bloom and before the output stage. Before the output stage because
 * the whiteout is written in **linear light**: `OutputShader`'s tone map takes
 * `WHITEOUT_LINEAR` to display white, and a mix written after the encode would
 * fight the dither and the vignette instead. After the bloom because the
 * streak's lines are meant to glow at their own strength, not to be the bloom's
 * next input.
 *
 * ## The `quality` key (#99)
 *
 * **Both sides draw it**, because a jump without its transition is the hard cut
 * #195 exists to remove. What `low` changes is the streak's sample count, which
 * is `WITCHSPACE_PASS_QUALITY` below — data, so a test reads it rather than a
 * comment. And the pass is **disabled** whenever the look is dark, so outside a
 * jump it costs nothing on either side; inside one, both terms also branch on
 * their uniform (`CLAUDE.md`: a dial at zero still evaluates everything to its
 * right).
 *
 * What it costs while it draws is `scripts/measure-witchspace-cost.mjs`'s to
 * print, per side and with the renderer it ran on; the figure is not restated
 * here.
 */
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import type { WitchspaceLook } from "./witchspace";

/** The linear-light value the whiteout mixes toward. ACES takes it to white. */
export const WHITEOUT_LINEAR = 10;

/** What each side of #99's `quality` key draws. */
export const WITCHSPACE_PASS_QUALITY = Object.freeze({
	high: Object.freeze({ samples: 12 }),
	low: Object.freeze({ samples: 6 }),
});

export type WitchspaceQuality = keyof typeof WITCHSPACE_PASS_QUALITY;

/** The fragment shader. Exported so a test reads the branches it relies on. */
export const WITCHSPACE_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uStreak;
uniform float uWhiteout;
uniform float uFlow;
uniform float uAspect;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
	vec4 base = texture2D(tDiffuse, vUv);
	vec3 c = base.rgb;
	if (uStreak > 0.0) {
		vec2 d = vUv - 0.5;
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
		// The radial lines, from a hash of the angle and not from the sky.
		vec2 p = vec2(d.x * uAspect, d.y);
		float r = length(p);
		float lane = floor((atan(p.y, p.x) + 3.14159265) * 60.0);
		float seed = hash(lane);
		float line = step(0.72, seed);
		float flow = fract(r * 2.5 - uFlow * (1.5 + 2.0 * seed) + seed * 7.0);
		float dash = smoothstep(0.0, 0.25, flow) * (1.0 - smoothstep(0.35, 0.9, flow));
		float lit = line * dash * smoothstep(0.04, 0.5, r) * uStreak * uStreak;
		c += vec3(0.45, 0.62, 1.35) * lit * 4.0;
		// A cold cast over the whole frame as the drive takes hold.
		c *= mix(vec3(1.0), vec3(0.75, 0.85, 1.25), 0.6 * uStreak);
	}
	// Shaped, because the mix is in linear light toward a value the tone map
	// takes to white: a linear weight puts a fifth of the way at nearly white
	// on screen, and the fade reads as a switch rather than a fade.
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

export class WitchspacePass extends ShaderPass {
	constructor(quality: WitchspaceQuality) {
		super({
			uniforms: {
				tDiffuse: { value: null },
				uStreak: { value: 0 },
				uWhiteout: { value: 0 },
				uFlow: { value: 0 },
				uAspect: { value: 1 },
			},
			defines: {
				SAMPLES: WITCHSPACE_PASS_QUALITY[quality].samples,
				WHITEOUT: WHITEOUT_LINEAR.toFixed(1),
			},
			vertexShader: VERTEX,
			fragmentShader: WITCHSPACE_FRAGMENT,
		});
		this.enabled = false;
	}

	/** The sample count the material is built with — what `quality` chose. */
	get samples(): number {
		return this.material.defines.SAMPLES as number;
	}

	/** What is currently on screen, for a probe to read by name. */
	get look(): { streak: number; whiteout: number } {
		const u = this.material.uniforms;
		return { streak: u.uStreak.value, whiteout: u.uWhiteout.value };
	}

	/** Switch sides of #99's key live; the program is rebuilt once. */
	setQuality(quality: WitchspaceQuality) {
		const samples = WITCHSPACE_PASS_QUALITY[quality].samples;
		if (this.material.defines.SAMPLES === samples) return;
		this.material.defines.SAMPLES = samples;
		this.material.needsUpdate = true;
	}

	/**
	 * Draw a look. Called every frame from the state, never poked from outside —
	 * the vignette's lesson (`CLAUDE.md`): a probe writing a uniform the frame
	 * loop rewrites measures its own write being overwritten.
	 *
	 * `flow` is the phase, so a held phase draws the same lines every capture.
	 */
	apply(
		look: Pick<WitchspaceLook, "streak" | "whiteout">,
		flow: number,
		aspect: number,
	) {
		const u = this.material.uniforms;
		u.uStreak.value = look.streak;
		u.uWhiteout.value = look.whiteout;
		u.uFlow.value = flow;
		u.uAspect.value = aspect;
		this.enabled = look.streak > 0 || look.whiteout > 0;
	}
}
