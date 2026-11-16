import type { HullCutter } from "./hull";
import type { Vec3 } from "./vec3";

/**
 * https://github.com/jcfischer/seelite/issues/1147
 * Whether a beam from `muzzleKm` (the ship mesh's frame: starboard +x, up +y,
 * nose −z) along the nose stays clear of the deployed cutter's box, as #920
 * D-D11 requires: a beam from the bow centre runs through the drill.
 */
export function beamClearsCutter(muzzleKm: Vec3, cutter: HullCutter): boolean {
	const inBeam = Math.abs(muzzleKm.x) <= cutter.radiusKm;
	const inHeight =
		muzzleKm.y >= -cutter.downKm - cutter.radiusKm &&
		muzzleKm.y <= -cutter.downKm + cutter.radiusKm;
	const ahead = -muzzleKm.z <= cutter.bowKm + cutter.feedTravelKm;
	return !(inBeam && inHeight && ahead);
}
