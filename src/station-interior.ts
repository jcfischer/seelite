/**
 * The inside of a station: the enclosed volume beyond the aperture, the berths
 * arranged around its transit lane, and the rules that put one ship in one
 * berth.
 *
 * `docs/specs/docking.md` §13 is the ratified contract (node #136); this module
 * is its arithmetic. **No Three.js and no `sim.ts`**, for the reason
 * `docking.ts`'s header gives — the authoritative world is float64 kilometres
 * outside the scene graph, and `station-interior-mesh.ts` is the drawn mirror
 * of what is decided here rather than a second author of it.
 *
 * **Everything is in the aperture frame**, the same `{ axial, across, up }`
 * decomposition `arrival.ts` interpolates in: `axial` measured out from the
 * station's centre along `ApertureFrame.axis`, `across` and `up` from
 * `slotBasis` at the current phase. A berth therefore turns with the station
 * for free, which is the property §12.3 names as the one a translating-frame
 * law loses.
 *
 * **Fit is geometric and there is no S/M/L taxonomy.** A berth declares a clear
 * length, beam and height; a hull declares an envelope; the berth accepts the
 * hull when the box contains the box. A parallel size class would be a second
 * spelling of the same comparison, and the two would drift the first time a
 * hull was retuned.
 */

import type { StationAperture, StationGeometry, StationType } from "./station";

/**
 * The three berth families (§13.2).
 *
 * They change presentation and parked pose, never the docking interaction —
 * which is why nothing below branches on the family except the drawn form. A
 * family that changed a check would be a second docking test, which §13.6
 * forbids outright.
 */
export type BerthFamily = "deck" | "wall" | "cradle";

/** Which wall of the interior a berth is on. `port` is the −`across` side and
 *  `starboard` the +`across` side, by the same convention `slotBasis` fixes. */
export type InteriorFace = "deck" | "port" | "starboard" | "overhead";

/** How far down the lane it sits. Two bands, because the address is
 *  `face × band` and a third would need a third traversal duration to mean
 *  anything. */
export type DepthBand = "near" | "deep";

/** A ship's bounding box, kilometres. Supplied rather than looked up:
 *  `ship-mesh.ts` imports Three, and this module may not. */
export interface HullEnvelope {
	lengthKm: number;
	beamKm: number;
	heightKm: number;
}

/** A position in the aperture frame — the decomposition `arrival.ts` holds its
 *  endpoints in, so a berth centre can be handed straight to a law. */
export interface InteriorOffset {
	axial: number;
	across: number;
	up: number;
}

export interface Berth {
	/** `face-band`. Stable, station-local, and what a reservation is keyed on. */
	id: string;
	family: BerthFamily;
	face: InteriorFace;
	band: DepthBand;
	/** The clear envelope **after** safety margin — what the fit predicate
	 *  compares against, so no caller applies a margin twice. */
	clearLengthKm: number;
	clearBeamKm: number;
	clearHeightKm: number;
	/** Where a parked ship's origin sits. */
	centre: InteriorOffset;
	/** The unit direction from the berth surface into the bay, in the aperture
	 *  frame — the parked ship's own up-vector (§13.3), and the axis phase 3 of
	 *  the traversal settles along. */
	normal: InteriorOffset;
}

export interface StationInterior {
	type: StationType;
	/** The mouth, `aperturePlaneKm` — where §3's checks are evaluated and where
	 *  the interior begins. */
	mouthAxialKm: number;
	/** The back wall. Smaller than the mouth: the interior runs inward. */
	endAxialKm: number;
	/** Half-extents of the enclosed volume across the lane. */
	halfAcrossKm: number;
	halfUpKm: number;
	/** The permanently clear central lane, as half-extents. It is the aperture's
	 *  own rectangle carried inward — the pilot has just flown through it, so
	 *  anything narrower would be a corridor they could not have entered. */
	laneHalfAcrossKm: number;
	laneHalfUpKm: number;
	/** Where the axial run ends and the lateral transfer begins (§13.3). One
	 *  point, on the axis, shared by every berth. */
	stagingAxialKm: number;
	berths: Berth[];
}

/**
 * The clear envelope of one berth, by role — **role-scaled, and that is the
 * outpost's whole point.**
 *
 * The receipt scales the *volume* by role and fixes the capacities; it does not
 * fix a cell size, and one cell for every role does not survive the outpost. An
 * outpost's core is 150 m and its aperture is 120 m across: a bay sized for a
 * miner would be larger than the station it is cut into. So an outpost's berths
 * are small ones, and a big hull is turned away by the ordinary fit predicate
 * rather than by a rule about outposts.
 *
 * The full cell admits every non-capital hull in `HULL_VISUALS` at rest — the
 * widest beam is the courier's 50 m, the tallest the miner's 34 m, the longest
 * the explorer's 74 m — and admits neither capital, which
 * `tests/station-interior.test.ts` asserts against the roster rather than
 * against these numbers.
 */
export const BERTH_CELL: Record<
	StationType,
	{ lengthKm: number; beamKm: number; heightKm: number }
> = {
	trade: { lengthKm: 0.09, beamKm: 0.058, heightKm: 0.04 },
	shipyard: { lengthKm: 0.09, beamKm: 0.058, heightKm: 0.04 },
	refinery: { lengthKm: 0.09, beamKm: 0.058, heightKm: 0.04 },
	// Two thirds of the volume, and it rejects the two largest ordinary hulls.
	outpost: { lengthKm: 0.078, beamKm: 0.054, heightKm: 0.03 },
};

/**
 * The berth addresses each role offers, in the station-local order ties are
 * broken in (§13.2).
 *
 * A `Record<StationType, …>` for `station.ts`'s reason: a fifth station type
 * must stop the build until this table answers for it, rather than silently
 * inheriting a trade station's eight berths.
 *
 * `seeded` marks the one address an outpost draws for — the receipt's
 * "one deck pad and one station-seeded side berth" — and is the only place a
 * seed reaches the catalogue.
 */
export const ROLE_BERTHS: Record<
	StationType,
	{ face: InteriorFace; band: DepthBand; family: BerthFamily; seeded?: true }[]
> = {
	// All eight addresses: four faces × two bands.
	trade: [
		{ face: "deck", band: "near", family: "deck" },
		{ face: "port", band: "near", family: "wall" },
		{ face: "starboard", band: "near", family: "wall" },
		{ face: "overhead", band: "near", family: "wall" },
		{ face: "deck", band: "deep", family: "deck" },
		{ face: "port", band: "deep", family: "wall" },
		{ face: "starboard", band: "deep", family: "wall" },
		{ face: "overhead", band: "deep", family: "wall" },
	],
	// Four side berths and two deep cradles.
	shipyard: [
		{ face: "port", band: "near", family: "wall" },
		{ face: "starboard", band: "near", family: "wall" },
		{ face: "port", band: "deep", family: "wall" },
		{ face: "starboard", band: "deep", family: "wall" },
		{ face: "deck", band: "deep", family: "cradle" },
		{ face: "overhead", band: "deep", family: "cradle" },
	],
	// Two deck pads and two deep cradles.
	refinery: [
		{ face: "deck", band: "near", family: "deck" },
		{ face: "deck", band: "deep", family: "deck" },
		{ face: "port", band: "deep", family: "cradle" },
		{ face: "starboard", band: "deep", family: "cradle" },
	],
	// One deck pad and one side berth, and which side is the station's own draw.
	outpost: [
		{ face: "deck", band: "near", family: "deck" },
		{ face: "port", band: "near", family: "wall", seeded: true },
	],
};

/** The receipt's v1 capacities, as a check on the table above rather than as a
 *  second source: `tests/station-interior.test.ts` compares the two, so a berth
 *  added to `ROLE_BERTHS` without a decision goes red. */
export const ROLE_CAPACITY: Record<StationType, number> = {
	trade: 8,
	shipyard: 6,
	refinery: 4,
	outpost: 2,
};

/**
 * How far the first berth's edge stands off the mouth, as a multiple of the
 * cell's length — and the same gap again behind the deep band.
 *
 * It is what keeps the lane's mouth clear of a berth's corner, so a ship that
 * has just crossed the plane is inside the lane and nothing else.
 */
export const BAND_MARGIN_FACTOR = 1;

/** The gap between the two bands' cells, as a multiple of cell length. Small:
 *  the bands are neighbours down one bay, not two rooms. */
export const BAND_GAP_FACTOR = 0.5;

/**
 * The lateral room a berth needs beyond the lane, as a multiple of the cell's
 * clear **height**.
 *
 * A parked ship's up-vector points away from its berth surface (§13.3), so what
 * a berth occupies measured out from its wall is the ship's height, whichever
 * wall it is on — which is why one factor answers for all four faces.
 *
 * **Two, not one, and the frame decided it.** At one the bay was exactly a
 * berth wider than the lane on each side, and from a deck berth 76 m off the
 * mouth the aperture subtended 64° across and 40° up: the exit filled the
 * canopy and the parked view read as open space rather than as a room. The bay
 * is a berth's clearance *and* a berth's standoff now, which is what puts wall
 * either side of the opening.
 */
export const BERTH_DEPTH_FACTOR = 2;

/**
 * How wide a bay a form can hold, kilometres of half-extent — **the form's own
 * internal clearance, and a second table for the reason `STATION_GEOMETRY`'s
 * `aperturePlaneKm` is one.**
 *
 * The bay is drawn inside the hull the form builds, and a bay wider than that
 * hull pokes through it: the shipyard's Gantry carries its slot on a hub about
 * 250 m across, and a bay sized from the berth cell alone came out 280 m wide.
 * The frame showed it — a chase view from a wall berth was outside the bay
 * altogether, among the drydock frame — and no headless check in this repo can
 * see it, because a hull mesh is `FrontSide` and a ray cast from inside passes
 * straight through.
 *
 * So the figure is authored here beside the catalogue that reads it, and it is
 * a **cap** rather than the size: a bay is the lane plus a berth's standoff,
 * clamped to what the form can hold. A form retuned narrower moves this number,
 * and the evidence for it is the canonical view set rather than an assertion.
 *
 * Every entry is at least `lane + cell height`, or a berth would overlap the
 * transit lane — which `tests/station-interior.test.ts` does check.
 */
export const BAY_HALF_LIMIT_KM: Record<StationType, number> = {
	// The Coriolis's square face is 428 m out and its girth is wider still.
	trade: 0.14,
	// The Gantry's hub: `slot.width/2 + r·0.11` is 126 m of half-width, and the
	// plating around it takes the usable clearance to about 100 m.
	shipyard: 0.1,
	// The Warren is a rock, and the bay is cut into it.
	refinery: 0.155,
	// A 150 m core with a 120 m pad on top of it: the bay is most of the
	// station, which is what an outpost is.
	outpost: 0.105,
};

/** Where the two bands' centres sit, axial kilometres. */
function bandAxial(
	mouthAxialKm: number,
	cellLengthKm: number,
): Record<DepthBand, number> {
	const near =
		mouthAxialKm - cellLengthKm * BAND_MARGIN_FACTOR - cellLengthKm / 2;
	return {
		near,
		deep: near - cellLengthKm * (1 + BAND_GAP_FACTOR),
	};
}

/**
 * The interior of one station, berths and all.
 *
 * `seed` decides only the addresses marked `seeded` — today the outpost's one
 * side berth. Passed in rather than drawn here: `system.ts` owns the per-system
 * streams and the domain-tag discipline, and a generator hidden in a geometry
 * module is exactly the coupling `domains.ts` exists to prevent.
 */
export function stationInterior(
	type: StationType,
	geometry: StationGeometry,
	seed = 0,
): StationInterior {
	const cell = BERTH_CELL[type];
	const aperture: StationAperture = geometry.aperture;
	const laneHalfAcrossKm = aperture.widthKm / 2;
	const laneHalfUpKm = aperture.heightKm / 2;
	// The outpost keeps the tighter bay: its core is 150 m and a two-berth
	// standoff on every face would put more room behind its aperture than the
	// station has hull to hold it in.
	const reach = cell.heightKm * (type === "outpost" ? 1.5 : BERTH_DEPTH_FACTOR);
	const limit = BAY_HALF_LIMIT_KM[type];
	const halfAcrossKm = Math.min(laneHalfAcrossKm + reach, limit);
	const halfUpKm = Math.min(laneHalfUpKm + reach, limit);
	const mouthAxialKm = geometry.aperturePlaneKm;
	const axialOf = bandAxial(mouthAxialKm, cell.lengthKm);
	const bands = ROLE_BERTHS[type].map((entry) => entry.band);
	const deepest = bands.includes("deep") ? axialOf.deep : axialOf.near;
	const endAxialKm =
		deepest - cell.lengthKm / 2 - cell.lengthKm * BAND_MARGIN_FACTOR;

	const berths = ROLE_BERTHS[type].map((entry) => {
		// The seeded address picks a side; every other address is what it says.
		const face: InteriorFace =
			entry.seeded && seed % 2 === 1 ? "starboard" : entry.face;
		const axial = axialOf[entry.band];
		const centre: InteriorOffset = { axial, across: 0, up: 0 };
		const normal: InteriorOffset = { axial: 0, across: 0, up: 0 };
		switch (face) {
			case "deck":
				centre.up = -halfUpKm + cell.heightKm / 2;
				normal.up = 1;
				break;
			case "overhead":
				centre.up = halfUpKm - cell.heightKm / 2;
				normal.up = -1;
				break;
			case "port":
				centre.across = -halfAcrossKm + cell.heightKm / 2;
				normal.across = 1;
				break;
			case "starboard":
				centre.across = halfAcrossKm - cell.heightKm / 2;
				normal.across = -1;
				break;
		}
		return {
			id: `${face}-${entry.band}`,
			family: entry.family,
			face,
			band: entry.band,
			clearLengthKm: cell.lengthKm,
			clearBeamKm: cell.beamKm,
			clearHeightKm: cell.heightKm,
			centre,
			normal,
		};
	});

	return {
		type,
		mouthAxialKm,
		endAxialKm,
		halfAcrossKm,
		halfUpKm,
		laneHalfAcrossKm,
		laneHalfUpKm,
		// One staging point on the axis, shared by every berth: the near band's
		// depth, so a near berth is a short transfer and a deep one is a long
		// one. That difference is what the traversal's duration reads (§13.3).
		stagingAxialKm: axialOf.near,
		berths,
	};
}

/**
 * Does this berth admit this hull?
 *
 * Box contains box, in the berth's own axes: length along the lane, beam across
 * it, height out from the surface. Inclusive, because a hull that measures
 * exactly the clear figure fits — an exclusive comparison would make the
 * declared clearance a number no ship may reach, which is not what "clear"
 * means.
 */
export function berthFits(berth: Berth, hull: HullEnvelope): boolean {
	return (
		hull.lengthKm <= berth.clearLengthKm &&
		hull.beamKm <= berth.clearBeamKm &&
		hull.heightKm <= berth.clearHeightKm
	);
}

/** How much of the berth the hull does not use, cubic kilometres. The
 *  allocation's ranking key: least spare first, so a big berth stays free for a
 *  big ship. */
export function berthSpare(berth: Berth, hull: HullEnvelope): number {
	return (
		berth.clearLengthKm * berth.clearBeamKm * berth.clearHeightKm -
		hull.lengthKm * hull.beamKm * hull.heightKm
	);
}

/**
 * Choose the berth clearance reserves (§13.2).
 *
 * Least spare envelope among the free, fitting berths; ties broken in the
 * catalogue's own order, **rotated by the request time** so a station does not
 * hand every arrival the same berth. `null` when nothing free fits, which is
 * what makes clearance queue rather than grant.
 *
 * Pure: the occupancy comes in as a set of berth ids, so the same request
 * against the same state is the same answer — which is the property the
 * headless tier can hold the reservation lifetime against.
 */
export function chooseBerth(
	interior: StationInterior,
	hull: HullEnvelope,
	occupied: ReadonlySet<string>,
	requestTimeS = 0,
): Berth | null {
	const candidates = interior.berths.filter(
		(berth) => !occupied.has(berth.id) && berthFits(berth, hull),
	);
	if (candidates.length === 0) return null;
	const least = Math.min(...candidates.map((berth) => berthSpare(berth, hull)));
	// Equal fits, in catalogue order — the deterministic station-local order the
	// receipt names — rotated by the whole second the request landed on.
	const tied = candidates.filter((berth) => berthSpare(berth, hull) === least);
	const seconds = Math.floor(requestTimeS);
	const index = ((seconds % tied.length) + tied.length) % tied.length;
	return tied[index];
}
