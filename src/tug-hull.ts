/**
 * The authored tug exterior (node #814): the Bollard O4 salvage tug the
 * principal approved on #798 (visual commit `26d6958`), drawn as the tug's
 * selected variant in place of the procedural loft, which stands in until it
 * installs. Built by `authored-hull.ts`, the courier's way.
 *
 * **Drawn at 1:1** (principal's ruling on node #814): the study is metres and
 * the tug row's envelope is the model's own box, rounded up to 0.1 m, so
 * `HULL_SPECS.tug.env` carries what the mesh measures and `tests/hull.test.ts`
 * holds the two together. The courier is scaled to its roster length instead,
 * because every hull's turn rate is solved against the courier's; the tug's
 * length is no other hull's reference.
 *
 * The study has no cabin interior and no fixture screens, so every mesh casts
 * a shadow and every mesh is in the reduced levels.
 */
import * as THREE from "three";
import { authoredHullLoader, createAuthoredHullBuilder } from "./authored-hull";
import { BOLLARD_TUG_GLB_URL } from "./model-urls";
import type { AuthoredHullBuilder } from "./ship-mesh";

/** The frame every authored tug's levels and glows hang under. */
export const TUG_FRAME_NAME = "tug-hull-frame";

/** The three levels' object names under `TUG_FRAME_NAME`. */
export const TUG_LEVEL_NAMES = {
	full: "tug-hull-model",
	reduced: "tug-hull-reduced",
	outline: "tug-hull-outline",
} as const;

/** One study metre in kilometres: the model is drawn at its own size. */
export const TUG_KM_PER_M = 0.001;

/**
 * The two drive mouths, study metres: each barrel engine is centred at
 * x ±17.7, y 0 (`build_model.py`). **Measured off the shipped model, not read
 * off the source**: the barrel's end cap at z −26.0 closes the mouth, so the
 * plate and ochre ring the source places at −25.6 are behind it, and sixteen
 * alloy rods line the wall. The mouth's clear radius, 3 cm off the nearest
 * triangle, is 3.22–3.37 m from z −26.2 to −27.2, 3.10 m at −27.4 and 2.97 m
 * at the lip; the glow's plate sits 10 cm aft of the cap and its radii stay
 * inside those. `tests/tug-hull.test.ts` measures the clearance.
 */
export const TUG_NOZZLES_M = {
	x: 17.7,
	y: 0,
	throatZ: -26.1,
	lipZ: -27.45,
	throatRadius: 3.15,
	lipRadius: 3.0,
} as const;

/** Prepare a loaded study scene once and return the builder `buildShipMesh`
 *  calls for every tug (`createAuthoredHullBuilder`). */
export function createTugHullBuilder(
	template: THREE.Object3D,
): Promise<AuthoredHullBuilder> {
	return createAuthoredHullBuilder(template, {
		hull: "tug",
		frameName: TUG_FRAME_NAME,
		levelNames: TUG_LEVEL_NAMES,
		kmPerM: () => TUG_KM_PER_M,
		nozzles: TUG_NOZZLES_M,
	});
}

/** Games start this after construction, once the courier's has settled, and
 *  refresh their cached tugs on resolution (`loadAuthoredHullsAfterBoot`).
 *  The postcard viewer and the ship workbench wait before drawing
 *  (`authoredHullLoader`). */
export const prepareTugHullModel = authoredHullLoader(
	"tug",
	BOLLARD_TUG_GLB_URL,
	createTugHullBuilder,
);
