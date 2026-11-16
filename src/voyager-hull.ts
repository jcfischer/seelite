/**
 * The authored voyager exterior (node #820): Discovery / Voyager A, the study
 * the principal accepted on #809 (2026-10-09), drawn as the voyager's selected
 * variant in place of the procedural Odyssey loft, which stands in until it
 * installs. Built by `authored-hull.ts`, the courier's and the tug's way.
 *
 * The study (`spikes/discovery/`) has its nose on +X; `prepare-flight-asset.mjs`
 * turns it onto +Z, the frame every authored hull is in, and the install then
 * turns it a half-turn about Y (`buildShipMesh`'s nose is −Z).
 *
 * **The scale is the voyager's roster length and nothing else.** The study is
 * 141.6 m end to end and says in its own handoff that its bounds are
 * "visual-study metres, not gameplay dimensions". The roster's 191 m is the
 * film's proportion, ratified with the hull (#331), and every figure in the row
 * was written against it: drawn 1:1 the box would be a third of the volume the
 * 380 t was set for (4.1 t per 1,000 m³, against a 1.2–2.4 band), which would
 * move the mass, the thrust, the integrity and the shields with it. Scaled to
 * the declared length (×1.35) the length, the mass and the thrust stand, and
 * only what the mesh measures is new: the beam and height, which
 * `HULL_SPECS.voyager.env` carries (`tests/hull.test.ts` holds every declared
 * box to its built one). The length is also what refuses the hull every berth
 * (`BERTH_CELL`, 90 m), so no scale above ×0.64 of the study's own size changes that.
 *
 * The study has no cabin interior and no fixture screens, so every mesh casts
 * a shadow and every mesh is in the reduced levels.
 */
import * as THREE from "three";
import { authoredHullLoader, createAuthoredHullBuilder } from "./authored-hull";
import { HULL_SPECS } from "./hull";
import { DISCOVERY_VOYAGER_GLB_URL } from "./model-urls";
import type { AuthoredHullBuilder } from "./ship-mesh";

/** The frame every authored voyager's levels and glows hang under. */
export const VOYAGER_FRAME_NAME = "voyager-hull-frame";

/** The three levels' object names under `VOYAGER_FRAME_NAME`. */
export const VOYAGER_LEVEL_NAMES = {
	full: "voyager-hull-model",
	reduced: "voyager-hull-reduced",
	outline: "voyager-hull-outline",
} as const;

/**
 * How far inside the declared length the model is drawn, so that its measured
 * length rounds up to the declared one rather than past it (the courier's
 * reason: a box read at 0.1 m cannot be exactly equal to a float length).
 */
export const VOYAGER_LENGTH_INSET_KM = 0.00005;

/**
 * The three drive bells, study metres (nose +Z after the prepare step's turn,
 * so aft is −Z): two above the axis and one below, in the reactor block's aft
 * face (`build_model.py`'s "three hollow engine bells", then its
 * `proportions` warp, which stretches the aft block and scales y by 0.9).
 * **Measured off the shipped model, not read off the source** — the warp
 * moves every figure the script states. The recess ring that closes each
 * throat stands at z −73.75 (clear radius 0.99–1.10 m); behind the glow
 * the flared wall runs from z −74.5 (1.25 m clear in y) to the lip at −79.06
 * (1.76 m). The glow's radii stay 6–7 cm inside those, and
 * `tests/voyager-hull.test.ts` measures every glow against every triangle.
 */
export const VOYAGER_NOZZLES_M = {
	x: 3.2,
	y: 2.79,
	mounts: [
		{ side: "port", x: 3.2, y: 2.79 },
		{ side: "starboard", x: -3.2, y: 2.79 },
		{ side: "keel", x: 0, y: -2.88 },
	],
	throatZ: -73.8,
	lipZ: -78.9,
	throatRadius: 0.9,
	lipRadius: 1.7,
} as const;

/** Prepare a loaded study scene once and return the builder `buildShipMesh`
 *  calls for every voyager (`createAuthoredHullBuilder`). */
export function createVoyagerHullBuilder(
	template: THREE.Object3D,
): Promise<AuthoredHullBuilder> {
	return createAuthoredHullBuilder(template, {
		hull: "voyager",
		frameName: VOYAGER_FRAME_NAME,
		levelNames: VOYAGER_LEVEL_NAMES,
		kmPerM: (box) =>
			(HULL_SPECS.voyager.env.lengthKm - VOYAGER_LENGTH_INSET_KM) /
			(box.max.z - box.min.z),
		nozzles: VOYAGER_NOZZLES_M,
	});
}

/** The model queue starts this when a voyager is drawn or owed, and the
 *  postcard viewer and the ship workbench wait before drawing
 *  (`authoredHullLoader`). */
export const prepareVoyagerHullModel = authoredHullLoader(
	"voyager",
	DISCOVERY_VOYAGER_GLB_URL,
	createVoyagerHullBuilder,
);
