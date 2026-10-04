import type { SurfaceClass } from "./planet-appearance";

/**
 * One fragment body per surface class.
 *
 * Each class fills in surface():
 *
 * glsl
 * void surface(vec3 p, inout vec3 albedo, inout vec3 N,
 *              inout vec3 emissive, inout float specPower, inout float specMask)
 *
 *
 * p is the unit object-space direction, N arrives as the geometric world
 * normal and may be perturbed, and the shared main() does the lighting. A
 * class that wants relief writes N; a class that glows writes emissive,
 * which is added *after* the diffuse term and therefore survives the night side.
 *
 * The split matters: the classes differ in what they paint, never in how they
 * are lit. The previous prototype let gas giants opt out of lighting entirely,
 * which is why they read as painted marbles rather than spheres.
 */

/** Height-field relief, shared by every class that has any. */
const RELIEF = /* glsl */ `
uniform float perfAblate;
// Perturb the normal from a height function by central differences in the
// sphere's own tangent frame. Cheaper than displacing geometry and it survives
// at any tessellation, which matters because the game draws these bodies at
// wildly different screen sizes.
/*
 * **The frame is mostly this function**, and it is worth writing down what that
 * cost is before reading the code, because the shape of the fix follows from it.
 *
 * Measured on a GPU with the body filling the view, by switching one term at a
 * time from the perf panel (?perf):
 *
 *              full    no relief   flat sphere
 *   terran     60 ms     28 ms       14 ms
 *   ice        86 ms     30 ms       16 ms
 *   jovian     26 ms     24 ms       17 ms
 *
 * A gas giant has no height field, and barely moves — which is the control that
 * makes the other two rows mean something. On the rocky classes relief is more
 * than half the frame, and neither bloom, nor the atmosphere shell, nor the
 * cloud shell moved terran at all.
 *
 * The reason is the four extra height() calls below. A height function here
 * is several octaves of fBm plus a ridged or contoured term, so asking it five
 * times a fragment to learn one slope is where the frame goes.
 *
 * reliefMode selects how the slope is obtained. Both paths shade from the
 * same height field; they differ only in how its gradient is found, which is
 * why they can be compared by eye on one body without anything else moving.
 */
vec3 reliefNormal(vec3 p, vec3 N, float strength) {
#ifdef RELIEF_NONE
  // #207's smallest band: under RELIEF_OFF_BELOW_PX of apparent radius there
  // are no pixels for a slope to show in. Compiled out rather than branched on
  // a uniform, so neither the four height() calls below nor the screen-space
  // path's derivatives are in the program at all — which is the same argument
  // the path itself is a #define for.
  return N;
#else
  // Diagnostic ablation, off by default. See planet-surface.ts. Kept as a
  // uniform because it is the instrument's dial and not the game's: the shipped
  // selector writes the path, never this.
  if (perfAblate > 0.5) return N;

#ifdef RELIEF_SCREEN_SPACE
  {
    /*
     * One height evaluation, and the screen its own difference operator.
     *
     * dFdx/dFdy hand back how a value changes across the 2x2 quad the GPU
     * is already shading, so the gradient of the height field costs a
     * subtraction rather than four more evaluations of it. The world-space
     * surface gradient is then recovered from the screen-space one through the
     * position's own derivatives — the standard construction, and exact for a
     * linear patch.
     *
     * What it gives up is resolution: the perturbation is constant across each
     * quad, so where the height field has detail finer than two pixels this
     * quantises what the four-tap version resolved. That is a thing to look at
     * rather than to argue about, which is why it is a switch.
     */
    vec3 dpx = dFdx(vWorldP), dpy = dFdy(vWorldP);
    float h = height(p);
    float hx = dFdx(h), hy = dFdy(h);
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    vec3 grad = (r1 * hx + r2 * hy) / det;
    // The four-tap path below perturbs by a *difference* over 2e rather than by
    // a derivative, so the same visual strength is that factor applied here.
    vec3 tilt = strength * 0.007 * grad;

    /*
     * **Where this goes wrong, and what black rectangles are.**
     *
     * A derivative is taken across a 2x2 quad, and a quad on the silhouette has
     * lanes outside the sphere. Those lanes still run the shader — that is what
     * makes the derivative available at all — and they evaluate the height
     * field at a position that is nowhere near their neighbours. The difference
     * is then enormous, det is near zero at a grazing angle, and the quotient
     * is huge or not a number at all.
     *
     * One NaN fragment is invisible. The bloom pass is what makes it a
     * rectangle: a downsample chain averages that pixel into a whole block of
     * a lower mip, so a handful of bad lanes at the limb come back as blocks
     * that appear and vanish as the body moves.
     *
     * This is a guard against a hazard this path introduces, and **not** the
     * cause of the flicker reported against this branch: that artefact exists
     * on main, where this path does not, and this path is off by default. The
     * flicker's own account is at onResize in main.ts.
     *
     * The test is inverted on purpose: NaN compares false against everything,
     * so !(m < LIMIT) catches NaN as well as Inf where m > LIMIT would let
     * NaN straight through.
     */
    float m = dot(tilt, tilt);
    if (!(m < 1.0e4)) return N;
    // A perturbation longer than the normal itself has already stopped meaning
    // "a slope" and is on its way to flipping the normal over.
    if (m > 1.0) tilt *= inversesqrt(m);
    return normalize(N - tilt);
  }

#else
  vec3 axis = abs(p.y) < 0.94 ? vec3(0,1,0) : vec3(1,0,0);
  vec3 t = normalize(cross(axis, p)), b = cross(p, t);
  float e = 0.0035;
  float dt = height(normalize(p + t * e)) - height(normalize(p - t * e));
  float db = height(normalize(p + b * e)) - height(normalize(p - b * e));
  return normalize(N - strength * (dt * t + db * b));
#endif
#endif
}
`;

export const TERRAN = /* glsl */ `
uniform float seaLevel;
uniform float seedOffset;
uniform float cloudCover;
// When non-zero, replaces the cloud field with a single deterministic blob
// centred at this direction. Zero in production; the probe sets it.
uniform vec3  cloudTestDir;

// Domain-warped continents. The warp is what turns blobs into landmasses with
// peninsulas and inland seas; without it every ocean world looks like the same
// ocean world.
float continent(vec3 p) {
  return stretch(fbm5(warp(p * 1.15 + seedOffset, 1.4, 0.85)));
}
// One coastline, used by both the relief and the albedo. Spelled twice, they
// drift, and the shore stops being where the mountains stop.
float landMask(float c) {
  return smoothstep(seaLevel - 0.008, seaLevel + 0.028, c);
}
float height(vec3 p) {
  float c = continent(p);
  float land = landMask(c);
  // Mountains only inland, and only on the taller half of the landmass, so the
  // ranges follow the continent instead of speckling it.
  float orogeny = smoothstep(seaLevel + 0.10, seaLevel + 0.34, c);
  return land * (0.12 + 0.88 * ridged(p * 11.0 + seedOffset) * orogeny);
}

void surface(vec3 p, inout vec3 albedo, inout vec3 N,
             inout vec3 emissive, inout float specPower, inout float specMask) {
  float c    = continent(p);
  float land = landMask(c);
  float h    = height(p);
  float lat  = abs(p.y);

  // Moisture on its own field, so climate bands cross the coastline instead of
  // tracing it. Continentality dries the deep interior.
  float wet = stretch(fbm4(p * 2.1 + 53.0 + seedOffset));
  // Mild: at 0.45 the interior of every landmass went to desert and the whole
  // world read as sand with a coastline.
  wet = clamp(wet - smoothstep(seaLevel + 0.05, seaLevel + 0.34, c) * 0.22, 0.0, 1.0);

  vec3 shelf = vec3(0.016, 0.086, 0.125);
  vec3 abyss = vec3(0.004, 0.020, 0.058);
  vec3 ocean = mix(abyss, shelf, smoothstep(seaLevel - 0.16, seaLevel, c));

  vec3 arid   = vec3(0.255, 0.185, 0.098);
  vec3 steppe = vec3(0.170, 0.165, 0.072);
  vec3 forest = vec3(0.038, 0.105, 0.036);
  vec3 ground = mix(arid, steppe, smoothstep(0.14, 0.36, wet));
  ground = mix(ground, forest, smoothstep(0.30, 0.56, wet));
  // Rock above the treeline.
  ground = mix(ground, vec3(0.150, 0.130, 0.110), smoothstep(0.34, 0.62, h));

  // Ice caps follow the isotherm, and the isotherm wobbles.
  float capEdge = 0.74 + (fbm3(p * 4.0 + 7.0) - 0.5) * 0.10;
  float ice = smoothstep(capEdge, capEdge + 0.09, lat);
  // Sea ice reaches further than land ice.
  float seaIce = smoothstep(capEdge - 0.06, capEdge + 0.05, lat);

  albedo = mix(ocean, ground, land);
  albedo = mix(albedo, vec3(0.72, 0.76, 0.78), max(ice * land, seaIce * (1.0 - land)));
  // Snow line on high ground at any latitude, and only near the summits: a low
  // threshold paints the whole range white and the relief disappears into it.
  albedo = mix(albedo, vec3(0.58, 0.61, 0.64), land * smoothstep(0.74, 0.96, h));

  N = reliefNormal(p, N, 4.5 * land);
  // Tight and dim. A broad lobe puts a headlight blob in the middle of the
  // disc, which is what a specular highlight looks like when it is wrong.
  specPower = 230.0;
  // Open water only: land and pack ice are not mirrors.
  specMask = (1.0 - land) * (1.0 - seaIce) * 0.22;
}
`;

export const DESERT = /* glsl */ `
uniform float seedOffset;
uniform float warmth;

// Canyon systems: ridged noise inverted, so the creases cut down rather than up.
float canyons(vec3 p) {
  return pow(ridged(warp(p * 2.6 + seedOffset, 1.1, 0.55)), 3.0);
}
float height(vec3 p) {
  float base  = fbm4(p * 1.5 + seedOffset);
  // Dune trains: high-frequency ripples stretched along one axis, strongest on
  // the flats between highlands.
  float dunes = fbm3(vec3(p.x * 34.0, p.y * 6.0, p.z * 34.0) + seedOffset) * 0.34;
  return base * 0.8 + dunes * (1.0 - base) - canyons(p) * 0.40;
}

void surface(vec3 p, inout vec3 albedo, inout vec3 N,
             inout vec3 emissive, inout float specPower, inout float specMask) {
  float h    = height(p);
  float cut  = canyons(p);
  float iron = stretch(fbm4(p * 3.1 + 19.0 + seedOffset));

  // Oxidised regolith, banded by how much iron the crust caught.
  // Pulled red and down from a neutral tan. A desert and a warm gas giant are
  // both "brown", and at these radii that made them the same planet in two
  // sizes; the probe put the collision at 0.010 chromaticity apart.
  vec3 pale  = vec3(0.300, 0.160, 0.078);
  vec3 rust  = vec3(0.235, 0.072, 0.028);
  vec3 basalt= vec3(0.075, 0.060, 0.055);
  albedo = mix(pale, rust, smoothstep(0.30, 0.72, iron));
  // Exposed bedrock in the canyon floors.
  // Narrower than it was: at 0.25 the network dominated the disc and looked
  // like the ice world's lineae in a different colour.
  albedo = mix(albedo, basalt, smoothstep(0.42, 0.95, cut));
  // Wind-scoured highlands are brighter.
  albedo = mix(albedo, albedo * 1.45, smoothstep(0.55, 0.85, h));

  // A cold desert keeps polar frost; a hot one does not. Same class, and the
  // orbit decides which end of it you get.
  float frostable = 1.0 - smoothstep(1.35, 1.85, warmth);
  float cap = smoothstep(0.80, 0.90, abs(p.y)) * frostable;
  albedo = mix(albedo, vec3(0.62, 0.63, 0.66), cap);

  N = reliefNormal(p, N, 3.4);
  specPower = 0.0;
  specMask  = 0.0;
}
`;

export const ICE = /* glsl */ `
uniform float seedOffset;

// Lineae: the thin curved fractures of a shell floating on something liquid.
float fractures(vec3 p, float freq, float width) {
  return contour(p * freq + seedOffset, width, 0.9, 0.65);
}
float height(vec3 p) {
  return fbm4(p * 2.2 + seedOffset) * 0.35
       - fractures(p, 2.4, 0.009) * 0.5
       + fractures(p, 2.4, 0.030) * 0.20;   // pressure ridges beside each crack
}

void surface(vec3 p, inout vec3 albedo, inout vec3 N,
             inout vec3 emissive, inout float specPower, inout float specMask) {
  // Thin. Lineae are hairlines at planet scale; widen them and the shell stops
  // reading as ice and starts reading as marble.
  float major = fractures(p, 2.4, 0.009);
  float minor = fractures(p, 7.5, 0.013) * 0.7;
  float dirt  = stretch(fbm4(p * 3.4 + 71.0 + seedOffset));

  vec3 clean = vec3(0.700, 0.760, 0.830);
  vec3 aged  = vec3(0.480, 0.560, 0.660);
  albedo = mix(clean, aged, smoothstep(0.30, 0.80, dirt));
  // Salts and tholins wick up through the cracks and stain their edges.
  albedo = mix(albedo, vec3(0.330, 0.185, 0.100), clamp(major + minor, 0.0, 1.0) * 0.60);

  N = reliefNormal(p, N, 2.8);
  specPower = 46.0;
  // Ice is glossy where it is clean, matte where it is stained.
  specMask  = 0.30 * (1.0 - clamp(major + minor, 0.0, 1.0));
}
`;

export const LAVA = /* glsl */ `
uniform float seedOffset;
uniform float time;

// The crust is broken into plates and the light comes out between them, so the
// glow lives on a contour of a warped field — the shared contour() primitive,
// wider and more strongly warped than ice uses, driving emission not albedo.
float rift(vec3 p, float freq, float width) {
  return contour(p * freq + seedOffset, width, 1.2, 0.8);
}
float height(vec3 p) {
  return fbm4(p * 3.0 + seedOffset) * 0.5 - rift(p, 1.9, 0.06) * 0.4;
}

/*
 * **The one static field this class has**, and #208 is why it is a function.
 *
 * The crack network is a pure function of position: pulse below is the only
 * term that reads the clock. So a baked lava world stores this in a channel
 * and recomputes the glow per frame, which is what lets the class bake at all
 * — and the bake fragment and the baked draw program must agree about it to
 * the bit, or the surface changes when the band is crossed. Spelled twice they
 * drift, which is the argument landMask makes two hundred lines up.
 *
 * No backticks in this file's comments: the chunks are JS template literals and
 * one would end the string.
 */
float lavaCrack(vec3 p) {
  float major = rift(p, 1.9, 0.055);
  float minor = rift(p, 5.2, 0.035) * 0.55;
  return clamp(major + minor, 0.0, 1.0);
}

/**
 * The blackbody glow, from the static crack and the clock.
 *
 * Deliberately over 1.0 so the bloom pass has something to catch. This is the
 * one class visible on its own night side, and the one term #208 leaves
 * per-frame on a baked body: convection makes the flow breathe rather than sit
 * still, so freezing it into a texture would freeze the planet.
 */
vec3 lavaEmissive(vec3 p, float crack) {
  float pulse = 0.62 + 0.38 * fbm3(p * 5.0 + vec3(time * 0.06, 0.0, time * 0.04));
  float heat  = crack * pulse;
  vec3 dull   = vec3(0.85, 0.13, 0.02);
  vec3 bright = vec3(2.60, 1.35, 0.35);
  return mix(dull, bright, pow(heat, 2.2)) * pow(heat, 1.6) * 1.4;
}

void surface(vec3 p, inout vec3 albedo, inout vec3 N,
             inout vec3 emissive, inout float specPower, inout float specMask) {
  float crack = lavaCrack(p);

  // Chilled basalt: almost black, and it has to be, or the glow has nothing to
  // be brighter than.
  vec3 crust = mix(vec3(0.020, 0.017, 0.016), vec3(0.055, 0.045, 0.040),
                   fbm4(p * 7.0 + seedOffset));
  albedo = mix(crust, vec3(0.090, 0.035, 0.020), smoothstep(0.15, 0.6, crack));

  emissive = lavaEmissive(p, crack);

  N = reliefNormal(p, N, 2.0);
  specPower = 0.0;
  specMask  = 0.0;
}
`;

export const VENUSIAN = /* glsl */ `
uniform float seedOffset;
uniform float time;

float height(vec3 p) { return 0.0; }

void surface(vec3 p, inout vec3 albedo, inout vec3 N,
             inout vec3 emissive, inout float specPower, inout float specMask) {
  // No surface at all — the deck is unbroken, and that is the identity. Two
  // layers drifting at different rates give the slow churn without ever
  // opening a gap.
  vec3 slow = p + vec3(time * 0.0022, 0.0, 0.0);
  vec3 fast = p + vec3(time * 0.0061, time * 0.0008, 0.0);
  float deck  = fbm4(warp(slow * 2.4 + seedOffset, 1.0, 0.5));
  float swirl = fbm5(fast * 6.5 + seedOffset);
  // Y-shaped equatorial cloud structure: a broad latitude wave, barely there.
  float wave  = 0.5 + 0.5 * sin(p.y * 6.0 + swirl * 3.0);

  vec3 cream = vec3(0.520, 0.430, 0.255);
  vec3 ochre = vec3(0.380, 0.280, 0.130);
  // Contrast held deliberately low: legible as *featureless*, not as unfinished.
  albedo = mix(ochre, cream, smoothstep(0.38, 0.66, deck * 0.7 + swirl * 0.3));
  albedo = mix(albedo, albedo * 0.90, wave * 0.35);

  specPower = 0.0;
  specMask  = 0.0;
}
`;

export const AIRLESS = /* glsl */ `
uniform float seedOffset;
uniform float warmth;
uniform float craterSlow;
uniform int basinCount;
uniform vec4 basins[4];
uniform int rayCount;
uniform vec3 rayCells[3];

/*
 * Two crater octaves supply the existing relief. Node #213 flattens the
 * sparse basin floors below without adding a height octave.
 *
 * craters() walks a 3x3x3 neighbourhood and reliefNormal() evaluates height()
 * four more times for its central differences, so each impact octave here costs
 * 5 x 27 = 135 cell tests per fragment. That makes this the most expensive class
 * in the set, and it is worth saying what was tried: moving the second octave
 * out to tint albedo only ran 35% faster and cost the moon its small craters —
 * the relief *is* the read on an airless body, and shading it from albedo alone
 * looked like a different, worse planet. Both octaves stay; the third tier of
 * detail is ridged noise in surface(), which is far cheaper than a third
 * neighbourhood walk and reads the same at that scale.
 *
 * The standing cost is a prototype figure, and #59 tried twice to lower it in
 * the live renderer. Both attempts were withdrawn, which is recorded here
 * because the next reader will otherwise propose them again.
 *
 * A **bake** at system generation — the answer an earlier revision of this
 * comment proposed. Baking to an equirectangular target gives back the UV seam
 * and the pole pinch this whole module is object-space to avoid, and a cubemap
 * bake that does not costs six faces to buy a saving nothing had measured.
 *
 * A **detail band** that dropped the fine octave once its craters were
 * sub-pixel. Built, measured on the moon alone in the frame in five
 * interleaved band-on/band-off pairs at each render layer, and withdrawn: the
 * lever moved the frame by +3.0 ms near, -3.7 approach and +1.2 far, against
 * run-to-run spreads of 66.9, 4.2 and 3.8 ms on the unchanged condition. Below
 * the instrument's own noise everywhere.
 *
 * **Those figures cannot be reproduced from the shipped tree**, and that is
 * stated rather than glossed: the lever they measured was removed with the
 * band, so scripts/probe-planet-surfaces.mjs no longer has a band-on/band-off
 * column. What it keeps is the per-layer budget those differences were taken
 * against, which is the number a later attempt has to beat.
 *
 * The measurement is also a **software-rasteriser** measurement — the runner
 * has no GPU — so what it licenses is "no saving was demonstrated here", not
 * "no saving exists". The reason to expect the second is an argument rather
 * than a measurement, and it is worth having in view: crater cost is a
 * coverage cost, so it is only large when the body fills the screen, and that
 * is exactly where the craters are the whole read and no band would drop them.
 * A GPU run could still overturn it.
 *
 * Both octaves stay, unconditionally.
 */
float height(vec3 p) {
  return craters(p + seedOffset, 3.2, 0.55)
       + craters(p + seedOffset * 1.7, 8.0, 0.20)
       + fbm4(p * 5.0 + seedOffset) * 0.08;
}

/*
 * The same relief, from one walk of each octave instead of five.
 *
 * reliefNormal differences height four times, and height here is two
 * 3x3x3 crater walks — so a normal that the walks already contain was costing
 * ten of them. cratersAndGradient accumulates each crater's slope in the loop
 * that accumulates its depth, which is exact rather than approximate: this is
 * the analytic derivative of the same profile, not a cheaper lookalike, and it
 * visits every cell the path it replaces visited. That is true of the *crater*
 * term only: the fine fbm octave below keeps its central differences, so the
 * composite normal is analytic in its dominant part and differenced in its
 * small one — not analytic throughout, which an earlier reading of this
 * paragraph would have suggested — the d < 1.2 cull below is
 * craters()'s own cull, not a new one.
 *
 * The fine fbm term keeps its central differences. It is 0.08 of the amplitude
 * and four fbm4 calls, against the four *pairs of crater walks* that differencing
 * the whole height was paying for it — so it is not what made this class
 * expensive, and leaving it exact costs nothing worth naming.
 *
 * This is #60's asteroid optimisation. The two attempts recorded above were an
 * octave split and a detail band; both changed *what is drawn* — a dropped
 * octave is a missing crater — and both were withdrawn for it. This one keeps
 * every octave and every cell either walk would have visited: the d < 1.2 cull
 * below is the same cull craters() applies, so nothing is dropped relative
 * to the path this replaces. It is not the stronger nothing-is-ever-dropped,
 * which an earlier version of this comment said two paragraphs above conceding
 * that very cull.
 *
 * It is not pixel-identical, and that should not be claimed. A central
 * difference over 2e smooths whatever it straddles; the analytic derivative
 * does not. Where the profile is smooth the two agree to O(e^2) and the frame
 * is the same frame. Where it breaks they differ, and it breaks in two known
 * places: step(d, 1.0) cuts the bowl at the rim, and the walk is culled at
 * d < 1.2 with the rim gaussian still worth about 0.009. Both are documented
 * at cratersAndGradient. The expected read is a slightly harder crater lip,
 * which is the same difference the asteroid shipped with and nobody has looked
 * for on either.
 *
 * The perf panel's o key keeps the old path alongside, so that is a thing
 * anyone can look at rather than take on this comment's word.
 */
vec3 craterRelief(vec3 p, vec3 N, float strength) {
#ifdef RELIEF_NONE
  // The airless class's own relief, and #207's smallest band applies to it for
  // the same reason it applies to reliefNormal: no pixels, no slope to show.
  // Compiled out, so the crater walk is not in the program. No backticks in
  // here: this GLSL is a JS template literal and one would end it.
  return N;
#endif
  if (perfAblate > 0.5) return N;
  vec4 c1 = cratersAndGradient(p + seedOffset, 3.2, 0.55);
  vec4 c2 = cratersAndGradient(p + seedOffset * 1.7, 8.0, 0.20);
  vec3 grad = c1.xyz + c2.xyz;

  // The fine octave, differenced in the tangent frame reliefNormal uses, so
  // the two contributions are expressed the same way before they are summed.
  vec3 axis = abs(p.y) < 0.94 ? vec3(0,1,0) : vec3(1,0,0);
  vec3 t = normalize(cross(axis, p)), b = cross(p, t);
  float e = 0.0035;
  float dt = (fbm4(normalize(p + t * e) * 5.0 + seedOffset)
            - fbm4(normalize(p - t * e) * 5.0 + seedOffset)) * 0.08;
  float db = (fbm4(normalize(p + b * e) * 5.0 + seedOffset)
            - fbm4(normalize(p - b * e) * 5.0 + seedOffset)) * 0.08;

  // The craters' gradient is a full 3D gradient; only its tangential part can
  // tilt a normal on a sphere, and the radial part is what the displacement
  // itself already is.
  vec3 slope = grad - p * dot(grad, p);
  return normalize(N - strength * (slope * (2.0 * e) + dt * t + db * b));
}

// Chord distance on the sphere avoids a pole or texture seam. A flat floor
// occupies the inner 94% of each basin; the rim is an albedo ring, not another
// height octave. The original crater walks above remain untouched.
float basinFloor(vec3 p, out float rimMask) {
  float floorMask = 0.0;
  rimMask = 0.0;
  for (int i = 0; i < 4; ++i) {
    if (i >= basinCount) break;
    float d = distance(p, basins[i].xyz) / basins[i].w;
    floorMask = max(floorMask, 1.0 - smoothstep(0.94, 1.0, d));
    float k = (d - 0.98) * 18.0;
    rimMask = max(rimMask, exp(-k * k));
  }
  return floorMask;
}

float airlessRays(vec3 p) {
  float rays = 0.0;
  for (int i = 0; i < 3; ++i) {
    if (i >= rayCount) break;
    vec3 cell = rayCells[i];
    vec3 centre = cell + vec3(hash31(cell), hash31(cell + 61.7), hash31(cell + 13.3));
    centre = centre / 8.0 - seedOffset * 1.7;
    float radius = (0.16 + 0.34 * hash31(cell + 3.1)) / 8.0;
    vec3 c = normalize(centre);
    vec3 axis = abs(c.y) < 0.94 ? vec3(0,1,0) : vec3(1,0,0);
    vec3 t = normalize(cross(axis, c)), b = cross(c, t);
    vec2 q = vec2(dot(p, t), dot(p, b));
    float d = distance(p, c);
    if (d < radius || d > radius * 9.0) continue;
    float angle = atan(q.y, q.x);
    // Unequal harmonics break a regular spoke wheel; the envelope dies before
    // the antipode. Ejecta changes reflectance only, never height or normal.
    float streak = pow(max(0.0, sin(angle * 17.0 + hash31(cell + 9.7) * 6.28)
                       * sin(angle * 11.0 + 1.7)), 4.0);
    float fade = (1.0 - smoothstep(radius * 2.0, radius * 9.0, d))
               * smoothstep(radius, radius * 1.5, d);
    rays = max(rays, streak * fade);
  }
  return rays;
}

void surface(vec3 p, inout vec3 albedo, inout vec3 N,
             inout vec3 emissive, inout float specPower, inout float specMask) {
  // Sub-crater roughness. Ridged noise rather than a third impact octave: at
  // this scale the pits read as texture, and 4 noise octaves cost a fraction of
  // 27 cell tests multiplied by reliefNormal's five height evaluations.
  float grit = ridged(p * 26.0 + seedOffset);
  float rimMask;
  float floorMask = basinFloor(p, rimMask);
  // Low-frequency basalt variation cannot leak onto the highlands. Floor
  // smoothing is independent of its colour, so the population has flat floors
  // even where the basalt is lighter. The bake stores both terms.
  float mare = floorMask * (0.96 + 0.04 * fbm3(p * 2.0 + seedOffset));

  vec3 highland = vec3(0.235, 0.225, 0.210);
  vec3 basalt   = vec3(0.015, 0.014, 0.017);
  // A moon close to its star is baked darker; a far one keeps its frost.
  vec3 frost    = vec3(0.400, 0.415, 0.440);
  highland = mix(highland, frost, smoothstep(3.0, 7.0, warmth));

  albedo = mix(highland, basalt, mare);
  albedo *= 0.82 + 0.36 * fbm4(p * 14.0 + seedOffset);
  albedo *= 0.86 + 0.28 * grit;
  albedo = mix(albedo, highland * 1.24, rimMask * 0.5);
  // Replaces the old height-based brightening, which asked height() for another
  // pair of crater walks. Radial ejecta does not need that height sample.
  albedo = mix(albedo, vec3(0.48, 0.46, 0.43), airlessRays(p) * 0.75);

  // Outside the basin floors the original small impacts keep their relief.
  // The perf panel's o key restores the five-walk path, so the two can be
  // compared in place, without reloading. #59 could measure this
  // class only on a software rasteriser and said so; what it licensed was "no
  // saving was demonstrated here", not "no saving exists". This is the switch
  // that lets a GPU answer it, and it costs a uniform branch that is uniform
  // across the draw.
  N = craterSlow > 0.5
    ? normalize(mix(reliefNormal(p, N, 2.6), N, floorMask))
    : normalize(mix(craterRelief(p, N, 2.6), N, floorMask));
  specPower = 0.0;
  specMask  = 0.0;
}
`;

/** Zonal flow, band profile, and storm ovals — shared by both giant classes. */
const GIANT_COMMON = /* glsl */ `
uniform float seedOffset;
uniform float time;

float height(vec3 p) { return 0.0; }

// Rotate p about a spot's own radial axis, falling off with angular distance.
// This is what makes a storm look like it is *turning* rather than pasted on.
vec3 vortex(vec3 p, vec3 centre, float radius, float strength) {
  float d = distance(p, centre) / radius;
  if (d > 1.0) return p;
  float a = strength * pow(1.0 - d, 2.0);
  vec3 axis = normalize(centre);
  return p * cos(a) + cross(axis, p) * sin(a) + axis * dot(axis, p) * (1.0 - cos(a));
}

// Zonal shear: each latitude band drifts at its own rate, which is what stretches
// every feature into a ribbon. Longitude is advected, latitude is not.
vec3 zonal(vec3 p, float rate) {
  float lat = clamp(p.y, -1.0, 1.0);
  float lon = atan(p.z, p.x) + time * rate * (0.35 + 0.65 * cos(lat * 2.6));
  float r = sqrt(max(1.0 - lat * lat, 0.0));
  return vec3(cos(lon) * r, lat, sin(lon) * r);
}

// The band profile is 1D noise *in latitude only*, so the bands come out at
// unequal widths with unequal spacing. The old prototype used sin(lat * 12),
// which is a barber pole: every band identical, evenly spaced, and unmistakably
// synthetic.
//
// **Folded, not clamped (#209).** What shipped was stretch(fbm4(...)) with a
// smoothstep on top at the call site: stretch() divides by FBM_SPREAD and
// clamps, so it saturates over most of its range, and the smoothstep spanned a
// third of the remainder. Two tones came out, and the principal reported them.
//
// Warping the boundary — which is where the node expected the fix — moves an
// edge and adds no tones. The mapping is what had to change, and a clamp is the
// wrong end of it: a bell-shaped fbm through a linear gain either stays narrow,
// which is a washed-out planet, or clips, and the clipped tails become two
// modes. A triangle fold spends those tails on more bands instead. The profile
// sweeps the belt-zone range and turns back, so raising the gain adds bands
// rather than clipping — at a gain large enough to reach the turns, which this
// one is and a small one is not: at zero the profile is 0.5 everywhere and the
// planet has no bands at all. The fold is continuous, so no band has a seam;
// its slope reverses at the turns, which is a band boundary and is what those
// are.
//
// **This shipped on the contact sheet and not on a measurement, and the reason
// is worth keeping.** A statistic was built for it — Sarle's bimodality
// coefficient over the detrended latitude profile, still printed by
// probe-planet-surfaces.mjs — and it does not measure this. Under a correct
// detrend it reads 0.541 on this build against **0.261** on the two-tone build
// it replaced, because Sarle's is (skew² + 1) / kurtosis and a dominant tone
// with a thin tail of dark bands is skewed rather than bimodal. The figures
// that motivated the change in the first place came from a detrend window sized
// from the bin count rather than from the populated bands, which left the
// planet-scale gradient in; Sage caught it. So: no figure here is evidence for
// this form, the numbers that were here for a round have been removed rather
// than restated, and what carries it is the sheet.
//
// **It adds no noise calls**, which is the budget the node set and is not the
// same as costing nothing — the fold is a fract and an abs, and no shader-cost
// measurement was taken for this change, so nothing here claims one. A second
// octave was flown and is not here: it moved the look no more than the gain
// does, for four more vnoise calls a fragment against a budget of two. JOVIAN
// stays at the 18 it had.
const float BAND_GAIN = 5.0;
float bandProfile(float lat, float warpAmt) {
  float v = 0.5 + (fbm4(vec3(lat * 5.5 + warpAmt, 4.3 + seedOffset, 1.9)) - 0.5) * BAND_GAIN;
  return abs(fract(v * 0.5) * 2.0 - 1.0);
}
`;

export const JOVIAN = /* glsl */ `
${GIANT_COMMON}

void surface(vec3 p, inout vec3 albedo, inout vec3 N,
             inout vec3 emissive, inout float specPower, inout float specMask) {
  vec3 q = zonal(p, 0.020);
  // One great oval plus a smaller companion, both seeded into the southern
  // mid-latitudes where the real ones live.
  vec3 spotA = normalize(vec3(cos(seedOffset * 2.1), -0.34, sin(seedOffset * 2.1)));
  vec3 spotB = normalize(vec3(cos(seedOffset * 4.7 + 2.0), 0.21, sin(seedOffset * 4.7 + 2.0)));
  q = vortex(q, spotA, 0.42, 2.3);
  q = vortex(q, spotB, 0.20, -1.5);

  float lat = q.y;
  // Turbulence folded back into the latitude coordinate, so it warps the band
  // *edges* rather than dusting noise over them.
  float turb = (fbm4(q * 3.0) - 0.5) * 0.16 + (fbm5(q * 9.0) - 0.5) * 0.05;
  float band = bandProfile(lat + turb, 0.0);
  float filament = fbm5(q * 16.0);

  // Gold rather than brown, for the same reason the desert went red: the two
  // classes were sharing a hue.
  vec3 zone = mix(vec3(0.560, 0.440, 0.215), vec3(0.760, 0.640, 0.375), filament);
  vec3 belt = mix(vec3(0.145, 0.062, 0.028), vec3(0.290, 0.135, 0.055), filament);
  // **The band's own value, not a threshold on it (#209).** This was
  // smoothstep(0.34, 0.62, band) — a second binarisation on top of the one
  // stretch was already doing, mapping two thirds of the profile's range to a
  // flat belt or a flat zone. bandProfile now sweeps its whole range, so the
  // ramp is the mix itself and there is nothing left for a threshold to do but
  // undo it.
  albedo = mix(belt, zone, band);

  // Bright equatorial zone and darker polar hoods: the large-scale shape that
  // survives at a distance when the band detail no longer resolves.
  albedo = mix(albedo, albedo * 1.22, smoothstep(0.30, 0.02, abs(lat)));
  albedo = mix(albedo, vec3(0.180, 0.140, 0.110), smoothstep(0.72, 0.99, abs(lat)));

  /*
   * The storm, and it has an inside (#209).
   *
   * It was one radial falloff painted over the bands, which is what made it
   * read as a decal: uniform tint, one scale, and a boundary that owed nothing
   * to the flow around it. Three things give it a form instead, and none of
   * them is a new noise call — all three read the fields already computed.
   *
   * The **eye** is the centre lightened: the second scale inside the mask, cut
   * from the same filament field so the wisps inside the oval belong to the
   * ones outside it. The **rim** is the shell between eye and edge, where a
   * real vortex piles its cloud up brightest. And the edge is broken by the
   * band turbulence rather than being a circle — turb is the same latitude
   * displacement the bands already use, so the storm frays where they do.
   */
  float stormR = distance(p, spotA) / 0.42;
  float storm = smoothstep(1.0, 0.15, stormR + turb * 1.6);
  vec3 stormBody = mix(vec3(0.520, 0.155, 0.075), vec3(0.700, 0.360, 0.190), filament);
  // The rim: brightest partway out, falling off to either side.
  float rim = storm * smoothstep(0.15, 0.55, stormR) * (1.0 - smoothstep(0.55, 0.95, stormR));
  stormBody = mix(stormBody, vec3(0.780, 0.470, 0.270), rim * 0.55);
  // The eye, lighter and quieter than the wall around it.
  float eye = smoothstep(0.34, 0.05, stormR);
  stormBody = mix(stormBody, vec3(0.830, 0.660, 0.480), eye * (0.35 + 0.35 * filament));
  albedo = mix(albedo, stormBody, storm * 0.80);
  /*
   * A tail drawn out along the band the storm sits in, so the spot reads as
   * being *in* the flow rather than sitting on top of it.
   *
   * **In the storm's own frame, and that is not a detail.** The first version
   * measured the tail from q and the mask from p. q is p advected by zonal(),
   * so the two frames separate at the zonal rate: at this latitude the tail's
   * centre travels about 108° in two minutes while the mask stays put, and the
   * tail that is supposed to trail the storm becomes a second unexplained blob
   * on the far side of the planet. Sage caught it — it is invisible in a still
   * frame and the sheet is still frames.
   *
   * The mask is on p because a storm is a feature of the planet rather than of
   * the flow over it; the tail follows the mask. The *sense* of downstream is
   * still real — the tail is offset along the band, not centred on the spot —
   * and it is the band's own axis rather than a clock that gives it a
   * direction, which is what keeps the two attached at every time.
   */
  vec3 downstream = normalize(cross(vec3(0.0, 1.0, 0.0), spotA));
  vec3 tailCentre = normalize(spotA - downstream * 0.30);
  float tail = smoothstep(0.62, 0.10, distance(p, tailCentre))
             * smoothstep(0.20, 0.02, abs(p.y - spotA.y));
  albedo = mix(albedo, stormBody, tail * 0.22 * (1.0 - storm));

  // Thin high haze catches light before the deck does.
  albedo += vec3(0.030, 0.028, 0.024) * filament;
  specPower = 0.0;
  specMask  = 0.0;
}
`;

export const ICE_GIANT = /* glsl */ `
${GIANT_COMMON}

void surface(vec3 p, inout vec3 albedo, inout vec3 N,
             inout vec3 emissive, inout float specPower, inout float specMask) {
  vec3 q = zonal(p, 0.011);
  vec3 spot = normalize(vec3(cos(seedOffset * 3.3), -0.46, sin(seedOffset * 3.3)));
  q = vortex(q, spot, 0.26, 1.7);

  float lat  = q.y;
  float turb = (fbm4(q * 2.2) - 0.5) * 0.10;
  // Banding is present but faint: methane haze buries it, and burying it is the
  // difference between an ice giant and a small Jupiter.
  float band = bandProfile(lat + turb, 17.0);

  vec3 deep = vec3(0.040, 0.120, 0.235);
  vec3 haze = vec3(0.110, 0.260, 0.400);
  albedo = mix(deep, haze, smoothstep(0.36, 0.64, band) * 0.55 + 0.30);

  // Bright polar cap where the haze piles up.
  albedo = mix(albedo, vec3(0.190, 0.330, 0.430), smoothstep(0.60, 0.95, abs(lat)));

  // Discrete white methane clouds — the only high-contrast feature these have,
  // and the reason they do not read as a plain blue ball.
  float cloud = smoothstep(0.62, 0.78, fbm5(q * 7.0 + 31.0));
  albedo = mix(albedo, vec3(0.660, 0.720, 0.760), cloud * 0.7);
  float dark = smoothstep(0.30, 0.0, distance(p, spot) / 0.26);
  albedo = mix(albedo, vec3(0.020, 0.055, 0.140), dark * 0.65);

  specPower = 0.0;
  specMask  = 0.0;
}
`;

export const STAR = /* glsl */ `
uniform float seedOffset;
uniform float time;
uniform vec3  starTint;

float height(vec3 p) { return 0.0; }

void surface(vec3 p, inout vec3 albedo, inout vec3 N,
             inout vec3 emissive, inout float specPower, inout float specMask) {
  // Granulation: convection cells that boil over on a few-second timescale.
  // Fine and low-contrast \u2014 a granule is ~1/1000 of the disc, so a coarse cell
  // pattern reads as a golf ball rather than a photosphere.
  vec3 q = p * 30.0 + vec3(0.0, time * 0.09, 0.0) + seedOffset;
  float cells = ridged(q);
  float churn = fbm4(p * 70.0 + time * 0.20 + seedOffset);
  float bright = pow(cells, 1.15) * 0.55 + churn * 0.45;

  // Spots: cool, so they are dark against the photosphere, and they sit in
  // mid-latitude belts rather than anywhere.
  float belt = smoothstep(0.12, 0.32, abs(p.y)) * smoothstep(0.60, 0.38, abs(p.y));
  // Sparse: sunspot groups cover a fraction of a percent of the disc, and a
  // generous threshold here turns a star into a scorched potato.
  float spot = smoothstep(0.66, 0.76, fbm4(p * 5.2 + seedOffset)) * belt;

  // Limb darkening, the real law: I(mu)/I(0) = 1 - u(1 - mu), u ~ 0.62.
  vec3 V = normalize(cameraPosition - vWorldP);
  float mu = max(dot(normalize(vWorldN), V), 0.0);
  float limb = 1.0 - 0.62 * (1.0 - mu);

  // Scaled to sit just under the knee of the tone curve, so the granulation is
  // still legible instead of clipping to a white disc.
  vec3 core = starTint * (0.55 + 0.62 * bright);
  // The limb is cooler as well as dimmer: less depth of photosphere seen
  // edge-on means a redder spectrum, which is the colour cue that says "sphere"
  // when the brightness cue alone has been flattened by the tone curve.
  core *= mix(vec3(1.20, 0.72, 0.42), vec3(1.0), smoothstep(0.0, 0.55, mu));
  emissive = core * limb * mix(1.0, 0.42, spot) * 1.30;
  albedo = vec3(0.0);   // A star is not lit; it is the light.
  specPower = 0.0;
  specMask  = 0.0;
}
`;

/** Keyed by `SurfaceClass`, so adding a rung without a shader is a type error
 *  rather than a shader that compiles with no surface() body. */
export const CLASS_GLSL: Record<SurfaceClass, string> = {
	terran: TERRAN,
	desert: DESERT,
	ice: ICE,
	lava: LAVA,
	venusian: VENUSIAN,
	airless: AIRLESS,
	jovian: JOVIAN,
	iceGiant: ICE_GIANT,
	star: STAR,
};

export { RELIEF };
