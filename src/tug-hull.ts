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
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createAuthoredHullBuilder } from "./authored-hull";
import { disposeSubtree } from "./gpu-teardown";
import { HULL_SPECS } from "./hull";
import type { ModelProgressListener } from "./model-progress";
import { BOLLARD_TUG_GLB_URL } from "./model-urls";
import {
	type AuthoredHullBuilder,
	buildShipMesh,
	installAuthoredHull,
} from "./ship-mesh";
import { ventThroats } from "./vent-plumes";

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

let ready: Promise<void> | undefined;

/** Games start this after construction, once the courier's has settled, and
 *  refresh their cached tugs on resolution (`loadAuthoredHullsAfterBoot`).
 *  The postcard viewer and the ship workbench wait before drawing.
 *  `onProgress` hears the download this call starts, as the courier's does. */
export function prepareTugHullModel(
	onProgress?: ModelProgressListener,
): Promise<void> {
	return (ready ??= new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.loadAsync(BOLLARD_TUG_GLB_URL, onProgress)
		.then(async (gltf) => {
			installAuthoredHull("tug", await createTugHullBuilder(gltf.scene));
			// One tug built now, before refreshing stand-ins, for the courier's
			// reason: the first build places the nav lights by raycast against
			// the model, and its throats are measured off the same build.
			const { root } = buildShipMesh("tug", HULL_SPECS.tug.variant);
			ventThroats(root, "tug");
			disposeSubtree(root);
		})
		.catch((error) => {
			ready = undefined;
			throw error;
		}));
}
