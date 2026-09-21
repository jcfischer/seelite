/**
 * The opening one hull needs at a given roll, metres — **the one place the
 * hull's beam is named as the `across` term.**
 *
 * It lived inside `tests/aperture-fit.test.ts` until #158. That file sizes the
 * aperture from `w·cos θ + h·sin θ` against the opening's *width* with `w` the
 * beam, and `tests/roll-reference.test.ts` checks that the pose check 4 calls a
 * perfect roll puts that same beam along the same axis — two halves of one
 * claim, and re-deriving them separately is the shape of the defect #157 found.
 *
 * **Swapping `size.x` for `size.y` here fails `roll-reference` and not
 * `aperture-fit`.** Measured, not assumed: the fit test only needs every hull to
 * clear the opening, and a transposed courier clears 120 x 70 as readily as the
 * right way round — which is #157's finding exactly. The pose row is the only
 * side of this seam that can hold it, and this file is what makes the two one
 * seam rather than two derivations.
 *
 * The worst case is *at* the roll rather than somewhere inside it: both
 * expressions grow monotonically in θ over 0–90° for any positive `w` and `h`.
 */

import * as THREE from "three";
import type { HullId } from "../../src/hull";
import { buildShipMesh, HULL_VARIANTS } from "../../src/ship-mesh";

export function rolledEnvelope(
	id: HullId,
	rollRad: number,
	/** One variant, or every variant of the hull. **The max is taken per term**,
	 *  so the widest and the tallest variant need not be the same one and
	 *  `max(w·cos + h·sin)` is not `max(w)·cos + max(h)·sin` — a caller doing
	 *  that arithmetic itself has to name a variant. */
	variantId?: string,
): { across: number; up: number } {
	let across = 0;
	let up = 0;
	const variants = variantId
		? HULL_VARIANTS[id].filter((v) => v.id === variantId)
		: HULL_VARIANTS[id];
	if (variants.length === 0) throw new Error(`no variant ${id}/${variantId}`);
	for (const variant of variants) {
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
