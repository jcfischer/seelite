/**
 * Node #812: the grid answers the courier's lines as three's raycast does.
 *
 * `axisLineTester` (`scripts/lib/axis-line-hits.ts`) exists because the
 * authored courier is too heavy for the plain raycast, so the courier is the
 * hull its exactness has to be shown on. `tests/vent-placement.test.ts` can
 * only show it on the procedural hulls, whose stored placements were measured
 * through three; the courier's was measured through the grid. Here the same
 * lines go through both, on the model `buildShipMesh` returns: a lattice of
 * cell centres across the hull's box along each of the six axis directions,
 * and then lines stepped across every gap where three's answer flips between
 * two neighbours, because the edge of the metal is where a grid that skipped
 * a triangle would disagree.
 */

import { expect, test } from "bun:test";
import * as THREE from "three";
import { axisLineTester, hullMetal } from "../scripts/lib/axis-line-hits";
import { HULL_SPECS } from "../src/hull";
import { buildShipMesh } from "../src/ship-mesh";

/** Lattice cells per side of each axis's sample. */
const SIDE = 9;
/** Lines stepped across a gap whose two ends three answers differently. */
const EDGE_STEPS = 3;

test("the courier's lattice lines and its metal edges meet the model exactly when three's raycast does", () => {
	const root = buildShipMesh("courier", HULL_SPECS.courier.variant).root;
	root.updateMatrixWorld(true);
	// The metal `measure-vent-placement.ts` asks about: no glows, no levels.
	const metal = hullMetal(root);
	const meets = axisLineTester(metal);
	const box = new THREE.Box3().setFromObject(root);
	const size = box.getSize(new THREE.Vector3());
	const reach = size.length();
	const caster = new THREE.Raycaster();
	let hits = 0;
	let misses = 0;
	let edgeLines = 0;
	const disagree: string[] = [];
	for (const axis of [0, 1, 2] as const) {
		const [u, v] = [0, 1, 2].filter((k) => k !== axis);
		for (const sign of [1, -1]) {
			const direction = new THREE.Vector3().setComponent(axis, sign);
			// The line through lattice coordinate (i, j), fractional between
			// cell centres; three's answer, after checking the grid agrees.
			const line = (i: number, j: number, label: string): boolean => {
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
				if (three !== grid)
					disagree.push(`axis ${axis} sign ${sign} ${label} ${i},${j}`);
				return three;
			};
			const lattice: boolean[][] = [];
			for (let i = 0; i < SIDE; i++) {
				lattice.push([]);
				for (let j = 0; j < SIDE; j++) {
					const three = line(i, j, "cell");
					lattice[i].push(three);
					if (three) hits++;
					else misses++;
				}
			}
			for (let i = 0; i < SIDE; i++)
				for (let j = 0; j < SIDE; j++)
					for (const [di, dj] of [
						[1, 0],
						[0, 1],
					] as const) {
						if (i + di >= SIDE || j + dj >= SIDE) continue;
						if (lattice[i][j] === lattice[i + di][j + dj]) continue;
						for (let k = 1; k <= EDGE_STEPS; k++) {
							const t = k / (EDGE_STEPS + 1);
							line(i + di * t, j + dj * t, "edge");
							edgeLines++;
						}
					}
		}
	}
	expect(disagree).toEqual([]);
	// Both answers occur on the lattice, so agreement is not two testers
	// saying the same constant, and the edges were reached.
	expect(hits).toBeGreaterThan(0);
	expect(misses).toBeGreaterThan(0);
	expect(edgeLines).toBeGreaterThan(0);
	console.log(
		`courier: ${hits + misses} lattice lines (${hits} hit, ${misses} miss), ${edgeLines} edge lines, ${disagree.length} disagree`,
	);
}, 90_000);
