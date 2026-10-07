/**
 * The cadence every version of the docking waltz plays is derived from
 * `THEME` (`CADENCE_THEME`), not typed again in each version (#738). This
 * holds the derivation to Strauss's last three bars as printed.
 */
import { expect, test } from "bun:test";
import { CADENCE_THEME } from "../src/music-danube";

test("the cadence is the theme's last three bars, from bar 0", () => {
	expect(CADENCE_THEME).toEqual([
		[0, 0, 78, 2],
		[0, 2, 76, 1],
		[1, 0, 83, 2],
		[1, 2, 81, 1],
		[2, 0, 74, 1],
		[2, 1.5, 74, 0.5],
		[2, 2, 74, 1],
	]);
});
