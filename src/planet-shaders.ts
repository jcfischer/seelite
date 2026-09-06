/**
 * GLSL building blocks for procedural celestial surfaces.
 *
 * Everything here is object-space and seamless: the shader samples 3D noise on
 * the unit sphere, so there is no UV seam to hide and no pole to pinch. The cost
 * of that choice is that every lookup is 3D, which is why the octave counts are
 * small and the expensive primitives (craters) are used by one class only.
 *
 * **Authored in linear space.** The renderer sets SRGBColorSpace on output, so
 * a colour written here is a linear reflectance, not a hex a designer picked.
 * Values look darker than the equivalent sRGB swatch on purpose.
 */

import type { SurfaceClass } from "./planet-appearance";
import { CLASS_GLSL, RELIEF } from "./planet-classes.glsl";

/**
 * One cell of a crater field, and the profile of the crater in it.
 *
 * **Two consumers, one definition.** craters() below sums the profile;
 * cratersAndGradient() beside it sums the profile *and* its slope, so a
 * refinery's asteroid and an airless moon each pay one walk of the 3×3×3
 * neighbourhood instead of the five that finite-differencing the height would
 * cost. Both live in this file: the gradient walk moved here from
 * station-surface.ts when the moon became its second caller. Those are different
 * accumulations of the same field, and the field is written here so they cannot
 * become two fields.
 *
 * The split is exactly at the accumulation: everything that decides *where a
 * crater is and what shape it has* lives in these two strings, and everything
 * that decides *what is done with it* lives in the function that interpolates
 * them. A new term — a terrace, a second rim, a depth clamp — goes here and
 * both consumers get it.
 *
 * They are strings rather than a shared GLSL function because the gradient
 * needs d, radius and the offset from inside the loop, and GLSL ES 1.00
 * has no way to hand those back without recomputing them.
 *
 * **What a consumer must provide, and must not shadow.** Being text rather
 * than a signature, the contract is by name, so it is written down here
 * instead of being learned from a collision. CRATER_CELL reads base, p
 * and the loop counters x, y, z, and declares cell, centre,
 * radius, offset, dist and d. CRATER_PROFILE reads d and declares
 * inside, bowl and rim. A third interpolator supplies the first set and
 * leaves the second alone.
 */
export const CRATER_CELL = /* glsl */ `    vec3 cell = base + vec3(x, y, z);
    vec3 centre = cell + vec3(hash31(cell),
                              hash31(cell + 61.7),
                              hash31(cell + 13.3));
    float radius = 0.16 + 0.34 * hash31(cell + 3.1);
    vec3 offset = p - centre;
    float dist = length(offset);
    float d = dist / radius;`;

/**
 * Where the rim sits, and how sharp it is.
 *
 * Hoisted out of the profile because the *derivative* needs them too:
 * cratersAndGradient below differentiates the rim analytically, and its chain
 * rule carries 2 · CRATER_RIM_SHARPNESS². Written as literals in both places, a
 * change to the sharpness here would leave the derivative describing a
 * different crater — silently, because a wrong slope shades plausibly.
 */
export const CRATER_RIM = /* glsl */ `#define CRATER_RIM_AT 0.88
#define CRATER_RIM_SHARPNESS 6.5`;

export const CRATER_PROFILE = /* glsl */ `      float inside = step(d, 1.0);
      float bowl = -(1.0 - d * d) * inside;
      float rim  = exp(-pow((d - CRATER_RIM_AT) * CRATER_RIM_SHARPNESS, 2.0)) * 0.7;`;

/** Hashes, value noise, fBm, ridged fBm, domain warp. GLSL ES 1.00. */
/**
 * fbmN for each octave count the classes use.
 *
 * Emitted from one template rather than written three times: GLSL ES 1.00
 * forbids a non-constant loop bound, so the functions genuinely cannot share a
 * body — but the lacunarity and the offset can still have one home instead of
 * three that must be edited together.
 *
 * Amplitude-normalised: the sum is divided by the total weight, so fbm3/4/5 all
 * return the same range and a threshold tuned against one still means something
 * against another. The prototype this replaced skipped that, which is why its
 * sea level sat in the tail of the distribution and drowned every continent.
 */
const FBM_VARIANTS = [3, 4, 5]
	.map(
		(octaves) => /* glsl */ `
float fbm${octaves}(vec3 p) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < ${octaves}; ++i) {
    s += a * vnoise(p); n += a; p = p * 2.03 + 17.1; a *= 0.5;
  }
  return s / n;
}`,
	)
	.join("\n");

export const NOISE_GLSL = /* glsl */ `
const float PI = 3.14159265;
${CRATER_RIM}

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash31(i),               b = hash31(i + vec3(1,0,0));
  float c = hash31(i + vec3(0,1,0)), d = hash31(i + vec3(1,1,0));
  float e = hash31(i + vec3(0,0,1)), g = hash31(i + vec3(1,0,1));
  float h = hash31(i + vec3(0,1,1)), k = hash31(i + vec3(1,1,1));
  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y),
             mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);
}

${FBM_VARIANTS}

// Ridged noise: the |2n-1| fold turns smooth hills into creases, which is what
// mountain chains and ice fractures both are.
float ridged(vec3 p) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 4; ++i) {
    s += a * (1.0 - abs(2.0 * vnoise(p) - 1.0));
    n += a; p = p * 2.07 + 9.2; a *= 0.5;
  }
  return s / n;
}

// Push the sample point around with another noise field before reading it.
// Un-warped fbm makes round blobs; warped fbm makes coastlines, because the
// warp is what introduces the long curved features noise alone never has.
vec3 warp(vec3 p, float freq, float amount) {
  return p + amount * (vec3(fbm3(p * freq + 11.0),
                            fbm3(p * freq + 37.0),
                            fbm3(p * freq + 91.0)) - 0.5);
}

// fBm is bell-shaped, not uniform, so a raw threshold on it is a threshold on a
// tail: the normalised octave sum sits near 0.5 with most of its mass inside a
// narrow band, and a cutoff at 0.55 lands out where almost nothing is.
//
// This rescales that band to fill 0..1, which makes a sea level near 0.5 a
// usable control instead of an off switch. It does **not** make the mapping a
// CDF — a linear stretch of a bell curve is still a bell curve, so a sea level
// of 0.6 is not 60% ocean. What is checked, in probe-planets.mjs, is the
// weaker claim the shader actually needs: raising sea level raises the measured
// ocean fraction, monotonically, across the usable range.
const float FBM_SPREAD = 0.26;
float stretch(float v) { return clamp(0.5 + (v - 0.5) / FBM_SPREAD, 0.0, 1.0); }

// A thin line along one contour of a warped field.
//
// The trick is the *inverse* of a threshold: keep only the pixels near a single
// value, and regions become curves. Ice lineae and lava rifts are the same
// primitive with different constants and different destinations — one paints
// albedo, the other paints emission — so it lives here rather than being
// spelled twice under two names.
// q arrives already scaled and offset, so a caller keeps control of how its
// seed enters the field — pre- and post-multiply seeding give different
// patterns, and that is the caller's decision to make, not this function's.
float contour(vec3 q, float width, float warpFreq, float warpAmt) {
  float f = fbm4(warp(q, warpFreq, warpAmt));
  return 1.0 - smoothstep(0.0, width, abs(f - 0.5));
}

// One impact per cell across a 3x3x3 neighbourhood: a parabolic bowl with a
// raised rim. No amount of fBm produces a crater, and craters are the entire
// reason an airless body reads as airless.
/**
 * The same field, accumulated with its slope.
 *
 * craters above answers "how deep here"; a normal also needs "which way is
 * downhill", and the usual way to get it — reliefNormal's central
 * differences — asks the height function four more times. On a body whose
 * height *is* two crater walks that is ten walks a fragment for a normal that
 * one walk already contains: a crater's profile is smooth in d, so its slope
 * is available inside the loop that accumulates its depth.
 *
 * Two consumers now: the refinery's asteroid (#60), and AIRLESS (#65), which
 * planet-classes.glsl.ts says is the most expensive class in the set for
 * exactly this reason.
 */
vec4 cratersAndGradient(vec3 p, float scale, float depth) {
  p *= scale;
  vec3 base = floor(p);
  float acc = 0.0;
  vec3 grad = vec3(0.0);
  for (int x = -1; x <= 1; ++x)
  for (int y = -1; y <= 1; ++y)
  for (int z = -1; z <= 1; ++z) {
${CRATER_CELL}
    if (d < 1.2) {
${CRATER_PROFILE}
      acc += (bowl + rim) * depth;
      // d(bowl)/dd is 2d inside the bowl and zero beyond it; d(rim)/dd is the
      // gaussian times its own exponent's derivative. Both read the profile's
      // own defines rather than the numbers they evaluate to: hand-expanded,
      // the sharpness would appear here as twice its square, and a change to it
      // upstream would leave this describing a different crater — silently,
      // because a wrong slope still shades plausibly.
      float dProfile = (2.0 * d * inside)
                     + rim * (-2.0 * CRATER_RIM_SHARPNESS * CRATER_RIM_SHARPNESS
                              * (d - CRATER_RIM_AT));
      // Chain rule out to p: dd/d|offset| is 1/radius, d|offset|/dp is the unit
      // offset, and the outer p *= scale contributes another factor.
      grad += dProfile * depth * scale * offset / max(dist * radius, 1e-6);
    }
  }
  return vec4(grad, acc);
}

float craters(vec3 p, float scale, float depth) {
  p *= scale;
  vec3 base = floor(p);
  float acc = 0.0;
  for (int x = -1; x <= 1; ++x)
  for (int y = -1; y <= 1; ++y)
  for (int z = -1; z <= 1; ++z) {
${CRATER_CELL}
    if (d < 1.2) {
${CRATER_PROFILE}
      acc += (bowl + rim) * depth;
    }
  }
  return acc;
}
`;

/**
 * Lighting shared by every class.
 *
 * Three terms the previous prototype was missing, and each fixes one way a
 * sphere stops reading as a sphere:
 *
 * - **Wrapped diffuse.** A hard max(N·L, 0) puts the terminator exactly on the
 *   geometric limb, which is right for an airless rock and wrong for anything
 *   with air — a thick atmosphere scatters light tens of degrees past it. wrap
 *   is the body's optical depth, so the same expression gives Luna a knife-edge
 *   terminator and Venus a soft one.
 * - **Limb darkening.** Grazing exit angles carry less light out. Without it the
 *   disc is uniformly bright to the silhouette and reads as a sticker.
 * - **Ambient at 1.5%, not 62%.** Deep space has starlight and nothing else. The
 *   old prototype's floor was high enough that the night side and the day side
 *   were the same colour, which is the single largest reason its worlds looked
 *   flat.
 */
/**
 * A last guard on what a fragment hands to the post-processing chain.
 *
 * **One bad pixel becomes a block, and that is bloom's doing rather than the
 * shader's.** `UnrealBloomPass` averages the frame down a mip chain, so a
 * single NaN or Inf spreads across a whole texel of a coarse level — which is
 * a large rectangle on screen, appearing and vanishing as the geometry that
 * produced it moves.
 *
 * Applied to the planet programs in this file — the surface classes, both
 * shells and the ring. The star field in `backdrop.ts` and the patched rock
 * material are custom fragments too and are *not* covered; they are the next
 * place to look if the artefact survives this.
 *
 * This is the second of two guards against that artefact — the first is the
 * mip geometry, at `bloomResolution` in main.ts, which demonstrably reduced it
 * without ending it. Neither is a diagnosis: no shader here is known to emit a
 * non-finite value, and the artefact does not reproduce headlessly, so it
 * cannot be traced that way. `onResize` in main.ts carries what is actually
 * established.
 *
 * The test is written inverted on purpose. NaN compares false against
 * everything, so `!(c >= 0.0)` is true for NaN as well as for a negative,
 * where `c < 0.0` would let NaN straight through. GLSL ES 1.00 has no `isnan`.
 *
 * The ceiling is far above anything meaningful — tone mapping has long since
 * flattened this range — and far below half float's 65504, which is what the
 * composer's targets store and what an unchecked product can reach.
 */
export const SANITISE_GLSL = /* glsl */ `
float saneF(float v) {
  // Inverted on purpose: NaN compares false against everything, so this is
  // true for NaN as well as for a negative, where v < 0.0 would let NaN pass.
  if (!(v >= 0.0)) return 0.0;
  return min(v, 64.0);
}
vec3 sane(vec3 c) {
  return vec3(saneF(c.r), saneF(c.g), saneF(c.b));
}
/*
 * **Alpha too, and on these shaders alpha matters more than colour.**
 *
 * The first version wrapped only RGB. The shells are the transparent and
 * additive passes, so their alpha is what scales their contribution into the
 * buffer bloom then samples — a non-finite one carries straight through the
 * exact path this guard exists to close, past a guarded colour. Guarding three
 * channels out of four on the one program where the fourth does the blending
 * was the wrong three.
 */
vec4 sane4(vec4 c) {
  return vec4(sane(c.rgb), saneF(c.a));
}
`;

export const LIGHT_GLSL = /* glsl */ `
uniform vec3  sunDir;
uniform vec3  sunColor;
uniform float wrapAmount;

const float AMBIENT = 0.015;

float wrappedDiffuse(vec3 N) {
  float ndl = dot(N, sunDir);
  return clamp((ndl + wrapAmount) / (1.0 + wrapAmount), 0.0, 1.0);
}

float limbDarken(vec3 N, vec3 V) {
  // Same shape as the stellar law, mild enough for a solid surface.
  return mix(0.70, 1.0, pow(max(dot(N, V), 0.0), 0.4));
}

vec3 shade(vec3 albedo, vec3 N, vec3 V) {
  return albedo * (wrappedDiffuse(N) * limbDarken(N, V) * sunColor + AMBIENT);
}

// Blinn-Phong, used only where a real specular exists: open water and ice.
float specular(vec3 N, vec3 V, float power) {
  return pow(max(dot(N, normalize(V + sunDir)), 0.0), power)
       * step(0.0, dot(N, sunDir));
}
`;

/** Varyings every surface shader shares. */
export const VARYINGS_GLSL = /* glsl */ `
varying vec3 vObjP;
varying vec3 vWorldP;
varying vec3 vWorldN;
// The body's centre and this shell's radius, both in world units. The
// atmosphere needs them to work out how much air a view ray actually passes
// through, which is a question about the sphere rather than about the fragment.
varying vec3 vCenter;
varying float vRadius;
`;

/**
 * The body of every surface vertex shader, spelled once.
 *
 * Two programs write these varyings — the procedural one and #208's baked one,
 * which adds three of its own — and they have to agree about all five or the
 * lighting, the atmosphere's chord and the relief's tangent frame disagree
 * between the two paths in ways no test looks for. Interpolated rather than
 * duplicated (sage, PR #256).
 */
export const SURFACE_VERTEX_BODY = /* glsl */ `
  vObjP   = normalize(position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldP = world.xyz;
  vWorldN = normalize(mat3(modelMatrix) * normal);
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vRadius = length(world.xyz - vCenter);
  gl_Position = projectionMatrix * viewMatrix * world;
`;

export const SURFACE_VERTEX = /* glsl */ `
${VARYINGS_GLSL}
void main() {
${SURFACE_VERTEX_BODY}
}
`;

/**
 * Assemble one class's fragment shader.
 *
 * The order is load-bearing: reliefNormal calls height, which the class body
 * defines *after* it, so a prototype declaration goes in between. GLSL allows
 * this and it is the only way to keep the relief code shared rather than pasted
 * into all six classes that use it.
 */
/**
 * How the relief normal gets its gradient. A **compile-time** choice, not a
 * uniform, and that is a correctness requirement rather than a preference.
 *
 * `dFdx`/`dFdy` are undefined inside non-uniform control flow, and a branch on
 * a uniform is not reliably treated as uniform control flow by every driver —
 * some evaluate both sides. Selecting the path with a `#define` means the
 * derivative calls are simply not in the program when they are not wanted, and
 * the four-tap program is byte-identical to the one that existed before the
 * screen-space path was added.
 *
 * It also removes a branch from every planet fragment, which the uniform
 * version was paying for on every class including the ones with no relief.
 */
/**
 * `"none"` is a third **program**, not a uniform, and #207 asked for it that way.
 *
 * `perfAblate` 1 already skips the perturbation, and #248's ladder measured
 * that saving on ANGLE Metal — 43.5 ms to 15.8 at a filling planet — so the
 * uniform demonstrably works *here*. It is still the wrong mechanism to ship
 * the band on, for two reasons.
 *
 * The first is the one this type's own docstring gives above: a branch on a
 * uniform is not reliably uniform control flow to every driver, and some
 * evaluate both sides. On such a driver the saving would silently be nothing,
 * and nothing here could tell. Compiled out, there is no branch to mis-execute.
 *
 * The second is ownership. `perfAblate` is the diagnostic ladder's dial
 * (`perf-panel.ts`), and a shipped per-frame selector writing it would fight
 * `setAblation` every frame — the instrument would set an arm, the loop would
 * overwrite it, and the table would print the selector's choice under the arm's
 * label. That is the trap `main.ts` already records for the vignette, where a
 * probe measured its own assignment being overwritten.
 */
export const RELIEF_PATHS = ["four-tap", "screen-space", "none"] as const;
export type ReliefPath = (typeof RELIEF_PATHS)[number];

export function fragmentFor(
	surface: SurfaceClass,
	relief: ReliefPath = "four-tap",
): string {
	return /* glsl */ `
precision highp float;
${relief === "screen-space" ? "#define RELIEF_SCREEN_SPACE 1" : ""}
${relief === "none" ? "#define RELIEF_NONE 1" : ""}
${SANITISE_GLSL}
${VARYINGS_GLSL}
${NOISE_GLSL}
${LIGHT_GLSL}
float height(vec3 p);
${RELIEF}
${CLASS_GLSL[surface]}
void main() {
  vec3 p = normalize(vObjP);
  vec3 N = normalize(vWorldN);
  vec3 V = normalize(cameraPosition - vWorldP);

  vec3  albedo = vec3(0.5);
  vec3  emissive = vec3(0.0);
  float specPower = 0.0, specMask = 0.0;
  // ?perf=flat: a plain lit sphere, so the whole class shader can be priced
  // against the rest of the frame. Diagnostic; see planet-surface.ts.
  if (perfAblate < 1.5) surface(p, albedo, N, emissive, specPower, specMask);

  vec3 col = shade(albedo, N, V);
  if (specPower > 0.0) col += sunColor * specular(N, V, specPower) * specMask;
  col += emissive;
  // Alpha is the literal 1.0 on the opaque surface, so only colour can go
  // wrong here. The shells use sane4, where alpha does the blending.
  gl_FragColor = vec4(sane(col), 1.0);
}
`;
}

/**
 * The shell around a body with air.
 *
 * Three things the old version got wrong. The rim was lit uniformly, so a
 * crescent planet wore a full halo and the terminator vanished into it — here
 * the glow is gated by the sun. There was no forward scattering, so the bright
 * arc that appears when you look *past* a planet at its star was missing. And
 * the colour was one uniform: a real limb reddens as the path length through it
 * grows, which is why the sunset term is separate.
 */
export const ATMOSPHERE_FRAGMENT = /* glsl */ `
precision highp float;
${VARYINGS_GLSL}
${SANITISE_GLSL}
uniform vec3  sunDir;
uniform vec3  atmoColor;
uniform float atmoStrength;
uniform float atmoInnerRatio;
/*
 * **How much air the ray goes through**, rather than how edge-on the shell is.
 *
 * The previous version used pow(1 - dot(N, V), 3.2), which is maximal exactly
 * at the shell's outer silhouette — so the glow was brightest where the
 * geometry ends and then stopped dead. That reads as a painted ring with two
 * hard edges. That is the *sharp atmosphere*, a separate report from the
 * flickering rectangles, and it became visible once bloom stopped smearing it.
 *
 * A real atmosphere is the opposite: the path through it goes to *zero* at the
 * outer edge, grows inward, and is cut short where the planet blocks it. That
 * is a chord length, and for a sphere it is worth computing rather than
 * imitating — the falloff it gives is the reason a limb looks like air.
 *
 * b is how far along the ray the closest approach to the centre lies and d2 the
 * square of that distance — the geometry the falloff below is built on. The
 * lit-limb and forward-scattering terms are unchanged.
 */
void main() {
  vec3 N = normalize(vWorldN);
  vec3 V = normalize(cameraPosition - vWorldP);

  // The view ray, and its closest approach to the body's centre.
  vec3 toCentre = vCenter - cameraPosition;
  vec3 dir = -V;
  float b = dot(toCentre, dir);
  float d2 = dot(toCentre, toCentre) - b * b;

  // Air along the ray: the shell's chord, less the part of it the planet's own
  // body occupies. innerRatio is the surface radius as a fraction of the
  // shell's, which is how planet-surface.ts scales the two.
  /*
   * **Density falls off with altitude**, and that is what makes a limb soft.
   *
   * A chord through a shell of *uniform* density does reach zero at the outer
   * edge — but as a square root, so its slope there is infinite and the edge is
   * still a line. That was the first attempt, and shaped by pow(depth, 0.65) it
   * saturated across the whole annulus: a flat band with a crisp rim, which is
   * what it looked like. Both halves were wrong the same way — the profile had
   * no tail, and the exponent boosted what little it had into saturation.
   *
   * Air thins exponentially with height, so what a ray gathers depends on where
   * it passes, not only how far. Weighting by the altitude of the ray's closest
   * approach gives that tail directly, for one exponential, and it has no edge
   * to be sharp at: it is already near nothing before the geometry runs out.
   */
  float outer = vRadius;
  float inner = outer * atmoInnerRatio;
  float graze = sqrt(max(d2, 0.0));
  // Zero at the ground, one at the top of the shell.
  float altitude = clamp((graze - inner) / max(outer - inner, 1e-6), 0.0, 1.0);
  // A scale height of 3.5 leaves about 3% of the ground value at the top,
  // which reads as a tail rather than a border.
  float density = exp(-altitude * 3.5);
  // Multiplied out to exactly zero at the silhouette, so the small remainder
  // the exponential still carries does not leave a step of its own.
  float rim = density * (1.0 - altitude);
  float depth = rim;

  // Only the lit limb glows, and it fades through the terminator rather than
  // stopping at it.
  float day = smoothstep(-0.45, 0.30, dot(N, sunDir));
  // Forward scattering: looking towards the star through the shell.
  float forward = pow(max(dot(V, -sunDir), 0.0), 5.0);
  // Longer path at grazing angles scatters out the blue first — grazing is now
  // "a long way through the air", which is what it always meant.
  float grazing = pow(clamp(depth, 0.0, 1.0), 2.5);
  vec3 sunset = mix(atmoColor, atmoColor * vec3(1.5, 0.75, 0.42), grazing * 0.8);
  gl_FragColor = sane4(vec4(sunset * (0.55 + 2.2 * forward) * day,
                            rim * day * atmoStrength));
}
`;

/**
 * The weather shell, for the classes that have weather separate from the ground.
 *
 * Kept as its own mesh rather than a term in the surface shader for one reason:
 * clouds are at a different altitude, so they cast onto a different part of the
 * disc and they cross the terminator before the ground does. Painting them into
 * the surface loses both, and loses the parallax that sells the gap.
 */
export const CLOUD_FRAGMENT = /* glsl */ `
precision highp float;
${VARYINGS_GLSL}
${SANITISE_GLSL}
${NOISE_GLSL}
${LIGHT_GLSL}
uniform float time;
uniform float cloudCover;
uniform float seedOffset;
uniform vec3  cloudTint;
void main() {
  vec3 p = normalize(vObjP);
  // Two rates: the deck drifts and the detail shears across it, which reads as
  // one system moving rather than a texture sliding.
  vec3 slow = p + vec3(time * 0.0030, 0.0, 0.0) + seedOffset;
  vec3 fast = p + vec3(time * 0.0068, 0.0, time * 0.0011) + seedOffset;
  float broad = fbm4(warp(slow * 2.3, 1.1, 0.75));
  float wisp  = fbm5(fast * 8.5);

  // Weather is banded on a rotating world: wet at the equator, dry in the horse
  // latitudes, wet again at the polar front. Uniform coverage looks like fog.
  float lat = abs(p.y);
  float zonal = 0.58 + 0.42 * cos(lat * 8.2 + 0.4);

  float field = broad * 0.68 + wisp * 0.32;
  float mask = smoothstep(0.54 - cloudCover * 0.16, 0.56 + 0.10, field) * zonal;

  vec3 N = normalize(vWorldN);
  vec3 V = normalize(cameraPosition - vWorldP);
  // Same lighting as the ground, so the cloud terminator lines up with it.
  float lit = wrappedDiffuse(N);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.2);
  gl_FragColor = sane4(vec4(cloudTint * (lit * 1.30 * sunColor + 0.025),
                            clamp(mask, 0.0, 1.0) * (0.62 + 0.30 * rim)));
}
`;

/** A ring plane: banded opacity, plus the planet's own shadow across it. */
export const RING_FRAGMENT = /* glsl */ `
precision highp float;
${SANITISE_GLSL}
varying vec2 vRing;
varying vec3 vWorldP;
varying vec3 vCentre;
${NOISE_GLSL}
uniform vec3  sunDir;
uniform float innerR;
uniform float outerR;
uniform float seedOffset;
void main() {
  float r = length(vRing);
  if (r < innerR || r > outerR) discard;
  float t = (r - innerR) / (outerR - innerR);

  // Gaps are resonances, so they are narrow and sharp; the material between
  // them varies smoothly. One field for each.
  float grain = fbm4(vec3(t * 34.0 + seedOffset, 2.3, 7.1));
  float gap   = smoothstep(0.02, 0.0, abs(fbm3(vec3(t * 7.0 + seedOffset, 5.0, 1.0)) - 0.5));
  float density = grain * (1.0 - gap) * smoothstep(0.0, 0.10, t) * smoothstep(1.0, 0.86, t);

  // Eclipse: anything whose perpendicular distance from the planet-sun line is
  // under one radius is in shadow.
  //
  // Measured from the planet's own world position, not from the scene origin.
  // vWorldP is world space and includes the group's placement, so negating it
  // pointed at the origin — which is the planet only in single-body mode, where
  // the group happens to sit there. In the gallery the ringed body is at about
  // (-2.7, -2.85), and the shadow band fell nowhere near it. Silent in exactly
  // the view a reviewer opens to look at rings.
  // The centre arrives as a varying because Three injects modelMatrix into the
  // vertex prefix only — reading it here compiles to nothing, the material
  // fails silently, and the rings simply do not draw.
  vec3 toBody = vCentre - vWorldP;
  float along = dot(toBody, sunDir);
  float perp  = length(toBody - sunDir * along);
  float shadow = (along < 0.0) ? 1.0 : smoothstep(0.94, 1.10, perp);

  vec3 ice = mix(vec3(0.30, 0.27, 0.23), vec3(0.55, 0.52, 0.47), grain);
  gl_FragColor = sane4(vec4(ice * (0.25 + 0.75 * shadow), density * 0.85));
}
`;

export const RING_VERTEX = /* glsl */ `
varying vec2 vRing;
varying vec3 vWorldP;
varying vec3 vCentre;
void main() {
  vRing = position.xy;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldP = world.xyz;
  // The planet's world position: the ring mesh carries no local translation, so
  // its own origin under modelMatrix *is* the body it orbits.
  vCentre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * What a class needs beyond its two baked cubes — node #208.
 *
 * A baked body is drawn from `albedo`/`specMask` in one cube and an
 * object-space normal plus one spare channel in the other. Three things do not
 * fit in that and are handled here instead.
 *
 * `specPower` is a per-class **literal** in `CLASS_GLSL` — 230 on terran's
 * water, 46 on ice, 0 everywhere else — so it is compiled into the draw program
 * rather than spending a channel on a constant.
 *
 * `aux` is what cube B's alpha carries and `perFrame` is the GLSL the draw
 * program runs each frame with `p`, `aux` and `emissive` in scope — the node's
 * "emissive lava stays a per-frame term". **Nothing uses either today**: lava
 * was the one class that wanted them and it is out of the table on the
 * measurement below. They are kept because they are the mechanism a second
 * attempt needs, and a test asserts they are inert so a class cannot acquire one
 * without that being a visible change.
 *
 * `perFrame` is the GLSL the draw program runs each frame, with `p`, `aux` and
 * `emissive` in scope. It is the node's "emissive lava stays a per-frame term",
 * and it is the *whole* of what a baked body still evaluates procedurally.
 *
 * **A class is bakeable exactly when its `surface()` does not read the clock.**
 * That is the rule, and `tests/planet-bake.test.ts` reads it off
 * `planet-classes.glsl.ts`'s own source rather than off this table — so adding
 * an animated term to a baked class goes red instead of freezing a planet.
 * `venusian` is the class that rule excludes and the node was unsure about: its
 * whole deck drifts and its `height` is `0.0`, so there is nothing to bake and
 * nothing to gain.
 */
export interface BakeDescriptor {
	/** GLSL for cube B's alpha, with `p` (the unit direction) in scope. */
	aux: string;
	/** GLSL the draw program runs per frame; reads `p` and `aux`, writes
	 *  `emissive`. Empty for a class whose surface is entirely static. */
	perFrame: string;
	/** The Blinn-Phong exponent, compiled in. 0 where the class has no
	 *  specular at all, which compiles the term out. */
	specPower: number;
}

export const BAKE_DESCRIPTORS: Partial<Record<SurfaceClass, BakeDescriptor>> = {
	terran: { aux: "0.0", perFrame: "", specPower: 230 },
	desert: { aux: "0.0", perFrame: "", specPower: 0 },
	ice: { aux: "0.0", perFrame: "", specPower: 46 },
	airless: { aux: "0.0", perFrame: "", specPower: 0 },
};

/**
 * **Lava is not in the table, and it was, and the measurement is why.**
 *
 * The node asks for it — "emissive lava stays a per-frame term from the height
 * channel" — and the mechanism exists: `lavaCrack` and `lavaEmissive` are
 * extracted in `planet-classes.glsl.ts` precisely so the static crack network
 * could bake into `aux` and the blackbody ramp be recomputed per frame.
 *
 * It does not reproduce. `probe-planet-surfaces.mjs` compares each class
 * against its own cube with the camera placed once and both arms captured back
 * to back, and the four classes above read 1.1% to 4.2% of the disc mean at the
 * worst patch. Lava reads **95.5% at 4 radii and 37.1% at 2.5**, with medians of
 * 25.4% and 7.1% — systematic rather than noise, and it survives every control
 * the other classes needed: shells off, clock pinned, one placement, no settle
 * between the arms.
 *
 * The reason is the shape of the term rather than the channel's depth alone.
 * `crack` is a narrow ridge network, `aux` is eight bits with a mip chain
 * filtering it, and `lavaEmissive` raises it to 2.2 and again to 1.6 before the
 * bloom pass amplifies what is left — on a disc whose mean luma is 44, because
 * this is the one class visible on its own night side. Every step of that
 * magnifies an error the other four classes never make.
 *
 * So lava stays procedural until a bake of it can be shown to reproduce, and
 * the node's step 2 is unmet on that one class with the figures above as the
 * reason. What is *not* being claimed is that it cannot work: a wider channel,
 * or baking the ramp's output rather than its input, are both untried.
 */
export const LAVA_UNBAKED_REASON =
	"the emissive ramp through an 8-bit aux channel reads 95.5% of the disc " +
	"mean against its own procedural program — see BAKE_DESCRIPTORS";

/** The classes a cube is baked for, in a stable order so a census reads the
 *  same twice. Derived from the table, so the two cannot disagree. */
export const BAKEABLE_CLASSES = Object.keys(
	BAKE_DESCRIPTORS,
) as readonly SurfaceClass[];

export const isBakeable = (surface: SurfaceClass): boolean =>
	surface in BAKE_DESCRIPTORS;

/**
 * The bake's vertex shader: a full-screen quad, and nothing else.
 *
 * A quad per face rather than a `CubeCamera` looking at a sphere from inside.
 * The camera version would need a sphere to hit, would shade its *back* faces,
 * and would interpolate the direction across a triangle; this one hands every
 * texel its exact direction and needs no geometry at all beyond two triangles.
 * It is what `PMREMGenerator` does, for the same reasons.
 *
 * `gl_Position` is written straight from the quad's own coordinates, so `vNdc`
 * *is* normalised device space and the face basis below can be read as a
 * camera.
 */
export const BAKE_VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * One face of one cube.
 *
 * `faceBasis`'s columns are a camera's right, up and forward, so
 * `faceBasis * vec3(ndc, 1.0)` is the ray through that pixel at a 90° field of
 * view — which is the same construction `CubeCamera` makes with six
 * `lookAt`s, and `planet-bake.ts` derives the six from three's own table rather
 * than transcribing a sign convention.
 *
 * `N` goes in as the direction, so `reliefNormal`'s tangent frame is built on
 * the sphere exactly as it is when the class is drawn procedurally, and what
 * comes out is an **object-space** normal. The four-tap path is compiled in
 * deliberately: the bake is the expensive one, it happens once, and it should
 * carry the reference look rather than the cheap one.
 *
 * The prelude omits `VARYINGS_GLSL`. Nothing reachable from here reads a
 * varying — the screen-space relief path is the one chunk that does and it is
 * not compiled in — and declaring a fragment varying the quad's vertex shader
 * does not write is a link the driver is entitled to reject.
 */
export function bakeFragmentFor(
	surface: SurfaceClass,
	channel: "albedo" | "normal",
): string {
	const d = BAKE_DESCRIPTORS[surface];
	if (!d) throw new Error(`${surface} has no bake descriptor`);
	return /* glsl */ `
precision highp float;
uniform mat3 faceBasis;
varying vec2 vNdc;
${SANITISE_GLSL}
${NOISE_GLSL}
float height(vec3 p);
${RELIEF}
${CLASS_GLSL[surface]}
void main() {
  vec3 p = normalize(faceBasis * vec3(vNdc, 1.0));
  vec3  albedo = vec3(0.5);
  vec3  N = p;
  vec3  emissive = vec3(0.0);
  float specPower = 0.0, specMask = 0.0;
  surface(p, albedo, N, emissive, specPower, specMask);
${
	channel === "albedo"
		? `  gl_FragColor = vec4(sane(albedo), saneF(specMask));`
		: `  // Object-space, half-range encoded. Eight bits is what a normal map is
  // normally stored in; the height field it came from is not, which is why the
  // node's "height in A" is not what this writes — a four-tap difference is a
  // small delta of a small delta and quantises to steps.
  //
  // **Sanitised after the encode, never before.** saneF clamps a negative to
  // zero, which is right for a colour and destroys a direction: wrapping the
  // normal first read every face's negative axis back as exactly 0.5 — +X came
  // out at 227/255 and −X at exactly 128 — and the planet lost its terrain
  // while rendering, compiling and erroring in no way at all. Encoded first, a
  // non-finite component lands on 0 and decodes to −1, which is a direction
  // rather than a hole.
  gl_FragColor = sane4(vec4(normalize(N) * 0.5 + 0.5, ${d.aux}));`
}
}
`;
}

/**
 * The varyings that carry the body's own rotation into the fragment.
 *
 * A baked normal is in **object** space and the lighting is in world space, so
 * something has to rotate it. Three's fragment prefix carries `viewMatrix` and
 * `cameraPosition` and **not** `modelMatrix` or `normalMatrix` — read off
 * `three.cjs`'s `prefixFragment`, not assumed — so the rotation cannot be
 * fetched in the fragment and has to be interpolated in.
 *
 * Three columns rather than a `varying mat3`, which is legal and less widely
 * exercised. They are constant over the mesh, so the interpolation is exact.
 *
 * Only the baked program pays for them. The procedural one keeps
 * `SURFACE_VERTEX` unchanged, which is also what keeps its program identical to
 * the one that shipped.
 */
export const BAKED_BASIS_VARYINGS = /* glsl */ `
varying vec3 vBx;
varying vec3 vBy;
varying vec3 vBz;
`;

export const BAKED_SURFACE_VERTEX = /* glsl */ `
${VARYINGS_GLSL}
${BAKED_BASIS_VARYINGS}
void main() {
${SURFACE_VERTEX_BODY}
  mat3 rot = mat3(modelMatrix);
  vBx = rot[0];
  vBy = rot[1];
  vBz = rot[2];
}
`;

/**
 * Draw a body from its two cubes — the cheap program the whole node is for.
 *
 * Two texture fetches and the shared lighting, against the 100 to 150 noise
 * calls a fragment the procedural program makes. There is **no relief path
 * here**: the normal comes out of a texture, so #207's three programs have
 * nothing to select between and `SurfacePath` keeps `"baked"` outside the
 * `ReliefPath` union rather than widening it.
 *
 * The rotation is applied to the decoded normal rather than the normal being
 * baked in world space, because a world-space bake would be wrong the first
 * frame a body turned — and nothing in this repo turns a planet *yet*, which is
 * exactly the kind of invariant that gets broken silently.
 *
 * `perfAblate` is honoured so #248's ladder still means the same thing on a
 * baked body: 1 drops the perturbation to the geometric normal, 2 is a plain
 * lit sphere. A uniform branch in a shipped program, matching what `RELIEF`
 * already does, so an arm named on the panel is not silently ignored on half
 * the bodies in the frame.
 *
 * A class with a `perFrame` term would get the full procedural prelude behind it
 * — lava needed `fbm3` for its convection — and with it the rest of its class
 * chunk, unreachable and stripped. No class in the table has one today; the
 * branch is kept because it is what a second attempt at lava would need, and
 * `tests/planet-bake.test.ts` asserts that it is currently inert rather than
 * leaving that to be inferred from reading the table.
 */
export function bakedFragmentFor(surface: SurfaceClass): string {
	const d = BAKE_DESCRIPTORS[surface];
	if (!d) throw new Error(`${surface} has no bake descriptor`);
	const prelude = d.perFrame
		? `${NOISE_GLSL}
float height(vec3 p);
${RELIEF}
${CLASS_GLSL[surface]}`
		: "";
	return /* glsl */ `
precision highp float;
${SANITISE_GLSL}
${VARYINGS_GLSL}
${BAKED_BASIS_VARYINGS}
${LIGHT_GLSL}
uniform samplerCube bakedAlbedo;
uniform samplerCube bakedNormal;
${d.perFrame ? "" : "uniform float perfAblate;"}
${prelude}
void main() {
  vec3 p = normalize(vObjP);
  vec3 V = normalize(cameraPosition - vWorldP);

  vec4 a  = textureCube(bakedAlbedo, p);
  vec4 nb = textureCube(bakedNormal, p);
  vec3  albedo   = a.rgb;
  float specMask = a.a;
  float aux      = nb.a;
  vec3  emissive = vec3(0.0);
  mat3  rot = mat3(vBx, vBy, vBz);
  vec3  N = normalize(rot * normalize(nb.xyz * 2.0 - 1.0));
${d.perFrame ? `  ${d.perFrame}` : ""}

  // The ladder's arms, in the order they subsume each other.
  if (perfAblate > 1.5) {
    albedo = vec3(0.5);
    specMask = 0.0;
    emissive = vec3(0.0);
  }
  if (perfAblate > 0.5) N = normalize(vWorldN);

  vec3 col = shade(albedo, N, V);
${
	d.specPower > 0
		? `  col += sunColor * specular(N, V, ${d.specPower.toFixed(1)}) * specMask;`
		: ""
}
  col += emissive;
  gl_FragColor = vec4(sane(col), 1.0);
}
`;
}
