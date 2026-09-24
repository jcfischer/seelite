import type { StationType } from "../../src/station";
import type { StationFormId } from "../../src/station-mesh";

/**
 * The forms whose shape is a plan solved from the assembly seed (#202, #257),
 * and a spread of seeds to build each at. Every row that builds at seed zero
 * measures one plan of a form whose whole point is that plans differ; rows
 * that read these measure the spread.
 */
export const SOLVED_FORMS: readonly [StationType, StationFormId][] = [
	["trade", "d"],
	["refinery", "d"],
	["outpost", "d"],
	["outpost", "e"],
];

/** The full spread, for the cheap rows. */
export const ASSEMBLY_SEEDS = [
	0, 1, 2, 3, 17, 42, 1000, 65535, 7, 8, 12345, 99999,
];

/** A shorter spread, for the rows that cast rays over a whole station. */
export const PLAN_SEEDS = [0, 1, 2, 3, 17, 42];

export const isSolvedForm = (type: StationType, id: StationFormId) =>
	SOLVED_FORMS.some(([t, f]) => t === type && f === id);
