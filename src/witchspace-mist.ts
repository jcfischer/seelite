/**
 * The witchspace mist (#532): the noise and the palette the tunnel and the
 * arrival rift share, so the thing the ship flies through and the thing it comes
 * out of read as one material. A string with no imports; each consumer defines
 * `OCTAVES` for its own cost.
 */
/** The pass-through vertex shader both the pass and the rift draw with. */
export const WITCHSPACE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const WITCHSPACE_MIST_GLSL = /* glsl */ `
float witchHash(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}
float witchNoise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(
			mix(witchHash(i), witchHash(i + vec3(1.0, 0.0, 0.0)), f.x),
			mix(witchHash(i + vec3(0.0, 1.0, 0.0)), witchHash(i + vec3(1.0, 1.0, 0.0)), f.x),
			f.y),
		mix(
			mix(witchHash(i + vec3(0.0, 0.0, 1.0)), witchHash(i + vec3(1.0, 0.0, 1.0)), f.x),
			mix(witchHash(i + vec3(0.0, 1.0, 1.0)), witchHash(i + vec3(1.0, 1.0, 1.0)), f.x),
			f.y),
		f.z);
}
float witchFbm(vec3 p) {
	float sum = 0.0;
	float amp = 0.5;
	for (int o = 0; o < OCTAVES; o++) {
		sum += amp * witchNoise(p);
		p = p * 2.03 + vec3(1.7, 9.2, 3.1);
		amp *= 0.5;
	}
	return sum;
}
// Magenta, wine, teal and cyan: several colours at once, in linear light.
vec3 witchPalette(float t) {
	vec3 a = vec3(0.36, 0.26, 0.48);
	vec3 b = vec3(0.46, 0.34, 0.42);
	return a + b * cos(6.28318 * (t + vec3(0.0, 0.25, 0.25)));
}
`;
