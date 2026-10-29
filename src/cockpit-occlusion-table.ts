/**
 * https://github.com/jcfischer/seelite/issues/920
 * What the Longwall's hull hides from the cockpit eye (D-D20), measured by
 * `cockpitOcclusion` and written by `WRITE_COCKPIT_OCCLUSION=1 bun test
 * tests/cockpit-occlusion-table.test.ts`; that test fails when it is stale.
 */
import type { Vec3 } from "./vec3";

export const COCKPIT_OCCLUSION: {
	readonly eyeKm: Vec3;
	readonly seen: readonly string[];
	readonly muzzlesSeen: readonly boolean[];
	readonly hullBoxKm: { readonly min: Vec3; readonly max: Vec3 };
} = {
	eyeKm: {
		x: 0,
		y: 0,
		z: -0.008,
	},
	seen: [],
	muzzlesSeen: [false, false, false],
	hullBoxKm: {
		min: {
			x: -0.017000000000000008,
			y: -0.005407084465026855,
			z: -0.039799999952316284,
		},
		max: {
			x: 0.017000000000000008,
			y: 0.00939291524887085,
			z: 0.04220000004768372,
		},
	},
};
