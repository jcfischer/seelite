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
} = {
	eyeKm: {
		x: 0,
		y: 0,
		z: -0.008,
	},
	seen: [],
};
