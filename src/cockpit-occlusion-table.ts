/**
 * https://github.com/jcfischer/seelite/issues/920
 * What the Longwall's hull hides from each cockpit eye (D-D20), for the drill
 * posed by `poseLongwallDrill` at each extension, measured by
 * `cockpitOcclusion` and written by `WRITE_COCKPIT_OCCLUSION=1 bun test
 * tests/cockpit-occlusion-table.test.ts`; that test fails when it is stale.
 */
import type { BridgeSeat, CabinId } from "./cockpit-eye";
import type { Vec3 } from "./vec3";

export const COCKPIT_OCCLUSION: readonly {
	readonly cabin: CabinId;
	readonly seat: BridgeSeat;
	readonly eyeKm: Vec3;
	readonly poses: readonly {
		readonly extension: number;
		readonly seen: readonly string[];
	}[];
}[] = [
	{
		cabin: "courier",
		seat: "pilot",
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
	},
	{
		cabin: "miner",
		seat: "pilot",
		eyeKm: {
			x: -0.0006,
			y: 0.006803,
			z: -0.025,
		},
		poses: [
			{
				extension: 0,
				seen: ["anchor-1-body", "longwall-mount-port"],
			},
			{
				extension: 0.25,
				seen: [
					"anchor-1-body",
					"anchor-1-elbow",
					"anchor-1-sleeve",
					"longwall-mount-port",
				],
			},
			{
				extension: 0.5,
				seen: [
					"anchor-0-body",
					"anchor-0-elbow",
					"anchor-0-lower",
					"anchor-0-sleeve",
					"anchor-1-body",
					"anchor-1-elbow",
					"longwall-mount-port",
				],
			},
			{
				extension: 0.75,
				seen: [
					"anchor-0-body",
					"anchor-0-elbow",
					"anchor-0-sleeve",
					"anchor-1-body",
					"anchor-1-elbow",
					"anchor-1-lower",
					"anchor-1-sleeve",
					"longwall-mount-port",
				],
			},
			{
				extension: 1,
				seen: [
					"anchor-0-body",
					"anchor-0-sleeve",
					"anchor-1-body",
					"anchor-1-elbow",
					"anchor-1-lower",
					"anchor-1-sleeve",
					"longwall-mount-port",
				],
			},
		],
	},
	{
		cabin: "miner",
		seat: "miner",
		eyeKm: {
			x: 0.0006,
			y: 0.006803,
			z: -0.025,
		},
		poses: [
			{
				extension: 0,
				seen: ["longwall-mount-starboard"],
			},
			{
				extension: 0.25,
				seen: [
					"anchor-0-body",
					"anchor-0-elbow",
					"anchor-0-lower",
					"anchor-0-sleeve",
					"longwall-mount-starboard",
				],
			},
			{
				extension: 0.5,
				seen: [
					"anchor-0-body",
					"anchor-0-elbow",
					"anchor-0-lower",
					"anchor-1-body",
					"anchor-1-elbow",
					"anchor-1-sleeve",
					"longwall-mount-starboard",
				],
			},
			{
				extension: 0.75,
				seen: [
					"anchor-0-body",
					"anchor-0-elbow",
					"anchor-0-lower",
					"anchor-0-sleeve",
					"anchor-1-body",
					"anchor-1-elbow",
					"anchor-1-lower",
					"anchor-1-sleeve",
					"longwall-mount-starboard",
				],
			},
			{
				extension: 1,
				seen: [
					"anchor-0-body",
					"anchor-0-elbow",
					"anchor-0-foot",
					"anchor-0-lower",
					"anchor-0-sleeve",
					"anchor-1-body",
					"anchor-1-elbow",
					"anchor-1-sleeve",
					"longwall-mount-starboard",
				],
			},
		],
	},
];

/** The parts `cabin`'s eye sees with the drill at `extension`: the row of the nearest measured pose. */
export function cockpitSeenParts(
	extension: number,
	cabin: CabinId,
	seat: BridgeSeat,
): readonly string[] {
	const poses =
		COCKPIT_OCCLUSION.find((row) => row.cabin === cabin && row.seat === seat)
			?.poses ?? [];
	let best = poses[0];
	for (const pose of poses)
		if (
			Math.abs(pose.extension - extension) <
			Math.abs(best.extension - extension)
		)
			best = pose;
	// Stryker disable next-line ArrayDeclaration,OptionalChaining: every cabin and seat the game flies has a row, so best is defined and the fallback never runs
	return best?.seen ?? [];
}
