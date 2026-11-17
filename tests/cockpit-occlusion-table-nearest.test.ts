import { expect, test } from "bun:test";
import {
	COCKPIT_OCCLUSION,
	cockpitSeenParts,
} from "../src/cockpit-occlusion-table";

test("an eye with no row sees none of the parts", () => {
	expect(cockpitSeenParts(0, "courier", "miner")).toEqual([]);
});

test("an extension midway between two measured poses reads the earlier pose", () => {
	const poses = COCKPIT_OCCLUSION[0].poses;
	const index = poses.findIndex(
		(pose, n) => n > 0 && pose.seen.join() !== poses[n - 1].seen.join(),
	);
	expect(index).toBeGreaterThan(0);
	const first = poses[index - 1];
	const second = poses[index];
	const midway = (first.extension + second.extension) / 2;
	expect(first.seen).not.toEqual(second.seen);
	expect(cockpitSeenParts(midway, "courier", "pilot")).toEqual(first.seen);
});
