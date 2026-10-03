/**
 * The refinery's and the outpost's vocabularies (#257), on the core
 * `station-modular.ts` grew for them.
 *
 * The principal's steer on the first finish sheet (2026-09-06): *"the
 * refineries could probably also benefit from the wave function collapse —
 * and the outposts too."* A refinery is the role that most wants it — a
 * plant is a grid of towers, crackers, tank farms and pipe racks by nature —
 * and an outpost the role that most needs a small vocabulary to read as one
 * thing. Each is a grammar here and a drawing in `station-mesh.ts`; nothing
 * about what a module looks like lives in this file.
 *
 * **Both pads stay at the aperture plane on the axis** (`docking.md` §13,
 * #165): the head house and the core can are planted at the centre cell and
 * are what carry the deck. The field is the XY plane, so every other module
 * is off the axis by at least a cell, and the corridor row is a question
 * about what rises past the plane inside a cell of the axis rather than
 * about the plan.
 */

import { EMPTY, type Vocabulary } from "./station-modular";

// ---------------------------------------------------------------------------
// Refinery D — Works.

/**
 * The refinery's modules. Every unit is a solid symmetric about the plane of
 * the plan, and every joined pair of cells is piped centre to centre; that
 * web is what makes a plan one object. (A first pass stood every unit on a
 * plated deck tile, and the sheet rejected it as an opaque wall — see
 * `buildRefineryWorks`.)
 */
export const REFINERY = {
	/** The head house, planted at the centre: the block the pad sits on. */
	HEAD: 1,
	/** A pipe rack running along X — a run of pipes on saddles, joining what
	 *  it runs between; its flank may carry a leaf. */
	PIPE_X: 2,
	PIPE_Y: 3,
	/** A distillation column: a tall drum with platforms round it. */
	COLUMN: 4,
	/** A cracker: a squat block with two short stacks. */
	CRACKER: 5,
	/** The mine head, planted at the −Y tip: a headframe over the shaft into
	 *  the rock the plant stands on, fed to the head house down the pipe
	 *  line. The rock is the ore; a stockpile beside it was the first pass,
	 *  and the principal read it as a pebble with a plant round it. */
	SHAFT: 6,
	/** Leaves: a tank farm, a flare stack, a radiator bank. */
	TANKS: 7,
	FLARE: 8,
	RADIATOR: 9,
	N: 10,
} as const;

const R = REFINERY;

/**
 * Along X. A pipe rack joins units end to end along its own axis and to the
 * head house or the ore line; a crossing rack shows a flank a leaf may hang
 * off; columns and crackers stand beside each other and beside anything
 * that pipes to them. No leaf beside a leaf, for the Assembly's reason.
 */
const REFINERY_ALONG_X: readonly (readonly [number, number])[] = [
	[R.HEAD, R.PIPE_X],
	[R.HEAD, R.COLUMN],
	[R.HEAD, R.CRACKER],
	[R.HEAD, R.TANKS],
	[R.HEAD, R.RADIATOR],
	[R.PIPE_X, R.PIPE_X],
	[R.PIPE_X, R.COLUMN],
	[R.PIPE_X, R.CRACKER],
	[R.PIPE_X, R.TANKS],
	[R.PIPE_X, R.SHAFT],
	[R.PIPE_Y, R.COLUMN],
	[R.PIPE_Y, R.CRACKER],
	[R.PIPE_Y, R.TANKS],
	[R.PIPE_Y, R.FLARE],
	[R.PIPE_Y, R.RADIATOR],
	[R.COLUMN, R.COLUMN],
	[R.COLUMN, R.CRACKER],
	[R.COLUMN, R.TANKS],
	[R.COLUMN, R.FLARE],
	[R.COLUMN, R.RADIATOR],
	[R.CRACKER, R.CRACKER],
	[R.CRACKER, R.TANKS],
	[R.CRACKER, R.FLARE],
	[R.CRACKER, R.RADIATOR],
	[R.SHAFT, R.CRACKER],
];

const refinerySwap = (m: number) =>
	m === R.PIPE_X ? R.PIPE_Y : m === R.PIPE_Y ? R.PIPE_X : m;

const REFINERY_WEIGHTS = new Uint32Array(R.N);
// **Two, not six.** On the eleven-cell field the plant sprawled and empty
// was the brake; on the quarried floor the field is thirteen cells and the
// same weight left seed zero with five units on it, which reads as a
// derelict rather than as a works.
REFINERY_WEIGHTS[EMPTY] = 2;
REFINERY_WEIGHTS[R.PIPE_X] = 4;
REFINERY_WEIGHTS[R.PIPE_Y] = 4;
REFINERY_WEIGHTS[R.COLUMN] = 5;
REFINERY_WEIGHTS[R.CRACKER] = 4;
REFINERY_WEIGHTS[R.TANKS] = 4;
REFINERY_WEIGHTS[R.FLARE] = 1;
REFINERY_WEIGHTS[R.RADIATOR] = 3;

/** The refinery's field: a thirteen-cell diamond, which is what fits on the
 *  quarried face of a rock the pool's reach admits. */
export const REFINERY_GRID = 7;
export const REFINERY_RADIUS = 2;

/**
 * Where the Works' plan stands, kilometres: the cell pitch, and the floor the
 * rock's +Z face is quarried to, which every cell's centre stands on. Here
 * rather than in the builder because two modules read them — the drawing
 * (`buildRefineryWorks`) and the collision proxy (`station-proxy.ts`), which
 * follows the same plan cell by cell and must not hold a second copy of where
 * a cell is. Why the floor is high on the rock is the builder's to say.
 */
export const WORKS_CELL_KM = 0.16;
export const WORKS_FLOOR_KM = 0.16;

/**
 * The plants: the head house at the centre, a pipe line running from it to
 * the −Y tip and the mine head at the end of it. The line is what gives
 * every plan a direction — a plant has an intake — and the rest is the
 * solver's.
 */
export const REFINERY_VOCABULARY: Vocabulary = {
	nModules: R.N,
	hosts: new Set([R.HEAD, R.PIPE_X, R.PIPE_Y, R.COLUMN, R.CRACKER, R.SHAFT]),
	leaves: new Set([R.TANKS, R.FLARE, R.RADIATOR]),
	plantedOnly: new Set([R.HEAD, R.SHAFT]),
	alongX: REFINERY_ALONG_X,
	swap: refinerySwap,
	weights: REFINERY_WEIGHTS,
	grid: REFINERY_GRID,
	radius: REFINERY_RADIUS,
	plants: [
		{ dx: 0, dy: 0, m: R.HEAD },
		...Array.from({ length: REFINERY_RADIUS - 1 }, (_, i) => ({
			dx: 0,
			dy: -(i + 1),
			m: R.PIPE_Y,
		})),
		{ dx: 0, dy: -REFINERY_RADIUS, m: R.SHAFT },
		// One flare stack in every plan, beside the ore line: a plant that vents
		// nothing is a warehouse, and the role's flicker (`station-visuals.md`
		// §5) needs a vent to breathe through.
		{ dx: 1, dy: -1, m: R.FLARE },
		// One radiator in every plan, off the head house's −X−Y corner. Two reasons
		// and both bind: a plant in vacuum sheds its heat by radiating and by
		// nothing else, and the built form hangs a wing on the rock's flank per
		// radiator cell (`buildRefineryWorks`) — so a plan without one has no
		// outline from behind, and the form's declared reach would be slack by
		// a third on the plans that happen to solve without a wing.
		{ dx: -1, dy: -1, m: R.RADIATOR },
	],
	/**
	 * **The first ring is the pad's apron, and only a pipe gallery fits under
	 * it.** The landing pad is 0.44 km across — the sim's berth catalogue sizes
	 * it and the form cannot shrink it — against a 0.32 km cell pitch, so the
	 * deck overhangs every cell adjacent to the head house. A column solved
	 * into one of them and rose straight through the pad;
	 * `probe-station-visuals.mjs` read the aperture as unlit, because what it
	 * could see of the pad was a drum standing in it. A pipe rack is a valve
	 * block and three lanes at deck level, which is where a pipe gallery
	 * belongs anyway.
	 */
	barred: (dx, dy) =>
		Math.abs(dx) + Math.abs(dy) <= 1
			? (1 << R.COLUMN) |
				(1 << R.CRACKER) |
				(1 << R.TANKS) |
				(1 << R.FLARE) |
				(1 << R.RADIATOR)
			: 0,
};

// ---------------------------------------------------------------------------
// Outpost D — Cluster.

/**
 * The outpost's modules: the Assembly's grammar at a fifth of the size,
 * with the pad on the core can's +Z face instead of a slot in a hub.
 */
export const OUTPOST = {
	/** The core can, planted at the centre: the pad deck stands on it. */
	CORE: 1,
	/** A habitat can along X — docks on ±X, shows a flank to ±Y. */
	CAN_X: 2,
	CAN_Y: 3,
	/** A lattice beam along X or Y. */
	TRUSS_X: 4,
	TRUSS_Y: 5,
	/** Leaves: a tank rack, a mast with a dish, a bank of radiator fins. */
	TANKS: 6,
	TOWER: 7,
	FINS: 8,
	N: 9,
} as const;

const O = OUTPOST;

const OUTPOST_ALONG_X: readonly (readonly [number, number])[] = [
	[O.CORE, O.CAN_X],
	[O.CORE, O.TRUSS_X],
	[O.CAN_X, O.CAN_X],
	[O.CAN_X, O.TRUSS_X],
	[O.CAN_X, O.TANKS],
	[O.CAN_X, O.TOWER],
	[O.TRUSS_X, O.TRUSS_X],
	[O.TRUSS_X, O.TANKS],
	[O.TRUSS_X, O.TOWER],
	[O.TRUSS_X, O.FINS],
	[O.CAN_Y, O.FINS],
	[O.CAN_Y, O.TANKS],
	[O.TRUSS_Y, O.FINS],
	[O.TRUSS_Y, O.TANKS],
	[O.TRUSS_Y, O.TOWER],
];

const outpostSwap = (m: number) =>
	m === O.CAN_X
		? O.CAN_Y
		: m === O.CAN_Y
			? O.CAN_X
			: m === O.TRUSS_X
				? O.TRUSS_Y
				: m === O.TRUSS_Y
					? O.TRUSS_X
					: m;

const OUTPOST_WEIGHTS = new Uint32Array(O.N);
OUTPOST_WEIGHTS[EMPTY] = 5;
OUTPOST_WEIGHTS[O.CAN_X] = 5;
OUTPOST_WEIGHTS[O.CAN_Y] = 5;
OUTPOST_WEIGHTS[O.TRUSS_X] = 3;
OUTPOST_WEIGHTS[O.TRUSS_Y] = 3;
OUTPOST_WEIGHTS[O.TANKS] = 3;
OUTPOST_WEIGHTS[O.TOWER] = 1;
OUTPOST_WEIGHTS[O.FINS] = 4;

/** The outpost's field: a smaller diamond, seven cells across. */
export const OUTPOST_GRID = 9;
export const OUTPOST_RADIUS = 3;

/**
 * The plants: the core can, a truss spine along ±Y to the tips, and a can
 * either side along X — the Assembly's, so every plan has a beam and
 * somewhere to live. The tower is barred from the first ring, where the pad
 * deck overhangs the cell and a mast would stand up into its underside.
 */
export const OUTPOST_VOCABULARY: Vocabulary = {
	nModules: O.N,
	hosts: new Set([O.CORE, O.CAN_X, O.CAN_Y, O.TRUSS_X, O.TRUSS_Y]),
	leaves: new Set([O.TANKS, O.TOWER, O.FINS]),
	plantedOnly: new Set([O.CORE]),
	alongX: OUTPOST_ALONG_X,
	swap: outpostSwap,
	weights: OUTPOST_WEIGHTS,
	grid: OUTPOST_GRID,
	radius: OUTPOST_RADIUS,
	plants: [
		{ dx: 0, dy: 0, m: O.CORE },
		...Array.from({ length: OUTPOST_RADIUS }, (_, i) => i + 1).flatMap((d) => [
			{ dx: 0, dy: d, m: O.TRUSS_Y },
			{ dx: 0, dy: -d, m: O.TRUSS_Y },
		]),
		{ dx: 1, dy: 0, m: O.CAN_X },
		{ dx: -1, dy: 0, m: O.CAN_X },
	],
	barred: (dx, dy) => (Math.abs(dx) + Math.abs(dy) <= 1 ? 1 << O.TOWER : 0),
};

// ---------------------------------------------------------------------------
// Outpost E — Salvage (#518).

/**
 * The salvage's core, kilometres: the freighter section every plan grows
 * from, standing on the axis under the deck. Here rather than in the builder
 * because the core is the one part every plan shares, so it is what the
 * form's macro fixtures (`station-fixtures.ts`) are mounted on — and a second
 * copy of these figures there would leave the fixtures floating or buried
 * the day the core is resized.
 */
export const SALVAGE_CORE = Object.freeze({
	/** Half-width across ±X, and the face the wider sockets are on. */
	halfWidthKm: 0.055,
	/** Half-height across ±Y. */
	halfHeightKm: 0.045,
	/** Its foot, the far end from the deck. */
	bottomKm: -0.16,
});
