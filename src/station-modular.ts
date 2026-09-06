/**
 * A station assembled from modules on a grid, solved by wave function
 * collapse — the vocabulary half (#202, on the principal's steer toward
 * seekolous's building generator and the ISS).
 *
 * The ISS is a hub with things docked to it: habitat tubes end to end, a
 * truss spine with radiators and tanks hung off it, a mast. That is a grammar
 * rather than a silhouette, and a grammar is what a collapse solver is for.
 * This module says what the modules *mean* and which may sit beside which,
 * per axis; `wfc.ts` collapses the grid; `station-mesh.ts`'s modular form
 * draws the result in kilometres. No Three.js here, so a plan can be checked
 * headlessly — that every non-empty cell is attached to the hub, that the
 * tables are symmetric, that a seed reproduces its plan.
 *
 * **Identity in the solver's three layers.** The *mask* shapes the field: a
 * diamond about the hub, so nothing lands in a corner where it would carry
 * the outline. The *plants* are the hub and a truss spine along ±Y, which is
 * what makes every plan read as one station rather than as a scatter. The
 * *weights* lean toward tubes and trusses, with leaves — radiators, tanks, a
 * dish — where a host offers a side.
 */

import { BIT, type Plant, type WfcSpec, solvePlan } from "./wfc";

export const EMPTY = 0;
/** The drum the aperture is cut into; planted, never drawn free. */
export const HUB = 1;
/** A junction drum, ports on four sides. */
export const NODE = 2;
/** A habitat tube running along X — docks on ±X, shows a flank to ±Y. */
export const TUBE_X = 3;
export const TUBE_Y = 4;
/** A lattice beam along X or Y. */
export const TRUSS_X = 5;
export const TRUSS_Y = 6;
/** Leaves: a bank of radiator panels, a tank rack, a mast with a dish. */
export const RADIATOR = 7;
export const TANKS = 8;
export const DISH = 9;
export const N_MODULES = 10;

const HOSTS = new Set([HUB, NODE, TUBE_X, TUBE_Y, TRUSS_X, TRUSS_Y]);
const LEAVES = new Set([RADIATOR, TANKS, DISH]);

export const isHost = (m: number) => HOSTS.has(m);
export const isLeaf = (m: number) => LEAVES.has(m);

/**
 * Which pairs may be neighbours **along X** (on each other's ±X sides) and
 * **along Y**, as unordered pairs. Unordered, because a module beside another
 * along an axis is the same fact read from either cell — which is exactly
 * the symmetry the solver's tables must have, and building them from pairs
 * is what makes it impossible to write half of one.
 *
 * The meaning: a tube docks end to end along its own axis and to a node or
 * the hub; a truss runs along its axis and carries leaves on its ends and
 * flanks; a tube's flank may carry a radiator or a tank rack; the hub takes
 * anything that runs into it; leaves may bank up beside each other.
 */
const ALONG_X: readonly (readonly [number, number])[] = [
	[HUB, TUBE_X],
	[HUB, TRUSS_X],
	[HUB, NODE],
	[NODE, TUBE_X],
	[NODE, TRUSS_X],
	[NODE, TANKS],
	[NODE, DISH],
	[TUBE_X, TUBE_X],
	[TUBE_X, TANKS],
	[TUBE_X, DISH],
	[TRUSS_X, TRUSS_X],
	[TRUSS_X, RADIATOR],
	[TRUSS_X, TANKS],
	[TRUSS_X, DISH],
	[TUBE_Y, RADIATOR],
	[TUBE_Y, TANKS],
	[TRUSS_Y, RADIATOR],
	[TRUSS_Y, TANKS],
	[TRUSS_Y, DISH],
	// No leaf beside a leaf: a radiator chained to a radiator has no host to
	// run its spine from, and `tests/wfc.test.ts` found one on the first
	// spread of seeds. A bank is one cell of eight panels.
];

/** The same rules with the axes swapped. */
const SWAPPED: Readonly<Record<number, number>> = {
	[TUBE_X]: TUBE_Y,
	[TUBE_Y]: TUBE_X,
	[TRUSS_X]: TRUSS_Y,
	[TRUSS_Y]: TRUSS_X,
};
const swap = (m: number) => SWAPPED[m] ?? m;
const ALONG_Y = ALONG_X.map(([a, b]) => [swap(a), swap(b)] as const);

/**
 * The four direction tables from the pair rules. `EMPTY` sits beside
 * anything on every side; nothing else is allowed unless a pair says so.
 * `tests/wfc.test.ts` asserts the symmetry this construction guarantees.
 */
export function buildAllowed(): [
	Uint32Array,
	Uint32Array,
	Uint32Array,
	Uint32Array,
] {
	const tables = [0, 1, 2, 3].map(() => new Uint32Array(N_MODULES)) as [
		Uint32Array,
		Uint32Array,
		Uint32Array,
		Uint32Array,
	];
	const allow = (dir: number, a: number, b: number) => {
		tables[dir][a] |= BIT(b);
	};
	for (let m = 0; m < N_MODULES; m++)
		for (let dir = 0; dir < 4; dir++) {
			allow(dir, m, EMPTY);
			allow(dir, EMPTY, m);
		}
	// Directions 0/1 are −X/+X, 2/3 are −Y/+Y (`wfc.ts`'s `DIRECTIONS`).
	for (const [a, b] of ALONG_X) {
		allow(0, a, b);
		allow(1, a, b);
		allow(0, b, a);
		allow(1, b, a);
	}
	for (const [a, b] of ALONG_Y) {
		allow(2, a, b);
		allow(3, a, b);
		allow(2, b, a);
		allow(3, b, a);
	}
	return tables;
}

const WEIGHTS = new Uint32Array(N_MODULES);
WEIGHTS[EMPTY] = 5;
WEIGHTS[NODE] = 2;
WEIGHTS[TUBE_X] = 6;
WEIGHTS[TUBE_Y] = 6;
WEIGHTS[TRUSS_X] = 4;
WEIGHTS[TRUSS_Y] = 4;
WEIGHTS[RADIATOR] = 4;
WEIGHTS[TANKS] = 2;
WEIGHTS[DISH] = 1;

/** How wide the field is, cells. Odd, so the hub is a cell. */
export const MODULAR_GRID = 11;
/** The hub's cell, on both axes. */
export const MODULAR_CENTRE = (MODULAR_GRID - 1) / 2;
/** How far from the hub a cell may be, as |dx| + |dy| — the diamond. */
export const MODULAR_RADIUS = 4;

/** One placed module, in cell coordinates about the hub. */
export interface Placement {
	module: number;
	/** Cells from the hub, +X to the right and +Y up. */
	dx: number;
	dy: number;
	/** Which of the four sides holds a non-empty neighbour, in `DIRECTIONS`
	 *  order (−X, +X, −Y, +Y). A presenter caps a free end and collars a
	 *  docked one from this rather than re-reading the plan. */
	joined: [boolean, boolean, boolean, boolean];
	/** The module on each side, `EMPTY` for none, in the same order. A leaf
	 *  reads its hosts off this: the plan lets a leaf sit **between** two
	 *  hosts, and a leaf strutted to one of them leaves the other adrift —
	 *  seed zero's dish at (2, 0) carried a tube, a node and a tank rack
	 *  behind it that touched nothing, which `tests/station-mesh.test.ts`'s
	 *  island check reads per member since sage measured the gap. */
	beside: [number, number, number, number];
	/** The direction of the nearest host, for a leaf, or −1. A radiator's
	 *  spine runs away from it; every host beside a leaf gets a strut. */
	host: number;
}

/** The solver's spec for the modular station. */
export function modularSpec(): WfcSpec {
	const gw = MODULAR_GRID;
	const c = MODULAR_CENTRE;
	const free =
		BIT(EMPTY) |
		BIT(NODE) |
		BIT(TUBE_X) |
		BIT(TUBE_Y) |
		BIT(TRUSS_X) |
		BIT(TRUSS_Y) |
		BIT(RADIATOR) |
		BIT(TANKS) |
		BIT(DISH);
	const plants: Plant[] = [{ i: c * gw + c, m: HUB }];
	// The spine: a truss along ±Y from the hub to the diamond's tips.
	for (let d = 1; d <= MODULAR_RADIUS; d++) {
		plants.push({ i: (c + d) * gw + c, m: TRUSS_Y });
		plants.push({ i: (c - d) * gw + c, m: TRUSS_Y });
	}
	// And a habitat tube either side of the hub along X, so every plan has
	// somewhere to live as well as somewhere to bolt things.
	plants.push({ i: c * gw + c + 1, m: TUBE_X });
	plants.push({ i: c * gw + c - 1, m: TUBE_X });
	return {
		nModules: N_MODULES,
		allowed: buildAllowed(),
		gw,
		gd: gw,
		freeMask: (i) => {
			const x = i % gw;
			const y = (i / gw) | 0;
			// Outside the diamond, and on the one-cell border, only EMPTY.
			if (x === 0 || y === 0 || x === gw - 1 || y === gw - 1) return BIT(EMPTY);
			if (Math.abs(x - c) + Math.abs(y - c) > MODULAR_RADIUS) return BIT(EMPTY);
			return free;
		},
		plants,
		weights: WEIGHTS,
		isMass: (m) => m !== EMPTY,
		orphanTo: EMPTY,
		fallbackFill: EMPTY,
	};
}

/**
 * Solve a plan and hand back its placements about the hub.
 *
 * Deterministic in the seed, which is the station's own draw: two clients at
 * one seed build one station, and a station keeps its shape across visits.
 */
export function modularPlacements(seed: number): {
	placements: Placement[];
	fallback: boolean;
	attempts: number;
} {
	const spec = modularSpec();
	const { plan, gw, fallback, attempts } = solvePlan(seed, spec);
	const c = MODULAR_CENTRE;
	const at = (x: number, y: number) =>
		x < 0 || y < 0 || x >= gw || y >= gw ? EMPTY : plan[y * gw + x];
	const placements: Placement[] = [];
	for (let y = 0; y < gw; y++)
		for (let x = 0; x < gw; x++) {
			const module = plan[y * gw + x];
			if (module === EMPTY) continue;
			const around = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
			const joined = around.map((m) => m !== EMPTY) as Placement["joined"];
			let host = -1;
			if (isLeaf(module)) host = around.findIndex((m) => isHost(m));
			placements.push({
				module,
				dx: x - c,
				dy: y - c,
				joined,
				beside: around as Placement["beside"],
				host,
			});
		}
	return { placements, fallback, attempts };
}
