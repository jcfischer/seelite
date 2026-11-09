import { expect, test } from "bun:test";
import {
	COCKPIT_OCCLUSION,
	cockpitSeenParts,
} from "../src/cockpit-occlusion-table";

test("an extension midway between two measured poses reads the earlier pose", () => {
	const [first, second] = COCKPIT_OCCLUSION[0].poses;
	const midway = (first.extension + second.extension) / 2;
	expect(first.seen).not.toEqual(second.seen);
	expect(cockpitSeenParts(midway, "courier", "pilot")).toEqual(first.seen);
});
