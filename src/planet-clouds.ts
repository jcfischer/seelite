/** Weather shared by coverage bakes and live terran shells (node #212). */
export const CLOUD_SHELL_RADIUS = 1.014;

/** Static, light-free coverage. All offsets live here. */
export const CLOUD_FIELD_GLSL = /* glsl */ `
// Compress y to streak the coarse cirrus along the rotation axis.
vec3 cirrusDomain(vec3 p, float seed) {
  return vec3(p.x * 2.8, p.y * 0.7, p.z * 2.8) + seed + 31.0;
}
float cloudFieldFromInputs(vec3 broadP, vec3 wispP, vec3 cirrusP,
                           float lat, float cover) {
  float broad  = fbm4(warp(broadP * 2.3, 1.1, 0.75));
  float wisp   = fbm5(wispP * 8.5);
  float cirrus = fbm3(cirrusP * 1.2);
  float zonal  = 0.58 + 0.42 * cos(lat * 8.2 + 0.4);
  float field  = broad * 0.55 + wisp * 0.25 + cirrus * 0.20;
  return smoothstep(0.54 - cover * 0.16, 0.56 + 0.10, field) * zonal;
}
float cloudField(vec3 p, float cover, float seed, vec3 testDir) {
  if (cover < 0.01) return 0.0;
  // Deterministic single-cloud fixture, also seen by the shell.
  if (dot(testDir, testDir) > 0.01)
    return smoothstep(0.30, 0.70, dot(normalize(p), normalize(testDir)));
  return cloudFieldFromInputs(p + seed, p + seed, cirrusDomain(p, seed),
                              abs(p.y), cover);
}
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
