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
 * Small on purpose, so a pilot who stays inside the corridor is not merely
 * legal but has most of check 2's 35° in hand. `docking.md` §3.2's complaint is
 * that the gate is wide *because* the instruments were missing; one that only
 * just fitted inside the gate would leave it exactly as wide.
 *
 * **Which point is worst depends on the station.** For a slot it is a corner of
 * the mouth, whose angle converges on
 * `atan(tan(TUNNEL_FLARE_DEG) · √(1 + aspect²))` — 6.9° for the 0.12 × 0.07
 * slot — rather than growing with length. For a **pad** it is the *throat*: a
 * refinery's 0.15 km aperture across a 0.4 km core already stands 14.9° off the
 * axis before the flare adds anything, and the corridor narrows in angle as it
 * lengthens. Both are inside half the tolerance, which is the claim, but 14.9°
 * against 17.5° is the tight one — and it is a fact about that station's
 * proportions, not about this constant. Retuning a station's aperture or core
 * radius is what would break it.
 *
 * A draft of this comment said "the worst point is a corner of its mouth, under
 * 8° at every distance". Both halves were false for the pad, and invisible to a
 * test whose fixture defaulted to the slot.
 */
export const TUNNEL_FLARE_DEG = 6;

/** The fixed distance from the aperture plane to the corridor mouth, km.
 *
 * The corridor is a station-side runway, not a glass-relative funnel: it holds
 * its world size as the player flies through it. The renderer omits frames that
 * pass behind the camera, so this fixed length never becomes screen-edge rails.
 */
export const TUNNEL_MOUTH_OFFSET_KM = 3;

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

export interface TunnelScreenPoint {
	x: number;
	y: number;
}

/**
 * Split each rail wherever an entire ring is omitted by projection.
 *
 * A screen-space rail may join only neighbouring drawn rings. A skipped ring is
 * a real discontinuity — joining across it would draw a bridge through the
 * camera plane, the exact edge-rail artifact the fixed corridor must avoid.
 */
export function tunnelRailSegments(
	rings: readonly (readonly (TunnelScreenPoint | null)[])[],
): TunnelScreenPoint[][][] {
	const rails: TunnelScreenPoint[][][] = [];
	for (let corner = 0; corner < 4; corner++) {
		const segments: TunnelScreenPoint[][] = [];
		let segment: TunnelScreenPoint[] = [];
		for (const ring of rings) {
			const point = ring[corner];
			if (point === null || ring.some((candidate) => candidate === null)) {
				if (segment.length > 1) segments.push(segment);
				segment = [];
				continue;
			}
			segment.push(point);
		}
		if (segment.length > 1) segments.push(segment);
		rails.push(segments);
	}
	return rails;
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
