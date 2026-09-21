/**
 * A station assembled from modules on a grid, solved by wave function
 * collapse — the vocabulary half (#202, on the principal's steer toward
 * seekolous's building generator and the ISS; generalised in #257 when the
 * refinery and the outpost asked for the same thing).
 *
 * The ISS is a hub with things docked to it: habitat tubes end to end, a
 * truss spine with radiators and tanks hung off it, a mast. That is a grammar
 * rather than a silhouette, and a grammar is what a collapse solver is for.
 * This module says what a **vocabulary** is — which modules exist, which may
 * sit beside which per axis, what is planted and what is weighed — and
 * carries the trade Assembly's; `station-plant.ts` carries the refinery's
 * and the outpost's. `wfc.ts` collapses the grid; `station-mesh.ts` draws the
 * result in kilometres. No Three.js here, so a plan can be checked
 * headlessly — that every non-empty cell is attached to the planted mass,
 * that the tables are symmetric, that a seed reproduces its plan.
 *
 * **Identity in the solver's three layers.** The *mask* shapes the field: a
 * diamond about the centre, so nothing lands in a corner where it would carry
 * the outline. The *plants* are what every plan of a vocabulary shares — a
 * hub and a spine, a head house and an ore line — and are what make every
 * plan read as one station rather than as a scatter. The *weights* lean the
 * rest.
 *
 * **A vocabulary's tables are built from unordered pairs**, one list for
 * neighbours along X and the same list with the axes swapped for Y. A module
 * beside another along an axis is the same fact read from either cell, which
 * is exactly the symmetry the solver's tables must have, and building them
 * from pairs is what makes it impossible to write half of one.
 */

import { BIT, DIRECTIONS, type Plant, type WfcSpec, solvePlan } from "./wfc";

/** Module 0 is empty in every vocabulary: the solver's `orphanTo` and the
 *  fallback fill, and what sits beside anything on every side. */
export const EMPTY = 0;

/** What a station's grammar is, independent of what its modules look like. */
export interface Vocabulary {
	/** Module ids run 0..nModules-1, with 0 `EMPTY`. At most 32. */
	readonly nModules: number;
	/** Modules a leaf may be strutted to; a leaf beside two hosts is
	 *  strutted to both (`Placement.beside`). */
	readonly hosts: ReadonlySet<number>;
	/** Modules that need a host beside them. */
	readonly leaves: ReadonlySet<number>;
	/** Modules the grammar plants and never leaves to the solver. */
	readonly plantedOnly: ReadonlySet<number>;
	/** Which pairs may be neighbours along X, unordered. */
	readonly alongX: readonly (readonly [number, number])[];
	/** A module's counterpart with the axes swapped: `alongX` under `swap`
	 *  is the rule along Y. Identity for anything without an axis. */
	readonly swap: (m: number) => number;
	/** Integer weight per module (identity layer 3). */
	readonly weights: Uint32Array;
	/** How wide the field is, cells. Odd, so the centre is a cell. */
	readonly grid: number;
	/** How far from the centre a cell may be, as |dx| + |dy| — the diamond. */
	readonly radius: number;
	/** The cells the grammar decides, in cell coordinates about the centre. */
	readonly plants: readonly { dx: number; dy: number; m: number }[];
	/** Modules a cell may not take beyond the field's own mask, by cell
	 *  coordinates — the outpost keeps its tower out from under the pad. */
	readonly barred?: (dx: number, dy: number) => number;
}

/** The centre cell of a vocabulary's grid, on both axes. */
export const centreOf = (vocabulary: Vocabulary) => (vocabulary.grid - 1) / 2;

/**
 * The four direction tables from a vocabulary's pair rules. `EMPTY` sits
 * beside anything on every side; nothing else is allowed unless a pair says
 * so. `tests/wfc.test.ts` asserts the symmetry this construction guarantees.
 */
export function allowedOf(
	vocabulary: Vocabulary,
): [Uint32Array, Uint32Array, Uint32Array, Uint32Array] {
	const n = vocabulary.nModules;
	const tables = [0, 1, 2, 3].map(() => new Uint32Array(n)) as [
		Uint32Array,
		Uint32Array,
		Uint32Array,
		Uint32Array,
	];
	const allow = (dir: number, a: number, b: number) => {
		tables[dir][a] |= BIT(b);
	};
	for (let m = 0; m < n; m++)
		for (let dir = 0; dir < 4; dir++) {
			allow(dir, m, EMPTY);
			allow(dir, EMPTY, m);
		}
	// Directions 0/1 are −X/+X, 2/3 are −Y/+Y (`wfc.ts`'s `DIRECTIONS`).
	for (const [a, b] of vocabulary.alongX) {
		allow(0, a, b);
		allow(1, a, b);
		allow(0, b, a);
		allow(1, b, a);
	}
	for (const [x, y] of vocabulary.alongX) {
		const a = vocabulary.swap(x);
		const b = vocabulary.swap(y);
		allow(2, a, b);
		allow(3, a, b);
		allow(2, b, a);
		allow(3, b, a);
	}
	return tables;
}

/** The solver's spec for a vocabulary. */
export function specOf(vocabulary: Vocabulary): WfcSpec {
	const gw = vocabulary.grid;
	const c = centreOf(vocabulary);
	let free = 0;
	for (let m = 0; m < vocabulary.nModules; m++)
		if (!vocabulary.plantedOnly.has(m)) free |= BIT(m);
	const plants: Plant[] = vocabulary.plants.map(({ dx, dy, m }) => ({
		i: (c + dy) * gw + (c + dx),
		m,
	}));
	return {
		nModules: vocabulary.nModules,
		allowed: allowedOf(vocabulary),
		gw,
		gd: gw,
		freeMask: (i) => {
			const x = i % gw;
			const y = (i / gw) | 0;
			// Outside the diamond, and on the one-cell border, only EMPTY.
			if (x === 0 || y === 0 || x === gw - 1 || y === gw - 1) return BIT(EMPTY);
			if (Math.abs(x - c) + Math.abs(y - c) > vocabulary.radius)
				return BIT(EMPTY);
			const barred = vocabulary.barred?.(x - c, y - c) ?? 0;
			return (free & ~barred) >>> 0;
		},
		plants,
		weights: vocabulary.weights,
		isMass: (m) => m !== EMPTY,
		orphanTo: EMPTY,
		fallbackFill: EMPTY,
	};
}

/** One placed module, in cell coordinates about the centre. */
export interface Placement {
	module: number;
	/** Cells from the centre, +X to the right and +Y up. */
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

/**
 * Solve a vocabulary's plan and hand back its placements about the centre.
 *
 * Deterministic in the seed, which is the station's own assembly draw
 * (`DOMAIN.STATION_ASSEMBLY`): two clients at one seed build one station,
 * and a station keeps its shape across visits.
 */
export function placementsOf(
	vocabulary: Vocabulary,
	seed: number,
): {
	placements: Placement[];
	fallback: boolean;
	attempts: number;
} {
	const spec = specOf(vocabulary);
	const { plan, gw, fallback, attempts } = solvePlan(seed, spec);
	const c = centreOf(vocabulary);
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
			if (vocabulary.leaves.has(module))
				host = around.findIndex((m) => vocabulary.hosts.has(m));
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

/** The unit step of a `DIRECTIONS` index, for a presenter. */
export const stepOf = (dir: number): readonly [number, number] =>
	DIRECTIONS[dir];

/**
 * The `DIRECTIONS` index a leaf faces its host along: its nearest host, or
 * +X for a module that has none, so a presenter never indexes with −1. One
 * place rather than one per builder, since sage found it in two.
 */
export const hostDirOf = (p: Placement): number => (p.host < 0 ? 1 : p.host);

// ---------------------------------------------------------------------------
// Trade D — Assembly.

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

/**
 * The trade Assembly's vocabulary. The plants are the hub, a truss spine
 * along ±Y to the diamond's tips, and a habitat tube either side of the hub
 * along X, so every plan has somewhere to live as well as somewhere to bolt
 * things.
 */
export const TRADE_VOCABULARY: Vocabulary = {
	nModules: N_MODULES,
	hosts: HOSTS,
	leaves: LEAVES,
	plantedOnly: new Set([HUB]),
	alongX: ALONG_X,
	swap,
	weights: WEIGHTS,
	grid: MODULAR_GRID,
	radius: MODULAR_RADIUS,
	plants: [
		{ dx: 0, dy: 0, m: HUB },
		...Array.from({ length: MODULAR_RADIUS }, (_, i) => i + 1).flatMap((d) => [
			{ dx: 0, dy: d, m: TRUSS_Y },
			{ dx: 0, dy: -d, m: TRUSS_Y },
		]),
		{ dx: 1, dy: 0, m: TUBE_X },
		{ dx: -1, dy: 0, m: TUBE_X },
	],
};

/** The trade Assembly's direction tables. */
export const buildAllowed = () => allowedOf(TRADE_VOCABULARY);

/** The solver's spec for the trade Assembly. */
export const modularSpec = () => specOf(TRADE_VOCABULARY);

/** The trade Assembly's placements at a seed. */
export const modularPlacements = (seed: number) =>
	placementsOf(TRADE_VOCABULARY, seed);
