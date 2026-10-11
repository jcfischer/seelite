/**
 * The authored courier exterior (node #812): the O4 hull the principal
 * approved on #795 (visual commit `720c928`), drawn as the courier's selected
 * variant in place of the procedural Kestrel.
 *
 * The study (`spikes/courier-hull/`) is metres, Y up, **+Z forward**; a hull
 * mesh here is kilometres with its nose at **-Z** (`buildShipMesh`). So the
 * model is turned a half-turn about Y and scaled — uniformly, which is what
 * keeps the approved silhouette.
 *
 * **The scale is set by the courier's length and nothing else, and that is a
 * decision about the roster rather than about this hull.** Every hull's turn
 * rate is solved against the courier's: `referenceHandling` in
 * `scripts/measure-vent-shares.ts` scales each row's agility by
 * `thrust / length` *over the courier's*, so a courier drawn at the study's
 * own 61.0 m would retune the angular figures of all twelve hulls. The model
 * is scaled to land inside the declared 57.5 m instead; its beam and height
 * are then what the mesh measures, and `HULL_SPECS.courier.env` carries them
 * (`tests/hull.test.ts` holds every declared box to its built one, and the
 * test preload installs this model, so the courier's row measures it).
 *
 * **Its box sits where the old one did**: centred on `envCentre`, so the
 * collision box, the station proxies' reach and a wreck's box keep the frame
 * they were written in.
 *
 * The study's four `interior-screen-*` faces carried fixture navigation and
 * flight values in its viewer. Those are not the ship's, and the exterior's
 * cabin is never the one a pilot reads (the cabin pass draws that), so here
 * they are unpowered — the cockpit model's own convention for a screen with
 * no live source.
 *
 * The model is built by `authored-hull.ts`, the tug's way too (node #814):
 * this module supplies the courier's scale, nozzles and the meshes it treats
 * differently — the screens, and the cabin and pilot behind the canopy, which
 * cast no shadow and are left out of the reduced levels.
 */
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
	AUTHORED_ALLOY_MATERIAL,
	AUTHORED_ALLOY_ROUGHNESS,
	createAuthoredHullBuilder,
} from "./authored-hull";
import { levelErrorKm } from "./authored-levels";
import { disposeSubtree, shared } from "./gpu-teardown";
import type { ModelProgressListener } from "./model-progress";
import { COURIER_HULL_GLB_URL } from "./model-urls";
import { HULL_SPECS } from "./hull";
import {
	type AuthoredHullBuilder,
	HULL_REACH_KM,
	buildShipMesh,
	installAuthoredHull,
} from "./ship-mesh";
import { ventThroats } from "./vent-plumes";

/** The frame every authored courier's levels and glows hang under. */
export const COURIER_FRAME_NAME = "courier-hull-frame";

/** The three levels' object names under `COURIER_FRAME_NAME`: the model
 *  and its two reduced copies. One copy of the names, for the instruments
 *  and rows that pick a level out of a built courier. */
export const COURIER_LEVEL_NAMES = {
	full: "courier-hull-model",
	reduced: "courier-hull-reduced",
	outline: "courier-hull-outline",
} as const;

/** The study's four fixture screens: unpowered in the game (see above). */
export const FIXTURE_SCREEN_PREFIX = "interior-screen-";

/** The cabin and the pilot, seen only through the canopy: left out of the
 *  reduced levels, where the canopy is a few pixels across. */
const BEHIND_THE_CANOPY = /^(interior-|pilot-)/;

/**
 * The target error the courier's reduced levels are made to, kilometres:
 * half a device pixel in `LEVEL_FRAME` at each level's band edge, in courier
 * reaches (`levelErrorKm`, `authored-levels.ts`).
 */
export const courierLevelErrorKm = (level: "reduced" | "outline"): number =>
	levelErrorKm(level, HULL_REACH_KM.courier);

/**
 * How far inside the declared length the model is drawn, kilometres. The
 * envelope row allows a declared box at most 0.1 m over the built one and
 * never under it; half that keeps both sides clear of float error.
 */
export const COURIER_LENGTH_INSET_KM = 0.00005;

/**
 * The two drive nozzles, study metres: the throat's centre on each nacelle, // glossary-ignore: throat
 * the closed throat plate's plane, the bowl's lip plane and radii. Read off // glossary-ignore: throat
 * `build_model.py` (its "aft circular thrust chamber"): the throat plate is // glossary-ignore: throat
 * the 2.34 m ring at z −25.8 and the inner wall runs out to the 2.94 m ring
 * at z −27.7. The glow sits a few centimetres inside that wall.
 */
export const COURIER_NOZZLES_M = {
	x: 21.9,
	y: -0.38,
	throatZ: -25.9,
	lipZ: -27.55,
	throatRadius: 2.25,
	lipRadius: 2.85,
} as const;

/** The courier study material whose roughness the game raises (#843); the
 *  floor is `authored-hull.ts`'s, shared with the tug. */
export const COURIER_ALLOY_MATERIAL = AUTHORED_ALLOY_MATERIAL;
export const COURIER_ALLOY_ROUGHNESS = AUTHORED_ALLOY_ROUGHNESS;

/**
 * Prepare a loaded study scene once and return the builder `buildShipMesh`
 * calls for every courier (`createAuthoredHullBuilder`).
 *
 * **The scale is set by the courier's length and nothing else** (see above):
 * the model is drawn `COURIER_LENGTH_INSET_KM` inside the declared length.
 */
export function createCourierHullBuilder(
	template: THREE.Object3D,
): Promise<AuthoredHullBuilder> {
	const unpowered = shared(new THREE.MeshBasicMaterial({ color: 0x01090b }));
	unpowered.name = "interior-screen-unpowered";
	return createAuthoredHullBuilder(template, {
		hull: "courier",
		frameName: COURIER_FRAME_NAME,
		levelNames: COURIER_LEVEL_NAMES,
		kmPerM: (box) =>
			(HULL_SPECS.courier.env.lengthKm - COURIER_LENGTH_INSET_KM) /
			(box.max.z - box.min.z),
		nozzles: COURIER_NOZZLES_M,
		prepareMesh: (mesh) => {
			const screen = mesh.name.startsWith(FIXTURE_SCREEN_PREFIX);
			if (screen) mesh.material = unpowered;
			// The cabin and the pilot sit inside the closed hull: nothing they
			// would shade is lit through it, so they stay out of the shadow pass.
			mesh.castShadow = !screen && !BEHIND_THE_CANOPY.test(mesh.name);
		},
		skipInLevels: (mesh) => BEHIND_THE_CANOPY.test(mesh.name),
	});
}

let ready: Promise<void> | undefined;

/** Games start this after construction and refresh their cached couriers on
 *  resolution (node #831). The postcard viewer waits before drawing; the ship
 *  workbench waits before building its review hulls.
 *  `onProgress` hears the download this call starts (#833), as
 *  `prepareCoriolisModel`'s does: without it the boot's tracker has no total
 *  for this model and draws its bar without a value until it resolves. */
export function prepareCourierHullModel(
	onProgress?: ModelProgressListener,
): Promise<void> {
	return (ready ??= new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.loadAsync(COURIER_HULL_GLB_URL, onProgress)
		.then(async (gltf) => {
			installAuthoredHull(
				"courier",
				await createCourierHullBuilder(gltf.scene),
			);
			// One courier built now, before refreshing stand-ins: the first build
			// places the nav lights by raycast against the model, about 0.3 s,
			// and without this the first Traffic courier drawn mid-flight
			// would pay it. Every later build reuses them. Its throats are
			// measured off the same build for the same reason (`ventThroats`
			// keeps them): otherwise a pilot pays it during replacement,
			// and a shipyard swap to one pays it on the frame.
			const { root } = buildShipMesh("courier", HULL_SPECS.courier.variant);
			ventThroats(root, "courier");
			disposeSubtree(root);
		})
		.catch((error) => {
			ready = undefined;
			throw error;
		}));
}
