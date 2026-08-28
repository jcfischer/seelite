/**
 * The docking corridor: `hud-and-scanner.md` §3's director as world geometry.
 *
 * A rectangular tunnel projected out of the station along its docking axis,
 * flaring gently, with the aperture itself as its throat. The pilot flies down
 * it. It answers a question nothing in the cockpit answered before — **which
 * side to approach from** — because it is anchored to the station rather than
 * to the glass, so turning the ship moves it.
 *
 * **It is deliberately narrower than every tolerance it guides, and that is the
 * design rather than a safety margin.** Check 2's position half admits a 35°
 * cone about the station, and a cone drawn truthfully is always a 70°-wide
 * object: its rim is 35° from the station from wherever the pilot is standing.
 * That is exactly what made #69's glass ring unusable — geometrically exact and
 * larger than the screen. So this draws the corridor to *fly*, not the boundary
 * not to leave: inside it is a **sufficient** condition for the position half
 * and for containment, never the gate. `evaluateEntry` remains the gate, and
 * `tests/docking-tunnel.test.ts` asserts the sufficiency against it rather than
 * against a hand-typed angle.
 *
 * Everything here is **station-relative kilometres** in the aperture frame —
 * the §1 conversion, the same one `entryPoseOf` makes. Nothing is in core radii
 * and nothing is a scene-graph unit, because `station-mesh.ts`'s trap is
 * exactly a table that mixed the two.
 */

import { type ApertureFrame, slotBasis } from "./docking";
import { type Vec3, add, scale } from "./vec3";

/**
 * The corridor's flare, degrees of half-angle on its width.
 *
 * Small on purpose. At this angle the worst point on the corridor — a corner of
 * its mouth — sits under 8° off the docking axis at every distance, against
 * check 2's 35°, so a pilot who stays inside is not merely legal but has most
 * of the tolerance in hand. `docking.md` §3.2's complaint is that the gate is
 * wide *because* the instruments were missing; an instrument that only just fit
 * inside the gate would leave it exactly as wide.
 */
export const TUNNEL_FLARE_DEG = 6;

/**
 * How far up the ship's own axial distance the corridor's mouth sits.
 *
 * **Not all the way.** The mouth is placed relative to the ship so the tunnel
 * always reaches back toward the pilot, and a mouth *at* the pilot is a
 * rectangle at the eye: its corners project to extreme angles and draw four
 * rails diverging off the edges of the frame instead of a tunnel converging on
 * a station. Three quarters puts the mouth visibly ahead, which is what makes
 * it something to fly into.
 */
export const TUNNEL_MOUTH_FRACTION = 0.75;

/** How many rectangles are drawn between the throat and the mouth. Enough to
 *  read as a tunnel rather than as two frames; few enough to stay a hairline. */
export const TUNNEL_RINGS = 6;

export interface TunnelRing {
	/** Distance from the station centre along the outward axis, km. */
	axialKm: number;
	halfWidthKm: number;
	halfHeightKm: number;
	/** The four corners, station-relative km, in the rolled aperture basis. */
	corners: Vec3[];
}

export interface TunnelGeometry {
	rings: TunnelRing[];
	/** The ring at the aperture plane — the aperture itself. Identical to
	 *  `rings[0]`, named because it is the thing the ship goes through. */
	throat: TunnelRing;
}

/**
 * Build the corridor out to `mouthKm` from the station centre.
 *
 * The mouth is clamped to the plane rather than trusted: the caller passes the
 * ship's own axial distance so the tunnel always reaches back to where the
 * pilot is, and inside the plane that number is behind the throat.
 */
export function dockingTunnel(
	frame: ApertureFrame,
	opts: { mouthKm: number },
): TunnelGeometry {
	const basis = slotBasis(frame);
	const aspect = frame.aperture.heightKm / frame.aperture.widthKm;
	const flare = Math.tan((TUNNEL_FLARE_DEG * Math.PI) / 180);
	const mouthKm = Math.max(frame.planeKm, opts.mouthKm);
	const span = mouthKm - frame.planeKm;

	const rings: TunnelRing[] = [];
	for (let i = 0; i < TUNNEL_RINGS; i++) {
		const axialKm = frame.planeKm + (span * i) / Math.max(1, TUNNEL_RINGS - 1);
		// Exactly the aperture at the plane, because the throat is not an
		// approximation of the thing the ship flies through — it is that thing.
		const halfWidthKm =
			frame.aperture.widthKm / 2 + (axialKm - frame.planeKm) * flare;
		const halfHeightKm = halfWidthKm * aspect;
		const centre = scale(frame.axis, axialKm);
		const across = scale(basis.across, halfWidthKm);
		const up = scale(basis.up, halfHeightKm);
		rings.push({
			axialKm,
			halfWidthKm,
			halfHeightKm,
			corners: [
				add(centre, add(across, up)),
				add(centre, add(scale(across, -1), up)),
				add(centre, add(scale(across, -1), scale(up, -1))),
				add(centre, add(across, scale(up, -1))),
			],
		});
	}
	return { rings, throat: rings[0] };
}
