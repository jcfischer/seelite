/** Shared box-section wheel rim, extracted unchanged from trade E for the metropolis study. */
import { hullLoft, type Ring } from "./loft";
export function wheelRimGeometry(
	innerKm: number,
	outerKm: number,
	z: number,
	widthKm: number,
) {
	const station = (radius: number, at: number): Ring => ({
		z: at,
		w: radius,
		h: radius,
		e: 2,
		hard: true,
	});
	const half = widthKm / 2;
	// `ship-mesh.ts`'s collar construction: out across the aft face, along the
	// outer face, in across the fore face and home along the bore, `open` so no
	// fan is drawn across either end.
	const geometry = hullLoft(
		[
			station(innerKm, z - half),
			station(outerKm, z - half),
			station(outerKm, z + half),
			station(innerKm, z + half),
			station(innerKm, z - half),
		],
		{ segments: 48, subdivisions: 1, open: true },
	);
	return geometry;
}
