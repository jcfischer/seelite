/** Weather shared by coverage bakes and live terran shells (node #212). */
export const CLOUD_SHELL_RADIUS = 1.014;

const BROAD_FREQUENCY = 2.3;
const WISP_FREQUENCY = 8.5;

const DETAIL_PARAMS = ", float footprint, float cap";
const detailArgs = (params: string) => params.replaceAll("float ", "");

const broadBase = /* glsl */ `fbm4(warp(broadP * ${BROAD_FREQUENCY}, 1.1, 0.75))`;
const wispBase = /* glsl */ `fbm5(wispP * ${WISP_FREQUENCY})`;

const broadDetail = /* glsl */ `fbm4Footprint(warp(broadP * ${BROAD_FREQUENCY}, 1.1, 0.75), footprint * ${BROAD_FREQUENCY}, cap)`;
const wispDetail = `fbm5Footprint(wispP * ${WISP_FREQUENCY}, footprint * ${WISP_FREQUENCY}, cap)`;

const weatherField = (
	name: string,
	params: string,
	broad: string,
	wisp: string,
) => `
float ${name}(vec3 broadP, vec3 wispP, vec3 cirrusP, float lat, float cover${params}) {
  float broad  = ${broad};
  float wisp   = ${wisp};
  float cirrus = fbm3(cirrusP * 1.2);
  float zonal  = 0.58 + 0.42 * cos(lat * 8.2 + 0.4);
  float field  = broad * 0.55 + wisp * 0.25 + cirrus * 0.20;
  return smoothstep(0.54 - cover * 0.16, 0.56 + 0.10, field) * zonal;
}`;

const weatherEntry = (name: string, from: string, params: string) => `
float ${name}(vec3 p, float cover, float seed, vec3 testDir${params}) {
  if (cover < 0.01) return 0.0;
  // Deterministic single-cloud fixture, also seen by the shell.
  if (dot(testDir, testDir) > 0.01)
    return smoothstep(0.30, 0.70, dot(normalize(p), normalize(testDir)));
  return ${from}(p + seed, p + seed, cirrusDomain(p, seed), abs(p.y), cover${detailArgs(params)});
}`;

/** Static, light-free coverage. All offsets live here. */
export const CLOUD_FIELD_GLSL = `
// Compress y to streak the coarse cirrus along the rotation axis.
vec3 cirrusDomain(vec3 p, float seed) {
  return vec3(p.x * 2.8, p.y * 0.7, p.z * 2.8) + seed + 31.0;
}
${weatherField("cloudFieldFromInputs", "", broadBase, wispBase)}
${weatherEntry("cloudField", "cloudFieldFromInputs", "")}
`;

export const CLOUD_FOOTPRINT_GLSL = `
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
export const CLOUD_MOTION_GLSL = `
vec3 cloudMotion(vec3 p, float seconds) {
  float angle = mod(seconds * 0.0030, 6.28318530718);
  float c = cos(angle), s = sin(angle);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c) * p;
}
`;

/** Intersect the sun ray with the real cloud altitude, in body space.
 * At the subsolar point this is shell height; near the terminator the slant
 * path is longer. Used only while drawing, never while baking. */
export const CLOUD_PROJECTION_GLSL = `
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
