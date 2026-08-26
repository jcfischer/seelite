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

/** Hashes, value noise, fBm, ridged fBm, domain warp. GLSL ES 1.00. */
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

// Amplitude-normalised: the sum is divided by the total weight, so fbm3/4/5 all
// return the same range and a threshold tuned against one still means something
// against another. The old prototype skipped this, which is why its sea level
// sat in the tail of the distribution and drowned every continent.
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 3; ++i) { s += a * vnoise(p); n += a; p = p * 2.03 + 17.1; a *= 0.5; }
  return s / n;
}
float fbm4(vec3 p) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 4; ++i) { s += a * vnoise(p); n += a; p = p * 2.03 + 17.1; a *= 0.5; }
  return s / n;
}
float fbm5(vec3 p) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 5; ++i) { s += a * vnoise(p); n += a; p = p * 2.03 + 17.1; a *= 0.5; }
  return s / n;
}

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
// tail. Stretch the middle to fill 0..1 first, then a sea level of 0.6 really is
// 60% ocean. FBM_SPREAD is the measured half-range of the normalised sum.
const float FBM_SPREAD = 0.26;
float stretch(float v) { return clamp(0.5 + (v - 0.5) / FBM_SPREAD, 0.0, 1.0); }

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
    vec3 cell = base + vec3(x, y, z);
    vec3 centre = cell + vec3(hash31(cell),
                              hash31(cell + 61.7),
                              hash31(cell + 13.3));
    float radius = 0.16 + 0.34 * hash31(cell + 3.1);
    float d = length(p - centre) / radius;
    if (d < 1.2) {
      float bowl = -(1.0 - d * d) * step(d, 1.0);
      float rim  = exp(-pow((d - 0.88) * 6.5, 2.0)) * 0.7;
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
