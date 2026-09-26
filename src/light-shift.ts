/**
 * The cruise sky's light shift (#537): #532's starbow, on the stars alone.
 *
 * The principal's ask: *the cruise graphics upgraded from the witchspace work —
 * no tunnel, but the light shift distortions, and it must be flyable.* #532 drew
 * the starbow in the jump's wind-up with two mechanisms, and neither is fit to
 * fly under:
 *
 * - `applySkyZoom` zooms the far and approach cameras, so planets and stations
 *   move off the markers that `markerNdc` projects at true bearings — in a jump
 *   the pilot's hands are held, in cruise they are not. It is also centred on
 *   the screen, which is wrong under head-look and in chase.
 * - The witchspace pass colours by screen radius and sits after the approach
 *   layer, so it would tint the bodies a pilot is reading.
 *
 * So the shift is done **per star, in world space, in the backdrop's vertex
 * shader**, about the ship's heading. Each star is moved by the aberration law,
 * coloured by its Doppler factor and beamed. The backdrop holds nothing but
 * stars, so every body, marker, bracket and scanner blip is true by
 * construction, and `in-system-travel.md` §5's sense of speed — far-layer bodies
 * sweeping past — is untouched. The heading is the ship's nose, because §1
 * nose-locks velocity in cruise.
 *
 * The fiction is superluminal and the look is not: β is a display dial read off
 * the same log-speed intensity as the warp streaks, capped under one. A literal
 * 20 c has no aberration to draw.
 *
 * `tests/light-shift.test.ts` holds these functions against the half-angle form
 * of the law, and `probe-cruise-light.mjs` holds a drawn star against
 * {@link aberrate}, so the GLSL copy below cannot drift from them unseen.
 */
import { type Vec3, dot, v3 } from "./vec3";

export const CRUISE_LIGHT = Object.freeze({
	/** β at the streaks' full intensity. The principal's to set on the sheet. */
	peakBeta: 0.6,
	/** The display-side time constant β eases on, seconds: a drop-out snaps the
	 *  speed to nothing, and an unsmoothed β would move every star in one frame. */
	easeS: 0.25,
	/** Beaming, as a point-size multiplier: `D²` (flux goes as size²), clamped so
	 *  the crowd ahead — where the target sits — is not a blaze. */
	sizeMin: 0.7,
	sizeMax: 1.6,
	/** `ln D` at which the colour shift is complete. */
	lnShiftFull: Math.log(2),
	/** Redshifted light dims as `D²` down to this, in the colour: a point cannot
	 *  shrink below the shader's one-pixel floor, so size alone cannot dim it. */
	dimFloor: 0.3,
});

const BLUE = [0.72, 0.88, 1.35] as const;
const RED = [1.3, 0.55, 0.3] as const;

/** The display β for an intensity in `[0, 1]`. */
export function cruiseBeta(intensity: number): number {
	return CRUISE_LIGHT.peakBeta * Math.min(1, Math.max(0, intensity));
}

/**
 * β one frame later, easing from `shown` toward `target` on {@link CRUISE_LIGHT}
 * `.easeS`. Settles exactly on the target, so an idle sky returns to the
 * shader's untouched branch.
 */
export function easeBeta(shown: number, target: number, dt: number): number {
	const k = 1 - Math.exp(-Math.max(0, dt) / CRUISE_LIGHT.easeS);
	const next = shown + (target - shown) * k;
	return Math.abs(next - target) < 1e-3 ? target : next;
}

/**
 * Aberration: a source at `cosTheta` from the heading, in the rest frame, seen
 * from a ship at `beta`.
 */
export function aberrateCos(cosTheta: number, beta: number): number {
	return (cosTheta + beta) / (1 + beta * cosTheta);
}

/** The Doppler factor of light seen at `cosSeen` from the heading. */
export function dopplerFactor(cosSeen: number, beta: number): number {
	if (beta === 0) return 1;
	const gamma = 1 / Math.sqrt(1 - beta * beta);
	return 1 / (gamma * (1 - beta * cosSeen));
}

/**
 * Where a unit direction is seen from a ship heading along the unit `heading`
 * at `beta`: turned toward the heading in the plane the two share. The heading
 * and its opposite are fixed points.
 */
export function aberrate(dir: Vec3, heading: Vec3, beta: number): Vec3 {
	const c = dot(dir, heading);
	const px = dir.x - c * heading.x;
	const py = dir.y - c * heading.y;
	const pz = dir.z - c * heading.z;
	const pl = Math.hypot(px, py, pz);
	if (pl < 1e-9 || beta === 0) return v3(dir.x, dir.y, dir.z);
	const seen = aberrateCos(c, beta);
	const s = Math.sqrt(Math.max(0, 1 - seen * seen)) / pl;
	return v3(
		heading.x * seen + px * s,
		heading.y * seen + py * s,
		heading.z * seen + pz * s,
	);
}

/** The point-size multiplier for a Doppler factor. */
export function beamedSize(doppler: number): number {
	return Math.min(
		CRUISE_LIGHT.sizeMax,
		Math.max(CRUISE_LIGHT.sizeMin, doppler * doppler),
	);
}

/** The colour multiplier for a Doppler factor: blue-white ahead, a dimmed red
 *  astern, white at one. */
export function shiftTint(doppler: number): [number, number, number] {
	const ln = Math.log(doppler);
	const s = Math.min(1, Math.abs(ln) / CRUISE_LIGHT.lnShiftFull);
	const to = ln >= 0 ? BLUE : RED;
	const dim = ln >= 0 ? 1 : Math.max(CRUISE_LIGHT.dimFloor, doppler * doppler);
	return [0, 1, 2].map((i) => (1 + (to[i] - 1) * s) * dim) as [
		number,
		number,
		number,
	];
}

const glslVec3 = (c: readonly number[]) =>
	`vec3(${c.map((x) => x.toFixed(4)).join(", ")})`;

/**
 * The backdrop's star vertex shader, with the shift. The GLSL copy of the
 * functions above, with their constants written in from {@link CRUISE_LIGHT}.
 *
 * It branches on `uBeta`, so an idle sky runs the path it always ran (`CLAUDE.md`:
 * a dial at zero still evaluates everything to its right). The direction is read
 * off the model matrix rather than assumed: the star group follows the camera,
 * and a rotated group would otherwise shift the sky about the wrong axis.
 */
export const LIGHT_SHIFT_VERTEX_GLSL = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uPixelScale;
uniform float uBeta;
uniform vec3 uHeading;
varying vec3 vColor;

vec3 shiftTint(float d) {
	float ln = log(d);
	float s = min(1.0, abs(ln) / ${CRUISE_LIGHT.lnShiftFull.toFixed(6)});
	if (ln >= 0.0) return mix(vec3(1.0), ${glslVec3(BLUE)}, s);
	return mix(vec3(1.0), ${glslVec3(RED)}, s)
		* max(${CRUISE_LIGHT.dimFloor.toFixed(4)}, d * d);
}

void main() {
	vec3 color = aColor;
	float size = aSize;
	vec4 world = modelMatrix * vec4(position, 1.0);
	if (uBeta > 0.0) {
		vec3 centre = modelMatrix[3].xyz;
		vec3 rel = world.xyz - centre;
		float radius = length(rel);
		vec3 n = rel / radius;
		float c = dot(n, uHeading);
		vec3 perp = n - c * uHeading;
		float pl = length(perp);
		float seen = (c + uBeta) / (1.0 + uBeta * c);
		if (pl > 1e-6)
			n = uHeading * seen + (perp / pl) * sqrt(max(0.0, 1.0 - seen * seen));
		float d = sqrt(1.0 - uBeta * uBeta) / (1.0 - uBeta * seen);
		color *= shiftTint(d);
		size *= clamp(d * d, ${CRUISE_LIGHT.sizeMin.toFixed(4)}, ${CRUISE_LIGHT.sizeMax.toFixed(4)});
		world.xyz = centre + n * radius;
	}
	vColor = color;
	// No distance attenuation: the sphere is re-centred on the camera every
	// frame, so every star is exactly BACKDROP_RADIUS away and attenuating by
	// depth would only add rounding.
	gl_PointSize = max(1.0, size * uPixelScale);
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;
