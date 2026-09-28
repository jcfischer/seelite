/**
 * The canopy: its outline, the frame members round it, the pane and the glass
 * (#204).
 *
 * Kilometres in the cabin's oversized frame, like every other fitting —
 * `cockpit-surface.ts` explains the hundredfold scale. `buildCockpit` places
 * these; this module owns the figures so the pane, the rails, the sill and the
 * header are one set of numbers rather than four that happen to agree.
 *
 * ## Why the glass is `MeshBasicMaterial`, and what that costs
 *
 * #204 proposed a `MeshPhysicalMaterial` pane so `scene.environment` would reach
 * it. Its own "Do not" list then forbids the key light reaching the glass — and
 * a standard-family pane is lit by **every** light in `nearScene`. The key
 * (`COCKPIT_KEY_LIGHT`) sits about 27 m from the canopy header against a 50 m
 * range and the cabin fill about 36 m from the pane against 65, so both would
 * land on it. A physical pane would also join #201's occlusion walk, which
 * excludes by material class, and cast a shadow onto the console.
 *
 * So the pane stays the class it was, and the reflection comes from an
 * **explicit** `envMap`: the same baked environment the scenes carry, handed to
 * this one material by `main.ts` when the quality gate gives the scenes theirs,
 * and rotated onto the star each frame beside `scene.environmentRotation`. A
 * basic material does not read `scene.environment` on its own, so both of those
 * are `main.ts`'s to do, and a probe reads the result off the page.
 */

import * as THREE from "three";

/** The canopy plane, kilometres ahead of the eye. */
export const CANOPY_Z_KM = -0.065;

/**
 * The pane's trapezoid in the canopy plane, `[x, y]` kilometres: sill port,
 * header port, header starboard, sill starboard. Narrower at the sill, which
 * is what leans the side rails in toward the console.
 */
export const CANOPY_OUTLINE = [
	[-0.043, -0.013],
	[-0.05, 0.018],
	[0.05, 0.018],
	[0.043, -0.013],
] as const satisfies ReadonlyArray<readonly [number, number]>;

type Point = [number, number, number];

const at = (corner: number): Point => [
	CANOPY_OUTLINE[corner][0],
	CANOPY_OUTLINE[corner][1],
	CANOPY_Z_KM,
];

/**
 * The two canopy side rails, derived from the outline.
 *
 * The lamps are placed along these (`railLamps`), and an earlier version typed
 * the rail endpoints, the lamp endpoints and the pane's corners as three sets
 * of literals. From one outline they cannot drift apart.
 */
export const CANOPY_SIDE_RAILS = [
	{ side: "port", from: at(0), to: at(1) },
	{ side: "starboard", from: at(3), to: at(2) },
] as const;

/**
 * The side rails' radius, kilometres — 1.25 m in the cabin's frame. The lamps'
 * standoff (`COCKPIT_LAMP.standoffKm`) and the pools' sleeve are both sized
 * against it, so it is named once rather than typed at the `addStrut` call.
 */
export const CANOPY_RAIL_RADIUS_KM = 0.00125;

/**
 * The sill and the header: `size` and `position`, kilometres, for a
 * `cockpitForm` box on the `trim` finish. Each spans the whole of its edge of
 * the outline and is deeper than the pane is thick, so the pane's edge is
 * seated in the member rather than standing in front of it.
 */
export const CANOPY_FRAME = {
	sill: {
		size: [0.088, 0.002, 0.004] as Point,
		position: [0, CANOPY_OUTLINE[0][1], CANOPY_Z_KM] as Point,
	},
	header: {
		size: [0.102, 0.0013, 0.002] as Point,
		position: [0, CANOPY_OUTLINE[1][1], CANOPY_Z_KM] as Point,
	},
} as const;

/**
 * The glass.
 *
 * - `thicknessKm` **0.0006** — 60 cm in the cabin's frame, a few millimetres at
 *   life size. Enough that the pane's rim is a line where the side walls catch
 *   the eye obliquely; under the header's 2 m depth, so the rim is buried.
 * - `opacity` **0.12** against the flat pane's 0.08, the node's figure: a pane
 *   the eye can find, still one the flight is read through.
 * - `reflectivity` is how much of the environment is **added** over the tint,
 *   and then scaled by `opacity` like the rest of the pane — so what reaches the
 *   screen is `opacity × reflectivity` of the environment. Set by looking, like
 *   every other figure in the cabin.
 */
export const CANOPY_GLASS = {
	color: 0x0a2635,
	opacity: 0.12,
	reflectivity: 0.6,
	thicknessKm: 0.0006,
} as const;

/** The pane: the outline extruded to the glass's thickness, centred on the
 *  canopy plane. */
export function canopyPaneGeometry(): THREE.BufferGeometry {
	const shape = new THREE.Shape();
	const [[x0, y0], ...rest] = CANOPY_OUTLINE;
	shape.moveTo(x0, y0);
	for (const [x, y] of rest) shape.lineTo(x, y);
	shape.closePath();
	const geometry = new THREE.ExtrudeGeometry(shape, {
		depth: CANOPY_GLASS.thicknessKm,
		bevelEnabled: false,
	});
	geometry.translate(0, 0, CANOPY_Z_KM - CANOPY_GLASS.thicknessKm / 2);
	return geometry;
}

/**
 * The glass material, without its environment: `main.ts` assigns `envMap`
 * under the quality gate and keeps `envMapRotation` on the star.
 *
 * `FrontSide` on a closed pane: the face toward the pilot and the rim draw, the
 * far face is culled. The flat pane was `DoubleSide` because it had no back;
 * doubled here the tint would be laid down twice.
 */
export function canopyGlassMaterial(): THREE.MeshBasicMaterial {
	const material = new THREE.MeshBasicMaterial({
		color: CANOPY_GLASS.color,
		transparent: true,
		opacity: CANOPY_GLASS.opacity,
		depthWrite: false,
		combine: THREE.AddOperation,
		reflectivity: CANOPY_GLASS.reflectivity,
	});
	material.name = "canopy-glass";
	return material;
}
