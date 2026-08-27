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
 * station-surface.ts's cratersAndGradient() sums it *and* its slope, so a
 * refinery's asteroid pays one walk of the 3×3×3 neighbourhood instead of the
 * five that finite-differencing the height would cost. Those are different
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
 * station-surface.ts differentiates the rim analytically, and its chain rule
 * carries 2 · CRATER_RIM_SHARPNESS². Written as literals in both places, a
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

export const SURFACE_VERTEX = /* glsl */ `
${VARYINGS_GLSL}
void main() {
  vObjP   = normalize(position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldP = world.xyz;
  vWorldN = normalize(mat3(modelMatrix) * normal);
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vRadius = length(world.xyz - vCenter);
  gl_Position = projectionMatrix * viewMatrix * world;
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
export type ReliefPath = "four-tap" | "screen-space";

export function fragmentFor(
	surface: SurfaceClass,
	relief: ReliefPath = "four-tap",
): string {
	return /* glsl */ `
precision highp float;
${relief === "screen-space" ? "#define RELIEF_SCREEN_SPACE 1" : ""}
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
  gl_FragColor = vec4(col, 1.0);
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
 * hard edges, which is what the principal saw once bloom stopped smearing it.
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
  gl_FragColor = vec4(sunset * (0.55 + 2.2 * forward) * day,
                      rim * day * atmoStrength);
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
  gl_FragColor = vec4(cloudTint * (lit * 1.30 * sunColor + 0.025),
                      clamp(mask, 0.0, 1.0) * (0.62 + 0.30 * rim));
}
`;

/** A ring plane: banded opacity, plus the planet's own shadow across it. */
export const RING_FRAGMENT = /* glsl */ `
precision highp float;
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
  gl_FragColor = vec4(ice * (0.25 + 0.75 * shadow), density * 0.85);
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
