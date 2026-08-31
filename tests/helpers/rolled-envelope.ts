/**
 * The opening one hull needs at a given roll, metres — **the one place the
 * hull's beam is named as the `across` term.**
 *
 * It lived inside `tests/aperture-fit.test.ts` until #158. That file sizes the
 * aperture from `w·cos θ + h·sin θ` against the opening's *width* with `w` the
 * beam, and `tests/roll-reference.test.ts` checks that the pose check 4 calls a
 * perfect roll puts that same beam along the same axis — two halves of one
 * claim, re-derived separately, which is the shape of the defect #157 found.
 * With both reading this, swapping `size.x` for `size.y` here fails both rather
 * than quietly re-transposing the pair.
 *
 * The worst case is *at* the roll rather than somewhere inside it: both
 * expressions grow monotonically in θ over 0–90° for any positive `w` and `h`.
 */

import * as THREE from "three";
import { HULL_VARIANTS, type HullId, buildShipMesh } from "../../src/ship-mesh";

export function rolledEnvelope(
	id: HullId,
	rollRad: number,
): { across: number; up: number } {
	let across = 0;
	let up = 0;
	for (const variant of HULL_VARIANTS[id]) {
		const root = buildShipMesh(id, variant.id).root;
		root.updateMatrixWorld(true);
		const size = new THREE.Box3()
			.setFromObject(root)
			.getSize(new THREE.Vector3());
		// **`x` is the beam and `y` is the height** — the mesh's own local axes,
		// which `Ship.setAttitude` puts on `cross(nose, up)` and `up`.
		const w = size.x * 1000;
		const h = size.y * 1000;
		across = Math.max(across, w * Math.cos(rollRad) + h * Math.sin(rollRad));
		up = Math.max(up, w * Math.sin(rollRad) + h * Math.cos(rollRad));
	}
	return { across, up };
}
