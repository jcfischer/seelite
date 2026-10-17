/** Weather shared by coverage bakes and live terran shells (node #212). */
export const CLOUD_SHELL_RADIUS = 1.014;

/**
 * The two coarse scales of the weather field, in unit-sphere cycles.
 *
 * Each number is emitted twice — once as the field's own frequency and once on
 * the footprint scale handed to the helper — so it is stated once. A scale priced
 * against the wrong frequency admits octaves the cell size does not need, or
 * refuses ones it does, and either reads as weather rather than as a bug.
 */
const BROAD_FREQUENCY = 2.3;
const WISP_FREQUENCY = 8.5;

/** The extra parameters the live shell threads from its call site down to the
 * helpers. Emitted into the signature, and — stripped of its type keywords — into
 * the nested call, from one string, so the two cannot disagree about the arity. */
const DETAIL_PARAMS = ", float footprint, float cap";
const detailArgs = (params: string) => params.replaceAll("float ", "");

const broadBase = /* glsl */ `fbm4(warp(broadP * ${BROAD_FREQUENCY}, 1.1, 0.75))`;
const wispBase = /* glsl */ `fbm5(wispP * ${WISP_FREQUENCY})`;
/** The same two fields continued by footprint (node #756, #720 D9). The scale is
 * the fragment's target-pixel size expressed in the units this field's own base
 * octave samples at, which is why it carries the frequency — the ground's four
 * fields do the same (#755). */
const broadDetail = /* glsl */ `fbm4Footprint(warp(broadP * ${BROAD_FREQUENCY}, 1.1, 0.75), footprint * ${BROAD_FREQUENCY}, cap)`;
const wispDetail = /* glsl */ `fbm5Footprint(wispP * ${WISP_FREQUENCY}, footprint * ${WISP_FREQUENCY}, cap)`;

/**
 * One weather field, emitted twice.
 *
 * Everything the two arms share — the cirrus scale and its domain compression,
 * the zonal band, the blend weights, the coverage threshold — is one text, on
 * purpose. A weight that drifted into one arm only would make the close-detail
 * band a different planet from the one the coverage cube bakes, and both arms
 * shade plausibly, so nothing else would say so. `tests/planet-clouds.test.ts`
 * asserts the two emitted bodies agree apart from the two calls and the extra
 * parameters.
 */
const weatherField = (
	name: string,
	params: string,
	broad: string,
	wisp: string,
) => /* glsl */ `
float ${name}(vec3 broadP, vec3 wispP, vec3 cirrusP, float lat, float cover${params}) {
  float broad  = ${broad};
  float wisp   = ${wisp};
  float cirrus = fbm3(cirrusP * 1.2);
  float zonal  = 0.58 + 0.42 * cos(lat * 8.2 + 0.4);
  float field  = broad * 0.55 + wisp * 0.25 + cirrus * 0.20;
  return smoothstep(0.54 - cover * 0.16, 0.56 + 0.10, field) * zonal;
}`;

/** Its entry point: the no-weather arm, the fixture arm, then the input offsets. */
const weatherEntry = (
	name: string,
	from: string,
	params: string,
) => /* glsl */ `
float ${name}(vec3 p, float cover, float seed, vec3 testDir${params}) {
  if (cover < 0.01) return 0.0;
  // Deterministic single-cloud fixture, also seen by the shell.
  if (dot(testDir, testDir) > 0.01)
    return smoothstep(0.30, 0.70, dot(normalize(p), normalize(testDir)));
  return ${from}(p + seed, p + seed, cirrusDomain(p, seed), abs(p.y), cover${detailArgs(params)});
}`;

/** Static, light-free coverage. All offsets live here. */
export const CLOUD_FIELD_GLSL = /* glsl */ `
// Compress y to streak the coarse cirrus along the rotation axis.
vec3 cirrusDomain(vec3 p, float seed) {
  return vec3(p.x * 2.8, p.y * 0.7, p.z * 2.8) + seed + 31.0;
}
${weatherField("cloudFieldFromInputs", "", broadBase, wispBase)}
${weatherEntry("cloudField", "cloudFieldFromInputs", "")}
`;

/**
 * The live weather shell's arm of that field (node #756, #720 D9).
 *
 * Only `CLOUD_FRAGMENT` includes this. The coverage bake and the ground's cloud
 * shadow keep `CLOUD_FIELD_GLSL` above, because the cube is one fixed-resolution
 * picture of the same weather the shell has to agree with, and a field that grew
 * octaves in one program and not the other would put the shell's cloud on a
 * different part of the disc from the shadow it casts (#720 D4).
 *
 * `cap` is the quality dial's extra-octave ceiling and `footprint` this
 * fragment's target-pixel size in unit-sphere units, both computed by the caller.
 * At cap zero the helpers run their original accumulation and division and break
 * before touching either sum, which is what lets Low quality and every view
 * beyond 2R reproduce the base pixels *exactly* rather than approximately —
 * #755's ANGLE Metal normal drift is the reason it is spelled that way.
 *
 * There is deliberately no coordinate seam here, unlike the ground's
 * `terrainCoordinates`: the shell and the baked cube read one field in one frame,
 * so moving this frame under one of them separates the weather from its shadow.
 */
export const CLOUD_FOOTPRINT_GLSL = /* glsl */ `
// The shell geometry is authored at this radius, so a camera distance divided by
// the shell's own vRadius is not the *body* radii the detail band is stated in.
const float CLOUD_SHELL_R = ${CLOUD_SHELL_RADIUS.toFixed(4)};
${weatherField(
	"cloudFieldFromInputsFootprint",
	DETAIL_PARAMS,
	broadDetail,
	wispDetail,
)}
${weatherEntry("cloudFieldFootprint", "cloudFieldFromInputsFootprint", DETAIL_PARAMS)}
`;

/** Rotate all three weather scales together, so one static coverage cube can
 * carry moving clouds. Independent noise translations cannot be reconstructed
 * from one cube. Neither sun nor clock enters the coverage bake. */
export const CLOUD_MOTION_GLSL = /* glsl */ `
vec3 cloudMotion(vec3 p, float seconds) {
  float angle = mod(seconds * 0.0030, 6.28318530718);
  float c = cos(angle), s = sin(angle);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c) * p;
}
`;

/** Intersect the sun ray with the real cloud altitude, in body space.
 * At the subsolar point this is shell height; near the terminator the slant
 * path is longer. Used only while drawing, never while baking. */
export const CLOUD_PROJECTION_GLSL = /* glsl */ `
const float CLOUD_RADIUS = ${CLOUD_SHELL_RADIUS.toFixed(4)};
const float CLOUD_SHADOW_STRENGTH = 0.40;
uniform vec3 cloudSunDir;
uniform float time;
${CLOUD_MOTION_GLSL}
vec3 cloudDirection(vec3 p) {
  float along = dot(p, cloudSunDir);
  float distance = -along + sqrt(along * along + CLOUD_RADIUS * CLOUD_RADIUS - 1.0);
  return cloudMotion(normalize(p + cloudSunDir * distance), time);
}
`;
