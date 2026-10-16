import type { SurfaceClass } from "./planet-appearance";
import type { Quality } from "./settings";

/** Node #720's interim ceiling; pricing owns the eventual High budget. */
export const PLANET_EXTRA_OCTAVES = 6;

export function planetDetailCap(
	quality: Quality,
	surface: SurfaceClass,
): number {
	return quality === "high" && surface === "terran" ? PLANET_EXTRA_OCTAVES : 0;
}

/** Projection slope per physical pixel of the target being drawn into.
 * A half-height target has twice the angle, including adaptive resolution and
 * postcard targets. projectionY includes camera zoom as well as its FOV. */
export function targetPixelAngle(
	projectionY: number,
	targetHeight: number,
): number {
	return 2 / (projectionY * targetHeight);
}
