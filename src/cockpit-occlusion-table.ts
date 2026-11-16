/**
 * https://github.com/jcfischer/seelite/issues/920
 * What the Longwall's hull hides from each cockpit eye (D-D20), for the drill
 * posed by `poseLongwallDrill` at each extension, measured by
 * `cockpitOcclusion` and written to the JSON by `WRITE_COCKPIT_OCCLUSION=1 bun test
 * tests/cockpit-occlusion-table.test.ts`; that test fails when it is stale.
 */
import type { BridgeSeat, CabinId } from "./cockpit-eye";
import TABLE from "./cockpit-occlusion-table.json";
import type { Vec3 } from "./vec3";

export const COCKPIT_OCCLUSION = TABLE as readonly {
	readonly cabin: CabinId;
	readonly seat: BridgeSeat;
	readonly eyeKm: Vec3;
	readonly poses: readonly {
		readonly extension: number;
		readonly seen: readonly string[];
	}[];
}[];
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
	return best?.seen ?? [];
}
