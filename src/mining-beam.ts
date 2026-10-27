/**
 * https://github.com/jcfischer/seelite/issues/920
 * Prototype for node #920: the Mining Laser's beam in the cockpit frame, with depth
 * (the principal, 2026-10-27: "no sense of depth / distance or impact on target").
 * The beam is cut into segments placed by perspective along its real length, so
 * it thins with distance, and bright pulses run along it toward the rock.
 */
import type { BeamStroke, FramePoint } from "./beam-glass";

/** Warm amber in linear working space, so a mining beam never reads as a combat shot. */
export const MINING_BEAM_RGB = [1.25, 0.62, 0.12] as const;
/** Candidate look figures. */
export const MINING_BEAM = {
	segments: 16,
	portDepthKm: 0.004,
	widthNearPx: 7,
	widthFarPx: 1.2,
	widthFalloffKm: 0.15,
	pulseHz: 2.2,
	pulseSpacing: 0.9,
} as const;

/** The beam's width at `depthKm` from the eye, CSS pixels. */
export const miningBeamWidthPx = (depthKm: number): number =>
	MINING_BEAM.widthFarPx +
	(MINING_BEAM.widthNearPx - MINING_BEAM.widthFarPx) /
		(1 + depthKm / MINING_BEAM.widthFalloffKm);

/**
 * Where a point `depthKm` from the eye lands between the port and the end on the
 * frame, as a share of the way: projection divides by depth, so the far half of
 * the beam takes almost none of the frame.
 */
export function screenShare(depthKm: number, endKm: number): number {
	const z0 = MINING_BEAM.portDepthKm;
	if (endKm <= z0) return 1;
	const u = (depthKm - z0) / (endKm - z0);
	return (u * endKm) / ((1 - u) * z0 + u * endKm);
}

/**
 * The beam from each port to `end`, `endKm` from the eye. With `hit` false it is
 * at full range and fades out at its far end. `t` is seconds, for the pulses.
 */
export function miningBeamStrokes(
	ports: readonly FramePoint[],
	end: FramePoint,
	endKm: number,
	hit: boolean,
	t: number,
): BeamStroke[] {
	const n = MINING_BEAM.segments;
	const z0 = MINING_BEAM.portDepthKm;
	const far = Math.max(endKm, z0 * 2);
	const out: BeamStroke[] = [];
	for (const port of ports) {
		const at = (share: number): FramePoint => ({
			x: port.x + (end.x - port.x) * share,
			y: port.y + (end.y - port.y) * share,
		});
		for (let k = 0; k < n; k++) {
			const za = z0 * (far / z0) ** (k / n);
			const zb = z0 * (far / z0) ** ((k + 1) / n);
			const pulse =
				0.5 +
				0.5 *
					Math.sin(
						2 * Math.PI * MINING_BEAM.pulseHz * t -
							k * MINING_BEAM.pulseSpacing,
					);
			const fade = hit ? 1 : 1 - k / n;
			out.push({
				from: at(screenShare(za, far)),
				to: at(screenShare(zb, far)),
				widthPx: miningBeamWidthPx((za + zb) / 2),
				rgb: MINING_BEAM_RGB,
				alpha: (0.55 + 0.45 * pulse) * fade,
			});
		}
	}
	return out;
}

/** The impact flare's radius on the glass, CSS pixels: about 30 m of glare, between 3 and 40 px. */
export const impactRadiusPx = (distKm: number, pxPerRadian: number): number =>
	Math.min(40, Math.max(3, (0.03 / Math.max(distKm, 1e-3)) * pxPerRadian));
