// Frozen parent-commit control for node #213 albedo measurements.
export const AIRLESS = /* glsl */ `
uniform float seedOffset;
uniform float warmth;
uniform float craterSlow;

/*
 * Relief comes from the large basins only.
 *
 * craters() walks a 3x3x3 neighbourhood and reliefNormal() evaluates height()
 * four more times for its central differences, so each impact octave here costs
 * 5 x 27 = 135 cell tests per fragment. That makes this the most expensive class
 * in the set, and it is worth saying what was tried: moving the second octave
 * out to tint albedo only ran 35% faster and cost the moon its small craters —
 * the relief *is* the read on an airless body, and shading it from albedo alone
 * looked like a different, worse planet. Both octaves stay; the third scale of
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
 * the analytic derivative of the same curve, not a cheaper lookalike, and it
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
 * does not. Where the curve is smooth the two agree to O(e^2) and the frame
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

void surface(vec3 p, inout vec3 albedo, inout vec3 N,
             inout vec3 emissive, inout float specPower, inout float specMask) {
  float h = height(p);
  // Sub-crater roughness. Ridged noise rather than a third impact octave: at
  // this scale the pits read as texture, and 4 noise octaves cost a fraction of
  // 27 cell tests multiplied by reliefNormal's five height evaluations.
  float grit = ridged(p * 26.0 + seedOffset);
  // Maria: flood basalt that drowned the old cratering, so they are both darker
  // and smoother than the highlands.
  float mare = smoothstep(0.52, 0.63, fbm4(warp(p * 1.3 + seedOffset, 1.0, 0.6)));

  vec3 highland = vec3(0.235, 0.225, 0.210);
  vec3 basalt   = vec3(0.070, 0.068, 0.072);
  // A moon close to its star is baked darker; a far one keeps its frost.
  vec3 frost    = vec3(0.400, 0.415, 0.440);
  highland = mix(highland, frost, smoothstep(3.0, 7.0, warmth));

  albedo = mix(highland, basalt, mare);
  // Fresh craters throw bright rays across everything, including the maria.
  albedo = mix(albedo, albedo * 2.2,
               smoothstep(0.28, 0.80, h) * (1.0 - mare * 0.6));
  albedo *= 0.82 + 0.36 * fbm4(p * 14.0 + seedOffset);
  albedo *= 0.86 + 0.28 * grit;

  // The relief is the whole read on an airless body: no air, no cloud, no
  // ocean, nothing but the shape the impacts left.
  // The perf panel's o key restores the five-walk path, so the two can be
  // compared in place, without reloading. #59 could measure this
  // class only on a software rasteriser and said so; what it licensed was "no
  // saving was demonstrated here", not "no saving exists". This is the switch
  // that lets a GPU answer it, and it costs a uniform branch that is uniform
  // across the draw.
  N = craterSlow > 0.5
    ? reliefNormal(p, N, 2.6 * (1.0 - mare * 0.7))
    : craterRelief(p, N, 2.6 * (1.0 - mare * 0.7));
  specPower = 0.0;
  specMask  = 0.0;
}
`;
