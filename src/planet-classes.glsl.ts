import type { SurfaceClass } from "./planet-appearance";

/**
 * One fragment body per surface class.
 *
 * Each class fills in `surface()`:
 *
 * ```glsl
 * void surface(vec3 p, inout vec3 albedo, inout vec3 N,
 *              inout vec3 emissive, inout float specPower, inout float specMask)
 * ```
 *
 * `p` is the unit object-space direction, `N` arrives as the geometric world
 * normal and may be perturbed, and the shared `main()` does the lighting. A
 * class that wants relief writes `N`; a class that glows writes `emissive`,
 * which is added *after* the diffuse term and therefore survives the night side.
 *
 * The split matters: the classes differ in what they paint, never in how they
 * are lit. The previous prototype let gas giants opt out of lighting entirely,
 * which is why they read as painted marbles rather than spheres.
 */

/** Height-field relief, shared by every class that has any. */
const RELIEF = /* glsl */ `
// Perturb the normal from a height function by central differences in the
// sphere's own tangent frame. Cheaper than displacing geometry and it survives
// at any tessellation, which matters because the game draws these bodies at
// wildly different screen sizes.
vec3 reliefNormal(vec3 p, vec3 N, float strength) {
  vec3 axis = abs(p.y) < 0.94 ? vec3(0,1,0) : vec3(1,0,0);
  vec3 t = normalize(cross(axis, p)), b = cross(p, t);
  float e = 0.0035;
  float dt = height(normalize(p + t * e)) - height(normalize(p - t * e));
  float db = height(normalize(p + b * e)) - height(normalize(p - b * e));
  return normalize(N - strength * (dt * t + db * b));
}
`;

export const TERRAN = /* glsl */ `
uniform float seaLevel;
uniform float seedOffset;

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

void surface(vec3 p, inout vec3 albedo, inout vec3 N,
             inout vec3 emissive, inout float specPower, inout float specMask) {
  float major = rift(p, 1.9, 0.055);
  float minor = rift(p, 5.2, 0.035) * 0.55;
  float crack = clamp(major + minor, 0.0, 1.0);

  // Convection makes the flow breathe rather than sit still.
  float pulse = 0.62 + 0.38 * fbm3(p * 5.0 + vec3(time * 0.06, 0.0, time * 0.04));
  float heat  = crack * pulse;

  // Chilled basalt: almost black, and it has to be, or the glow has nothing to
  // be brighter than.
  vec3 crust = mix(vec3(0.020, 0.017, 0.016), vec3(0.055, 0.045, 0.040),
                   fbm4(p * 7.0 + seedOffset));
  albedo = mix(crust, vec3(0.090, 0.035, 0.020), smoothstep(0.15, 0.6, crack));

  // Blackbody ramp, and deliberately over 1.0 so the bloom pass has something
  // to catch. This is the one class visible on its own night side.
  vec3 dull   = vec3(0.85, 0.13, 0.02);
  vec3 bright = vec3(2.60, 1.35, 0.35);
  emissive = mix(dull, bright, pow(heat, 2.2)) * pow(heat, 1.6) * 1.4;

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

/*
 * Relief comes from the large basins only.
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
 * The standing cost is a prototype figure. An implementation should bake this
 * into a normal map once at system generation, where 135 cell tests happen per
 * texel at load instead of per pixel per frame.
 */
float height(vec3 p) {
  return craters(p + seedOffset, 3.2, 0.55)
       + craters(p + seedOffset * 1.7, 8.0, 0.20)
       + fbm4(p * 5.0 + seedOffset) * 0.08;
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
  N = reliefNormal(p, N, 2.6 * (1.0 - mare * 0.7));
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
float bandProfile(float lat, float warpAmt) {
  return stretch(fbm4(vec3(lat * 5.5 + warpAmt, 4.3 + seedOffset, 1.9)));
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
  albedo = mix(belt, zone, smoothstep(0.34, 0.62, band));

  // Bright equatorial zone and darker polar hoods: the large-scale shape that
  // survives at a distance when the band detail no longer resolves.
  albedo = mix(albedo, albedo * 1.22, smoothstep(0.30, 0.02, abs(lat)));
  albedo = mix(albedo, vec3(0.180, 0.140, 0.110), smoothstep(0.72, 0.99, abs(lat)));

  // The storm itself, tinted where the vortex wound the coordinate tightest.
  float storm = smoothstep(0.40, 0.0, distance(p, spotA) / 0.42);
  albedo = mix(albedo, mix(vec3(0.520, 0.155, 0.075), vec3(0.700, 0.360, 0.190), filament), storm * 0.80);

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
 *  rather than a shader that compiles with no `surface()` body. */
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
