/**
 * The bonnet: the front of the ship, seen over the canopy sill (#204).
 *
 * Before this the cockpit showed nothing of the ship at all — `shipMesh` is
 * drawn in chase only — so the cabin read as a room with a window rather than
 * the front of a hull.
 *
 * **Why a proxy and not the hull.** The cabin is drawn at about a hundred times
 * life size (`cockpit-surface.ts`'s module docstring) and the camera sits a few
 * metres ahead of the life-size hull's centre, inside it. So the real nose is
 * either smaller than the sill and behind it, or culled from the inside — a
 * `FrontSide` hull shows nothing to a camera within it. The node offered
 * clipping the hull as the other route; at this scale there is nothing to clip.
 *
 * **Why a generic section and not the flown hull's own rings.** Every hull's
 * rings live inside its detail plan's builder in `ship-mesh.ts`, not in a table
 * a caller can read, and a flown hull's nose is 20-odd metres ahead of the eye
 * at life size — a figure that means nothing in the cabin's frame. What *is*
 * the flown hull's is the paint: `buildBonnet` takes the hull's own `hull`
 * material, plated, so the bonnet is the ship's colour and the ship's plates.
 *
 * Kilometres in the cabin's frame, like every fitting.
 */

import * as THREE from "three";
import { CANOPY_FRAME } from "./cockpit-canopy";
import { type Ring, hullLoft, scaleUVs } from "./loft";
import { plateUVs } from "./ship-surface";

/**
 * How much larger than life the cabin is drawn. **About** a hundred, and the
 * only reader is the bonnet's plating: `hullLoft` writes UVs in the geometry's
 * own kilometres, so a bonnet drawn a hundred times life size would carry
 * plates a hundred times smaller than the hull's without this.
 */
export const BONNET_LIFE_SCALE = 100;

/**
 * The bonnet's stations, **nose first**, as every hull in `ship-mesh.ts` is
 * written. Set by apparent size on the contact sheet, not derived:
 *
 * - The tip stands about 200 m ahead of the eye and clears the sightline over
 *   the sill (`sillSightline`) — the only part of the bonnet the eye can reach.
 * - The aft station is tucked under and just ahead of the sill, so the join is
 *   hidden by the sill rather than drawn in the flight view.
 * - Every station's top is below the sill: `tests/cockpit-bonnet.test.ts` holds
 *   all three of these.
 */
export const BONNET_RINGS: readonly Ring[] = [
	{ z: -0.2, w: 0.003, h: 0.0012, b: 0.0012, y: -0.029, e: 2.4 },
	{ z: -0.16, w: 0.016, h: 0.004, b: 0.006, y: -0.026, e: 3 },
	{ z: -0.11, w: 0.032, h: 0.006, b: 0.01, y: -0.022, e: 4 },
	{ z: -0.068, w: 0.045, h: 0.007, b: 0.012, y: -0.0205, e: 5 },
];

/**
 * How low a point `z` kilometres ahead may be and still be seen over the sill:
 * the line from the eye over the sill's front top edge. Anything below it is
 * behind the sill.
 */
export function sillSightline(z: number): number {
	const { size, position } = CANOPY_FRAME.sill;
	const edgeY = position[1] + size[1] / 2;
	const edgeZ = position[2] - size[2] / 2;
	return (edgeY / edgeZ) * z;
}

/**
 * Build the bonnet in `paint` — the flown hull's own `hull` material.
 *
 * `plate: false` leaves the loft's kilometre UVs as they are, which only a test
 * wants.
 */
export function buildBonnet(
	paint: THREE.Material,
	options: { plate?: boolean } = {},
): THREE.Mesh {
	const geometry = hullLoft(BONNET_RINGS);
	if (options.plate ?? true) {
		// Down to life-size kilometres, and then the hull's own division into
		// plates — so the bonnet's plate is the hull's plate under every finish.
		scaleUVs(geometry, 1 / BONNET_LIFE_SCALE, 1 / BONNET_LIFE_SCALE);
		plateUVs(geometry);
	}
	const mesh = new THREE.Mesh(geometry, paint);
	mesh.name = "cockpit-bonnet";
	return mesh;
}
