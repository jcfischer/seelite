/**
 * https://github.com/jcfischer/seelite/issues/920
 * What the Longwall's hull hides from the cockpit eye (D-D20), for the drill
 * posed by `poseLongwallDrill` at each extension, measured by
 * `cockpitOcclusion` and written by `WRITE_COCKPIT_OCCLUSION=1 bun test
 * tests/cockpit-occlusion-table.test.ts`; that test fails when it is stale.
 */
import type { Vec3 } from "./vec3";

export const COCKPIT_OCCLUSION: {
	readonly eyeKm: Vec3;
	readonly poses: readonly {
		readonly extension: number;
		readonly seen: readonly string[];
	}[];
} = {
	eyeKm: {
		x: 0,
		y: 0,
		z: -0.008,
	},
	poses: [
		{
			extension: 0,
			seen: ["anchor-3-elbow"],
		},
		{
			extension: 0.25,
			seen: ["anchor-2-elbow", "anchor-3-elbow"],
		},
		{
			extension: 0.5,
			seen: [
				"anchor-2-elbow",
				"anchor-2-foot",
				"anchor-2-lower",
				"anchor-2-lower-rod",
				"anchor-3-elbow",
				"anchor-3-foot",
				"anchor-3-lower",
				"anchor-3-lower-rod",
			],
		},
		{
			extension: 0.75,
			seen: [],
		},
		{
			extension: 1,
			seen: [],
		},
	],
};

/** The parts the cockpit sees with the drill at `extension`: the row of the nearest measured pose. */
export function cockpitSeenParts(extension: number): readonly string[] {
	let best = COCKPIT_OCCLUSION.poses[0];
	for (const pose of COCKPIT_OCCLUSION.poses)
		if (
			Math.abs(pose.extension - extension) <
			Math.abs(best.extension - extension)
		)
			best = pose;
	return best?.seen ?? [];
}
