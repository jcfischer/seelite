/**
 * GLSL building blocks for procedural celestial surfaces.
 *
 * Everything here is object-space and seamless: the shader samples 3D noise on
 * the unit sphere, so there is no UV seam to hide and no pole to pinch. The cost
 * of that choice is that every lookup is 3D, which is why the octave counts are
 * small and the expensive primitives (craters) are used by one class only.
 *
 * **Authored in linear space.** The renderer sets `SRGBColorSpace` on output, so
 * a colour written here is a linear reflectance, not a hex a designer picked.
 * Values look darker than the equivalent sRGB swatch on purpose.
 */

/**
 * One cell of a crater field, and the profile of the crater in it.
 *
 * **Two consumers, one definition.** `craters()` below sums the profile;
 * `station-surface.ts`'s `cratersAndGradient()` sums it *and* its slope, so a
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
 * needs `d`, `radius` and the offset from inside the loop, and GLSL ES 1.00
 * has no way to hand those back without recomputing them.
 */
export const CRATER_CELL = /* glsl */ `    vec3 cell = base + vec3(x, y, z);
    vec3 centre = cell + vec3(hash31(cell),
                              hash31(cell + 61.7),
                              hash31(cell + 13.3));
    float radius = 0.16 + 0.34 * hash31(cell + 3.1);
    vec3 offset = p - centre;
    float dist = length(offset);
    float d = dist / radius;`;

export const CRATER_PROFILE = /* glsl */ `      float inside = step(d, 1.0);
      float bowl = -(1.0 - d * d) * inside;
      float rim  = exp(-pow((d - 0.88) * 6.5, 2.0)) * 0.7;`;

/** Hashes, value noise, fBm, ridged fBm, domain warp. GLSL ES 1.00. */
/**
 * `fbmN` for each octave count the classes use.
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
 * - **Wrapped diffuse.** A hard `max(N·L, 0)` puts the terminator exactly on the
 *   geometric limb, which is right for an airless rock and wrong for anything
 *   with air — a thick atmosphere scatters light tens of degrees past it. `wrap`
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
`;

export const SURFACE_VERTEX = /* glsl */ `
${VARYINGS_GLSL}
void main() {
  vObjP   = normalize(position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldP = world.xyz;
  vWorldN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
