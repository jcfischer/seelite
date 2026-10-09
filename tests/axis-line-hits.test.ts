/**
 * Node #812: the grid answers the courier's lines as three's raycast does.
 *
 * `axisLineTester` (`scripts/lib/axis-line-hits.ts`) exists because the
 * authored courier is too heavy for the plain raycast, so the courier is the
 * hull its exactness has to be shown on. `tests/vent-placement.test.ts` can
 * only show it on the procedural hulls, whose stored placements were measured
 * through three; the courier's was measured through the grid. Here the same
 * lines go through both, on the model `buildShipMesh` returns.
 */

import { expect, test } from "bun:test";
import * as THREE from "three";
import { axisLineTester } from "../scripts/lib/axis-line-hits";
import { HULL_SPECS } from "../src/hull";
import { isLevelStandIn } from "../src/ship-detail";
import { buildShipMesh } from "../src/ship-mesh";

/** Lines per side of each axis's sample: a lattice across the box. */
const SIDE = 9;

test("every sampled line along each axis meets the courier's model exactly when three's raycast does", () => {
	const root = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
	root.updateMatrixWorld(true);
	// The metal `measure-vent-placement.ts` asks about: no glows, no levels.
	const metal: THREE.Mesh[] = [];
	root.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (
			mesh.isMesh &&
			!(mesh as THREE.InstancedMesh).isInstancedMesh &&
			!mesh.name.endsWith("-exhaust") &&
			!isLevelStandIn(mesh)
		)
			metal.push(mesh);
	});
	const meets = axisLineTester(metal);
	const box = new THREE.Box3().setFromObject(root);
	const size = box.getSize(new THREE.Vector3());
	const reach = size.length();
	const caster = new THREE.Raycaster();
	let hits = 0;
	let misses = 0;
	const disagree: string[] = [];
	for (const axis of [0, 1, 2] as const) {
		const [u, v] = [0, 1, 2].filter((k) => k !== axis);
		for (const sign of [1, -1]) {
			const direction = new THREE.Vector3().setComponent(axis, sign);
			for (let i = 0; i < SIDE; i++)
				for (let j = 0; j < SIDE; j++) {
					// Cell centres, slightly past the box so some lines miss.
					const origin = box.getCenter(new THREE.Vector3());
					origin.setComponent(
						u,
						box.min.getComponent(u) + ((i + 0.5) / SIDE) * size.getComponent(u),
					);
					origin.setComponent(
						v,
						box.min.getComponent(v) + ((j + 0.5) / SIDE) * size.getComponent(v),
					);
					origin.addScaledVector(direction, -2 * reach);
					caster.set(origin, direction);
					caster.near = 0;
					caster.far = 4 * reach;
					const three = caster.intersectObjects(metal, false).length > 0;
					const grid = meets(origin, direction, 0, 4 * reach);
					if (three) hits++;
					else misses++;
					if (three !== grid)
						disagree.push(`axis ${axis} sign ${sign} cell ${i},${j}`);
				}
		}
	}
	expect(disagree).toEqual([]);
	// Both answers occur, so agreement is not two testers saying the same
	// constant.
	expect(hits).toBeGreaterThan(0);
	expect(misses).toBeGreaterThan(0);
}, 60_000);
