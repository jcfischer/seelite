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
 * pulled into the starbow's hue by its seen angle ({@link shiftColor} says why
 * the angle and not the Doppler factor), and beamed and dimmed by its Doppler
 * factor. The backdrop holds nothing but
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
 * {@link aberrate} — in the forward view and with the head turned — so the
 * shader's **placement** cannot drift from it unseen. Its colour and size terms
 * are copies nothing in the browser compares; a drift there is the sheet's to
 * catch.
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
	/**
	 * The starbow's radius: the seen angle from the heading, degrees, where the
	 * ring reaches red. About the cockpit frame's corner, so the whole spectrum
	 * is on screen looking ahead — #532 normalised its ring to the same corner.
	 */
	ringDeg: 50,
	/** How far a star is pulled to the ring's hue at peak β: under one, so a
	 *  star keeps a trace of its own class. */
	strength: 0.85,
	/** Redshifted light dims as `D²` down to this, in the colour: a point cannot
	 *  shrink below the shader's one-pixel floor, so size alone cannot dim it. */
	dimFloor: 0.3,
});

/**
 * The starbow's stops, from the heading out to the ring: #532's `starbow()`
 * in `witchspace-pass.ts`, blue-white through cyan, green and gold to red.
 */
const STOPS = [
	[0.9, 0.95, 1.7],
	[0.35, 0.95, 1.5],
	[0.45, 1.35, 0.5],
	[1.45, 1.1, 0.3],
	[1.6, 0.3, 0.12],
] as const;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

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

type Rgb = readonly [number, number, number];
const luma = (c: Rgb) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
const mix3 = (a: Rgb, b: Rgb, k: number): [number, number, number] => [
	a[0] + (b[0] - a[0]) * k,
	a[1] + (b[1] - a[1]) * k,
	a[2] + (b[2] - a[2]) * k,
];

/** The starbow's hue at `x` in `[0, 1]`, heading to ring, piecewise linear. */
export function starbowHue(x: number): [number, number, number] {
	const t = Math.min(1, Math.max(0, x)) * (STOPS.length - 1);
	const i = Math.min(STOPS.length - 2, Math.floor(t));
	return mix3(STOPS[i], STOPS[i + 1], t - i);
}

/**
 * A star's colour at a seen angle from the heading, at `beta`.
 *
 * **The starbow, not a literal Doppler shift.** At the β this dial reaches,
 * every star in a forward frame has `D` above 1.5, and a colour read off `D`
 * alone turned the whole view one pale blue — the first capture. #532's
 * starbow is a ring: blue-white at the nose to red at the frame's rim, and that
 * is what the principal ratified. So the hue is read off the seen angle, and
 * the ring is anchored to the heading rather than to the screen.
 *
 * It is **pulled toward** the hue rather than multiplied by it: most of the sky
 * is warm, and a warm star times a blue tint stays warm. Luminance is kept —
 * the brightening ahead is the size's — and light with `D` under one dims as
 * `D²` to a floor, which is what empties the sky astern.
 */
export function shiftColor(
	color: Rgb,
	cosSeen: number,
	beta: number,
): [number, number, number] {
	if (beta <= 0) return [color[0], color[1], color[2]];
	const x =
		Math.acos(Math.min(1, Math.max(-1, cosSeen))) /
		((CRUISE_LIGHT.ringDeg * Math.PI) / 180);
	const hue = starbowHue(x);
	const k = luma(color) / luma(hue);
	const amount =
		CRUISE_LIGHT.strength * Math.min(1, beta / CRUISE_LIGHT.peakBeta);
	const out = mix3(color, [hue[0] * k, hue[1] * k, hue[2] * k], amount);
	const d = dopplerFactor(cosSeen, beta);
	const dim = d >= 1 ? 1 : Math.max(CRUISE_LIGHT.dimFloor, d * d);
	return [out[0] * dim, out[1] * dim, out[2] * dim];
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

vec3 starbowHue(float x) {
	float t = clamp(x, 0.0, 1.0) * 4.0;
	if (t < 1.0) return mix(${glslVec3(STOPS[0])}, ${glslVec3(STOPS[1])}, t);
	if (t < 2.0) return mix(${glslVec3(STOPS[1])}, ${glslVec3(STOPS[2])}, t - 1.0);
	if (t < 3.0) return mix(${glslVec3(STOPS[2])}, ${glslVec3(STOPS[3])}, t - 2.0);
	return mix(${glslVec3(STOPS[3])}, ${glslVec3(STOPS[4])}, t - 3.0);
}

vec3 shiftColor(vec3 c, float seen, float d) {
	const vec3 LUMA = ${glslVec3(LUMA)};
	vec3 hue = starbowHue(acos(clamp(seen, -1.0, 1.0)) / ${((CRUISE_LIGHT.ringDeg * Math.PI) / 180).toFixed(6)});
	float amount = ${CRUISE_LIGHT.strength.toFixed(4)} * min(1.0, uBeta / ${CRUISE_LIGHT.peakBeta.toFixed(4)});
	vec3 outc = mix(c, hue * (dot(c, LUMA) / dot(hue, LUMA)), amount);
	if (d < 1.0) outc *= max(${CRUISE_LIGHT.dimFloor.toFixed(4)}, d * d);
	return outc;
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
		color = shiftColor(color, seen, d);
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
