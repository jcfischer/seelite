import * as THREE from "three";
import { authoredHullLoader, createAuthoredHullBuilder } from "./authored-hull";
import { LANCE_INTERCEPTOR_GLB_URL } from "./model-urls";
import type { AuthoredHullBuilder } from "./ship-mesh";

/** The frame every authored interceptor's levels and glows hang under. */
export const INTERCEPTOR_FRAME_NAME = "interceptor-hull-frame";

/** The three levels' object names under `INTERCEPTOR_FRAME_NAME`. */
export const INTERCEPTOR_LEVEL_NAMES = {
	full: "interceptor-hull-model",
	reduced: "interceptor-hull-reduced",
	outline: "interceptor-hull-outline",
} as const;

/** One study metre in kilometres: the model is drawn at its own size. */
export const INTERCEPTOR_KM_PER_M = 0.001;

/**
 * The four drive mouths, study metres: engines at (±8, 0) and (0, ±8), 4.1 m
 * radius (`build_model.py`'s `small_ship`). **Measured off the shipped model,
 * not read off the source**: each barrel's aft cap closes its mouth at z −29.60
 * (radius 2.87), and the funnel wall runs out from there to the lip at
 * z −31.10, 2.9 m clear at −29.75 and 3.3 m at −30.95. The glow's plate stands
 * 10 cm aft of the cap and its radii stay inside the wall.
 * `tests/interceptor-hull.test.ts` measures every glow against every triangle.
 *
 * Sides are the ship's: the half-turn puts the study's +x engine on the port
 * side, and `dorsal` and `keel` are the engines above and below the axis.
 */
export const INTERCEPTOR_NOZZLES_M = {
	x: 8,
	y: 0,
	mounts: [
		{ side: "port", x: 8, y: 0 },
		{ side: "starboard", x: -8, y: 0 },
		{ side: "dorsal", x: 0, y: 8 },
		{ side: "keel", x: 0, y: -8 },
	],
	throatZ: -29.7,
	lipZ: -30.95,
	throatRadius: 2.7,
	lipRadius: 3.1,
} as const;

/** Prepare a loaded study scene once and return the builder `buildShipMesh`
 *  calls for every interceptor (`createAuthoredHullBuilder`). */
export function createInterceptorHullBuilder(
	template: THREE.Object3D,
): Promise<AuthoredHullBuilder> {
	return createAuthoredHullBuilder(template, {
		hull: "interceptor",
		frameName: INTERCEPTOR_FRAME_NAME,
		levelNames: INTERCEPTOR_LEVEL_NAMES,
		kmPerM: () => INTERCEPTOR_KM_PER_M,
		nozzles: INTERCEPTOR_NOZZLES_M,
	});
}

/** The model queue starts this when an interceptor is drawn or owed, and the
 *  postcard viewer and the ship workbench wait before drawing
 *  (`authoredHullLoader`). */
export const prepareInterceptorHullModel = authoredHullLoader(
	"interceptor",
	LANCE_INTERCEPTOR_GLB_URL,
	createInterceptorHullBuilder,
);
