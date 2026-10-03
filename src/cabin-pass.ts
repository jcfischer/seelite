/**
 * The cabin's own pass (#651): the figures it is drawn with, and how a light
 * from the world is carried into it.
 *
 * The cabin is authored at about a hundred times life size, so that its
 * nearest face cleared the near layer's 10 m near plane while it was drawn in
 * that layer. A berth cell is 58 m across, so near a berth the bay's structure
 * stood *inside* the cabin and drew over the dash. The fix is the FPS
 * "view-model" pattern: the cabin in its own scene, with its own camera, drawn
 * after every world layer over a cleared depth buffer. No world fragment can
 * reach a pixel the cabin covers, because nothing of the world is in the depth
 * buffer the cabin is tested against.
 *
 * **The scale stays, and that is a choice with a reason.** Every camera sits
 * at the origin and head-look only rotates them, so in a pass that draws the
 * cabin alone its absolute size cannot be seen — only its angular size can,
 * and that does not change. Dividing every cabin figure by a hundred would
 * re-author `COCKPIT_PANEL_KM`, `COCKPIT_CHAMFER_KM`, `COCKPIT_LAMP`,
 * `COCKPIT_KEY_LIGHT`, every `CANOPY_*` figure and the ambient occlusion's
 * radius for a frame that would look the same. What the scale *does* touch is
 * a light carried in from the world, and `cabinLight` is where that is paid.
 *
 * No Three.js here: what is decided is arithmetic, and it is tested headless.
 */

/**
 * How many times life size the cabin is authored at. A real canopy pane is
 * about a metre across and sits under a metre from the eye; `CANOPY_OUTLINE`
 * is 100 m across and `CANOPY_Z_KM` is 65 m out. Read only by `cabinLight`:
 * nothing in the cabin is drawn from it.
 */
export const CABIN_SCALE = 100;

/**
 * The cabin camera's near plane, kilometres. One cabin metre — a centimetre
 * of the real cabin — so no head turn can slice a fitting open. The near
 * layer's own near plane is untouched; #15's depth ratio is why it is 10 m.
 */
export const CABIN_NEAR_KM = 0.001;

/**
 * The cabin camera's far plane, kilometres. The farthest cabin vertex is the
 * canopy header's corner, about 84 m from the eye; 200 m brackets it, and a
 * far plane only as far as the cabin keeps its depth ratio at 200.
 */
export const CABIN_FAR_KM = 0.2;

/** A point light as the cabin pass needs it: where, how far, how bright. */
export type CabinLight = {
	/** Position relative to the camera, kilometres. */
	positionKm: readonly [number, number, number];
	/** Three's `distance` cut-off, kilometres; 0 means none. */
	distanceKm: number;
	intensity: number;
	/** Three's `decay` exponent. */
	decay: number;
};

/**
 * Carry a world point light into the cabin's frame, so it lights the cabin as
 * it would light a cabin of real size at the eye.
 *
 * The cabin is `CABIN_SCALE` times life size, so a bay lamp 30 m from the eye
 * must stand 3 km from the cabin's origin — at 30 m it would stand *inside*
 * the cabin, which is the defect this pass exists to remove, in light rather
 * than in geometry. Position and cut-off scale by `k`; intensity by
 * `k^decay`, so that `intensity / d^decay` at the cabin is what the world
 * light gives at the eye. Three's window `(1 − (d/cutoff)⁴)²` is a ratio of
 * two distances that both scale by `k`, so it is unchanged.
 *
 * The principal's ruling for #651 is that the bay lights the cabin. The bay
 * has no point lights until #205 adds them, so nothing calls this yet but
 * `Game.mirrorIntoCabin` and the probe that exercises it.
 *
 * **Three's attenuation floor is in scene units.** `getDistanceAttenuation`
 * divides by `max(d^decay, 0.01)`, so in this game's kilometre world a lamp
 * within 100 m of what it lights is flattened; carried into the cabin's frame
 * the floor is reached only within a real metre.
 */
export function cabinLight(world: CabinLight, k = CABIN_SCALE): CabinLight {
	return cabinLightInto(
		world,
		{ positionKm: [0, 0, 0], distanceKm: 0, intensity: 0, decay: 0 },
		k,
	);
}

/** A `CabinLight` a caller owns and lets `cabinLightInto` write. */
export type CabinLightState = {
	positionKm: [number, number, number];
	distanceKm: number;
	intensity: number;
	decay: number;
};

/**
 * `cabinLight`, written into `out` rather than a new object: the frame loop
 * carries every mirrored lamp every frame, and an object per lamp per frame is
 * garbage the moment it is read. Returns `out`.
 */
export function cabinLightInto(
	world: CabinLight,
	out: CabinLightState,
	k = CABIN_SCALE,
): CabinLightState {
	if (!(k > 0) || !Number.isFinite(k))
		throw new Error(`cabinLight: scale must be finite and positive, got ${k}`);
	const p = world.positionKm;
	out.positionKm[0] = p[0] * k;
	out.positionKm[1] = p[1] * k;
	out.positionKm[2] = p[2] * k;
	out.distanceKm = world.distanceKm * k;
	out.intensity = world.intensity * k ** world.decay;
	out.decay = world.decay;
	return out;
}
