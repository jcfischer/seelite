/** Whole fitting selection by projected removed-detail size, in device pixels. */
export type LodLevel = 0 | 1 | 2;
export type LodMode = "auto" | "0" | "1" | "2";
export const LOD_PIXEL_LIMIT = 1;
export const LOD_HYSTERESIS = 1.2;
export function selectLod(
	current: LodLevel,
	distance: number,
	focalPixels: number,
	diameters: readonly number[],
): LodLevel {
	if (!(distance > 0) || !(focalPixels > 0)) return 0;
	for (const level of [2, 1] as const) {
		const pixels = (diameters[level - 1] * focalPixels) / distance;
		// A selected coarse level remains until its detail exceeds 1.2 pixels.
		if (pixels <= LOD_PIXEL_LIMIT * (current >= level ? LOD_HYSTERESIS : 1))
			return level;
	}
	return 0;
}
