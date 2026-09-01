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

import {
	STATION_GEOMETRY,
	type StationAperture,
	type StationType,
} from "./station";

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
	/**
	 * The direction a parked ship's nose points, in the aperture frame.
	 *
	 * **Carried on the berth rather than assumed by the traversal** (#165). In a
	 * bay it is the aperture axis on every berth — §13.3's *"the exit remains
	 * straight ahead"* — and it was written into `parkedAttitude` as a constant.
	 * On a pad the berth's normal *is* the aperture axis, so a nose along the
	 * axis too would be an attitude with no roll: `quatFromAttitude`
	 * re-orthogonalises the up-vector against the nose, and two parallel
	 * directions leave it with a zero vector and an arbitrary basis. A ship on a
	 * landing pad lies in the deck, so its nose does too.
	 */
	parkedNose: InteriorOffset;
}

/**
 * Which of the two interiors a role has (§13.1, reversed in part by #165).
 *
 * `bay` — an enclosed volume running *inward* from the aperture, with berths on
 * its four walls. `pad` — an open deck at the aperture plane with berths
 * standing on it, and no enclosure at all.
 *
 * **Read off `aperture.kind` rather than declared a second time.** A pad
 * aperture and a landing pad are the same fact about a role, and the two tables
 * would drift the first time one was retuned. It is the aperture's `kind` that
 * already says a refinery and an outpost are not flown *into*.
 */
export type InteriorPresentation = "bay" | "pad";

export interface StationInterior {
	type: StationType;
	presentation: InteriorPresentation;
	/** The mouth, `aperturePlaneKm` — where §3's checks are evaluated and where
	 *  the interior begins. On a pad it is the deck's own surface. */
	mouthAxialKm: number;
	/** The back wall. Smaller than the mouth: a bay runs inward. **Equal to the
	 *  mouth on a pad**, which is what "no enclosed interior" is as a number —
	 *  the volume a pad declares runs outward instead, from `mouthAxialKm` to
	 *  `stagingAxialKm`. */
	endAxialKm: number;
	/** Half-extents of the volume across the lane — the bay's walls, or the
	 *  pad deck's own footprint. */
	halfAcrossKm: number;
	halfUpKm: number;
	/** The permanently clear central lane, as half-extents. It is the aperture's
	 *  own rectangle carried inward — the pilot has just flown through it, so
	 *  anything narrower would be a corridor they could not have entered. */
	laneHalfAcrossKm: number;
	laneHalfUpKm: number;
	/** Where the axial run ends and the lateral transfer begins (§13.3). One
	 *  point, on the axis, shared by every berth. Inward of the mouth in a bay
	 *  and outward of it on a pad, where it is the hover height a ship rises to
	 *  before it translates over its berth. */
	stagingAxialKm: number;
	/**
	 * The half-extent of the square hole a pad's deck leaves round its landing
	 * lane, kilometres. **Zero for a bay**, which has no deck to cut.
	 *
	 * The approach corridor's radius with a margin on it. It is here rather than
	 * in the renderer because it is the same question as where a berth may
	 * stand — `padStandoffKm` solves against the same cylinder — and two
	 * modules computing one clearance is how the two come to disagree.
	 */
	padHoleHalfKm: number;
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
	// Two deck pads and two service cradles, one on each side of the landing
	// lane. **One band, because a pad has no depth** (#165): the four sides are
	// the whole catalogue, and a second band would be a second ring of berths
	// further out on a deck that has no room for one.
	refinery: [
		{ face: "deck", band: "near", family: "deck" },
		{ face: "overhead", band: "near", family: "deck" },
		{ face: "port", band: "near", family: "cradle" },
		{ face: "starboard", band: "near", family: "cradle" },
	],
	// One deck pad and one side pad, and which side is the station's own draw.
	//
	// **Both are `deck` family now, and the wall they stood against is gone**
	// (#165). §13.2 allowed an outpost `deck or wall`; a pad has one surface, so
	// there is no wall to be a wall berth on. The seeded draw survives intact,
	// because which side of the lane the second pad sits on is still a choice.
	outpost: [
		{ face: "deck", band: "near", family: "deck" },
		{ face: "port", band: "near", family: "deck", seeded: true },
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
 *
 * **A record rather than a constant with an outpost branch in the sizer.** The
 * outpost keeps the tighter figure — its core is 150 m and a two-berth standoff
 * on every face would want more room behind its aperture than the station has
 * hull to hold it in — and a `type === "outpost"` test inside the generic sizer
 * was a second per-role mechanism hidden in a function.
 */
export const BERTH_DEPTH_FACTOR: Record<StationType, number> = {
	trade: 2,
	shipyard: 2,
	refinery: 2,
	outpost: 1.5,
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
 * How far a pad's berths stand clear of the approach corridor, as a multiple of
 * the cell's clear height.
 *
 * **The corridor, not the aperture rectangle, and that is the whole reason a
 * pad's deck is as wide as it is.** `tests/station-mesh.test.ts`'s corridor row
 * measures a cylinder of the aperture's *half-diagonal* extended outward from
 * the plane, and nothing of the station may stand in it. A bay's berths are
 * behind the plane and never met it; a pad's stand in front of it, so they are
 * the first thing in the game that has to clear it — and the margin is what
 * keeps a service boom, which reaches inboard of its own apron, on the right
 * side of the line. Measured on the outpost, the tighter of the two: at 0.5 the
 * boom cleared the cylinder by 11 cm, which is a coincidence rather than a
 * clearance; at 0.75 it clears by 7.6 m.
 */
export const PAD_CORRIDOR_MARGIN_FACTOR = 0.75;

/**
 * How far outside the approach corridor a pad's deck begins, as a multiple of
 * the corridor's own radius.
 *
 * The corridor is a cylinder and the deck is a rectangular ring, so the two
 * meet where the ring's edges are nearest the axis: at 1.0 the ring's edge
 * midpoints lie *on* the cylinder and whether they count as inside it is a
 * float32 question. Two per cent is 1.7 m on an outpost, four orders above the
 * noise and invisible against a 120 m opening.
 */
export const PAD_HOLE_FACTOR = 1.02;

/**
 * The approach corridor's radius: the aperture's own half-diagonal, which is
 * the cylinder nothing of a station may stand in
 * (`tests/station-mesh.test.ts`).
 *
 * One expression, read by the standoff that keeps berths out of it and by the
 * hole a pad's deck is cut to.
 */
const corridorRadiusKm = (aperture: StationAperture): number =>
	Math.hypot(aperture.widthKm, aperture.heightKm) / 2;

/** Which way a face points in the deck plane, measured out from the lane — the
 *  opposite of the bay normal, which points from that wall *into* the bay. */
const FACE_DIRECTION: Record<InteriorFace, { across: number; up: number }> = {
	deck: { across: 0, up: -1 },
	overhead: { across: 0, up: 1 },
	port: { across: -1, up: 0 },
	starboard: { across: 1, up: 0 },
};

/**
 * How far out from the aperture axis a pad's berth centres sit.
 *
 * A parked ship lies **broadside to the lane** — its clear length tangential,
 * its beam radial — so what has to clear the corridor cylinder of radius `R` is
 * the box corner at `(c − beam/2, ±length/2)`. Solving that for `c` is the
 * expression below, and it is the orientation that fits: nose-out instead puts
 * the *length* on the radius and pushes an outpost's deck 30 m past the one its
 * own form draws.
 */
function padStandoffKm(
	aperture: StationAperture,
	cell: { lengthKm: number; beamKm: number; heightKm: number },
): number {
	const radiusKm = corridorRadiusKm(aperture);
	const half = cell.lengthKm / 2;
	// A corridor narrower than the berth is long has no solution on this axis;
	// the berth then clears it on the radius alone. Not reachable at any
	// shipped figure, and a `NaN` here would travel silently into a position.
	const radial =
		radiusKm > half ? Math.sqrt(radiusKm * radiusKm - half * half) : 0;
	return cell.beamKm / 2 + radial + cell.heightKm * PAD_CORRIDOR_MARGIN_FACTOR;
}

/**
 * The interior of one station, berths and all.
 *
 * **`aperturePlaneKm` is a parameter, not a lookup**, and that is the one thing
 * a caller may vary: the renderer's workbench builds each role's alternate
 * forms, which cut their aperture wherever their own silhouette wants, and a
 * bay built against the table would hang in space in front of them. For a
 * *selected* form the two are the same number by construction —
 * `STATION_GEOMETRY[type].aperturePlaneKm` is what the form cuts at — which is
 * what keeps the sim's catalogue and the drawn bay in step. Everything else the
 * geometry decides is read from the table here, so there is one aperture
 * rectangle rather than a caller's copy of one.
 *
 * **Two presentations, and the aperture's own `kind` picks between them**
 * (#165). A slot role gets §13.1's enclosed bay running inward from the plane;
 * a pad role gets a deck *at* the plane with its berths standing on it. The
 * two share the aperture frame, the fit predicate, the allocation and the
 * three-leg traversal — what differs is where the berths are and which way a
 * parked ship's up-vector points.
 *
 * `seed` decides only the addresses marked `seeded` — today the outpost's one
 * side berth. Passed in rather than drawn here: `system.ts` owns the per-system
 * streams and the domain-tag discipline, and a generator hidden in a geometry
 * module is exactly the coupling `domains.ts` exists to prevent.
 */
export function stationInterior(
	type: StationType,
	aperturePlaneKm: number,
	seed = 0,
): StationInterior {
	const cell = BERTH_CELL[type];
	const aperture: StationAperture = STATION_GEOMETRY[type].aperture;
	const laneHalfAcrossKm = aperture.widthKm / 2;
	const laneHalfUpKm = aperture.heightKm / 2;
	const mouthAxialKm = aperturePlaneKm;
	const presentation: InteriorPresentation =
		aperture.kind === "pad" ? "pad" : "bay";

	// The seeded address picks a side; every other address is what it says.
	const faces = ROLE_BERTHS[type].map((entry) =>
		entry.seeded && seed % 2 === 1 ? ("starboard" as InteriorFace) : entry.face,
	);

	if (presentation === "pad") return padInterior(type, mouthAxialKm, faces);

	const reach = cell.heightKm * BERTH_DEPTH_FACTOR[type];
	const halfAcrossKm = laneHalfAcrossKm + reach;
	const halfUpKm = laneHalfUpKm + reach;
	const axialOf = bandAxial(mouthAxialKm, cell.lengthKm);
	const bands = ROLE_BERTHS[type].map((entry) => entry.band);
	const deepest = bands.includes("deep") ? axialOf.deep : axialOf.near;
	const endAxialKm =
		deepest - cell.lengthKm / 2 - cell.lengthKm * BAND_MARGIN_FACTOR;

	const berths = ROLE_BERTHS[type].map((entry, index) => {
		const face = faces[index];
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
			// §13.3's *"the exit remains straight ahead"*: in a bay every berth
			// parks its ship nose-out, whichever wall it is on.
			parkedNose: { axial: 1, across: 0, up: 0 },
		};
	});

	return {
		type,
		presentation,
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
		// A bay has no deck, so there is no hole in one.
		padHoleHalfKm: 0,
		berths,
	};
}

/**
 * A pad role's interior: an open deck at the aperture plane (#165).
 *
 * **Nothing runs inward.** `endAxialKm` equals `mouthAxialKm`, which is what
 * "outposts don't have bays, just landing pads" is as a number, and the volume
 * the traversal uses runs *outward* from the deck to `stagingAxialKm`, one
 * clear height up. The berths stand on the deck around the landing lane, one to
 * a side, and a parked ship's up-vector is the aperture axis.
 *
 * **The four faces still name four directions, and they are the same four.** In
 * a bay they are the walls a berth is bolted to; on a pad there is one surface,
 * so a face is the side of the lane a berth stands on — `deck` and `overhead`
 * the −`up` and +`up` sides, `port` and `starboard` the −`across` and
 * +`across`. The grammar is unchanged; what changes is that the pad lays the
 * four out *around* the lane instead of *down* it.
 */
function padInterior(
	type: StationType,
	mouthAxialKm: number,
	faces: InteriorFace[],
): StationInterior {
	const cell = BERTH_CELL[type];
	const aperture: StationAperture = STATION_GEOMETRY[type].aperture;
	const standoff = padStandoffKm(aperture, cell);
	// The deck reaches past the outermost berth by the lip its own apron adds —
	// `station-interior-mesh.ts` draws a pad 8% wider than the clear beam and a
	// kerb outside that, and a deck that stopped at the clear box would leave
	// both hanging over its edge.
	const halfKm = standoff + cell.beamKm * 0.6;
	const berths = ROLE_BERTHS[type].map((entry, index) => {
		const face = faces[index];
		const dir = FACE_DIRECTION[face];
		return {
			id: `${face}-${entry.band}`,
			family: entry.family,
			face,
			band: entry.band,
			clearLengthKm: cell.lengthKm,
			clearBeamKm: cell.beamKm,
			clearHeightKm: cell.heightKm,
			centre: {
				axial: mouthAxialKm + cell.heightKm / 2,
				across: dir.across * standoff,
				up: dir.up * standoff,
			},
			// Out of the deck, away from the station: a parked ship's up-vector.
			normal: { axial: 1, across: 0, up: 0 },
			// Broadside to the lane, a quarter turn anticlockwise from the
			// berth's own radius — which is the orientation `padStandoffKm`
			// solves for, and the one that makes four berths a flight line round
			// the pad rather than four ships pointing at each other.
			parkedNose: { axial: 0, across: -dir.up, up: dir.across },
		};
	});
	return {
		type,
		presentation: "pad",
		mouthAxialKm,
		// No enclosed depth at all. The two coincide, and every consumer that
		// wants the volume a ship moves through reads `[mouth, staging]`.
		endAxialKm: mouthAxialKm,
		halfAcrossKm: halfKm,
		halfUpKm: halfKm,
		laneHalfAcrossKm: aperture.widthKm / 2,
		laneHalfUpKm: aperture.heightKm / 2,
		// The hover height: level with every berth's settle standoff, so the
		// traversal's first leg is a climb, its second a pure translation and
		// its third the settle — and a launch runs the three back out without
		// dipping toward the deck on the way.
		stagingAxialKm: mouthAxialKm + cell.heightKm,
		padHoleHalfKm: corridorRadiusKm(aperture) * PAD_HOLE_FACTOR,
		berths,
	};
}

/**
 * The axial span the interior occupies, nearest the station's centre first.
 *
 * **One expression for two presentations** (#165), because every consumer that
 * asks "is this point inside the interior" needs both: a bay runs from its back
 * wall out to the mouth, and a pad runs from its deck out to the hover point
 * the traversal stages at. Written here rather than in each caller, which is
 * three copies of a sign convention.
 */
export function interiorAxialSpanKm(
	interior: StationInterior,
): [number, number] {
	return interior.presentation === "pad"
		? [interior.mouthAxialKm, interior.stagingAxialKm]
		: [interior.endAxialKm, interior.mouthAxialKm];
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
